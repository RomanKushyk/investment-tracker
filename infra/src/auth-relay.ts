// `/auth/*` — the only way a browser obtains a token, and the only holder of the client secret.
//
// RFC 10017's token-mediating backend on a confidential client (*Auth model*): the refresh token
// goes into an HttpOnly cookie on this host and nowhere else, and the ID and access tokens go back
// in the body for the app to hold in memory. Data routes never see this function.
import { createHmac } from 'node:crypto';
import {
  type ChallengeNameType,
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  GetTokensFromRefreshTokenCommand,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  RevokeTokenCommand,
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
const CLEARED = `${COOKIE}=; Max-Age=0; ${ATTRIBUTES}`;
const FORGOTTEN = [CLEARED, `${ORIGIN}=; Max-Age=0; ${ATTRIBUTES}`] as const;

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
  example: { idToken: '<JWT>', accessToken: '<JWT>', expiresIn: 3600 },
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
const SIGNED_OUT = derived({
  statusCode: 200,
  name: 'signed_out',
  headers: ['set-cookie'],
  example: { status: 'signed_out' },
});
/** RFC 10017 §6.2.2.2: a refresh token no longer valid ends the session, so the cookie goes too. */
const SESSION_ENDED = derived({
  statusCode: 401,
  name: 'not_authorized',
  headers: ['set-cookie'],
  example: { error: 'not_authorized' },
});

const NOT_AUTHORIZED = json(401, '{"error":"not_authorized"}');
const INVALID_PASSWORD = json(400, '{"error":"invalid_password"}');
const CSRF = json(403, '{"error":"csrf"}');

/** What each route can answer, and the only list of it — `openapi.ts` builds the document from
 *  here, and `auth-relay.test.ts` proves it against what the routes really answer. */
export const RESPONSES: Record<string, readonly (ApiResult | Declared)[]> = {
  [START_ROUTE]: [CHALLENGE, NOT_AUTHORIZED, INVALID, CSRF, INTERNAL],
  [RESPOND_ROUTE]: [TOKENS, CHALLENGE, NOT_AUTHORIZED, INVALID_PASSWORD, INVALID, CSRF, INTERNAL],
  [REFRESH_ROUTE]: [TOKENS, SESSION_ENDED, CSRF, INTERNAL],
  [SIGN_OUT_ROUTE]: [SIGNED_OUT, CSRF, INTERNAL],
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
  ['InvalidPasswordException', INVALID_PASSWORD],
  ['PasswordHistoryPolicyViolationException', INVALID_PASSWORD],
  ['InvalidParameterException', INVALID],
]);

/** What `GetTokensFromRefreshToken` says of a token that will never work again. A replay is not
 *  among them: it ends the family, not only the session. */
const SESSION_OVER = new Set([
  'NotAuthorizedException',
  'UserNotFoundException',
  'InvalidParameterException',
]);

/** The refusals `RevokeToken` documents for a token it will not take — an access token, or input it
 *  cannot parse. A revoked or unknown refresh token revokes without complaint (measured). */
const ALREADY_DEAD = new Set(['UnsupportedTokenTypeException', 'InvalidParameterException']);

/** A refusal waits this long before it may read the secret again — the default cache lifetime of
 *  AWS's Parameters and Secrets Lambda Extension. `UserPoolClientRead` allows five a second. */
const REREAD_MS = 300_000;

type Tokens = { IdToken?: string; AccessToken?: string; RefreshToken?: string; ExpiresIn?: number };
type Answer = {
  ChallengeName?: string;
  Session?: string;
  ChallengeParameters?: Record<string, string>;
  AvailableChallenges?: string[];
  AuthenticationResult?: Tokens;
};

