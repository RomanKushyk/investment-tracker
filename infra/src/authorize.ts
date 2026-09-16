// The gate every authenticated route reads, and the reason it is a module rather than a Lambda.
//
// THE AUTHORIZER IN FRONT OF THIS IS NATIVE AND HAS NO LAMBDA IN IT — `docs/DECISIONS.md`,
// **Auth model**. API Gateway proves the token: the signature against the pool's `jwks_uri`, the
// issuer, the audience and the expiry. What it cannot prove is anything that has happened since
// the token was issued — true of any token at any lifetime, because a claim is stamped once and
// never revisited. So AUTHENTICATION is the authorizer's and AUTHORIZATION is this file's, read
// from the `app_user` row on every request.
//
// WHICH IS ALSO WHY `cognito:groups` IS NEVER THE SOURCE. Group membership is stamped into a
// token at issue time, so removing somebody from a super-admin group would change nothing until
// their token refreshed. The row is read anyway — it is what resolves `user_id` — so the check
// costs nothing beyond what the request already pays.
//
// IT TOOK OVER THE POST-CONFIRMATION TRIGGER'S JOB, AND THE TRIGGER IS DECLINED IN WRITING. AWS
// invokes that trigger on `ConfirmSignUp`, `AdminConfirmSignUp` and `ConfirmForgotPassword` only
// — "not for user accounts that you create with your administrator credentials" — so it never
// sees an approved user, and never sees a federated one either. The two paths it was meant to
// cover are covered here and in `approve.ts`, each by something that already holds what the
// trigger would have needed.
import { canonicalAddress } from './address';
import { INTERNAL, type ApiEvent, type ApiResult, canonicalUuid, claim, json } from './http';
import type { SqlClient } from './migrate';

/** What the row says about the caller. `role` is the row's, never the token's. */
export type Caller = { userId: string; email: string; role: string };

/** Either the caller or the answer that refuses them — never both, and never a bare boolean. */
export type Gate = { caller: Caller } | { refusal: ApiResult };

// THREE REFUSALS FOR THREE SITUATIONS, AND THEY ARE THREE ON PURPOSE. "Refused" is not a useful
// thing to tell somebody who is genuinely signed in: a `pending` applicant has to be told to
// wait, a `rejected` one has to stop trying, and a caller with no application at all is a
// different case again. None of them is a 401 — that would say "you are not signed in", which is
// false and sends whoever reads it back through a sign-in that will succeed and change nothing.
//
// `FORBIDDEN` is the fourth constant and deliberately NOT a fourth situation: it is what a
// caller gets when the request itself is not usable — an unreadable token, the demo identity, a
// role that may not reach this route — and those must not be told apart, because telling them
// apart is a description of the system given to somebody it just turned away.
//
// THE BODY DESCRIBES THE CALLER'S OWN RECORD, which is theirs to know. Nothing here says
// anything about anybody else, and the unauthenticated route next door still answers in fixed
// text for the opposite reason.
export const PENDING = json(403, '{"error":"pending"}');
export const REJECTED = json(403, '{"error":"rejected"}');
export const NO_APPLICATION = json(403, '{"error":"no_application"}');
export const FORBIDDEN = json(403, '{"error":"forbidden"}');

// THE EXACT STRING, so an absent variable and every other value mean closed — the rule
// `pre-signup.ts` states: an environment variable arrives as text and `Boolean('false')` is
// `true`. Read per call rather than at module load, so a warm container cannot hold a value from
// before the deploy that changed it.
const registrationIsOpen = () => process.env.OPEN_REGISTRATION === 'true';

/**
 * ONE STATEMENT ANSWERING TWO QUESTIONS, the shape `migrate.ts`'s bootstrap look uses.
 *
 * By `user_id` is the ordinary case. By `email` is the one that would otherwise be a crash:
 * `app_user_email_uq` is byte-exact and this address may already hold a row under a placeholder
 * — somebody applied, registration was opened, and they signed up. Asking both at once is what
 * makes that a considered answer rather than a unique violation.
 */
const LOOK = `SELECT user_id, email, status, role FROM app_user
              WHERE user_id = $1 OR email = $2`;

/**
 * The row a caller who got in through an open door leaves behind.
 *
 * SELF-DECIDED, and it is the only truthful shape available — the same argument the bootstrap
 * makes. `app_user_decided_ck` exempts `role = 'demo'` alone, so an `active` row must carry both
 * halves of the decision pair, and there is no super-admin who ruled on this one: the DEPLOY
 * that opened registration did. A pair naming a real person would be a fabricated approval.
 *
 * ONE STATEMENT WRITES BOTH HALVES, because the check is "not both null" rather than "both
 * present" (`user-schema.test.ts`, `app_user`) — so nothing but this line holds the pair whole.
 *
 * `ON CONFLICT (user_id) DO NOTHING` follows `005` and for its reason: a `23505` does not say
 * which constraint raised it, and `app_user_email_uq` can raise one for a different row.
 */
const CREATE = `INSERT INTO app_user (user_id, email, status, role, applied_at,
                                      decided_at, decided_by)
                VALUES ($1, $2, 'active', 'user', now(), now(), $1)
                ON CONFLICT (user_id) DO NOTHING`;

type Row = { user_id: string; email: string; status: string; role: string };

