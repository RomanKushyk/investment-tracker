// `/auth/*` — the only way a browser obtains a token, and the only holder of the client secret.
//
// RFC 10017's token-mediating backend on a confidential client (*Auth model*): the refresh token
// goes into an HttpOnly cookie on this host, the ID token back in the body, and the access token —
// it authorizes `DeleteUser` too — into a cookie only this function opens. Data routes never see it.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  type ChallengeNameType,
  type CompleteWebAuthnRegistrationCommandInput,
  CognitoIdentityProviderClient,
  CompleteWebAuthnRegistrationCommand,
  DescribeUserPoolClientCommand,
  GetTokensFromRefreshTokenCommand,
  InitiateAuthCommand,
  ListWebAuthnCredentialsCommand,
  RespondToAuthChallengeCommand,
  RevokeTokenCommand,
  StartWebAuthnRegistrationCommand,
} from '@aws-sdk/client-cognito-identity-provider';

import {
  INTERNAL,
  INVALID,
  type ApiEvent,
  type ApiResult,
  type Declared,
  derived,
  json,
  respond,
} from './http';

export const START_ROUTE = 'POST /auth/start';
export const RESPOND_ROUTE = 'POST /auth/respond';
export const REFRESH_ROUTE = 'POST /auth/refresh';
export const SIGN_OUT_ROUTE = 'POST /auth/sign-out';
/** GOOGLE IS THE ONE SIGN-IN THAT CANNOT BE A FORM: Cognito federates through its managed-login
 *  domain on the authorization-code grant, so the browser leaves between these two. */
export const GOOGLE_BEGIN_ROUTE = 'POST /auth/google/begin';
export const GOOGLE_COMPLETE_ROUTE = 'POST /auth/google/complete';
/** THE ACCOUNT'S PASSKEYS, which take the access token: RFC 10017 §6.2.2.3 keeps a token wider than
 *  the frontend needs with the backend, and this one's scope authorizes `DeleteUser` as well. */
export const PASSKEY_LIST_ROUTE = 'POST /auth/passkey/list';
export const PASSKEY_START_ROUTE = 'POST /auth/passkey/start';
export const PASSKEY_COMPLETE_ROUTE = 'POST /auth/passkey/complete';

/** RFC 10017 §6.1.3.3.2: a static custom header forces a preflight, which CORS refuses to every
 *  origin it does not name. Duende BFF's spelling; the value is checked exactly. */
export const CSRF_HEADER = 'x-csrf';
const CSRF_VALUE = '1';

/** A browser names the site a fetch came from on every request; the app's is this API's own. */
const SAME_SITE = new Set(['same-site', 'same-origin']);

/** RFC 10017 §6.1.3.2. `__Host-` makes the browser refuse it without Secure, with a Domain or off
 *  `Path=/`; `Http-` refuses it to `document.cookie`. */
const COOKIE = '__Host-Http-refresh';
/** The idle half of the session, re-set on every refresh (*Auth model*). */
const IDLE_SECONDS = 7200;
/** THE FAMILY'S ORIGINAL, set once at sign-in and never refreshed with: besides the live token, the
 *  one whose revocation ends every branch (`docs/reference/COGNITO-POOL-PARAMS.md`). */
const ORIGIN = '__Host-Http-origin';
/** The family's lifetime, `RefreshTokenValidity`: each rotated token is valid "for the remaining
 *  duration of the original refresh token" it replaced (AWS), so no branch outlives this cookie. */
export const ORIGIN_SECONDS = 86400;
const ATTRIBUTES = 'Path=/; Secure; HttpOnly; SameSite=Strict';
const cookieOf = (token: string) => `${COOKIE}=${token}; Max-Age=${IDLE_SECONDS}; ${ATTRIBUTES}`;
const originOf = (token: string) => `${ORIGIN}=${token}; Max-Age=${ORIGIN_SECONDS}; ${ATTRIBUTES}`;
/** THE ACCESS TOKEN, SEALED, as RFC 10017 §6.1.3.2 asks of a BFF's cookie holding one: a copied
 *  cookie store holds no token Cognito takes. It lives as long as the token. */
const ACCESS = '__Host-Http-access';
const accessOf = (sealed: string, seconds: number) =>
  `${ACCESS}=${sealed}; Max-Age=${seconds}; ${ATTRIBUTES}`;
const CLEARED = `${COOKIE}=; Max-Age=0; ${ATTRIBUTES}`;
const ACCESS_CLEARED = `${ACCESS}=; Max-Age=0; ${ATTRIBUTES}`;
/** A session that ended: the refresh cookie, and the access token sealed beside it. */
const ENDED = [CLEARED, ACCESS_CLEARED] as const;
const FORGOTTEN = [CLEARED, `${ORIGIN}=; Max-Age=0; ${ATTRIBUTES}`, ACCESS_CLEARED] as const;

/** AES-256-GCM under a key HKDF draws from the client secret, the cookie's name as salt (RFC 5869),
 *  as Auth.js draws its own from `AUTH_SECRET`: no second secret to store. */
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const keyOf = (secret: string) =>
  Buffer.from(hkdfSync('sha256', secret, ACCESS, 'quirenote relay: the access token', 32));

/** A FRESH RANDOM 96-BIT NONCE EVERY SEAL, NIST SP 800-38D §8.2.2's construction: GCM loses both
 *  its secrecy and its integrity once a nonce repeats under one key. */
const seal = (secret: string, token: string): string => {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), nonce, {
    authTagLength: TAG_BYTES,
  });
  const sealed = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, sealed, cipher.getAuthTag()]).toString('base64url');
};

/** The token, or nothing for a value this key did not seal: altered, cut short, or another key's.
 *  GCM refuses each of them at `final`, and a value too short to hold a tag before that. */
const unseal = (secret: string, value: string): string | undefined => {
  const bytes = Buffer.from(value, 'base64url');
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyOf(secret),
      bytes.subarray(0, NONCE_BYTES),
      { authTagLength: TAG_BYTES },
    ).setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
    const token = Buffer.concat([
      decipher.update(bytes.subarray(NONCE_BYTES, bytes.length - TAG_BYTES)),
      decipher.final(),
    ]);
    return token.toString('utf8');
  } catch {
    return undefined;
  }
};

