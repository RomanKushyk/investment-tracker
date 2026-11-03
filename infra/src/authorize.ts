// The gate every authenticated route reads, and the reason it is a module rather than a Lambda.
//
// A CLAIM IS STAMPED ONCE AT ISSUE TIME AND NEVER REVISITED, which is the argument the whole auth
// model rests on. API Gateway's native authorizer proves the token — signature, issuer, audience,
// expiry — and can prove nothing that has happened since. So AUTHENTICATION is the authorizer's
// and AUTHORIZATION is this file's, read from the `app_user` row on every request (*Auth model*).
// It is the same reason a group in a token cannot carry the role: removing somebody from a
// super-admin group would change nothing until their token refreshed, and the row is read anyway.
import { canonicalAddress } from '@quirenote/core/address';
import { deletionWindowOpen } from '@quirenote/core/deletion';
import { deleteRows } from './account-delete';
import {
  INTERNAL,
  type ApiEvent,
  type ApiResult,
  authTimeOf,
  canonicalUuid,
  claim,
  derived,
  json,
  respond,
} from './http';
import { loggable } from './log';
import type { SqlClient } from './migrate';
import { provision } from './provision';

/** What the row says about the caller. `role` is the row's, never the token's. `settings` is the
 *  account's settings text as the column holds it, NULL when it holds none: one more column on a row
 *  already read (*Persistence today*). */
export type Caller = { userId: string; email: string; role: string; settings: string | null };

/** Either the caller or the answer that refuses them — never both, and never a bare boolean. */
export type Gate = { caller: Caller } | { refusal: ApiResult };

// ONE REFUSAL PER SITUATION, AND EACH SAYS WHAT TO DO: a `pending` applicant has to be told to
// wait, a `rejected` one to stop trying, a caller with no application at all is a different case
// again, and an account that holds no terms version is asked to accept them. None is a 401, which
// would say "you are not signed in" — false, and it sends the reader back through a sign-in that
// succeeds and changes nothing. `FORBIDDEN` is deliberately NOT a situation: its causes must not be
// told apart, because telling them apart describes the system to somebody it just turned away.
export const PENDING = json(403, '{"error":"pending"}');
export const REJECTED = json(403, '{"error":"rejected"}');
export const NO_APPLICATION = json(403, '{"error":"no_application"}');
export const FORBIDDEN = json(403, '{"error":"forbidden"}');
/** The server's refusal, not only the app's: a caller who never saw the terms reaches no route but
 *  the one that records them (*Legal documents*). */
export const TERMS = json(403, '{"error":"terms"}');
/** An account a scheduled deletion holds reaches nothing until its last day ends, and is told the
 *  day and whether this sign-in may cancel: only one made after the request can (*Auth model*). */
export const SCHEDULED = derived({
  statusCode: 403,
  name: 'scheduled',
  headers: [],
  example: { error: 'scheduled', date: '2026-11-29', cancellable: true },
});
const scheduled = (date: string, cancellable: boolean): ApiResult =>
  respond(SCHEDULED, {}, JSON.stringify({ error: 'scheduled', date, cancellable }));

// THE EXACT STRING, the rule `pre-signup.ts` states: the value arrives as text and
// `Boolean('false')` is `true`, so everything else must mean closed. Read per call.
const registrationIsOpen = () => process.env.OPEN_REGISTRATION === 'true';

/** By `user_id` is the ordinary case; by `email` is the one that would otherwise be a unique
 *  violation, since the address may already hold a row under a placeholder — somebody applied,
 *  registration was opened, they signed up. */
const LOOK = `SELECT user_id, email, status, role, settings, terms_version,
                     deletion_due::text AS deletion_due,
                     to_char(deletion_requested_at AT TIME ZONE 'UTC',
                             'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS deletion_requested_at
                FROM app_user WHERE user_id = $1 OR email = $2`;

/**
 * SELF-DECIDED, and it is the only truthful shape available: `app_user_decided_ck` exempts
 * `role = 'demo'` alone, so an `active` row must carry both halves of the decision pair, and no
 * super-admin ruled on this one — the DEPLOY that opened registration did. One statement writes
 * both halves, because the check is "not both null" rather than "both present". `ON CONFLICT
 * (user_id)` because a `23505` does not say which constraint raised it.
 */
const CREATE = `INSERT INTO app_user (user_id, email, status, role, applied_at,
                                      decided_at, decided_by)
                VALUES ($1, $2, 'active', 'user', now(), now(), $1)
                ON CONFLICT (user_id) DO NOTHING`;