/** What the row says, turned into the answer. The only place a status becomes a response. */
function answer(row: Row, sub: string): Gate {
  // THE DEMO IS NOT AN APPLICATION AND NEVER BECOMES ONE. No token can carry its `sub` — no
  // identity exists for it — so this is reachable only through the address, and only because
  // that address is under the owner's own domain. Refused as a non-caller rather than as a
  // status, which is what the role is for.
  if (row.role === 'demo') return { refusal: FORBIDDEN };
  if (row.status === 'pending') return { refusal: PENDING };
  if (row.status === 'rejected') return { refusal: REJECTED };

  // AN ACTIVE ROW UNDER ANOTHER `sub` FOR THIS ADDRESS. It should not exist: approval keys the
  // row by the sub the create call returned, and the pool refuses a duplicate address and its
  // case variant. Logged loudly rather than absorbed, because the alternative is serving one
  // person's portfolio to another.
  if (row.user_id !== sub) {
    console.error(`authorize: ${row.email} is active under ${row.user_id}, not ${sub}`);
    return { refusal: FORBIDDEN };
  }
  return { caller: { userId: row.user_id, email: row.email, role: row.role } };
}

/** The row for this caller — by id where there is one, otherwise by the address they hold. */
async function look(client: SqlClient, sub: string, email: string): Promise<Row | undefined> {
  const { rows } = await client.query<Row>(LOOK, [sub, email]);
  return rows.find((r) => r.user_id === sub) ?? rows.find((r) => r.email === email);
}

export async function authorize(client: SqlClient, event: ApiEvent): Promise<Gate> {
  const claims = event.requestContext?.authorizer?.jwt?.claims;

  // AN ID TOKEN, AND THE CHECK IS NOT PEDANTRY. AWS's own note on JWT authorizers says there is
  // no standard mechanism to tell an access token from an ID token, and API Gateway accepts
  // either here: a Cognito access token carries `client_id` where an ID token carries `aud`, and
  // the authorizer matches whichever is present. Only the ID token carries `email` — which is
  // what the open-registration path writes a row from — so an access token would reach this file
  // and fail for a reason nobody could read. Refused by name instead.
  if (claim(claims, 'token_use') !== 'id') return { refusal: FORBIDDEN };

  // FOLDED, NOT MERELY CHECKED. The row's `user_id` comes back from a `uuid` column and is
  // canonical, and `answer()` below compares the two with `===` — so an id that arrived in
  // another case would be found by the cluster and then refused by the comparison, which reads
  // as somebody else holding the address.
  const sub = canonicalUuid(claim(claims, 'sub'));
  if (sub === undefined) return { refusal: FORBIDDEN };

  // FOLDED HERE TOO, by the one rule this system has for an address. The pool canonicalises
  // nothing — matching case-insensitively still stores the case that was typed — so a mixed-case
  // claim would miss `app_user_email_uq`'s byte-exact index and read as "no row".
  const email = canonicalAddress(claim(claims, 'email'));
  if (email === undefined) return { refusal: FORBIDDEN };

  const found = await look(client, sub, email);
  if (found !== undefined) return answer(found, sub);

  // NO ROW, AND THIS IS WHERE THE DOOR IS. Closed is the default and the only safe state: the
  // caller holds a valid token for an identity this system never approved, which is exactly what
  // a federated sign-in mints on its own.
  if (!registrationIsOpen()) return { refusal: NO_APPLICATION };

  // AND THE ADDRESS HAS TO BE ONE THE PROVIDER ASSERTS IT CHECKED. `pre-signup.ts` makes exactly
  // this argument before it will LINK an identity — "claim someone's mailbox at a provider that
  // never checked and the link hands over their portfolio" — but it lets an unverified sign-up
  // through while registration is open, leaving a standalone profile. This is where that profile
  // asks for a row, so the same question has to be asked again, of the claim rather than of the
  // provider lookup. Without it an open window plus a careless IdP is a row for a mailbox its
  // holder does not own, and the real owner's later application is then absorbed by
  // `app_user_email_uq` and answered 202 for a row that is not theirs.
  //
  // ONLY ON THIS PATH. An existing row was decided by a super-admin or by an earlier window and
  // is not re-litigated here; a pool that later stopped asserting the claim would otherwise lock
  // out everybody who already has one.
  if (claim(claims, 'email_verified') !== 'true') {
    console.warn(`authorize: not creating a row, address not asserted verified (${sub})`);
    return { refusal: NO_APPLICATION };
  }

  try {
    await client.query(CREATE, [sub, email]);
  } catch (err) {
    // NOT SWALLOWED, AND NOT RETURNED EITHER. A concurrent request for the same address is the
    // only way here — the look above found nothing — and the read below is what settles it.
    console.error('authorize: could not create the row for an open registration', err);
  }

  const created = await look(client, sub, email);
  if (created === undefined) return { refusal: INTERNAL };
  return answer(created, sub);
}

/**
 * The admin gate, in one place rather than once per route.
 *
 * `role` is the ROW's — a token claiming super-admin against a `user` row changes nothing, which
 * is the whole reason authorization is not decided at token-issue time.
 */
export function superAdminOnly(gate: Gate): Gate {
  if ('refusal' in gate) return gate;
  return gate.caller.role === 'super_admin' ? gate : { refusal: FORBIDDEN };
}
