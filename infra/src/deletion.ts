// `POST /me/deletion`: the caller deletes their own account, at once, behind a sign-in under five
// minutes old (*Auth model*, *User schema and deletes*). The deletion is `account-delete.ts`'s; a
// press after a failure goes on from where it stopped.
import {
  AdminDeleteUserCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { canonicalAddress } from '@quirenote/core/address';

import { type AccountIdentity, deleteAccount } from './account-delete';
import {
  FORBIDDEN,
  NO_APPLICATION,
  PENDING,
  REJECTED,
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
  canonicalUuid,
  claim,
  json,
  readJson,
} from './http';
import { loggable } from './log';
import type { SqlClient } from './migrate';

export const DELETION_ROUTE = 'POST /me/deletion';

const DELETED = json(200, '{"status":"deleted"}');
// Its own refusal: the repair is another super-admin, which no press of this one makes.
const SOLE_SUPER_ADMIN = json(409, '{"error":"sole_super_admin"}');

/** What the route can answer, and the only list of it: `openapi.ts` builds the document from here,
 *  and `deletion.test.ts` proves it against what the route really answers. */
export const RESPONSES: Record<string, readonly ApiResult[]> = {
  [DELETION_ROUTE]: [
    DELETED,
    INVALID,
    TOO_LARGE,
    INSUFFICIENT_USER_AUTHENTICATION,
    SOLE_SUPER_ADMIN,
    PENDING,
    REJECTED,
    FORBIDDEN,
    INTERNAL,
  ],
};

export const REQUEST_BODY = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['timing'],
        additionalProperties: false,
        /** When the account goes; `now` alone until a scheduled deletion exists. */
        properties: { timing: { type: 'string', enum: ['now'] } },
      },
    },
  },
} as const;

export interface DeletionDeps {
  user: SqlClient;
  identity: AccountIdentity;
  userPoolId: string | undefined;
  /** Milliseconds, as `Date.now`. */
  now: () => number;
}

/** The sign-in's age, from the ID token's `auth_time`, which the HTTP API hands on as text; a number
 *  is the form the token itself carries. Anything else is no sign-in this route can date. */
const authTimeOf = (event: ApiEvent): number | undefined => {
  const value: unknown = event.requestContext?.authorizer?.jwt?.claims?.auth_time;
  if (typeof value === 'number') return Number.isInteger(value) ? value : undefined;
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : undefined;
};

export async function deleteOwnAccount(deps: DeletionDeps, event: ApiEvent): Promise<ApiResult> {
  // THE WHOLE BODY IS INSIDE THE CATCH, THE GATE INCLUDED, as `approve.ts` says why.
  try {
    // NO TERMS ASKED, erasure waiting on no acceptance; a caller with no row is a deletion stopped
    // before its identity, which this call finishes, the function shipping no registration switch.
    const gate = await authorize(deps.user, event, { terms: 'optional' });
    if ('refusal' in gate && gate.refusal !== NO_APPLICATION) return gate.refusal;

    const read = readJson(event);
    if ('statusCode' in read) return read;
    const body = read.value;
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'timing') ||
      (body as { timing?: unknown }).timing !== 'now'
    ) {
      return INVALID;
    }

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

    // Without a row, the claims are read as the gate reads them, by its own rule for an address:
    // every identity under it is about to go.
    const claims = event.requestContext?.authorizer?.jwt?.claims;
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
      username: claim(claims, 'cognito:username'),
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

const identityClient = new CognitoIdentityProviderClient({});
const sdk: AccountIdentity = {
  adminUserGlobalSignOut: (input) => identityClient.send(new AdminUserGlobalSignOutCommand(input)),
  adminDeleteUser: (input) => identityClient.send(new AdminDeleteUserCommand(input)),
  listUsers: (input) => identityClient.send(new ListUsersCommand(input)),
};

export async function handler(event: ApiEvent): Promise<ApiResult> {
  // A connection failure answers rather than throws, as the applications endpoint's does.
  const client = await connect().catch((err: unknown) => {
    console.error('deletion connect failed', err);
    return undefined;
  });
  if (client === undefined) return INTERNAL;

  try {
    return await deleteOwnAccount(
      { user: client, identity: sdk, userPoolId: process.env.USER_POOL_ID, now: Date.now },
      event,
    );
  } finally {
    await client.end().catch((err: unknown) => console.error('deletion disconnect failed', err));
  }
}