/** The pool's one read the gate makes: the user under a username, and its attributes. */
type ReadUser = (input: {
  UserPoolId: string;
  Username: string;
}) => Promise<{ UserAttributes?: { Name?: string; Value?: string }[]; Enabled?: boolean }>;

/** THE SDK LOADS ON THE FIRST PROVISIONING, which no other request makes; a failed load is not
 *  kept, as `bot-check.ts` keeps none. */
let reader: Promise<ReadUser> | undefined;
const connect = (): Promise<ReadUser> => {
  if (reader) return reader;
  const loading = import('@aws-sdk/client-cognito-identity-provider').then(
    ({ CognitoIdentityProviderClient, AdminGetUserCommand }): ReadUser => {
      const client = new CognitoIdentityProviderClient({});
      return (input) => client.send(new AdminGetUserCommand(input));
    },
  );
  reader = loading;
  loading.catch(() => {
    if (reader === loading) reader = undefined;
  });
  return loading;
};

/** An enabled user under the token's username with the token's `sub`: a re-created Google profile
 *  keeps its username, and a declined one is disabled before it goes. Only not-found is an answer. */
async function poolHolds(UserPoolId: string, Username: string, sub: string): Promise<boolean> {
  const read = await connect();
  try {
    const { UserAttributes = [], Enabled } = await read({ UserPoolId, Username });
    if (Enabled === false) return false;
    return canonicalUuid(UserAttributes.find((a) => a.Name === 'sub')?.Value) === sub;
  } catch (err) {
    if ((err as { name?: string })?.name === 'UserNotFoundException') return false;
    throw err;
  }
}

type Row = {
  user_id: string;
  email: string;
  status: string;
  role: string;
  settings: string | null;
  terms_version: unknown;
  deletion_due?: string | null;
  deletion_requested_at?: string | null;
};

/** Whether the provider asserts it checked the address: what a caller with no row must show. */
export const assertsVerified = (claims: Record<string, string | string[]> | undefined): boolean =>
  claim(claims, 'email_verified') === 'true';

/** `terms: 'optional'` is for the routes a caller who holds no version may reach; `held: 'cancel'`
 *  is the cancel's alone, the one route a held account may reach. `now` is milliseconds. */
export type GateOptions = {
  terms?: 'required' | 'optional';
  held?: 'refused' | 'cancel';
  now?: () => number;
};

function answer(
  row: Row,
  sub: string,
  { terms = 'required', held = 'refused', now = Date.now }: GateOptions,
  authTime: number | undefined,
): Gate {
  // THE DEMO IS NOT AN APPLICATION AND NEVER BECOMES ONE: no token can carry its `sub`, so this
  // is reachable only through the address. Refused as a non-caller rather than as a status.
  if (row.role === 'demo') return { refusal: FORBIDDEN };
  if (row.status === 'pending') return { refusal: PENDING };
  if (row.status === 'rejected') return { refusal: REJECTED };

  // An active row under another `sub` for this address should not exist. Logged loudly rather
  // than absorbed, because the alternative is serving one person's portfolio to another. BY THE
  // TWO IDS, which find both rows; the address stays out of CloudWatch (*Deployment*).
  if (row.user_id !== sub) {
    console.error(`authorize: the address of ${sub} is active under ${row.user_id}`);
    return { refusal: FORBIDDEN };
  }
  // THE HOLD, BEFORE ANY READ AND AHEAD OF THE TERMS, so no route reads a held account's data and
  // none needs a filter for it. Past its last day it answers as the deleted account it is about to
  // be. A sign-in in the request's own second counts as before it, which fails safe.
  if (row.deletion_due != null) {
    if (!deletionWindowOpen(row.deletion_due, new Date(now()))) return { refusal: NO_APPLICATION };
    const cancellable =
      authTime !== undefined && authTime * 1000 > Date.parse(row.deletion_requested_at ?? '');
    if (held !== 'cancel' || !cancellable) {
      return { refusal: scheduled(row.deletion_due, cancellable) };
    }
  }
  // After every status, so a pending applicant never meets the step: the terms apply from approval.
  // Absent counts as none, so a row read without the column cannot pass for one that holds it.
  if (terms === 'required' && row.terms_version == null) return { refusal: TERMS };
  return {
    caller: { userId: row.user_id, email: row.email, role: row.role, settings: row.settings },
  };
}

async function look(client: SqlClient, sub: string, email: string): Promise<Row | undefined> {
  const { rows } = await client.query<Row>(LOOK, [sub, email]);
  return rows.find((r) => r.user_id === sub) ?? rows.find((r) => r.email === email);
}

