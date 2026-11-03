// `GET /me`: the caller and its settings, read on every load beside `/view` and so answered from the
// gate's row alone (*Cloud target*, *Auth model*). `GET /me/account` answers the profile's fields,
// read by `/profile` alone; a field it does not hold is omitted rather than null (OIDC Core §5.3.2).
//
// Each tag is a digest of its body (RFC 9110 §8.8.3): a profile's 304 needs the pool's answer as much
// as a 200 does, so composing it from inputs would save no read and add a list to keep in step.
import { createHash } from 'node:crypto';

import {
  AdminGetUserAuthFactorsCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { kyivDateIso } from '@quirenote/core/dates';
import { SETTINGS_DEFAULTS, settingsOf } from '@quirenote/core/settings';

import { soleSuperAdmin } from './account-delete';
import {
  FORBIDDEN,
  NO_APPLICATION,
  PENDING,
  REJECTED,
  SCHEDULED,
  TERMS,
  authorize,
} from './authorize';
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
/** The profile's fields, so a settings write leaves this read's tag as it was. */
export const ACCOUNT_ROUTE = 'GET /me/account';

/** Stored by the browser alone and revalidated on every use, as `/view` is. */
const CACHE_POLICY = 'private, no-cache';

const PROFILE = {
  memberSince: '2026-03-02',
  googleLinked: false,
  passwordSet: true,
  assets: 4,
  transactions: 25,
  firstTransaction: '2026-03-09',
};
// The only active super-admin's, a variant of its own: `PROFILE`, a plain user's, never carries
// `soleSuperAdmin`. The counts are those of an account that only administers (#55).
const SOLE_PROFILE = {
  memberSince: '2026-03-02',
  googleLinked: false,
  passwordSet: true,
  assets: 0,
  transactions: 0,
  soleSuperAdmin: true,
};

const ME = derived({
  statusCode: 200,
  name: 'me',
  headers: ['etag', 'cache-control'],
  example: {
    userId: '<the sub>',
    email: 'owner@quirenote.com',
    role: 'user',
    settings: SETTINGS_DEFAULTS,
  },
});
const ACCOUNT = derived({
  statusCode: 200,
  name: 'account',
  headers: ['etag', 'cache-control'],
  example: PROFILE,
});
const SOLE_ACCOUNT = derived({
  statusCode: 200,
  name: 'sole_super_admin',
  headers: ['etag', 'cache-control'],
  example: SOLE_PROFILE,
});
const UNCHANGED = bodiless({ name: 'not_modified', headers: ['etag', 'cache-control'] });

/** What the route can answer, and the only list of it: `openapi.ts` builds the document from here,
 *  and `me.test.ts` proves it against what the route really answers. */
export const RESPONSES: Record<string, readonly (ApiResult | Declared)[]> = {
  [ME_ROUTE]: [
    ME,
    UNCHANGED,
    PENDING,
    REJECTED,
    NO_APPLICATION,
    FORBIDDEN,
    TERMS,
    SCHEDULED,
    INTERNAL,
  ],
  [ACCOUNT_ROUTE]: [
    ACCOUNT,
    SOLE_ACCOUNT,
    UNCHANGED,
    PENDING,
    REJECTED,
    NO_APPLICATION,
    FORBIDDEN,
    TERMS,
    SCHEDULED,
    INTERNAL,
  ],
};

const IF_NONE_MATCH = [
  { name: 'If-None-Match', in: 'header', required: false, schema: { type: 'string' } },
];
export const PARAMETERS = { [ME_ROUTE]: IF_NONE_MATCH, [ACCOUNT_ROUTE]: IF_NONE_MATCH };

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

/** The gate, then the profile's fields: a refusal or a 500 as it is. */
async function readAccount(
  deps: MeDeps,
  event: ApiEvent,
): Promise<ApiResult | { sole: boolean; account: Record<string, unknown> }> {
  const gate = await authorize(deps.user, event);
  if ('refusal' in gate) return gate.refusal;
  const UserPoolId = deps.userPoolId;
  if (!UserPoolId) {
    console.error('me: USER_POOL_ID is not set on this function');
    return INTERNAL;
  }
  const { userId, role } = gate.caller;
  // The pool's own username for the caller: a `sub` names a local user only, and a profile an open
  // registration let in through Google is `<provider>_<id>`, its case Cognito's own. Every ID token
  // carries it, so one without it is refused as the gate refuses a token it cannot read.
  const username = claim(event.requestContext?.authorizer?.jwt?.claims, 'cognito:username');
  if (username === undefined) return FORBIDDEN;
  const [member, held, moved, pooled, factors, sole] = await Promise.all([
    deps.user.query<{ decided_at: string }>(MEMBER, [userId]),
    deps.user.query<{ assets: number }>(ASSETS, [userId]),
    deps.user.query<Moved>(TRANSACTIONS, [userId]),
    deps.identity.adminGetUser({ UserPoolId, Username: username }),
    deps.identity.adminGetUserAuthFactors({ UserPoolId, Username: username }),
    // Only a super-admin can be the only one, so nobody else's read pays for the question.
    role === 'super_admin' && soleSuperAdmin(deps.user, userId),
  ]);
  const { transactions, first_transaction: first } = moved.rows[0];
  return {
    sole,
    account: {
      memberSince: kyivDateIso(new Date(utc(member.rows[0].decided_at))),
      googleLinked: googleLinked(pooled.UserAttributes),
      passwordSet: passwordSet(pooled.UserStatus, factors.ConfiguredUserAuthFactors),
      assets: held.rows[0].assets,
      transactions,
      ...(first === null ? {} : { firstTransaction: first }),
      // The deletion's refusal, shown before any press (#572).
      ...(sole ? { soleSuperAdmin: true } : {}),
    },
  };
}

/** The body under a weak tag of its own bytes, or a 304 when the client holds that tag. */
function tagged(event: ApiEvent, declared: typeof ME, text: string): ApiResult | EmptyResult {
  const etag = `W/"${createHash('sha256').update(text, 'utf8').digest('base64url')}"`;
  const headers = { etag, 'cache-control': CACHE_POLICY };
  if (weakMatch(headerValues(event, 'if-none-match'), etag)) {
    return notModified(UNCHANGED, headers);
  }
  return respond(declared, headers, text);
}

export async function me(deps: MeDeps, event: ApiEvent): Promise<ApiResult | EmptyResult> {
  // THE WHOLE BODY IS INSIDE THE CATCH, THE GATE INCLUDED, as `approve.ts` says why.
  try {
    const gate = await authorize(deps.user, event);
    if ('refusal' in gate) return gate.refusal;
    const { userId, email, role, settings } = gate.caller;
    return tagged(
      event,
      ME,
      JSON.stringify({ userId, email, role, settings: settingsOf(settings) }),
    );
  } catch (err) {
    console.error('me failed', loggable(err));
    return INTERNAL;
  }
}

export async function meAccount(deps: MeDeps, event: ApiEvent): Promise<ApiResult | EmptyResult> {
  try {
    const read = await readAccount(deps, event);
    if ('statusCode' in read) return read;
    return tagged(event, read.sole ? SOLE_ACCOUNT : ACCOUNT, JSON.stringify(read.account));
  } catch (err) {
    console.error('me/account failed', loggable(err));
    return INTERNAL;
  }
}

const identityClient = new CognitoIdentityProviderClient({});
export const identityReader: IdentityReader = {
  adminGetUser: (input) => identityClient.send(new AdminGetUserCommand(input)),
  adminGetUserAuthFactors: (input) =>
    identityClient.send(new AdminGetUserAuthFactorsCommand(input)),
};
