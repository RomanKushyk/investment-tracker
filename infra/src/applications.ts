// `POST /applications` — the row a sign-up leaves, and the first HTTP handler here.
//
// REGISTRATION IS AN APPLICATION RATHER THAN A SIGN-UP, and the ordering protects the MAU
// allowance: Cognito marks a user active at `SignUp`, so an application that reached the pool
// would already have cost a monthly active user, approved or not. Minting the identity belongs to
// APPROVAL, which is also what makes approval the verification step (*Auth model*).
import { ADDRESS, MAX_ADDRESS, canonicalAddress } from '@quirenote/core/address';
import { TERMS_VERSION } from '@quirenote/core/terms';
import {
  BOT_CHECK_FAILED,
  TOKEN,
  type Verify,
  fromEnvironment,
  refusalOf,
  tokenOf,
  verifyWith,
} from './bot-check';
import { connect } from './dsql';
import { INTERNAL, INVALID, type ApiEvent, type ApiResult, json } from './http';
import { loggable } from './log';
import type { SqlClient } from './migrate';

// EVERY ANSWER IS FIXED TEXT: a body carrying the cluster's message would repeat a
// constraint name to a stranger, and one varying with the row would be a directory of applicants.
const RECEIVED = json(202, '{"status":"received"}');
/** Terms other than the route's: their own code, so a form that knows it asks for a reload, not an
 *  address. */
const TERMS_OUTDATED = json(400, '{"error":"terms_outdated"}');

/** What this route can answer, and the only list of it — `openapi.ts` builds the document from
 *  here, and `openapi.test.ts` catches a constant added above and not added to it. */
export const ROUTE = 'POST /applications';
export const REQUEST_BODY = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['email', 'botCheck', 'termsVersion'],
        additionalProperties: false,
        // THE RULE ITSELF, not a description of it: `format` is annotation-only, so a client
        // generated from one sends `user@localhost` and is refused. Both bounds are `address.ts`'s.
        properties: {
          email: {
            type: 'string',
            format: 'email',
            maxLength: MAX_ADDRESS,
            pattern: ADDRESS.source,
          },
          /** The Turnstile widget's token, verified with siteverify before the cluster is asked. */
          botCheck: TOKEN,
          /** The terms the form showed, accepted by pressing its button; only the current ones. */
          termsVersion: { type: 'string', enum: [TERMS_VERSION] },
        },
      },
    },
  },
} as const;

export const RESPONSES: Record<string, readonly ApiResult[]> = {
  [ROUTE]: [RECEIVED, INVALID, TERMS_OUTDATED, BOT_CHECK_FAILED, INTERNAL],
};

const KEYS = new Set(['email', 'botCheck', 'termsVersion']);

type Application = { email: string; botCheck: string };

/** The address a request carries, already folded, and its token, under the current terms — or the
 *  400 that refuses it. A token that is absent or not text reads as empty, which the bot check
 *  refuses as a 403. */
function applicationOf(event: ApiEvent): Application | ApiResult {
  if (typeof event.body !== 'string') return INVALID;
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return INVALID;
  }
  // An array is an object to `typeof`, and `[].email` is `undefined` rather than an error, so both
  // have to be turned away by name.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return INVALID;
  // EXACT-KEY, as the published schema says: a key nothing reads is a client misreading the route.
  if (Object.keys(parsed).some((key) => !KEYS.has(key))) return INVALID;

  const {
    email: supplied,
    botCheck,
    termsVersion,
  } = parsed as { email?: unknown; botCheck?: unknown; termsVersion?: unknown };
  if (typeof supplied !== 'string') return INVALID;
  const email = canonicalAddress(supplied);
  if (email === undefined) return INVALID;
  // A stale form showed other terms; what it accepted is not what this route would record.
  if (termsVersion !== TERMS_VERSION) return TERMS_OUTDATED;

  return { email, botCheck: tokenOf(botCheck) };
}

/**
 * `ON CONFLICT` rather than a read then a write: a read that decided the address was new could be
 * overtaken. `user_id` IS A PLACEHOLDER — the column holds the Cognito `sub`, no identity exists
 * yet, and approval replaces the row. `decided_at` and `decided_by` are unset because
 * `app_user_decided_ck` requires both NULL for a pending row. A declined application leaves no
 * row, so its address applying again lands a fresh `pending` one; the address of an account, a
 * suspended one included, lands in this no-op. The terms are accepted as the application is
 * made, so one `now()` stamps both. Applying again writes nothing, the first acceptance standing,
 * so this route never writes a row approval has read.
 */
const INSERT = `INSERT INTO app_user (user_id, email, status, role, applied_at,
                                      terms_version, terms_accepted_at)
                VALUES (gen_random_uuid(), $1, 'pending', 'user', now(), $2::date, now())
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
    await client.query(INSERT, [email, TERMS_VERSION]);
  } catch (err) {
    if (isDuplicateAddress(err)) return RECEIVED;
    // LOGGED, NOT RETURNED: whatever the cluster said belongs in CloudWatch.
    console.error('application insert failed', loggable(err));
    return INTERNAL;
  }
  return RECEIVED;
}

/** The cluster's half alone, which the bundle's smoke test drives; the token is the handler's. */
export async function applications(client: SqlClient, event: ApiEvent): Promise<ApiResult> {
  const application = applicationOf(event);
  return 'statusCode' in application ? application : apply(client, application.email);
}

type Connection = SqlClient & { end: () => Promise<void> };

export const createHandler =
  ({ verify, connect }: { verify: Verify; connect: () => Promise<Connection> }) =>
  async (event: ApiEvent): Promise<ApiResult> => {
    // THE GATES ARE BEFORE THE CONNECTION, which costs a handshake and a concurrency slot: the
    // address first, spending no token, then the token, so a flood costs one siteverify call.
    const application = applicationOf(event);
    if ('statusCode' in application) return application;

    const refused = refusalOf(
      await verify(application.botCheck, event.requestContext?.http?.sourceIp),
    );
    if (refused) return refused;
    const { email } = application;

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
      await client
        .end()
        .catch((err: unknown) => console.error('application disconnect failed', err));
    }
  };

export const handler = createHandler({
  verify: verifyWith((url, init) => fetch(url, init), fromEnvironment(), 'apply'),
  connect,
});