/** The account a token names, read and never verified: the relay sealed it, so nobody else wrote it. */
const accountOf = (token: string): unknown => {
  try {
    const payload = Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8');
    return (JSON.parse(payload) as { sub?: unknown } | null)?.sub;
  } catch {
    return undefined;
  }
};

/** A GOOGLE FLOW'S STATE AND PKCE VERIFIER, bound to the browser that began it (RFC 9700 §2.1.1)
 *  for as long as Auth.js keeps its own pair; Cognito's code itself lives five minutes. */
const FLOW = '__Host-Http-google';
const FLOW_SECONDS = 900;
const flowOf = (state: string, verifier: string) =>
  `${FLOW}=${state}.${verifier}; Max-Age=${FLOW_SECONDS}; ${ATTRIBUTES}`;
const FLOW_CLEARED = `${FLOW}=; Max-Age=0; ${ATTRIBUTES}`;

/** RFC 6749 §5.1: a response carrying a token MUST NOT be stored, and a challenge session neither. */
const NO_STORE = 'no-store';

/** What each preference `/auth/start` admits must carry, and nothing else. Naming a preference
 *  means supplying its credential in the same call, so SRP brings `SRP_A`. */
const START_KEYS = {
  WEB_AUTHN: ['USERNAME', 'PREFERRED_CHALLENGE'],
  PASSWORD_SRP: ['USERNAME', 'PREFERRED_CHALLENGE', 'SRP_A'],
} as const satisfies Record<string, readonly string[]>;

/** Every challenge `/auth/respond` answers, with exactly the keys AWS documents for it. */
const CHALLENGE_KEYS = {
  WEB_AUTHN: ['USERNAME', 'CREDENTIAL'],
  SELECT_CHALLENGE: ['USERNAME', 'ANSWER', 'SRP_A'],
  PASSWORD_VERIFIER: [
    'USERNAME',
    'PASSWORD_CLAIM_SIGNATURE',
    'PASSWORD_CLAIM_SECRET_BLOCK',
    'TIMESTAMP',
  ],
  NEW_PASSWORD_REQUIRED: ['USERNAME', 'NEW_PASSWORD'],
} as const satisfies Record<string, readonly string[]>;

/** THE ONE SELECTION ADMITTED. AWS: "The Password option is always available", so a plain password
 *  is refused here or nowhere. */
const SELECTABLE = 'PASSWORD_SRP';

/** What the client lists and the Google provider maps; Cognito ignores a scope it does not list. */
const SCOPE = 'openid email profile';

/** What `/auth/google/complete` takes: what Cognito's redirect handed the callback page. */
const COMPLETE_KEYS = ['code', 'state'] as const;

const TEXT = { type: 'string', minLength: 1 } as const;
const exactObject = (keys: readonly string[], narrowed: Record<string, unknown> = {}) => ({
  type: 'object',
  additionalProperties: false,
  required: [...keys],
  properties: Object.fromEntries(keys.map((key) => [key, narrowed[key] ?? TEXT])),
});

/** THE RULES THEMSELVES, not a description of them: both bodies are derived from the tables the
 *  handler checks against. */
export const START_BODY = {
  required: true,
  content: {
    'application/json': {
      schema: {
        oneOf: Object.entries(START_KEYS).map(([preference, keys]) =>
          exactObject(keys, { PREFERRED_CHALLENGE: { type: 'string', enum: [preference] } }),
        ),
      },
    },
  },
};

export const RESPOND_BODY = {
  required: true,
  content: {
    'application/json': {
      schema: {
        oneOf: Object.entries(CHALLENGE_KEYS).map(([challenge, keys]) => ({
          type: 'object',
          additionalProperties: false,
          required: ['challenge', 'session', 'responses'],
          properties: {
            challenge: { type: 'string', enum: [challenge] },
            session: TEXT,
            responses: exactObject(
              keys,
              challenge === 'SELECT_CHALLENGE'
                ? { ANSWER: { type: 'string', enum: [SELECTABLE] } }
                : {},
            ),
          },
        })),
      },
    },
  },
};

export const GOOGLE_COMPLETE_BODY = {
  required: true,
  content: { 'application/json': { schema: exactObject(COMPLETE_KEYS) } },
};

/** What each passkey call names: the account its tab shows, the `sub` of that tab's ID token. */
const PASSKEY_KEYS = ['sub'] as const;
export const PASSKEY_BODY = {
  required: true,
  content: { 'application/json': { schema: exactObject(PASSKEY_KEYS) } },
};

/** And what the OS dialog made, as `PublicKeyCredential.toJSON()` spells it; Cognito reads it. */
export const PASSKEY_COMPLETE_BODY = {
  required: true,
  content: {
    'application/json': {
      schema: exactObject([...PASSKEY_KEYS, 'credential'], { credential: { type: 'object' } }),
    },
  },
};

const ASKING_FOR_THE_HEADER = [
  {
    name: CSRF_HEADER,
    in: 'header',
    required: true,
    schema: { type: 'string', enum: [CSRF_VALUE] },
  },
];

const TOKENS = derived({
  statusCode: 200,
  name: 'tokens',
  headers: ['set-cookie', 'cache-control'],
  example: { idToken: '<JWT>', expiresIn: 3600 },
});
const CHALLENGE = derived({
  statusCode: 200,
  name: 'challenge',
  headers: ['cache-control'],
  example: {
    challenge: 'PASSWORD_VERIFIER',
    session: '<session>',
    parameters: {
      USER_ID_FOR_SRP: '<username>',
      SRP_B: '<hex>',
      SALT: '<hex>',
      SECRET_BLOCK: '<b64>',
    },
  },
});
/** A refresh's tokens name whether Google is on: every page load asks this, so knowing costs no
 *  call of its own (Supabase publishes the same flag on `GET /settings`). */
const REFRESHED = derived({
  statusCode: 200,
  name: 'tokens',
  headers: ['set-cookie', 'cache-control'],
  example: { idToken: '<JWT>', expiresIn: 3600, google: true },
});
/** `logout` WHILE GOOGLE IS ON: `GlobalSignOut` "doesn't clear the managed login session cookie",
 *  and only a browser sent to Cognito's logout endpoint can have it cleared. */