export async function authorize(
  client: SqlClient,
  event: ApiEvent,
  options: GateOptions = {},
): Promise<Gate> {
  const claims = event.requestContext?.authorizer?.jwt?.claims;

  // AN ID TOKEN, AND THE CHECK IS NOT PEDANTRY: there is no standard way to tell an access token
  // from an ID token, and API Gateway accepts either here. Only the ID token carries `email`, so
  // an access token would reach this file and fail for a reason nobody could read.
  if (claim(claims, 'token_use') !== 'id') return { refusal: FORBIDDEN };

  // FOLDED, NOT MERELY CHECKED. `answer()` compares with `===`, so an id arriving in another case
  // would be found by the cluster and then refused by the comparison.
  const sub = canonicalUuid(claim(claims, 'sub'));
  if (sub === undefined) return { refusal: FORBIDDEN };

  // Folded here too: the pool stores the case that was typed, so a mixed-case claim would miss
  // the byte-exact index and read as "no row".
  const email = canonicalAddress(claim(claims, 'email'));
  if (email === undefined) return { refusal: FORBIDDEN };

  const found = await look(client, sub, email);
  if (found !== undefined) return answer(found, sub, options, authTimeOf(event));

  // NO ROW, AND THIS IS WHERE THE DOOR IS. Closed is the default and the only safe state: a valid
  // token for an identity this system never approved is what a federated sign-in mints on its own.
  if (!registrationIsOpen()) return { refusal: NO_APPLICATION };

  // AND THE ADDRESS MUST BE ONE THE PROVIDER ASSERTS IT CHECKED. Without this, an open window
  // plus a careless IdP is a row for a mailbox its holder does not own, and the real owner's
  // later application is then absorbed by `app_user_email_uq`. ONLY ON THIS PATH: an existing row
  // is not re-litigated, or a pool that stopped asserting the claim would lock everybody out.
  if (!assertsVerified(claims)) {
    console.warn(`authorize: not creating a row, address not asserted verified (${sub})`);
    return { refusal: NO_APPLICATION };
  }

  // AND THE IDENTITY MUST STILL BE THE POOL'S: a deleted account's ID token still verifies, and
  // would provision it again (*Auth model*). By username, which a `sub` is for local users only.
  const username = claim(claims, 'cognito:username');
  if (username === undefined) return { refusal: FORBIDDEN };
  const UserPoolId = process.env.USER_POOL_ID;
  if (!UserPoolId) {
    console.error('authorize: USER_POOL_ID is not set on this function');
    return { refusal: INTERNAL };
  }
  if (!(await poolHolds(UserPoolId, username, sub))) return { refusal: NO_APPLICATION };

  // THE ACCOUNT IS PART OF THE ROW, not a later step: `transaction.account_id` is NOT NULL, so a
  // caller admitted here without one is somebody this gate lets in and every write refuses. Both
  // land or neither does, which is what makes the read below the settlement it already claims to be.
  try {
    await provision(client, sub, () => client.query(CREATE, [sub, email]));
  } catch (err) {
    // Not swallowed and not returned: a concurrent request is the only way here, and the read
    // below settles it.
    console.error('authorize: could not create the row for an open registration', loggable(err));
  }

  // ASKED AGAIN AFTER THE WRITE (CWE-367): a deletion's last pass may have run before it landed.
  // Unanswered, the row goes whoever wrote it: a new caller's next request provisions it again.
  const holds = await poolHolds(UserPoolId, username, sub).catch(async (err: unknown) => {
    await deleteRows(client, sub).catch((undone: unknown) => {
      console.error('authorize: could not take back an unconfirmed row', loggable(undone));
    });
    throw err;
  });
  if (!holds) {
    await deleteRows(client, sub);
    return { refusal: NO_APPLICATION };
  }

  const created = await look(client, sub, email);
  if (created === undefined) return { refusal: INTERNAL };
  return answer(created, sub, options, authTimeOf(event));
}

/** `role` is the ROW's — a token claiming super-admin against a `user` row changes nothing. */
export function superAdminOnly(gate: Gate): Gate {
  if ('refusal' in gate) return gate;
  return gate.caller.role === 'super_admin' ? gate : { refusal: FORBIDDEN };
}

/** The portfolio routes' gate. It admits `user` rather than refusing `super_admin`, so a role added
 *  later reads no portfolio until somebody says why it may (OWASP: deny by default). */
export function userOnly(gate: Gate): Gate {
  if ('refusal' in gate) return gate;
  return gate.caller.role === 'user' ? gate : { refusal: FORBIDDEN };
}
