// `POST /v1/applications` — the row a sign-up leaves, and the first HTTP handler here.
//
// REGISTRATION IS AN APPLICATION RATHER THAN A SIGN-UP, and the ordering is what protects
// the MAU allowance: Cognito marks a user active at `SignUp`, so an application that
// reached the pool would already have cost a monthly active user whether or not it is ever
// approved. This endpoint writes a row and creates no identity. `AdminCreateUser` belongs
// to APPROVAL, which is also what makes approval the verification step — the invitation
// then reaches only the address's owner. `docs/DECISIONS.md`, **Auth model**.
//
// THE RESPONSE IS A CONSTANT, and that is the whole of what stops this route answering who
// has already applied. A first submission and a repeat return the same bytes; nothing
// about the row, its age or its status reaches the caller.
import { ADDRESS, MAX_ADDRESS, canonicalAddress } from './address';
import { connect } from './dsql';
import { INTERNAL, INVALID, type ApiEvent, type ApiResult, json } from './http';
import type { SqlClient } from './migrate';

// THREE ANSWERS, EVERY ONE OF THEM FIXED TEXT. A body carrying the cluster's message would
// repeat a constraint name back to an unauthenticated caller, and a constraint name is a
// description of the schema; a body that varied with the row would be a directory of who
// has applied. The other two are `http.ts`'s, shared so that one of them cannot start saying
// something else. The CORS headers are the API's, not this file's.
const RECEIVED = json(202, '{"status":"received"}');

/**
 * WHAT THIS ROUTE CAN ANSWER, and the only list of it. `openapi.ts` builds the document
 * from this rather than from a second copy kept beside it, because a list of these kept by
 * hand went stale inside one milestone. A constant added above and not added here is caught
 * by `openapi.test.ts`, which scans this file for `json(…)` literals.
 */
export const ROUTE = 'POST /v1/applications';
/**
 * WHAT THIS ROUTE TAKES, declared beside what it answers and for the same reason. It is the one
 * route on this API with a body, and `addressOf` refuses anything whose `email` is not a string —
 * so a document describing the 400 and never the shape that avoids it sends every reader into it.
 */
export const REQUEST_BODY = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['email'],
        // THE RULE ITSELF, not a description of it. `format` is annotation-only, so a client
        // generated from a schema carrying only that sends `user@localhost` and is told
        // `invalid_request`; and the length ceiling is checked BEFORE the pattern, so a
        // 300-character RFC-valid address is refused too. Both come from `address.ts`.
        properties: {
          email: {
            type: 'string',
            format: 'email',
            maxLength: MAX_ADDRESS,
            pattern: ADDRESS.source,
          },
        },
      },
    },
  },
} as const;

export const RESPONSES: Record<string, readonly ApiResult[]> = {
  [ROUTE]: [RECEIVED, INVALID, INTERNAL],
};

/** The address a request carries, already folded — or nothing, which is the 400. */
function addressOf(event: ApiEvent): string | undefined {
  if (typeof event.body !== 'string') return undefined;
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  // An array is an object to `typeof`, and `[].email` is `undefined` rather than an error,
  // so both have to be turned away by name.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;

  const supplied = (parsed as { email?: unknown }).email;
  if (typeof supplied !== 'string') return undefined;

  return canonicalAddress(supplied);
}

/**
 * ONE STATEMENT, and `ON CONFLICT` rather than a read followed by a write: a read that
 * decided the address was new could be overtaken before the write, and the unique index is
 * the only thing that settles it.
 *
 * `user_id` IS A PLACEHOLDER. The column holds the Cognito `sub` and there is no identity
 * at application time; a pending row owns nothing, so no foreign key is disturbed, and
 * approval replaces the row with the real one. Generated in SQL, as `capture.ts` does —
 * nothing here mints a uuid.
 *
 * `decided_at` and `decided_by` are left unset on purpose: `app_user_decided_ck` requires
 * both to be NULL for a pending row, so the absence is the constraint being satisfied
 * rather than a column forgotten.
 *
 * A REJECTED APPLICANT RE-APPLIES INTO THIS NO-OP. The row is keyed by address whatever its
 * status, so a second application from an address already decided against is absorbed and
 * answered 202, and nothing reaches the approval queue. That is a product decision the
 * reject endpoint owns, not this one; it is written here because this is the line that
 * makes it true.
 */