const SIGNED_OUT = derived({
  statusCode: 200,
  name: 'signed_out',
  headers: ['set-cookie'],
  example: { status: 'signed_out', logout: 'https://<auth domain>/logout?client_id=<client>' },
});
/** RFC 10017 §6.2.2.2: a refresh token no longer valid ends the session, so the cookie goes too. */
const SESSION_ENDED = derived({
  statusCode: 401,
  name: 'not_authorized',
  headers: ['set-cookie'],
  example: { error: 'not_authorized', google: true },
});
const AUTHORIZE = derived({
  statusCode: 200,
  name: 'authorize',
  headers: ['set-cookie', 'cache-control'],
  example: { authorize: 'https://<auth domain>/oauth2/authorize?identity_provider=Google&…' },
});
/** A code the token endpoint will not redeem: its flow is spent, so the cookie goes. */
const FLOW_SPENT = derived({
  statusCode: 401,
  name: 'flow_spent',
  headers: ['set-cookie'],
  example: { error: 'not_authorized' },
});

/** Whether the account holds a passkey: the offer follows a password sign-in while it holds none. */
const PASSKEYS = derived({
  statusCode: 200,
  name: 'passkeys',
  headers: ['cache-control'],
  example: { passkey: false },
});
/** `StartWebAuthnRegistration`'s options, for the OS dialog; its challenge is single-use. */
const CREATION_OPTIONS = derived({
  statusCode: 200,
  name: 'creation_options',
  headers: ['cache-control'],
  example: { options: { challenge: '<base64url>', rp: { id: '<apex>', name: '<apex>' } } },
});
const REGISTERED = json(200, '{"status":"registered"}');

const NOT_AUTHORIZED = json(401, '{"error":"not_authorized"}');
const INVALID_PASSWORD = json(400, '{"error":"invalid_password"}');
/** The pool's history refusing the temporary password as the new one, which meets the rule. */
const REUSED_PASSWORD = json(400, '{"error":"reused_password"}');
const CSRF = json(403, '{"error":"csrf"}');
/** RFC 6585 §4, with no `Retry-After`: Cognito never says how long its lockout lasts. */
const TOO_MANY = json(429, '{"error":"too_many_attempts"}');
/** The client lists no Google provider: the deploy had no Google credentials. */
const GOOGLE_DISABLED = json(404, '{"error":"google_disabled"}');

/** What each route can answer, and the only list of it — `openapi.ts` builds the document from
 *  here, and `auth-relay.test.ts` proves it against what the routes really answer. */
export const RESPONSES: Record<string, readonly (ApiResult | Declared)[]> = {
  [START_ROUTE]: [CHALLENGE, NOT_AUTHORIZED, TOO_MANY, INVALID, CSRF, INTERNAL],
  [RESPOND_ROUTE]: [
    TOKENS,
    CHALLENGE,
    NOT_AUTHORIZED,
    TOO_MANY,
    INVALID_PASSWORD,
    REUSED_PASSWORD,
    INVALID,
    CSRF,
    INTERNAL,
  ],
  [REFRESH_ROUTE]: [REFRESHED, SESSION_ENDED, CSRF, INTERNAL],
  [SIGN_OUT_ROUTE]: [SIGNED_OUT, CSRF, INTERNAL],
  [GOOGLE_BEGIN_ROUTE]: [AUTHORIZE, GOOGLE_DISABLED, CSRF, INTERNAL],
  [GOOGLE_COMPLETE_ROUTE]: [TOKENS, NOT_AUTHORIZED, FLOW_SPENT, INVALID, CSRF, INTERNAL],
  [PASSKEY_LIST_ROUTE]: [PASSKEYS, NOT_AUTHORIZED, INVALID, CSRF, INTERNAL],
  [PASSKEY_START_ROUTE]: [CREATION_OPTIONS, NOT_AUTHORIZED, INVALID, CSRF, INTERNAL],
  [PASSKEY_COMPLETE_ROUTE]: [REGISTERED, NOT_AUTHORIZED, INVALID, CSRF, INTERNAL],
};

/** What a request must carry beyond its body, for the document to publish: every route the relay
 *  answers refuses a call without the header, so every one is derived from that list. */
export const PARAMETERS: Record<string, typeof ASKING_FOR_THE_HEADER> = Object.fromEntries(
  Object.keys(RESPONSES).map((route) => [route, ASKING_FOR_THE_HEADER]),
);

/** Cognito's refusals the app can act on; the address ones answer alike, so none can be probed. */
const REFUSED_AS = new Map<string, ApiResult>([
  ['NotAuthorizedException', NOT_AUTHORIZED],
  ['UserNotFoundException', NOT_AUTHORIZED],
  // SOME ADDRESSES WITH NO ACCOUNT GET IT AT EVERY START, so a 401 there does not show that one
  // exists; AWS documents a wrong password's answer in its place.
  ['PasswordResetRequiredException', NOT_AUTHORIZED],
  ['InvalidPasswordException', INVALID_PASSWORD],
  ['PasswordHistoryPolicyViolationException', REUSED_PASSWORD],
  ['InvalidParameterException', INVALID],
]);

/** COGNITO'S LOCKOUT carries a wrong password's name, so only this message tells it apart. An address
 *  with no account meets it too (`docs/reference/COGNITO-POOL-PARAMS.md`); other wording answers 401. */
const LOCKED_OUT = 'Password attempts exceeded';

/** What `GetTokensFromRefreshToken` says of a token that will never work again. A replay is not
 *  among them: it ends the family, not only the session. */
const SESSION_OVER = new Set([
  'NotAuthorizedException',
  'UserNotFoundException',
  'InvalidParameterException',
]);

/** A passkey call's refusals the app can act on: a token Cognito does not take — expired, revoked,
 *  or a Google sign-in's, which lacks the scope — and a request it refuses. Anything else is logged. */
