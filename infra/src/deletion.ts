// `POST /me/deletion`: the caller deletes their own account, at once or as the 30th Kyiv day after
// the press ends, behind a sign-in under five minutes old; `DELETE /me/deletion` cancels the second
// (*Auth model*, *User schema and deletes*). The deletion is `account-delete.ts`'s; a press after a
// failure goes on from where it stopped, and `purge.ts` runs the scheduled one.
import {
  AdminDeleteUserCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { canonicalAddress } from '@quirenote/core/address';
import { deletionLastDay } from '@quirenote/core/deletion';

import {
  type AccountIdentity,
  deleteAccount,
  signOutEverywhere,
  soleSuperAdmin,
} from './account-delete';
import {
  FORBIDDEN,
  NO_APPLICATION,
  PENDING,
  REJECTED,
  SCHEDULED,
  assertsVerified,
  authorize,
} from './authorize';
import { connect } from './dsql';
import {
  INSUFFICIENT_USER_AUTHENTICATION,
  INTERNAL,
  INVALID,
  REAUTHENTICATED_SECONDS,
  TOO_LARGE,
  type ApiEvent,
  type ApiResult,
  type Declared,
  type EmptyResult,
  authTimeOf,
  bodiless,
  canonicalUuid,
  claim,
  derived,
  json,
  noContent,
  readJson,
  respond,
} from './http';
import { loggable } from './log';
import type { SqlClient } from './migrate';

export const DELETION_ROUTE = 'POST /me/deletion';
/** RFC 9110 §9.3.5: the scheduled deletion is the resource, and deleting it cancels it. */
export const CANCEL_ROUTE = 'DELETE /me/deletion';

const DELETED = json(200, '{"status":"deleted"}');
/** RFC 9110 §15.3.3, accepted and not yet done: the day is the last one a cancel is taken. */
const SCHEDULED_FOR = derived({
  statusCode: 202,
  name: 'scheduled',
  headers: [],
  example: { status: 'scheduled', date: '2026-11-29' },
});
/** Idempotent as a DELETE is: the same answer whether a deletion waited or not. */
const CANCELLED = bodiless({ statusCode: 204, name: 'cancelled', headers: [] });
// Its own refusal: the repair is another super-admin, which no press of this one makes.
const SOLE_SUPER_ADMIN = json(409, '{"error":"sole_super_admin"}');

/** What the routes can answer, and the only list of it: `openapi.ts` builds the document from here,
 *  and `deletion.test.ts` proves it against what the routes really answer. */
export const RESPONSES: Record<string, readonly (ApiResult | Declared)[]> = {
  [DELETION_ROUTE]: [
    DELETED,
    SCHEDULED_FOR,
    INVALID,
    TOO_LARGE,
    INSUFFICIENT_USER_AUTHENTICATION,
    SOLE_SUPER_ADMIN,
    PENDING,
    REJECTED,
    SCHEDULED,
    FORBIDDEN,
    INTERNAL,
  ],
  [CANCEL_ROUTE]: [CANCELLED, PENDING, REJECTED, NO_APPLICATION, SCHEDULED, FORBIDDEN, INTERNAL],
};

export const REQUEST_BODY = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['timing'],
        additionalProperties: false,
        /** When the account goes: at once, or as the 30th Kyiv day after the press ends. */
        properties: { timing: { type: 'string', enum: ['now', 'later'] } },
      },
    },
  },
} as const;

type Timing =
  (typeof REQUEST_BODY.content)['application/json']['schema']['properties']['timing']['enum'][number];
const TIMINGS: readonly unknown[] =
  REQUEST_BODY.content['application/json'].schema.properties.timing.enum;

export interface DeletionDeps {
  user: SqlClient;
  identity: AccountIdentity;
  userPoolId: string | undefined;
  /** Milliseconds, as `Date.now`. */
  now: () => number;
}

// ONLY WHILE NONE WAITS, so a second press keeps the first one's day and instant.
const HOLD = `UPDATE app_user SET deletion_due = $2, deletion_requested_at = $3
               WHERE user_id = $1 AND deletion_due IS NULL`;
const HELD_DAY = `SELECT deletion_due::text AS due FROM app_user WHERE user_id = $1`;
const CANCEL = `UPDATE app_user SET deletion_due = NULL, deletion_requested_at = NULL
                 WHERE user_id = $1`;

