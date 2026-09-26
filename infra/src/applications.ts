// `POST /v1/applications` — the row a sign-up leaves, and the first HTTP handler here.
//
// REGISTRATION IS AN APPLICATION RATHER THAN A SIGN-UP, and the ordering protects the MAU
// allowance: Cognito marks a user active at `SignUp`, so an application that reached the pool
// would already have cost a monthly active user, approved or not. Minting the identity belongs to
// APPROVAL, which is also what makes approval the verification step (*Auth model*).
import { ADDRESS, MAX_ADDRESS, canonicalAddress } from '@quirenote/core/address';
import { connect } from './dsql';
import { INTERNAL, INVALID, type ApiEvent, type ApiResult, json } from './http';
import type { SqlClient } from './migrate';

// THREE ANSWERS, EVERY ONE FIXED TEXT: a body carrying the cluster's message would repeat a
// constraint name to a stranger, and one varying with the row would be a directory of applicants.
const RECEIVED = json(202, '{"status":"received"}');

/** What this route can answer, and the only list of it — `openapi.ts` builds the document from
 *  here, and `openapi.test.ts` catches a constant added above and not added to it. */
export const ROUTE = 'POST /v1/applications';
export const REQUEST_BODY = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['email'],
        // THE RULE ITSELF, not a description of it: `format` is annotation-only, so a client
        // generated from one sends `user@localhost` and is refused. Both bounds are `address.ts`'s.
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
  // An array is an object to `typeof`, and `[].email` is `undefined` rather than an error, so both
  // have to be turned away by name.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;

  const supplied = (parsed as { email?: unknown }).email;
  if (typeof supplied !== 'string') return undefined;

  return canonicalAddress(supplied);
}

/**
 * `ON CONFLICT` rather than a read then a write: a read that decided the address was new could be
 * overtaken. `user_id` IS A PLACEHOLDER — the column holds the Cognito `sub`, no identity exists
 * yet, and approval replaces the row. `decided_at` and `decided_by` are unset because
 * `app_user_decided_ck` requires both NULL for a pending row. A rejected applicant re-applying
 * lands in this no-op and never reaches the approval queue.
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
 * A duplicate is a SUCCESS and arrives as either of two things. `dsql-constraints.md` measured a
 * conflicting insert reporting zero rows rather than raising — but on the PRIMARY KEY, not on the
 * secondary unique index this statement asks for, so the `23505` path is kept rather than assumed
 * away. The constraint name is what keeps the branch safe.
 */
const isDuplicateAddress = (err: unknown): boolean =>
  codeOf(err) === '23505' &&
  typeof err === 'object' &&
  err !== null &&
  (err as { constraint?: unknown }).constraint === 'app_user_email_uq';

async function apply(client: SqlClient, email: string): Promise<ApiResult> {
  try {
    await client.query(INSERT, [email]);
  } catch (err) {
    if (isDuplicateAddress(err)) return RECEIVED;
    // LOGGED, NOT RETURNED: whatever the cluster said belongs in CloudWatch.
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
  // THE GATE IS BEFORE THE CONNECTION: `connect()` completes a TLS handshake and a database
  // startup, so a malformed body checked on the far side would cost that and a concurrency slot,
  // and this is the route a stranger reaches. Read once rather than parsed again, because API
  // Gateway accepts several megabytes and only the ADDRESS inside is bounded.
  const email = addressOf(event);
  if (email === undefined) return INVALID;

  // A connection failure answers rather than throws: an uncaught throw reaches the caller as API
  // Gateway's own 502, a second shape for the same class of event.
  const client = await connect().catch((err: unknown) => {
    console.error('application connect failed', err);
    return undefined;
  });
  if (client === undefined) return INTERNAL;

  try {
    return await apply(client, email);
  } finally {
    // BELT, NOT COVERAGE: `pg`'s `end()` does not reject today, but the answer is already in
    // hand and a rejection escaping a `finally` would REPLACE it with API Gateway's 502.
    await client.end().catch((err: unknown) => console.error('application disconnect failed', err));
  }
}