const PASSKEY_REFUSED_AS = new Map<string, ApiResult>([
  ['NotAuthorizedException', NOT_AUTHORIZED],
  ['UserNotFoundException', NOT_AUTHORIZED],
  ['PasswordResetRequiredException', NOT_AUTHORIZED],
  ['InvalidParameterException', INVALID],
  ['LimitExceededException', INVALID],
  ['WebAuthnChallengeNotFoundException', INVALID],
  ['WebAuthnClientMismatchException', INVALID],
  ['WebAuthnCredentialNotSupportedException', INVALID],
  ['WebAuthnOriginNotAllowedException', INVALID],
  ['WebAuthnRelyingPartyMismatchException', INVALID],
]);

/** The refusals `RevokeToken` documents for a token it will not take — an access token, or input it
 *  cannot parse. A revoked or unknown refresh token revokes without complaint. */
const ALREADY_DEAD = new Set(['UnsupportedTokenTypeException', 'InvalidParameterException']);

/** The token endpoint's refusals of a code (Cognito, *Token endpoint*): spent or unknown, a redirect
 *  that does not match, a malformed request. `invalid_client` is the secret's, and is re-read. */
const UNREDEEMABLE = new Set(['invalid_grant', 'unauthorized_client', 'invalid_request']);

/** A refusal's wait before re-reading the secret, and the providers' age at re-read: AWS's
 *  Parameters and Secrets Lambda Extension's default. `UserPoolClientRead` allows five a second. */
const REREAD_MS = 300_000;

type Tokens = { IdToken?: string; AccessToken?: string; RefreshToken?: string; ExpiresIn?: number };
/** The token endpoint's own spelling of the same four. */
export type CodeTokens = {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};
export type RedeemInput = {
  domain: string;
  client: string;
  secret: string;
  code: string;
  redirectUri: string;
  verifier: string;
};
type Answer = {
  ChallengeName?: string;
  Session?: string;
  ChallengeParameters?: Record<string, string>;
  AvailableChallenges?: string[];
  AuthenticationResult?: Tokens;
};

/** Narrowed to the nine calls this file makes, so a test injects a double rather than the SDK. */
export type IdentityClient = {
  describeUserPoolClient(input: { UserPoolId: string; ClientId: string }): Promise<{
    UserPoolClient?: {
      ClientSecret?: string;
      SupportedIdentityProviders?: string[];
      CallbackURLs?: string[];
    };
  }>;
  initiateAuth(input: {
    AuthFlow: 'USER_AUTH';
    ClientId: string;
    AuthParameters: Record<string, string>;
  }): Promise<Answer>;
  respondToAuthChallenge(input: {
    ClientId: string;
    ChallengeName: string;
    Session: string;
    ChallengeResponses: Record<string, string>;
  }): Promise<Answer>;
  getTokensFromRefreshToken(input: {
    RefreshToken: string;
    ClientId: string;
    ClientSecret: string;
  }): Promise<{ AuthenticationResult?: Tokens }>;
  revokeToken(input: { Token: string; ClientId: string; ClientSecret: string }): Promise<unknown>;
  /** `/oauth2/token`, which no SDK command covers; a refusal throws under its OAuth `error`. */
  redeemCode(input: RedeemInput): Promise<CodeTokens>;
  /** The three passkey calls, which the user's access token authorizes: no secret, and no IAM. */
  listWebAuthnCredentials(input: {
    AccessToken: string;
    MaxResults: number;
  }): Promise<{ Credentials?: unknown[] }>;
  startWebAuthnRegistration(input: {
    AccessToken: string;
  }): Promise<{ CredentialCreationOptions?: unknown }>;
  completeWebAuthnRegistration(input: {
    AccessToken: string;
    Credential: unknown;
  }): Promise<unknown>;
};

/** THE READ'S OWN FAILURE, kept apart: `DescribeUserPoolClient` answers a missing grant with
 *  `NotAuthorizedException`, which must never read as the caller's wrong password. */
class SecretUnreadable extends Error {
  override name = 'SecretUnreadable';
}

const nameOf = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && typeof (err as { name?: unknown }).name === 'string'
    ? (err as { name: string }).name
    : undefined;

const fromTheApp = (event: ApiEvent): boolean =>
  event.headers?.[CSRF_HEADER] === CSRF_VALUE &&
  SAME_SITE.has(event.headers?.['sec-fetch-site'] ?? '');

const parsed = (event: ApiEvent): unknown => {
  if (typeof event.body !== 'string') return undefined;
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** A named error, which is how every refusal here is told apart. */
const named = (name: string, message: string) => Object.assign(new Error(message), { name });

/** An object holding exactly `keys`, each non-empty text — or nothing, which is the 400. */
const exactly = (value: unknown, keys: readonly string[]): Record<string, string> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  const fits =
    entries.length === keys.length &&
    entries.every(([key, v]) => keys.includes(key) && typeof v === 'string' && v !== '');
  return fits ? (value as Record<string, string>) : undefined;
};

const startOf = (event: ApiEvent) => {
  const body = parsed(event);
  const preference = (body as { PREFERRED_CHALLENGE?: unknown } | null | undefined)
    ?.PREFERRED_CHALLENGE;
  if (typeof preference !== 'string' || !Object.hasOwn(START_KEYS, preference)) return undefined;
  return exactly(body, START_KEYS[preference as keyof typeof START_KEYS]);
};

const respondOf = (event: ApiEvent) => {
  const body = parsed(event);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  if (Object.keys(body).length !== 3) return undefined;
  const { challenge, session, responses } = body as Record<string, unknown>;
  if (typeof challenge !== 'string' || !Object.hasOwn(CHALLENGE_KEYS, challenge)) return undefined;
  if (typeof session !== 'string' || session === '') return undefined;
  const answered = exactly(responses, CHALLENGE_KEYS[challenge as keyof typeof CHALLENGE_KEYS]);
  if (answered === undefined) return undefined;
  if (challenge === 'SELECT_CHALLENGE' && answered.ANSWER !== SELECTABLE) return undefined;
  return { challenge, session, responses: answered };
};

const cookieIn = (event: ApiEvent, name: string): string | undefined => {
  const prefix = `${name}=`;
  const value = event.cookies
    ?.map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
  return value ? value : undefined;
};