export async function deleteOwnAccount(deps: DeletionDeps, event: ApiEvent): Promise<ApiResult> {
  // THE WHOLE BODY IS INSIDE THE CATCH, THE GATE INCLUDED, as `approve.ts` says why.
  try {
    // NO TERMS ASKED, erasure waiting on no acceptance; a caller with no row is a deletion stopped
    // before its identity, which this call finishes, the function shipping no registration switch.
    // A held account is refused here as everywhere: one deletion waits already.
    const gate = await authorize(deps.user, event, { terms: 'optional', now: deps.now });
    if ('refusal' in gate && gate.refusal !== NO_APPLICATION) return gate.refusal;

    const read = readJson(event);
    if ('statusCode' in read) return read;
    const body = read.value;
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'timing') ||
      !TIMINGS.includes((body as { timing?: unknown }).timing)
    ) {
      return INVALID;
    }
    const timing = (body as { timing: Timing }).timing;

    // `>=`, as the relay's sign-out everywhere draws the same line.
    const authTime = authTimeOf(event);
    if (authTime === undefined || deps.now() / 1000 - authTime >= REAUTHENTICATED_SECONDS) {
      return INSUFFICIENT_USER_AUTHENTICATION;
    }

    const UserPoolId = deps.userPoolId;
    if (!UserPoolId) {
      console.error('deletion: USER_POOL_ID is not set on this function');
      return INTERNAL;
    }

    const claims = event.requestContext?.authorizer?.jwt?.claims;
    const username = claim(claims, 'cognito:username');

    if (timing === 'later') {
      // Only an account that holds a row can be held.
      if (!('caller' in gate)) return FORBIDDEN;
      const { userId, email } = gate.caller;
      if (await soleSuperAdmin(deps.user, userId)) return SOLE_SUPER_ADMIN;
      // SESSIONS FIRST, as the deletion ends them: a failure holds nothing, and asking again is
      // asked of a sign-in the gate still admits.
      await signOutEverywhere(deps.identity, UserPoolId, email, username ? [username] : []);
      const pressed = new Date(deps.now());
      await deps.user.query(HOLD, [userId, deletionLastDay(pressed), pressed.toISOString()]);
      const [{ due }] = (await deps.user.query<{ due: string }>(HELD_DAY, [userId])).rows;
      return respond(SCHEDULED_FOR, {}, JSON.stringify({ status: 'scheduled', date: due }));
    }

    // Without a row, the claims are read as the gate reads them, by its own rule for an address:
    // every identity under it is about to go.
    const account =
      'caller' in gate
        ? { userId: gate.caller.userId, email: gate.caller.email }
        : {
            userId: canonicalUuid(claim(claims, 'sub')),
            email: assertsVerified(claims) ? canonicalAddress(claim(claims, 'email')) : undefined,
          };
    if (account.userId === undefined || account.email === undefined) return FORBIDDEN;

    const done = await deleteAccount(deps.user, deps.identity, UserPoolId, {
      userId: account.userId,
      email: account.email,
      username,
    });
    if (done === 'sole_super_admin') return SOLE_SUPER_ADMIN;
    // The gate refuses the demo before this, no token carrying its `sub`.
    if (done === 'demo') return FORBIDDEN;
    return DELETED;
  } catch (err) {
    console.error('deletion failed', loggable(err));
    return INTERNAL;
  }
}

/** The cancel takes no fresher sign-in than the one that followed the request: the gate admits
 *  only that one, and refuses an older one with the day, as every route does. */
export async function cancelDeletion(
  deps: DeletionDeps,
  event: ApiEvent,
): Promise<ApiResult | EmptyResult> {
  try {
    const gate = await authorize(deps.user, event, {
      terms: 'optional',
      held: 'cancel',
      now: deps.now,
    });
    if ('refusal' in gate) return gate.refusal;
    await deps.user.query(CANCEL, [gate.caller.userId]);
    return noContent(CANCELLED, {});
  } catch (err) {
    console.error('deletion cancel failed', loggable(err));
    return INTERNAL;
  }
}

const identityClient = new CognitoIdentityProviderClient({});
const sdk: AccountIdentity = {
  adminUserGlobalSignOut: (input) => identityClient.send(new AdminUserGlobalSignOutCommand(input)),
  adminDeleteUser: (input) => identityClient.send(new AdminDeleteUserCommand(input)),
  listUsers: (input) => identityClient.send(new ListUsersCommand(input)),
};

export async function handler(event: ApiEvent): Promise<ApiResult | EmptyResult> {
  // A connection failure answers rather than throws, as the applications endpoint's does.
  const client = await connect().catch((err: unknown) => {
    console.error('deletion connect failed', err);
    return undefined;
  });
  if (client === undefined) return INTERNAL;

  try {
    const deps = {
      user: client,
      identity: sdk,
      userPoolId: process.env.USER_POOL_ID,
      now: Date.now,
    };
    return event.routeKey === CANCEL_ROUTE
      ? await cancelDeletion(deps, event)
      : await deleteOwnAccount(deps, event);
  } finally {
    await client.end().catch((err: unknown) => console.error('deletion disconnect failed', err));
  }
}
