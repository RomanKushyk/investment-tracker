// `GET /me`: the caller's own account, read by the screens that show it and never at sign-in or on a
// load, which `/view` serves alone (*Cloud target*, *Auth model*). It carries what a screen shows,
// and a field it does not hold is omitted rather than null (OIDC Core §5.3.2).
//
// The tag is a digest of the body (RFC 9110 §8.8.3): a 304 needs the pool's answer as much as a 200
// does, so composing it from inputs would save no read and add a list to keep in step.
import { createHash } from 'node:crypto';

import {
  AdminGetUserAuthFactorsCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { kyivDateIso } from '@quirenote/core/dates';
import { SETTINGS_DEFAULTS, settingsOf } from '@quirenote/core/settings';

import { FORBIDDEN, NO_APPLICATION, PENDING, REJECTED, TERMS, authorize } from './authorize';
import {
  INTERNAL,
  type ApiEvent,
  type ApiResult,
  type Declared,
  type EmptyResult,
  bodiless,
  claim,
  derived,
  headerValues,
  notModified,
  respond,
  weakMatch,
} from './http';
import { utc } from './ledger';
import { loggable } from './log';
import type { SqlClient } from './migrate';
import { GOOGLE } from './providers';

export const ME_ROUTE = 'GET /me';

/** Stored by the browser alone and revalidated on every use, as `/view` is. */
const CACHE_POLICY = 'private, no-cache';

const ME = derived({
  statusCode: 200,
  name: 'me',
  headers: ['etag', 'cache-control'],
  example: {
    userId: '<the sub>',
    email: 'owner@quirenote.com',
    role: 'user',
    memberSince: '2026-03-02',
    googleLinked: false,
    passwordSet: true,
    assets: 4,
    transactions: 25,
    firstTransaction: '2026-03-09',
    settings: SETTINGS_DEFAULTS,
  },
});
const UNCHANGED = bodiless({ name: 'not_modified', headers: ['etag', 'cache-control'] });

/** What the route can answer, and the only list of it: `openapi.ts` builds the document from here,
 *  and `me.test.ts` proves it against what the route really answers. */
export const RESPONSES: Record<string, readonly (ApiResult | Declared)[]> = {
  [ME_ROUTE]: [ME, UNCHANGED, PENDING, REJECTED, NO_APPLICATION, FORBIDDEN, TERMS, INTERNAL],
};

export const PARAMETERS = {
  [ME_ROUTE]: [
    { name: 'If-None-Match', in: 'header', required: false, schema: { type: 'string' } },
  ],
};

/** The pool's two reads of the caller's user: its `identities`, naming the providers linked to it,
 *  and its status; and the sign-in factors configured on it. */
export type IdentityReader = {
  adminGetUser(input: {
    UserPoolId: string;
    Username: string;
  }): Promise<{ UserAttributes?: { Name?: string; Value?: string }[]; UserStatus?: string }>;
  adminGetUserAuthFactors(input: {
    UserPoolId: string;
    Username: string;
  }): Promise<{ ConfiguredUserAuthFactors?: string[] }>;
};

export interface MeDeps {
  user: SqlClient;
  identity: IdentityReader;
  userPoolId: string | undefined;
}

// `decided_at` is the membership, the approval's own date; the counts are the live dataset's.
const MEMBER = `SELECT to_char(decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS decided_at
                  FROM app_user WHERE user_id = $1`;
const ASSETS = `SELECT count(*)::int AS assets
                  FROM asset a JOIN app_user u ON u.dataset_id = a.dataset_id
                 WHERE u.user_id = $1`;
const TRANSACTIONS = `SELECT count(*)::int AS transactions,
                             to_char(min(t.date), 'YYYY-MM-DD') AS first_transaction
                        FROM "transaction" t JOIN app_user u ON u.dataset_id = t.dataset_id
                       WHERE u.user_id = $1`;
type Moved = { transactions: number; first_transaction: string | null };

/** Cognito writes the linked providers as JSON text on the user, `primary: false` each on a local
 *  one, each named as the template names its provider. */
const googleLinked = (attributes: { Name?: string; Value?: string }[] = []): boolean => {
  const value = attributes.find((a) => a.Name === 'identities')?.Value;
  if (value === undefined) return false;
  const identities = JSON.parse(value) as { providerName?: unknown }[];
  return identities.some((i) => i.providerName === GOOGLE);
};

/** A password of the account's own: the pool lists an invitation's password too, which stays
 *  `FORCE_CHANGE_PASSWORD` until replaced and is never the account's own (ASVS 5.0.0 6.4.1). */
const passwordSet = (status: string | undefined, factors: string[] = []): boolean =>
  status === 'CONFIRMED' && factors.includes('PASSWORD');

export async function me(deps: MeDeps, event: ApiEvent): Promise<ApiResult | EmptyResult> {
  // THE WHOLE BODY IS INSIDE THE CATCH, THE GATE INCLUDED, as `approve.ts` says why.
  try {
    const gate = await authorize(deps.user, event);
    if ('refusal' in gate) return gate.refusal;
    const UserPoolId = deps.userPoolId;
    if (!UserPoolId) {
      console.error('me: USER_POOL_ID is not set on this function');
      return INTERNAL;
    }
    const { userId, email, role, settings } = gate.caller;
    // The pool's own username for the caller: a `sub` names a local user only, and a profile an open
    // registration let in through Google is `<provider>_<id>`, its case Cognito's own. Every ID token
    // carries it, so one without it is refused as the gate refuses a token it cannot read.
    const username = claim(event.requestContext?.authorizer?.jwt?.claims, 'cognito:username');
    if (username === undefined) return FORBIDDEN;
    const [member, held, moved, pooled, factors] = await Promise.all([
      deps.user.query<{ decided_at: string }>(MEMBER, [userId]),
      deps.user.query<{ assets: number }>(ASSETS, [userId]),
      deps.user.query<Moved>(TRANSACTIONS, [userId]),
      deps.identity.adminGetUser({ UserPoolId, Username: username }),
      deps.identity.adminGetUserAuthFactors({ UserPoolId, Username: username }),
    ]);
    const { transactions, first_transaction: first } = moved.rows[0];
    const text = JSON.stringify({
      userId,
      email,
      role,
      memberSince: kyivDateIso(new Date(utc(member.rows[0].decided_at))),
      googleLinked: googleLinked(pooled.UserAttributes),
      passwordSet: passwordSet(pooled.UserStatus, factors.ConfiguredUserAuthFactors),
      assets: held.rows[0].assets,
      transactions,
      ...(first === null ? {} : { firstTransaction: first }),
      settings: settingsOf(settings),
    });
    const etag = `W/"${createHash('sha256').update(text, 'utf8').digest('base64url')}"`;
    const headers = { etag, 'cache-control': CACHE_POLICY };
    if (weakMatch(headerValues(event, 'if-none-match'), etag)) {
      return notModified(UNCHANGED, headers);
    }
    return respond(ME, headers, text);
  } catch (err) {
    console.error('me failed', loggable(err));
    return INTERNAL;
  }
}

const identityClient = new CognitoIdentityProviderClient({});
export const identityReader: IdentityReader = {
  adminGetUser: (input) => identityClient.send(new AdminGetUserCommand(input)),
  adminGetUserAuthFactors: (input) =>
    identityClient.send(new AdminGetUserAuthFactorsCommand(input)),
};