/** Every refresh token a request carries, the original first; a token both cookies hold, once. */
const carried = (event: ApiEvent): string[] => [
  ...new Set(
    [cookieIn(event, ORIGIN), cookieIn(event, COOKIE)].filter((token) => token !== undefined),
  ),
];

/** Cognito's hash over the USERNAME the same call carries: "any user pool sign-in attribute". */
const hashOf = (secret: string, username: string, client: string) =>
  createHmac('sha256', secret)
    .update(username + client)
    .digest('base64');

/** The flow a begin bound to this browser, or nothing when the cookie holds no whole pair. */
const flowIn = (event: ApiEvent) => {
  const [state, verifier, ...rest] = cookieIn(event, FLOW)?.split('.') ?? [];
  return state && verifier && rest.length === 0 ? { state, verifier } : undefined;
};

/** In constant time, so the comparison says nothing of how much of a guess was right. */
const same = (a: string, b: string) => {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
};

type Ids = { pool: string; client: string; domain: string };

const idsOf = (): Ids | undefined => {
  const pool = process.env.USER_POOL_ID;
  const client = process.env.USER_POOL_CLIENT_ID;
  const domain = process.env.AUTH_DOMAIN;
  if (!pool || !client || !domain) {
    console.error('auth-relay: USER_POOL_ID, USER_POOL_CLIENT_ID or AUTH_DOMAIN is not set');
    return undefined;
  }
  return { pool, client, domain };
};

/** COGNITO'S LOGOUT FOR THIS CLIENT; the app names where it lands (`logout_uri`). */
const logoutOf = (ids: Ids) => {
  const url = new URL('/logout', `https://${ids.domain}`);
  url.searchParams.set('client_id', ids.client);
  return url.href;
};

const challenged = (answer: Answer): ApiResult => {
  if (!answer.ChallengeName || !answer.Session) {
    console.error('auth-relay: Cognito answered with no challenge to relay');
    return INTERNAL;
  }
  return respond(
    CHALLENGE,
    { 'cache-control': NO_STORE },
    JSON.stringify({
      challenge: answer.ChallengeName,
      session: answer.Session,
      parameters: answer.ChallengeParameters ?? {},
      availableChallenges: answer.AvailableChallenges,
    }),
  );
};

/** The refresh token into the cookie, the access token sealed into its own, the ID token into the
 *  body. A sign-in's is the family's original too; a refresh's `sent` is kept if nothing rotates. */
const issued = (
  tokens: Tokens | undefined,
  secret: string,
  from: 'sign-in' | 'google' | { sent: string; google: boolean },
): ApiResult => {
  const refresh = tokens?.RefreshToken ?? (typeof from === 'string' ? undefined : from.sent);
  if (!tokens?.IdToken || !tokens.AccessToken || !tokens.ExpiresIn || !refresh) {
    console.error('auth-relay: Cognito answered without the tokens a session needs');
    return INTERNAL;
  }
  const body = { idToken: tokens.IdToken, expiresIn: tokens.ExpiresIn };
  const access = accessOf(seal(secret, tokens.AccessToken), tokens.ExpiresIn);
  if (typeof from !== 'string') {
    return respond(
      REFRESHED,
      { 'set-cookie': [cookieOf(refresh), access], 'cache-control': NO_STORE },
      JSON.stringify({ ...body, google: from.google }),
    );
  }
  const signedIn = [cookieOf(refresh), originOf(refresh), access] as const;
  return respond(
    TOKENS,
    {
      'set-cookie': from === 'google' ? [...signedIn, FLOW_CLEARED] : signedIn,
      'cache-control': NO_STORE,
    },
    JSON.stringify(body),
  );
};

const refusedBy = (route: string, err: unknown): ApiResult => {
  if ((err as { message?: unknown } | undefined)?.message === LOCKED_OUT) return TOO_MANY;
  const known = REFUSED_AS.get(nameOf(err) ?? '');
  if (known !== undefined) return known;
  console.error(`auth-relay: ${route} failed`, err);
  return INTERNAL;
};

const ended = (cleared: readonly [string, ...string[]], google: boolean) =>
  respond(
    SESSION_ENDED,
    { 'set-cookie': cleared },
    JSON.stringify({ error: 'not_authorized', google }),
  );
const signedOut = (logout?: string) =>
  respond(
    SIGNED_OUT,
    { 'set-cookie': FORGOTTEN },
    JSON.stringify(
      logout === undefined ? { status: 'signed_out' } : { status: 'signed_out', logout },
    ),
  );
const spent = () =>
  respond(FLOW_SPENT, { 'set-cookie': [FLOW_CLEARED] }, '{"error":"not_authorized"}');

/** The token endpoint's answer in the SDK's spelling, which `issued` reads. */
const tokensOf = (answered: CodeTokens): Tokens => ({
  IdToken: answered.id_token,
  AccessToken: answered.access_token,
  RefreshToken: answered.refresh_token,
  ExpiresIn: answered.expires_in,
});

/** What the relay reads of its client: the secret, whether Google is among its providers, and the
 *  one callback Cognito sends Google's code to. */
type Client = { secret: string; google: boolean; callback: string | undefined };

