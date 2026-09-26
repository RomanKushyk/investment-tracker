// The gate every authenticated route reads, and the reason it is a module rather than a Lambda.
//
// A CLAIM IS STAMPED ONCE AT ISSUE TIME AND NEVER REVISITED, which is the argument the whole auth
// model rests on. API Gateway's native authorizer proves the token — signature, issuer, audience,
// expiry — and can prove nothing that has happened since. So AUTHENTICATION is the authorizer's
// and AUTHORIZATION is this file's, read from the `app_user` row on every request (*Auth model*).
// It is the same reason a group in a token cannot carry the role: removing somebody from a
// super-admin group would change nothing until their token refreshed, and the row is read anyway.
import { canonicalAddress } from '@quirenote/core/address';
import { INTERNAL, type ApiEvent, type ApiResult, canonicalUuid, claim, json } from './http';
import type { SqlClient } from './migrate';
import { provision } from './provision';

/** What the row says about the caller. `role` is the row's, never the token's. */
export type Caller = { userId: string; email: string; role: string };

/** Either the caller or the answer that refuses them — never both, and never a bare boolean. */
export type Gate = { caller: Caller } | { refusal: ApiResult };

// THREE REFUSALS FOR THREE SITUATIONS, AND THEY ARE THREE ON PURPOSE: a `pending` applicant has
// to be told to wait, a `rejected` one to stop trying, and a caller with no application at all is
// a different case again. None is a 401, which would say "you are not signed in" — false, and it
// sends the reader back through a sign-in that succeeds and changes nothing. `FORBIDDEN` is
// deliberately NOT a fourth situation: its causes must not be told apart, because telling them
// apart describes the system to somebody it just turned away.
export const PENDING = json(403, '{"error":"pending"}');
export const REJECTED = json(403, '{"error":"rejected"}');
export const NO_APPLICATION = json(403, '{"error":"no_application"}');
export const FORBIDDEN = json(403, '{"error":"forbidden"}');

// THE EXACT STRING, the rule `pre-signup.ts` states: the value arrives as text and
// `Boolean('false')` is `true`, so everything else must mean closed. Read per call.
const registrationIsOpen = () => process.env.OPEN_REGISTRATION === 'true';

/** By `user_id` is the ordinary case; by `email` is the one that would otherwise be a unique
 *  violation, since the address may already hold a row under a placeholder — somebody applied,
 *  registration was opened, they signed up. */
const LOOK = `SELECT user_id, email, status, role FROM app_user
              WHERE user_id = $1 OR email = $2`;

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

type Row = { user_id: string; email: string; status: string; role: string };

function answer(row: Row, sub: string): Gate {
  // THE DEMO IS NOT AN APPLICATION AND NEVER BECOMES ONE: no token can carry its `sub`, so this
  // is reachable only through the address. Refused as a non-caller rather than as a status.
  if (row.role === 'demo') return { refusal: FORBIDDEN };
  if (row.status === 'pending') return { refusal: PENDING };
  if (row.status === 'rejected') return { refusal: REJECTED };

  // An active row under another `sub` for this address should not exist. Logged loudly rather
  // than absorbed, because the alternative is serving one person's portfolio to another.
  if (row.user_id !== sub) {
    console.error(`authorize: ${row.email} is active under ${row.user_id}, not ${sub}`);
    return { refusal: FORBIDDEN };
  }
  return { caller: { userId: row.user_id, email: row.email, role: row.role } };
}

async function look(client: SqlClient, sub: string, email: string): Promise<Row | undefined> {
  const { rows } = await client.query<Row>(LOOK, [sub, email]);
  return rows.find((r) => r.user_id === sub) ?? rows.find((r) => r.email === email);
}

export async function authorize(client: SqlClient, event: ApiEvent): Promise<Gate> {
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
  if (found !== undefined) return answer(found, sub);

  // NO ROW, AND THIS IS WHERE THE DOOR IS. Closed is the default and the only safe state: a valid
  // token for an identity this system never approved is what a federated sign-in mints on its own.
  if (!registrationIsOpen()) return { refusal: NO_APPLICATION };

  // AND THE ADDRESS MUST BE ONE THE PROVIDER ASSERTS IT CHECKED. Without this, an open window
  // plus a careless IdP is a row for a mailbox its holder does not own, and the real owner's
  // later application is then absorbed by `app_user_email_uq`. ONLY ON THIS PATH: an existing row
  // is not re-litigated, or a pool that stopped asserting the claim would lock everybody out.
  if (claim(claims, 'email_verified') !== 'true') {
    console.warn(`authorize: not creating a row, address not asserted verified (${sub})`);
    return { refusal: NO_APPLICATION };
  }

  // THE ACCOUNT IS PART OF THE ROW, not a later step: `transaction.account_id` is NOT NULL, so a
  // caller admitted here without one is somebody this gate lets in and every write refuses. Both
  // land or neither does, which is what makes the read below the settlement it already claims to be.
  try {
    await provision(client, sub, () => client.query(CREATE, [sub, email]));
  } catch (err) {
    // Not swallowed and not returned: a concurrent request is the only way here, and the read
    // below settles it.
    console.error('authorize: could not create the row for an open registration', err);
  }

  const created = await look(client, sub, email);
  if (created === undefined) return { refusal: INTERNAL };
  return answer(created, sub);
}

/** `role` is the ROW's — a token claiming super-admin against a `user` row changes nothing. */
export function superAdminOnly(gate: Gate): Gate {
  if ('refusal' in gate) return gate;
  return gate.caller.role === 'super_admin' ? gate : { refusal: FORBIDDEN };
}