/** Narrowed to the five calls this file makes, so a test injects a double rather than the SDK. */
export type IdentityClient = {
  describeUserPoolClient(input: {
    UserPoolId: string;
    ClientId: string;
  }): Promise<{ UserPoolClient?: { ClientSecret?: string } }>;
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

/** Cognito's hash over the USERNAME the same call carries: "any user pool sign-in attribute". */
const hashOf = (secret: string, username: string, client: string) =>
  createHmac('sha256', secret)
    .update(username + client)
    .digest('base64');

type Ids = { pool: string; client: string };

const idsOf = (): Ids | undefined => {
  const pool = process.env.USER_POOL_ID;
  const client = process.env.USER_POOL_CLIENT_ID;
  if (!pool || !client) {
    console.error('auth-relay: USER_POOL_ID or USER_POOL_CLIENT_ID is not set on this function');
    return undefined;
  }
  return { pool, client };
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

/** The refresh token into the cookie, the other two into the body. A sign-in's is the family's
 *  original too; a refresh's `sent` is the cookie's own, kept when Cognito rotates nothing. */
const issued = (tokens: Tokens | undefined, from: 'sign-in' | { sent: string }): ApiResult => {
  const refresh = tokens?.RefreshToken ?? (from === 'sign-in' ? undefined : from.sent);
  if (!tokens?.IdToken || !tokens.AccessToken || !refresh) {
    console.error('auth-relay: Cognito answered without the tokens a session needs');
    return INTERNAL;
  }
  return respond(
    TOKENS,
    {
      'set-cookie':
        from === 'sign-in' ? [cookieOf(refresh), originOf(refresh)] : [cookieOf(refresh)],
      'cache-control': NO_STORE,
    },
    JSON.stringify({
      idToken: tokens.IdToken,
      accessToken: tokens.AccessToken,
      expiresIn: tokens.ExpiresIn,
    }),
  );
};

const refusedBy = (route: string, err: unknown): ApiResult => {
  const known = REFUSED_AS.get(nameOf(err) ?? '');
  if (known !== undefined) return known;
  console.error(`auth-relay: ${route} failed`, err);
  return INTERNAL;
};

const ended = (cleared: readonly [string, ...string[]]) =>
  respond(SESSION_ENDED, { 'set-cookie': cleared }, '{"error":"not_authorized"}');
const signedOut = () => respond(SIGNED_OUT, { 'set-cookie': FORGOTTEN }, '{"status":"signed_out"}');

/** One relay per execution environment, which is what its secret is cached across. */
export const createRelay = (idp: IdentityClient, now: () => number = Date.now) => {
  let secret: Promise<string> | undefined;
  let rereadAt = -Infinity;

  const read = (ids: Ids): Promise<string> =>
    idp.describeUserPoolClient({ UserPoolId: ids.pool, ClientId: ids.client }).then(
      (described) => {
        const value = described.UserPoolClient?.ClientSecret;
        if (!value) throw new SecretUnreadable('the app client has no secret');
        return value;
      },
      (err: unknown) => {
        throw new SecretUnreadable('DescribeUserPoolClient failed', { cause: err });
      },
    );

  // A FAILED READ IS NOT KEPT, or one throttle would poison the environment until it is recycled.
  const cached = (ids: Ids): Promise<string> => {
    if (secret === undefined) {
      const reading = read(ids);
      secret = reading;
      reading.catch(() => {
        if (secret === reading) secret = undefined;
      });
    }
    return secret;
  };

  /** One call with the secret, made AGAIN only when a re-read finds the secret changed: a wrong
   *  password submitted twice would count twice toward Cognito's lockout. */
  const withSecret = async <T>(
    ids: Ids,
    refusedAs: string,
    call: (secret: string) => Promise<T>,
  ): Promise<T> => {
    const known = await cached(ids);
    try {
      return await call(known);
    } catch (err) {
      if (nameOf(err) !== refusedAs || now() - rereadAt < REREAD_MS) throw err;
      rereadAt = now();
      const fresh = await read(ids).catch(() => undefined);
      if (fresh === undefined || fresh === known) throw err;
      secret = Promise.resolve(fresh);
      return call(fresh);
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
      const signedIn = issued(answered.AuthenticationResult, 'sign-in');
      // A SIGN-IN ENDS THE FAMILY THIS BROWSER STILL CARRIES, which an idle expiry does not end. A
      // revocation that errors costs no sign-in: that family is capped by its own lifetime.
      const earlier = cookieIn(event, ORIGIN);
      if (signedIn.statusCode === 200 && earlier !== undefined) {
        await revoke(ids, earlier).catch((err: unknown) => {
          console.error('auth-relay: revoking the earlier family failed', err);
        });
      }
      return signedIn;
    } catch (err) {
      return refusedBy(RESPOND_ROUTE, err);
    }
  };

  const refresh = async (event: ApiEvent): Promise<ApiResult> => {
    const token = cookieIn(event, COOKIE);
    if (token === undefined) return ended([CLEARED]);
    const ids = idsOf();
    if (ids === undefined) return INTERNAL;
    try {
      const { AuthenticationResult } = await withSecret(ids, 'NotAuthorizedException', (s) =>
        idp.getTokensFromRefreshToken({
          RefreshToken: token,
          ClientId: ids.client,
          ClientSecret: s,
        }),
      );
      return issued(AuthenticationResult, { sent: token });
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
        return ended(FORGOTTEN);
      }
      // AN EXPIRED OR REVOKED TOKEN SAYS NOTHING OF A THIEF: the original stays, for the next
      // sign-in to revoke.
      if (SESSION_OVER.has(nameOf(err) ?? '')) return ended([CLEARED]);
      // A FAULT IS NOT A DEAD SESSION: the cookie stays, so the next refresh can still succeed.
      console.error('auth-relay: refresh failed', err);
      return INTERNAL;
    }
  };

  const signOut = async (event: ApiEvent): Promise<ApiResult> => {
    // THE ORIGINAL BEFORE THE COOKIE'S TOKEN: after a fork inside the window the cookie may hold the
    // dead sibling, and revoking that leaves the other branch refreshing (measured).
    const token = cookieIn(event, ORIGIN) ?? cookieIn(event, COOKIE);
    if (token === undefined) return signedOut();
    const ids = idsOf();
    if (ids === undefined) return INTERNAL;
    try {
      await revoke(ids, token);
    } catch (err) {
      // KEPT SO A RETRY CAN STILL REVOKE IT: a forgotten live token stays usable wherever it went.
      console.error('auth-relay: sign-out failed', err);
      return INTERNAL;
    }
    return signedOut();
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
        default:
          return INVALID;
      }
    } catch (err) {
      console.error('auth-relay failed', err);
      return INTERNAL;
    }
  };
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
};

export const handler = createRelay(sdk);