/** One relay per execution environment, which is what its client is cached across. */
export const createRelay = (idp: IdentityClient, now: () => number = Date.now) => {
  let client: { value: Promise<Client>; at: number } | undefined;
  let rereadAt = -Infinity;

  const read = (ids: Ids): Promise<Client> =>
    idp.describeUserPoolClient({ UserPoolId: ids.pool, ClientId: ids.client }).then(
      (described) => {
        const { ClientSecret, SupportedIdentityProviders, CallbackURLs } =
          described.UserPoolClient ?? {};
        if (!ClientSecret) throw new SecretUnreadable('the app client has no secret');
        return {
          secret: ClientSecret,
          google: SupportedIdentityProviders?.includes('Google') ?? false,
          callback: CallbackURLs?.[0],
        };
      },
      (err: unknown) => {
        throw new SecretUnreadable('DescribeUserPoolClient failed', { cause: err });
      },
    );

  // A FAILED READ IS NOT KEPT, or one throttle would poison the environment until it is recycled.
  const fill = (ids: Ids): Promise<Client> => {
    const entry = { value: read(ids), at: now() };
    client = entry;
    entry.value.catch(() => {
      if (client === entry) client = undefined;
    });
    return entry.value;
  };
  /** The secret is kept until Cognito refuses it. */
  const cached = (ids: Ids): Promise<Client> => client?.value ?? fill(ids);
  /** THE PROVIDERS ARE READ AGAIN ONCE FIVE MINUTES OLD: a deploy that turns Google on or off
   *  changes the client and not this function. A failed re-read serves what was read, five more. */
  const current = (ids: Ids): Promise<Client> => {
    const kept = client;
    if (kept === undefined) return fill(ids);
    if (now() - kept.at < REREAD_MS) return kept.value;
    const entry = { value: read(ids).catch(() => kept.value), at: now() };
    client = entry;
    return entry.value;
  };

  /** A client that cannot be read offers no Google: a sign-in page then shows the form alone. */
  const googleOn = (ids: Ids | undefined): Promise<boolean> =>
    ids === undefined
      ? Promise.resolve(false)
      : current(ids).then(
          (read) => read.google,
          () => false,
        );

  /** One call with the secret, made AGAIN only when a re-read finds the secret changed: a wrong
   *  password submitted twice would count twice toward Cognito's lockout. */
  const withSecret = async <T>(
    ids: Ids,
    refusedAs: string,
    call: (secret: string) => Promise<T>,
  ): Promise<T> => {
    const known = await cached(ids);
    try {
      return await call(known.secret);
    } catch (err) {
      if (nameOf(err) !== refusedAs || now() - rereadAt < REREAD_MS) throw err;
      rereadAt = now();
      const fresh = await read(ids).catch(() => undefined);
      if (fresh === undefined || fresh.secret === known.secret) throw err;
      client = { value: Promise.resolve(fresh), at: now() };
      return call(fresh.secret);
    }
  };

  /** A token already dead counts as revoked; any other refusal is the caller's to weigh. */
  const revoke = async (ids: Ids, token: string): Promise<void> => {
    try {
      // `RevokeToken` NAMES A CLIENT-AUTH FAILURE `UnauthorizedException`, not the sign-in calls' name.
      await withSecret(ids, 'UnauthorizedException', (s) =>
        idp.revokeToken({ Token: token, ClientId: ids.client, ClientSecret: s }),
      );
    } catch (err) {
      if (!ALREADY_DEAD.has(nameOf(err) ?? '')) throw err;
    }
  };

  /** EACH IN TURN, so a secret one call re-read serves the next; every token is tried whatever
   *  the others answer, and what failed is returned for the route to weigh. */
  const revokeEach = async (ids: Ids, tokens: readonly string[]): Promise<unknown[]> => {
    const failed: unknown[] = [];
    for (const token of tokens) {
      await revoke(ids, token).catch((err: unknown) => failed.push(err));
    }
    return failed;
  };

  const start = async (event: ApiEvent): Promise<ApiResult> => {
    const parameters = startOf(event);
    if (parameters === undefined) return INVALID;
    const ids = idsOf();
    if (ids === undefined) return INTERNAL;
    try {
      const answer = await withSecret(ids, 'NotAuthorizedException', (s) =>
        idp.initiateAuth({
          AuthFlow: 'USER_AUTH',
          ClientId: ids.client,
          AuthParameters: {
            ...parameters,
            SECRET_HASH: hashOf(s, parameters.USERNAME, ids.client),
          },
        }),
      );
      // EITHER PREFERENCE ANSWERS WITH A CHALLENGE, so tokens here are a path nobody asked for and
      // are refused with the rest of what is not one.
      return challenged(answer);
    } catch (err) {
      return refusedBy(START_ROUTE, err);
    }
  };

  const answer = async (event: ApiEvent): Promise<ApiResult> => {
    const request = respondOf(event);
    if (request === undefined) return INVALID;
    const ids = idsOf();
    if (ids === undefined) return INTERNAL;
    const { challenge, session, responses } = request;
    try {
      const answered = await withSecret(ids, 'NotAuthorizedException', (s) =>
        idp.respondToAuthChallenge({
          ClientId: ids.client,
          ChallengeName: challenge,
          Session: session,
          ChallengeResponses: {
            ...responses,
            SECRET_HASH: hashOf(s, responses.USERNAME, ids.client),
          },
        }),
      );
      if (answered.AuthenticationResult === undefined) return challenged(answered);
      const signedIn = issued(answered.AuthenticationResult, (await cached(ids)).secret, 'sign-in');
      // A SIGN-IN REVOKES EVERY TOKEN THIS BROWSER STILL CARRIES, whose family an idle expiry does
      // not end. A revocation that errors costs no sign-in: that family is capped by its own lifetime.
      if (signedIn.statusCode === 200) {
        for (const err of await revokeEach(ids, carried(event))) {
          console.error('auth-relay: revoking the earlier session failed', err);
        }
      }
      return signedIn;
    } catch (err) {
      return refusedBy(RESPOND_ROUTE, err);
    }
  };

  const refresh = async (event: ApiEvent): Promise<ApiResult> => {
    const ids = idsOf();
    const token = cookieIn(event, COOKIE);
    if (token === undefined) return ended(ENDED, await googleOn(ids));
    if (ids === undefined) return INTERNAL;
    try {
      const { AuthenticationResult } = await withSecret(ids, 'NotAuthorizedException', (s) =>
        idp.getTokensFromRefreshToken({
          RefreshToken: token,
          ClientId: ids.client,
          ClientSecret: s,
        }),
      );
      // THE FLAG FIRST: its re-read may bring a rotated secret, which the seal must then be under.
      const google = await googleOn(ids);
      return issued(AuthenticationResult, (await cached(ids)).secret, { sent: token, google });
    } catch (err) {
      // RFC 9700 §4.14.2: WHICH HOLDER REPLAYED CANNOT BE TOLD, AND THE ACTIVE TOKEN IS REVOKED —
      // here every branch, through the original this browser carries; Cognito revokes nothing.
      if (nameOf(err) === 'RefreshTokenReuseException') {
        console.warn('auth-relay: a rotated-out refresh token was replayed');
        const original = cookieIn(event, ORIGIN);
        try {
          if (original !== undefined) await revoke(ids, original);
        } catch (failed) {
          // KEPT SO THE NEXT ATTEMPT REVOKES AGAIN, as a failed sign-out keeps its cookie.
          console.error('auth-relay: revoking a replayed family failed', failed);
          return INTERNAL;
        }
        return ended(FORGOTTEN, await googleOn(ids));
      }
      // AN EXPIRED OR REVOKED TOKEN SAYS NOTHING OF A THIEF: the original stays, for the next
      // sign-in to revoke.
      if (SESSION_OVER.has(nameOf(err) ?? '')) return ended(ENDED, await googleOn(ids));
      // A FAULT IS NOT A DEAD SESSION: the cookie stays, so the next refresh can still succeed.
      console.error('auth-relay: refresh failed', err);
      return INTERNAL;
    }
  };

  const signOut = async (event: ApiEvent): Promise<ApiResult> => {
    // BOTH COOKIES' TOKENS, because they can belong to two families — a refresh answering after a
    // sign-in overwrites one — and Cognito revokes a family, never the browser.
    const tokens = carried(event);
    const ids = idsOf();
    if (ids === undefined) return tokens.length === 0 ? signedOut() : INTERNAL;
    const failed = tokens.length === 0 ? [] : await revokeEach(ids, tokens);
    // KEPT SO A RETRY CAN STILL REVOKE THEM: a forgotten live token stays usable wherever it went.
    for (const err of failed) console.error('auth-relay: sign-out failed', err);
    if (failed.length > 0) return INTERNAL;
    // EVERY SIGN-OUT WHILE GOOGLE IS ON, a tokenless one too: Cognito's session is its own, and
    // nothing this relay holds says whether the browser has one.
    return signedOut((await googleOn(ids)) ? logoutOf(ids) : undefined);
  };

  const begin = async (): Promise<ApiResult> => {
    const ids = idsOf();
    if (ids === undefined) return INTERNAL;
    const { google, callback } = await current(ids);
    if (!google) return GOOGLE_DISABLED;
    if (callback === undefined) {
      console.error('auth-relay: the app client lists no callback URL');
      return INTERNAL;
    }
    // RFC 7636 §4.1: "a 32-octet sequence"; §4.2: S256 "MUST" where the client can, and Cognito
    // "supports only S256". A new pair for every redirect, as openid-client requires of the state.
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const authorize = new URL('/oauth2/authorize', `https://${ids.domain}`);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: ids.client,
      redirect_uri: callback,
      // "silently redirects your user to the sign-in page for that identity provider": managed
      // login's own page is never shown.
      identity_provider: 'Google',
      scope: SCOPE,
      // FORWARDED TO GOOGLE, which then asks which account every time — so a sign-out is followed
      // by a question, not by the last account signing straight back in.
      prompt: 'select_account',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return respond(
      AUTHORIZE,
      { 'set-cookie': [flowOf(state, verifier)], 'cache-control': NO_STORE },
      JSON.stringify({ authorize: authorize.href }),
    );
  };

  const complete = async (event: ApiEvent): Promise<ApiResult> => {
    const body = exactly(parsed(event), COMPLETE_KEYS);
    if (body === undefined) return INVALID;
    const ids = idsOf();
    if (ids === undefined) return INTERNAL;
    // A CODE ONLY THE BROWSER THAT BEGAN CAN REDEEM: its state must be the cookie's, and the
    // verifier is nowhere else (RFC 9700 §4.7.1). A stray code leaves any flow in progress alone.
    const flow = flowIn(event);
    if (flow === undefined || !same(flow.state, body.state)) return NOT_AUTHORIZED;
    const { callback } = await cached(ids);
    if (callback === undefined) {
      console.error('auth-relay: the app client lists no callback URL');
      return INTERNAL;
    }
    try {
      const answered = await withSecret(ids, 'invalid_client', (secret) =>
        idp.redeemCode({
          domain: ids.domain,
          client: ids.client,
          secret,
          code: body.code,
          redirectUri: callback,
          verifier: flow.verifier,
        }),
      );
      const signedIn = issued(tokensOf(answered), (await cached(ids)).secret, 'google');
      // AS ANY SIGN-IN DOES: every token this browser still carries is revoked, at no cost to it.
      if (signedIn.statusCode === 200) {
        for (const err of await revokeEach(ids, carried(event))) {
          console.error('auth-relay: revoking the earlier session failed', err);
        }
      }
      return signedIn;
    } catch (err) {
      const name = nameOf(err) ?? '';
      // Named, since a misconfigured client refuses every code the same way.
      if (UNREDEEMABLE.has(name)) {
        console.warn('auth-relay: the token endpoint refused a Google code', name);
        return spent();
      }
      // A FAULT IS NOT A REFUSAL: logged, and the flow left to expire.
      console.error('auth-relay: redeeming a Google code failed', err);
      return INTERNAL;
    }
  };

  /** A SECRET ROTATED IN PLACE leaves environments holding different ones, so a cookie this one cannot
   *  open reads again the secret Cognito describes; one sealed under the other waits for a refresh. */
  const opened = async (ids: Ids, sealed: string): Promise<string | undefined> => {
    const known = await cached(ids);
    const token = unseal(known.secret, sealed);
    if (token !== undefined || now() - rereadAt < REREAD_MS) return token;
    rereadAt = now();
    const fresh = await read(ids).catch(() => undefined);
    if (fresh === undefined) return undefined;
    client = { value: Promise.resolve(fresh), at: now() };
    return unseal(fresh.secret, sealed);
  };

  /** A PASSKEY CALL, for the account the tab names, with the token a sign-in sealed: the cookie is
   *  the browser's, and another tab's sign-in replaces it. It writes no cookie, so takes no lock. */
  const withToken = async (
    event: ApiEvent,
    route: string,
    sub: string,
    call: (token: string) => Promise<ApiResult>,
  ): Promise<ApiResult> => {
    const sealed = cookieIn(event, ACCESS);
    if (sealed === undefined) return NOT_AUTHORIZED;
    const ids = idsOf();
    if (ids === undefined) return INTERNAL;
    const token = await opened(ids, sealed);
    if (token === undefined || accountOf(token) !== sub) return NOT_AUTHORIZED;
    try {
      return await call(token);
    } catch (err) {
      const known = PASSKEY_REFUSED_AS.get(nameOf(err) ?? '');
      if (known !== undefined) return known;
      console.error(`auth-relay: ${route} failed`, err);
      return INTERNAL;
    }
  };

  const listPasskeys = (event: ApiEvent) => {
    const asked = exactly(parsed(event), PASSKEY_KEYS);
    if (asked === undefined) return Promise.resolve(INVALID);
    return withToken(event, PASSKEY_LIST_ROUTE, asked.sub, async (token) => {
      const { Credentials } = await idp.listWebAuthnCredentials({
        AccessToken: token,
        MaxResults: 1,
      });
      // AN ANSWER COGNITO CANNOT GIVE OFFERS NOTHING (*Auth model*), so no list is not an empty one.
      if (!Array.isArray(Credentials)) {
        console.error('auth-relay: Cognito listed no credentials');
        return INTERNAL;
      }
      return respond(
        PASSKEYS,
        { 'cache-control': NO_STORE },
        JSON.stringify({ passkey: Credentials.length > 0 }),
      );
    });
  };

  const startRegistration = (event: ApiEvent) => {
    const asked = exactly(parsed(event), PASSKEY_KEYS);
    if (asked === undefined) return Promise.resolve(INVALID);
    return withToken(event, PASSKEY_START_ROUTE, asked.sub, async (token) => {
      const { CredentialCreationOptions: options } = await idp.startWebAuthnRegistration({
        AccessToken: token,
      });
      if (typeof options !== 'object' || options === null) {
        console.error('auth-relay: Cognito started a registration with no options');
        return INTERNAL;
      }
      return respond(CREATION_OPTIONS, { 'cache-control': NO_STORE }, JSON.stringify({ options }));
    });
  };

  const completeRegistration = (event: ApiEvent) => {
    // EVERY PASSKEY CALL'S KEYS, and an object under `credential`, which Cognito reads.
    const { credential, ...given } = (parsed(event) ?? {}) as Record<string, unknown>;
    const asked = exactly(given, PASSKEY_KEYS);
    if (
      asked === undefined ||
      typeof credential !== 'object' ||
      credential === null ||
      Array.isArray(credential)
    ) {
      return Promise.resolve(INVALID);
    }
    return withToken(event, PASSKEY_COMPLETE_ROUTE, asked.sub, async (token) => {
      await idp.completeWebAuthnRegistration({ AccessToken: token, Credential: credential });
      return REGISTERED;
    });
  };

  return async (event: ApiEvent): Promise<ApiResult> => {
    // THE GATE IS FIRST, before the body, the environment or Cognito: RFC 10017 §6.2.3.3 puts these
    // defences exactly on the endpoints where the application obtains its tokens.
    if (!fromTheApp(event)) return CSRF;
    try {
      switch (event.routeKey) {
        case START_ROUTE:
          return await start(event);
        case RESPOND_ROUTE:
          return await answer(event);
        case REFRESH_ROUTE:
          return await refresh(event);
        case SIGN_OUT_ROUTE:
          return await signOut(event);
        case GOOGLE_BEGIN_ROUTE:
          return await begin();
        case GOOGLE_COMPLETE_ROUTE:
          return await complete(event);
        case PASSKEY_LIST_ROUTE:
          return await listPasskeys(event);
        case PASSKEY_START_ROUTE:
          return await startRegistration(event);
        case PASSKEY_COMPLETE_ROUTE:
          return await completeRegistration(event);
        default:
          return INVALID;
      }
    } catch (err) {
      console.error('auth-relay failed', err);
      return INTERNAL;
    }
  };
};