const INSERT = `INSERT INTO app_user (user_id, email, status, role, applied_at)
                VALUES (gen_random_uuid(), $1, 'pending', 'user', now())
                ON CONFLICT (email) DO NOTHING`;

/** A SQLSTATE, or nothing — the shape `migrate.ts` reads one in, and for its reasons. */
const codeOf = (err: unknown): string | undefined => {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const code = (err as { code: unknown }).code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
};

/**
 * A duplicate is a SUCCESS, and it can arrive as either of two things.
 *
 * `ON CONFLICT (email)` absorbs it when DSQL infers the arbiter, and
 * `infra/docs/dsql-constraints.md` records a conflicting insert reporting zero rows rather
 * than raising — but what it measured was `005`'s conflict on the PRIMARY KEY, not on a
 * secondary unique index, which is what this statement asks for. So the `23505` path is
 * kept rather than assumed away: the same duplicate, named by the same constraint, and the
 * repeat has to answer what the first submission answered whichever way the cluster
 * reports it. The constraint name is what makes the branch safe — a `23505` from anywhere
 * else is still a failure.
 */
const isDuplicateAddress = (err: unknown): boolean =>
  codeOf(err) === '23505' &&
  typeof err === 'object' &&
  err !== null &&
  (err as { constraint?: unknown }).constraint === 'app_user_email_uq';

/** The write, for an address that has already satisfied the rule above. */
async function apply(client: SqlClient, email: string): Promise<ApiResult> {
  try {
    await client.query(INSERT, [email]);
  } catch (err) {
    if (isDuplicateAddress(err)) return RECEIVED;
    // LOGGED, NOT RETURNED. Whatever the cluster said belongs in CloudWatch, where the
    // owner can read it; the caller gets the same two words every failure gets.
    console.error('application insert failed', err);
    return INTERNAL;
  }
  return RECEIVED;
}

export async function applications(client: SqlClient, event: ApiEvent): Promise<ApiResult> {
  const email = addressOf(event);
  return email === undefined ? INVALID : apply(client, email);
}

export async function handler(event: ApiEvent): Promise<ApiResult> {
  // THE GATE IS HERE, BEFORE THE CONNECTION, which is what makes the address rule's claim
  // true rather than nearly true: `connect()` completes a TLS handshake and a database
  // startup, so a malformed body checked on the far side of it would cost that much and a
  // concurrency slot each — and this is the route a stranger reaches. It reads the body
  // once and hands the address on, rather than delegating to `applications` and parsing a
  // second time: API Gateway accepts a payload of several megabytes, and only the ADDRESS
  // inside it is bounded.
  const email = addressOf(event);
  if (email === undefined) return INVALID;

  // A CONNECTION FAILURE ANSWERS RATHER THAN THROWS. An uncaught throw reaches the caller
  // as API Gateway's own 502, which is a different shape for the same class of event and
  // one this API would then have two of.
  const client = await connect().catch((err: unknown) => {
    console.error('application connect failed', err);
    return undefined;
  });
  if (client === undefined) return INTERNAL;

  try {
    return await apply(client, email);
  } finally {
    // BELT, NOT COVERAGE. `pg`'s `end()` resolves on the connection closing and does not
    // reject today, so this branch is unreachable with this driver — but the row is written
    // and the 202 is in hand by now, and a rejection escaping a `finally` REPLACES that
    // answer with API Gateway's 502. One line to make the return value the last word.
    await client.end().catch((err: unknown) => console.error('application disconnect failed', err));
  }
}