/** Cognito's token endpoint: "supports client_secret_basic", and "The authorization header string
 *  is Basic Base64Encode(client_id:client_secret)". A refusal throws under its OAuth `error`. */
export const redeemWith =
  (fetch: (url: string, init: RequestInit) => Promise<Response>) =>
  async (input: RedeemInput): Promise<CodeTokens> => {
    const response = await fetch(`https://${input.domain}/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${input.client}:${input.secret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: input.client,
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.verifier,
      }).toString(),
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (response.ok && typeof body === 'object' && body !== null) return body as CodeTokens;
    const error = (body as { error?: unknown } | undefined)?.error;
    throw typeof error === 'string'
      ? named(error, `the token endpoint refused the code (${response.status})`)
      : named('TokenEndpointFault', `the token endpoint answered ${response.status}`);
  };

const cognito = new CognitoIdentityProviderClient({});

const sdk: IdentityClient = {
  describeUserPoolClient: (input) => cognito.send(new DescribeUserPoolClientCommand(input)),
  initiateAuth: (input) => cognito.send(new InitiateAuthCommand(input)),
  respondToAuthChallenge: (input) =>
    cognito.send(
      new RespondToAuthChallengeCommand({
        ...input,
        ChallengeName: input.ChallengeName as ChallengeNameType,
      }),
    ),
  getTokensFromRefreshToken: (input) => cognito.send(new GetTokensFromRefreshTokenCommand(input)),
  revokeToken: (input) => cognito.send(new RevokeTokenCommand(input)),
  redeemCode: redeemWith((url, init) => fetch(url, init)),
  listWebAuthnCredentials: (input) => cognito.send(new ListWebAuthnCredentialsCommand(input)),
  startWebAuthnRegistration: (input) => cognito.send(new StartWebAuthnRegistrationCommand(input)),
  completeWebAuthnRegistration: (input) =>
    cognito.send(
      new CompleteWebAuthnRegistrationCommand({
        ...input,
        // A JSON DOCUMENT, as the dialog made it: `completeRegistration` admits an object alone.
        Credential: input.Credential as CompleteWebAuthnRegistrationCommandInput['Credential'],
      }),
    ),
};

export const handler = createRelay(sdk);
