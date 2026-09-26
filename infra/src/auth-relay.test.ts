// The relay is the only way a browser gets a token, and the only holder of the client secret. What
// these tests pin is where each token goes — the refresh token into an HttpOnly cookie and nowhere
// else — and what a request must carry to be answered at all.
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  REFRESH_ROUTE,
  RESPOND_ROUTE,
  RESPONSES,
  SIGN_OUT_ROUTE,
  START_ROUTE,
  type IdentityClient,
  createRelay,
  handler as rawHandler,
} from './auth-relay';
import type { ApiEvent, ApiResult } from './http';
import { proveRouteContract, recorder } from './route-contract';

const { observed, record } = recorder(START_ROUTE);

const POOL = 'eu-north-1_EXAMPLE';
const CLIENT = 'exampleclientid';
const SECRET = 'the-client-secret';
const ROTATED_SECRET = 'the-rotated-client-secret';
const EMAIL = 'owner@quirenote.com';
/** What Cognito names the user inside an SRP challenge: the pool username, not the address. */
const SUB = '9f1e2d3c-0000-4000-8000-0000000000d4';
const SESSION = 'challenge-session';
const ID = 'id.token.jwt';
const ACCESS = 'access.token.jwt';
const REFRESH = 'refresh.token.jwe';
const ROTATED = 'rotated.refresh.token.jwe';
/** A family's original, from a sign-in before this request: never `REFRESH`, so a test can tell
 *  which of the two was revoked. */
const ORIGIN = 'origin.refresh.token.jwe';

const hashOf = (secret: string, username: string) =>
  createHmac('sha256', secret)
    .update(username + CLIENT)
    .digest('base64');

// THE NAME IS WRITTEN OUT, not imported: `__Host-Http-` is the criterion, and a constant renamed in
// the module would carry an import along with it.
const ATTRIBUTES = 'Path=/; Secure; HttpOnly; SameSite=Strict';
const kept = (token: string) => `__Host-Http-refresh=${token}; Max-Age=7200; ${ATTRIBUTES}`;
/** The family's original: its whole lifetime, set once at sign-in (*Auth model*). */
const origin = (token: string) => `__Host-Http-origin=${token}; Max-Age=86400; ${ATTRIBUTES}`;
const CLEARED = `__Host-Http-refresh=; Max-Age=0; ${ATTRIBUTES}`;
const FORGOTTEN = [CLEARED, `__Host-Http-origin=; Max-Age=0; ${ATTRIBUTES}`];

const BROWSER = { 'x-csrf': '1', 'sec-fetch-site': 'same-site' };

const post = (
  routeKey: string,
  body?: unknown,
  headers: Record<string, string | undefined> = {},
): ApiEvent => ({
  routeKey,
  headers: { ...BROWSER, ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body), isBase64Encoded: false }),
});

type Jar = { refresh?: string; origin?: string };

/** What a browser sends, the original FIRST where there is one: a cookie is found by its name,
 *  never by its place. */
const cookiesOf = (jar: Jar) => [
  ...(jar.origin === undefined ? [] : [`__Host-Http-origin=${jar.origin}`]),
  'theme=dark',
  ...(jar.refresh === undefined ? [] : [`__Host-Http-refresh=${jar.refresh}`]),
];

const carrying = (routeKey: string, jar: Jar = { refresh: REFRESH }): ApiEvent => ({
  ...post(routeKey),
  cookies: cookiesOf(jar),
});

const refusal = (name: string, message = name) => Object.assign(new Error(message), { name });

const PASSKEY_CHALLENGE = {
  ChallengeName: 'WEB_AUTHN',
  Session: SESSION,
  ChallengeParameters: { CREDENTIAL_REQUEST_OPTIONS: '{"challenge":"abc"}' },
};
const VERIFIER_CHALLENGE = {
  ChallengeName: 'PASSWORD_VERIFIER',
  Session: SESSION,
  ChallengeParameters: { USER_ID_FOR_SRP: SUB, SRP_B: 'b', SALT: 's', SECRET_BLOCK: 'sb' },
};
const SIGNED_IN = {
  AuthenticationResult: {
    IdToken: ID,
    AccessToken: ACCESS,
    RefreshToken: REFRESH,
    ExpiresIn: 3600,
  },
};

/** A pool that records every call. `secrets` is what successive `DescribeUserPoolClient` calls
 *  read, the last one repeated; every other call answers from `script`, else succeeds. */
const cognito = (script: Partial<IdentityClient> = {}, secrets: (string | Error)[] = [SECRET]) => {
  const calls: { op: keyof IdentityClient; input: Record<string, unknown> }[] = [];
  let reads = 0;
  const log = (op: keyof IdentityClient, input: unknown) =>
    calls.push({ op, input: input as Record<string, unknown> });
  const idp: IdentityClient = {
    describeUserPoolClient: async (input) => {
      log('describeUserPoolClient', input);
      const next = secrets[Math.min(reads++, secrets.length - 1)];
      if (next instanceof Error) throw next;
      return { UserPoolClient: { ClientSecret: next } };
    },
    initiateAuth: async (input) => {
      log('initiateAuth', input);
      return script.initiateAuth ? script.initiateAuth(input) : PASSKEY_CHALLENGE;
    },
    respondToAuthChallenge: async (input) => {
      log('respondToAuthChallenge', input);
      return script.respondToAuthChallenge ? script.respondToAuthChallenge(input) : SIGNED_IN;
    },
    getTokensFromRefreshToken: async (input) => {
      log('getTokensFromRefreshToken', input);
      return script.getTokensFromRefreshToken
        ? script.getTokensFromRefreshToken(input)
        : {
            AuthenticationResult: {
              IdToken: ID,
              AccessToken: ACCESS,
              RefreshToken: ROTATED,
              ExpiresIn: 3600,
            },
          };
    },
    revokeToken: async (input) => {
      log('revokeToken', input);
      return script.revokeToken ? script.revokeToken(input) : {};
    },
  };
  const of = (op: keyof IdentityClient) => calls.filter((c) => c.op === op).map((c) => c.input);
  return { idp, calls, of };
};

/** One execution environment: a relay whose secret cache survives between the calls it answers. */
const environment = (idp: IdentityClient, now?: () => number) => {
  const relay = createRelay(idp, now);
  return async (event: ApiEvent): Promise<ApiResult> => record(event, await relay(event));
};

const handler = async (event: ApiEvent) => record(event, await rawHandler(event));

const bodyOf = (res: ApiResult) => JSON.parse(res.body) as Record<string, unknown>;

beforeEach(() => {
  vi.stubEnv('USER_POOL_ID', POOL);
  vi.stubEnv('USER_POOL_CLIENT_ID', CLIENT);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a sign-in leaves the refresh token in the cookie and nowhere else', () => {
  it('starts a passkey sign-in with the hash of the secret, and hands back the challenge', async () => {
    const { idp, of } = cognito();
    const res = await environment(idp)(
      post(START_ROUTE, { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'WEB_AUTHN' }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.cookies).toBeUndefined();
    expect(bodyOf(res)).toEqual({
      challenge: 'WEB_AUTHN',
      session: SESSION,
      parameters: PASSKEY_CHALLENGE.ChallengeParameters,
    });
    expect(of('initiateAuth')).toEqual([
      {
        AuthFlow: 'USER_AUTH',
        ClientId: CLIENT,
        AuthParameters: {
          USERNAME: EMAIL,
          PREFERRED_CHALLENGE: 'WEB_AUTHN',
          SECRET_HASH: hashOf(SECRET, EMAIL),
        },
      },
    ]);
  });

  // THE SAME TOKEN TWICE: the live one, which every refresh replaces, and the family's original,
  // which revoked ends every branch the family grows.
  it('finishes it with the tokens in the body and the refresh token in both cookies', async () => {
    const { idp, of } = cognito();
    const res = await environment(idp)(
      post(RESPOND_ROUTE, {
        challenge: 'WEB_AUTHN',
        session: SESSION,
        responses: { USERNAME: EMAIL, CREDENTIAL: '{"id":"cred"}' },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(bodyOf(res)).toEqual({ idToken: ID, accessToken: ACCESS, expiresIn: 3600 });
    expect(res.cookies).toEqual([kept(REFRESH), origin(REFRESH)]);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).not.toContain(REFRESH);
    expect(JSON.stringify(res.headers)).not.toContain(REFRESH);
    expect(of('respondToAuthChallenge')).toEqual([
      {
        ClientId: CLIENT,
        ChallengeName: 'WEB_AUTHN',
        Session: SESSION,
        ChallengeResponses: {
          USERNAME: EMAIL,
          CREDENTIAL: '{"id":"cred"}',
          SECRET_HASH: hashOf(SECRET, EMAIL),
        },
      },
    ]);
  });

  // THE HASH IS OVER THE USERNAME THE SAME REQUEST CARRIES: inside an SRP challenge that is the
  // pool username Cognito handed out as `USER_ID_FOR_SRP`, not the address the sign-in began with.
  it('runs an SRP sign-in through a first-password change to the tokens', async () => {
    const { idp, of } = cognito({
      initiateAuth: async () => VERIFIER_CHALLENGE,
      respondToAuthChallenge: async (input) =>
        input.ChallengeName === 'PASSWORD_VERIFIER'
          ? { ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: SESSION, ChallengeParameters: {} }
          : SIGNED_IN,
    });
    const relay = environment(idp);
    const started = await relay(
      post(START_ROUTE, { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'PASSWORD_SRP', SRP_A: 'a' }),
    );
    expect(bodyOf(started)).toEqual({
      challenge: 'PASSWORD_VERIFIER',
      session: SESSION,
      parameters: VERIFIER_CHALLENGE.ChallengeParameters,
    });
    const verified = await relay(
      post(RESPOND_ROUTE, {
        challenge: 'PASSWORD_VERIFIER',
        session: SESSION,
        responses: {
          USERNAME: SUB,
          PASSWORD_CLAIM_SIGNATURE: 'sig',
          PASSWORD_CLAIM_SECRET_BLOCK: 'sb',
          TIMESTAMP: 'Sat Sep 26 10:00:00 UTC 2026',
        },
      }),
    );
    expect([verified.statusCode, bodyOf(verified).challenge]).toEqual([
      200,
      'NEW_PASSWORD_REQUIRED',
    ]);
    expect(verified.cookies).toBeUndefined();
    const changed = await relay(
      post(RESPOND_ROUTE, {
        challenge: 'NEW_PASSWORD_REQUIRED',
        session: SESSION,
        responses: { USERNAME: SUB, NEW_PASSWORD: 'a new password' },
      }),
    );
    expect(changed.cookies).toEqual([kept(REFRESH), origin(REFRESH)]);
    expect(of('initiateAuth')[0].AuthParameters).toEqual({
      USERNAME: EMAIL,
      PREFERRED_CHALLENGE: 'PASSWORD_SRP',
      SRP_A: 'a',
      SECRET_HASH: hashOf(SECRET, EMAIL),
    });
    expect(
      of('respondToAuthChallenge').map(
        (i) => (i.ChallengeResponses as Record<string, string>).SECRET_HASH,
      ),
    ).toEqual([hashOf(SECRET, SUB), hashOf(SECRET, SUB)]);
  });

  // A USER WITH NO PASSKEY IS OFFERED A SELECTION, and the relay passes the list through.
  it('answers a selection with SRP, and passes the offered list back', async () => {
    const { idp, of } = cognito({
      initiateAuth: async () => ({
        ChallengeName: 'SELECT_CHALLENGE',
        Session: SESSION,
        AvailableChallenges: ['PASSWORD_SRP', 'PASSWORD'],
        ChallengeParameters: {},
      }),
      respondToAuthChallenge: async () => VERIFIER_CHALLENGE,
    });
    const relay = environment(idp);
    const offered = await relay(
      post(START_ROUTE, { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'WEB_AUTHN' }),
    );
    expect(bodyOf(offered).availableChallenges).toEqual(['PASSWORD_SRP', 'PASSWORD']);
    const chosen = await relay(
      post(RESPOND_ROUTE, {
        challenge: 'SELECT_CHALLENGE',
        session: SESSION,
        responses: { USERNAME: EMAIL, ANSWER: 'PASSWORD_SRP', SRP_A: 'a' },
      }),
    );
    expect(bodyOf(chosen).challenge).toBe('PASSWORD_VERIFIER');
    expect(of('respondToAuthChallenge')[0].ChallengeResponses).toEqual({
      USERNAME: EMAIL,
      ANSWER: 'PASSWORD_SRP',
      SRP_A: 'a',
      SECRET_HASH: hashOf(SECRET, EMAIL),
    });
  });
});

// COGNITO HAS NO INACTIVITY EXPIRY: a family whose refresh cookie idled out can still be live, and
// then its original is still in the browser, for the next sign-in there to end.
describe('a sign-in revokes every token the browser still carries', () => {
  const answer = {
    challenge: 'WEB_AUTHN',
    session: SESSION,
    responses: { USERNAME: EMAIL, CREDENTIAL: '{}' },
  };
  const signingIn = (jar: Jar): ApiEvent => ({
    ...post(RESPOND_ROUTE, answer),
    cookies: cookiesOf(jar),
  });
  const earlier = signingIn({ refresh: ROTATED, origin: ORIGIN });

  // THE TWO COOKIES CAN BELONG TO TWO FAMILIES — a refresh answering after a sign-in overwrites
  // one — and Cognito revokes a family, never the browser.
  it('revokes the earlier original and refresh token once Cognito has signed in, then sets both cookies', async () => {
    const { idp, calls } = cognito();
    const res = await environment(idp)(earlier);
    expect([res.statusCode, res.cookies]).toEqual([200, [kept(REFRESH), origin(REFRESH)]]);
    expect(calls.filter((c) => c.op !== 'describeUserPoolClient')).toEqual([
      expect.objectContaining({ op: 'respondToAuthChallenge' }),
      { op: 'revokeToken', input: { Token: ORIGIN, ClientId: CLIENT, ClientSecret: SECRET } },
      { op: 'revokeToken', input: { Token: ROTATED, ClientId: CLIENT, ClientSecret: SECRET } },
    ]);
  });

  // A SESSION FROM BEFORE THE ORIGINAL'S COOKIE carries its refresh token alone.
  it('revokes the refresh token a browser carries alone', async () => {
    const { idp, of } = cognito();
    const res = await environment(idp)(signingIn({ refresh: ROTATED }));
    expect([res.statusCode, res.cookies]).toEqual([200, [kept(REFRESH), origin(REFRESH)]]);
    expect(of('revokeToken').map((input) => input.Token)).toEqual([ROTATED]);
  });

  it('revokes a token both cookies hold once', async () => {
    const { idp, of } = cognito();
    await environment(idp)(signingIn({ refresh: ORIGIN, origin: ORIGIN }));
    expect(of('revokeToken').map((input) => input.Token)).toEqual([ORIGIN]);
  });

  // THE OLD FAMILY IS CAPPED BY ITS OWN LIFETIME, so a revocation that errors costs no sign-in.
  for (const [which, failing] of [
    ['the original', ORIGIN],
    ['the refresh token', ROTATED],
  ]) {
    it(`completes the sign-in when revoking ${which} fails, and still revokes the other`, async () => {
      const { idp, of } = cognito({
        revokeToken: async (input) => {
          if (input.Token === failing) throw refusal('TooManyRequestsException');
          return {};
        },
      });
      const res = await environment(idp)(earlier);
      expect([res.statusCode, res.cookies]).toEqual([200, [kept(REFRESH), origin(REFRESH)]]);
      expect(bodyOf(res)).toEqual({ idToken: ID, accessToken: ACCESS, expiresIn: 3600 });
      expect(of('revokeToken').map((input) => input.Token)).toEqual([ORIGIN, ROTATED]);
      expect(console.error).toHaveBeenCalledTimes(1);
    });
  }

  // ONLY A SIGN-IN THAT HAPPENED ENDS THE OLD ONE: a step on the way, a refusal or a failure
  // leaves the browser signed in as it was.
  const unfinished: [string, Partial<IdentityClient>][] = [
    [
      'a challenge still to answer',
      {
        respondToAuthChallenge: async () => ({
          ChallengeName: 'NEW_PASSWORD_REQUIRED',
          Session: SESSION,
          ChallengeParameters: {},
        }),
      },
    ],
    [
      'a refusal',
      {
        respondToAuthChallenge: async () => {
          throw refusal('NotAuthorizedException');
        },
      },
    ],
    [
      'tokens missing what a session needs',
      { respondToAuthChallenge: async () => ({ AuthenticationResult: { IdToken: ID } }) },
    ],
  ];
  for (const [what, script] of unfinished) {
    it(`revokes nothing on ${what}`, async () => {
      const { idp, of } = cognito(script);
      const res = await environment(idp)(earlier);
      expect(res.cookies).toBeUndefined();
      expect(of('revokeToken')).toEqual([]);
    });
  }
});

describe('the cookies', () => {
  const signIn = post(RESPOND_ROUTE, {
    challenge: 'WEB_AUTHN',
    session: SESSION,
    responses: { USERNAME: EMAIL, CREDENTIAL: '{}' },
  });

  // RFC 10017 §6.1.3.2: Secure and HttpOnly are MUST; SameSite=Strict, `Path=/`, no `Domain` and
  // the `__Host-Http-` prefix are SHOULD. `Max-Age` is the idle half of the session (*Auth model*).
  it('is __Host-Http-, Secure, HttpOnly, SameSite=Strict, Path=/, with no Domain', async () => {
    const res = await environment(cognito().idp)(carrying(REFRESH_ROUTE));
    expect(res.cookies).toEqual([
      '__Host-Http-refresh=rotated.refresh.token.jwe; Max-Age=7200; Path=/; Secure; HttpOnly; SameSite=Strict',
    ]);
    for (const cookie of res.cookies ?? []) expect(cookie).not.toMatch(/domain/i);
  });

  // THE SAME RULES FOR THE ORIGINAL, and `Max-Age` is the family's lifetime: no rotated token
  // outlives its original (AWS).
  it('holds the same token as the family’s original after a sign-in, for the family’s life', async () => {
    const res = await environment(cognito().idp)(signIn);
    expect(res.cookies).toEqual([
      '__Host-Http-refresh=refresh.token.jwe; Max-Age=7200; Path=/; Secure; HttpOnly; SameSite=Strict',
      '__Host-Http-origin=refresh.token.jwe; Max-Age=86400; Path=/; Secure; HttpOnly; SameSite=Strict',
    ]);
    for (const cookie of res.cookies ?? []) expect(cookie).not.toMatch(/domain/i);
  });

  // SET ONCE, NEVER MOVED: re-set by a refresh, the original would outlive its family.
  it('never re-sets the original on a refresh', async () => {
    const { idp, of } = cognito();
    const res = await environment(idp)(
      carrying(REFRESH_ROUTE, { refresh: REFRESH, origin: ORIGIN }),
    );
    expect(res.cookies).toEqual([kept(ROTATED)]);
    expect(of('getTokensFromRefreshToken').map((input) => input.RefreshToken)).toEqual([REFRESH]);
  });

  it('is never sent as a header, where payload 2.0 would not repeat it', async () => {
    for (const event of [carrying(REFRESH_ROUTE), signIn]) {
      const res = await environment(cognito().idp)(event);
      expect(Object.keys(res.headers)).not.toContain('set-cookie');
    }
  });
});

describe('only the listed challenges pass, and never a plain password', () => {
  const refused = async (event: ApiEvent) => {
    const { idp, calls } = cognito();
    const res = await environment(idp)(event);
    return { status: res.statusCode, body: res.body, calls: calls.length };
  };
  const INVALID = { status: 400, body: '{"error":"invalid_request"}', calls: 0 };

  const starts: [string, unknown][] = [
    // Naming a preference means supplying its credential in the same call, so this is its shape.
    [
      'a plain password as the preference',
      { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'PASSWORD', PASSWORD: 'p' },
    ],
    [
      'a password preference with no password',
      { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'PASSWORD' },
    ],
    [
      'a password beside a passkey preference',
      { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'WEB_AUTHN', PASSWORD: 'p' },
    ],
    ['an emailed code', { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'EMAIL_OTP' }],
    ['a texted code', { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'SMS_OTP' }],
    ['no preference', { USERNAME: EMAIL }],
    ['SRP with no SRP_A', { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'PASSWORD_SRP' }],
    [
      'an SRP_A beside a passkey',
      { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'WEB_AUTHN', SRP_A: 'a' },
    ],
    [
      'a hash the caller computed',
      { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'WEB_AUTHN', SECRET_HASH: 'x' },
    ],
    ['no username', { PREFERRED_CHALLENGE: 'WEB_AUTHN' }],
    ['an empty username', { USERNAME: '', PREFERRED_CHALLENGE: 'WEB_AUTHN' }],
    ['a username that is not text', { USERNAME: 7, PREFERRED_CHALLENGE: 'WEB_AUTHN' }],
    ['a list', [EMAIL]],
    ['null', null],
  ];
  for (const [what, body] of starts) {
    it(`refuses to start with ${what}, asking Cognito nothing`, async () => {
      expect(await refused(post(START_ROUTE, body))).toEqual(INVALID);
    });
  }

  it('refuses a start whose body is not JSON', async () => {
    expect(await refused({ ...post(START_ROUTE), body: '{', isBase64Encoded: false })).toEqual(
      INVALID,
    );
  });

  const responds: [string, unknown][] = [
    [
      'a plain password as the challenge',
      { challenge: 'PASSWORD', session: SESSION, responses: { USERNAME: EMAIL, PASSWORD: 'p' } },
    ],
    [
      'a plain password as the selection',
      {
        challenge: 'SELECT_CHALLENGE',
        session: SESSION,
        responses: { USERNAME: EMAIL, ANSWER: 'PASSWORD', PASSWORD: 'p' },
      },
    ],
    [
      'a passkey as the selection',
      {
        challenge: 'SELECT_CHALLENGE',
        session: SESSION,
        responses: { USERNAME: EMAIL, ANSWER: 'WEB_AUTHN', SRP_A: 'a' },
      },
    ],
    [
      'a password slipped beside a verifier',
      {
        challenge: 'PASSWORD_VERIFIER',
        session: SESSION,
        responses: {
          USERNAME: SUB,
          PASSWORD_CLAIM_SIGNATURE: 's',
          PASSWORD_CLAIM_SECRET_BLOCK: 'b',
          TIMESTAMP: 't',
          PASSWORD: 'p',
        },
      },
    ],
    [
      'a verifier missing its signature',
      {
        challenge: 'PASSWORD_VERIFIER',
        session: SESSION,
        responses: { USERNAME: SUB, PASSWORD_CLAIM_SECRET_BLOCK: 'b', TIMESTAMP: 't' },
      },
    ],
    [
      'an emailed code',
      { challenge: 'EMAIL_OTP', session: SESSION, responses: { USERNAME: EMAIL } },
    ],
    ['a texted code', { challenge: 'SMS_OTP', session: SESSION, responses: { USERNAME: EMAIL } }],
    [
      'a custom challenge',
      {
        challenge: 'CUSTOM_CHALLENGE',
        session: SESSION,
        responses: { USERNAME: EMAIL, ANSWER: 'x' },
      },
    ],
    [
      'an authenticator code',
      {
        challenge: 'SOFTWARE_TOKEN_MFA',
        session: SESSION,
        responses: { USERNAME: EMAIL, SOFTWARE_TOKEN_MFA_CODE: '123456' },
      },
    ],
    [
      'a hash the caller computed',
      {
        challenge: 'WEB_AUTHN',
        session: SESSION,
        responses: { USERNAME: EMAIL, CREDENTIAL: '{}', SECRET_HASH: 'x' },
      },
    ],
    ['no session', { challenge: 'WEB_AUTHN', responses: { USERNAME: EMAIL, CREDENTIAL: '{}' } }],
    [
      'a credential that is not text',
      { challenge: 'WEB_AUTHN', session: SESSION, responses: { USERNAME: EMAIL, CREDENTIAL: {} } },
    ],
    [
      'a key beside the three',
      {
        challenge: 'WEB_AUTHN',
        session: SESSION,
        responses: { USERNAME: EMAIL, CREDENTIAL: '{}' },
        clientMetadata: {},
      },
    ],
  ];
  for (const [what, body] of responds) {
    it(`refuses to respond with ${what}, asking Cognito nothing`, async () => {
      expect(await refused(post(RESPOND_ROUTE, body))).toEqual(INVALID);
    });
  }
});

describe('the secret is read from Cognito, once per environment', () => {
  const start = post(START_ROUTE, { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'WEB_AUTHN' });

  it('reads it with DescribeUserPoolClient on this pool and client, and keeps it', async () => {
    const { idp, of } = cognito();
    const relay = environment(idp);
    await relay(start);
    await relay(start);
    await relay(carrying(REFRESH_ROUTE));
    expect(of('describeUserPoolClient')).toEqual([{ UserPoolId: POOL, ClientId: CLIENT }]);
  });

  it('reads it again in a second environment, which shares nothing with the first', async () => {
    const { idp, of } = cognito();
    await environment(idp)(start);
    await environment(idp)(start);
    expect(of('describeUserPoolClient')).toHaveLength(2);
  });

  // ONE FAILED READ MUST NOT POISON THE ENVIRONMENT until Lambda recycles it.
  it('does not keep a read that failed', async () => {
    const { idp, of } = cognito({}, [refusal('TooManyRequestsException'), SECRET]);
    const relay = environment(idp);
    expect((await relay(start)).statusCode).toBe(500);
    expect((await relay(start)).statusCode).toBe(200);
    expect(of('describeUserPoolClient')).toHaveLength(2);
  });

  // THE READ'S OWN REFUSAL IS A FAULT OF THIS STACK, NOT THE CALLER'S: `DescribeUserPoolClient`
  // throws `NotAuthorizedException` for a missing grant, and read as a wrong password it would sign
  // somebody out with a live token.
  it('answers a refused read as its own failure, never as the caller’s', async () => {
    const { idp } = cognito({}, [refusal('NotAuthorizedException')]);
    const relay = environment(idp);
    const signIn = await relay(start);
    const refresh = await relay(carrying(REFRESH_ROUTE));
    expect([signIn.statusCode, refresh.statusCode]).toEqual([500, 500]);
    expect(refresh.cookies).toBeUndefined();
  });

  it('answers a client with no secret as a failure', async () => {
    const { idp } = cognito({}, ['']);
    expect((await environment(idp)(start)).statusCode).toBe(500);
  });

  // THE ONE CASE A SECOND ATTEMPT IS FOR: the secret changed under a warm environment.
  it('retries once with a secret that changed since it was read', async () => {
    const { idp, of } = cognito(
      {
        initiateAuth: async (input) => {
          if (input.AuthParameters.SECRET_HASH !== hashOf(ROTATED_SECRET, EMAIL)) {
            throw refusal('NotAuthorizedException', 'Unable to verify secret hash for client');
          }
          return PASSKEY_CHALLENGE;
        },
      },
      [SECRET, ROTATED_SECRET],
    );
    const res = await environment(idp)(start);
    expect(res.statusCode).toBe(200);
    expect(of('initiateAuth')).toHaveLength(2);
    expect(of('describeUserPoolClient')).toHaveLength(2);
  });

  // A WRONG PASSWORD IS NEVER SUBMITTED TWICE: Cognito counts each failure toward locking the
  // account, so a retry with the same secret would halve the attempts a person gets.
  it('does not retry a refusal when the secret has not changed', async () => {
    const { idp, of } = cognito({
      respondToAuthChallenge: async () => {
        throw refusal('NotAuthorizedException', 'Incorrect username or password.');
      },
    });
    const res = await environment(idp)(
      post(RESPOND_ROUTE, {
        challenge: 'PASSWORD_VERIFIER',
        session: SESSION,
        responses: {
          USERNAME: SUB,
          PASSWORD_CLAIM_SIGNATURE: 's',
          PASSWORD_CLAIM_SECRET_BLOCK: 'b',
          TIMESTAMP: 't',
        },
      }),
    );
    expect([res.statusCode, res.body]).toEqual([401, '{"error":"not_authorized"}']);
    expect(of('respondToAuthChallenge')).toHaveLength(1);
  });

  // `UserPoolClientRead` allows five a second per pool, so a refusal re-reads the secret at most
  // once per five minutes per environment — the default cache lifetime of AWS's own Parameters
  // and Secrets Lambda Extension.
  it('re-reads the secret after a refusal at most once every five minutes', async () => {
    let clock = 0;
    const { idp, of } = cognito({
      initiateAuth: async () => {
        throw refusal('NotAuthorizedException');
      },
    });
    const relay = environment(idp, () => clock);
    await relay(start);
    clock += 299_999;
    await relay(start);
    expect(of('describeUserPoolClient')).toHaveLength(2);
    clock += 1;
    await relay(start);
    expect(of('describeUserPoolClient')).toHaveLength(3);
  });

  it('answers the original refusal when the re-read itself fails', async () => {
    const { idp } = cognito(
      {
        initiateAuth: async () => {
          throw refusal('NotAuthorizedException');
        },
      },
      [SECRET, refusal('TooManyRequestsException')],
    );
    const res = await environment(idp)(start);
    expect([res.statusCode, res.body]).toEqual([401, '{"error":"not_authorized"}']);
  });

  const throttled = async () => {
    throw refusal('TooManyRequestsException');
  };
  const passkey = post(RESPOND_ROUTE, {
    challenge: 'WEB_AUTHN',
    session: SESSION,
    responses: { USERNAME: EMAIL, CREDENTIAL: '{}' },
  });
  const logging: [string, Partial<IdentityClient>, ApiEvent][] = [
    [
      'a sign-in Cognito fails',
      {
        respondToAuthChallenge: async () => {
          throw refusal('InternalErrorException');
        },
      },
      passkey,
    ],
    [
      'a sign-in whose earlier tokens will not revoke',
      { revokeToken: throttled },
      { ...passkey, cookies: cookiesOf({ refresh: ROTATED, origin: ORIGIN }) },
    ],
    [
      'a replay whose original will not revoke',
      {
        getTokensFromRefreshToken: async () => {
          throw refusal('RefreshTokenReuseException');
        },
        revokeToken: throttled,
      },
      carrying(REFRESH_ROUTE, { refresh: REFRESH, origin: ORIGIN }),
    ],
    [
      'a sign-out that will not revoke',
      { revokeToken: throttled },
      carrying(SIGN_OUT_ROUTE, { refresh: REFRESH, origin: ORIGIN }),
    ],
  ];
  for (const [what, script, event] of logging) {
    it(`never puts the secret or a token in a log line: ${what}`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await environment(cognito(script).idp)(event);
      expect(console.error).toHaveBeenCalled();
      const logged = JSON.stringify(
        [...vi.mocked(console.error).mock.calls, ...warn.mock.calls],
        (_, v: unknown) => (v instanceof Error ? `${v.name}: ${v.message}` : v),
      );
      for (const needle of [SECRET, hashOf(SECRET, EMAIL), SESSION, REFRESH, ROTATED, ORIGIN]) {
        expect([needle, logged.includes(needle)]).toEqual([needle, false]);
      }
    });
  }
});

describe('Cognito’s refusals, as the app can tell them apart', () => {
  const respond = post(RESPOND_ROUTE, {
    challenge: 'NEW_PASSWORD_REQUIRED',
    session: SESSION,
    responses: { USERNAME: SUB, NEW_PASSWORD: 'short' },
  });
  const answers: [string, number, string][] = [
    ['NotAuthorizedException', 401, '{"error":"not_authorized"}'],
    // THE SAME ANSWER AS A WRONG PASSWORD, so an address cannot be probed through the relay.
    ['UserNotFoundException', 401, '{"error":"not_authorized"}'],
    ['InvalidPasswordException', 400, '{"error":"invalid_password"}'],
    ['PasswordHistoryPolicyViolationException', 400, '{"error":"invalid_password"}'],
    ['InvalidParameterException', 400, '{"error":"invalid_request"}'],
    ['PasswordResetRequiredException', 500, '{"error":"internal"}'],
  ];
  for (const [name, status, body] of answers) {
    it(`answers ${name} with ${status}`, async () => {
      const { idp } = cognito({
        respondToAuthChallenge: async () => {
          throw refusal(name);
        },
      });
      const res = await environment(idp)(respond);
      expect([res.statusCode, res.body, res.cookies]).toEqual([status, body, undefined]);
    });
  }

  // THE LOCKOUT SHARES A WRONG PASSWORD'S NAME, so only its message tells it apart; an address with
  // no account meets it too (`docs/reference/COGNITO-POOL-PARAMS.md`).
  const lockout: [string, number, string][] = [
    ['Incorrect username or password.', 401, '{"error":"not_authorized"}'],
    ['Password attempts exceeded', 429, '{"error":"too_many_attempts"}'],
  ];
  for (const [message, status, body] of lockout) {
    it(`answers "${message}" with ${status}, at the start and at the verifier`, async () => {
      const refused = async () => {
        throw refusal('NotAuthorizedException', message);
      };
      const started = await environment(cognito({ initiateAuth: refused }).idp)(
        post(START_ROUTE, { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'PASSWORD_SRP', SRP_A: 'a' }),
      );
      const verified = await environment(cognito({ respondToAuthChallenge: refused }).idp)(
        post(RESPOND_ROUTE, {
          challenge: 'PASSWORD_VERIFIER',
          session: SESSION,
          responses: {
            USERNAME: SUB,
            PASSWORD_CLAIM_SIGNATURE: 'sig',
            PASSWORD_CLAIM_SECRET_BLOCK: 'sb',
            TIMESTAMP: 'Sat Sep 26 10:00:00 UTC 2026',
          },
        }),
      );
      for (const res of [started, verified]) {
        expect([res.statusCode, res.body, res.cookies]).toEqual([status, body, undefined]);
      }
    });
  }

  it('answers a start that Cognito refuses with 401', async () => {
    const { idp } = cognito({
      initiateAuth: async () => {
        throw refusal('NotAuthorizedException');
      },
    });
    const res = await environment(idp)(
      post(START_ROUTE, { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'PASSWORD_SRP', SRP_A: 'a' }),
    );
    expect([res.statusCode, res.body]).toEqual([401, '{"error":"not_authorized"}']);
  });

  // A START NEVER SIGNS ANYBODY IN: both preferences it admits answer with a challenge, so tokens
  // here mean Cognito took a path this relay did not ask for.
  it('refuses tokens at the start, where no preference it admits can produce them', async () => {
    const { idp } = cognito({ initiateAuth: async () => SIGNED_IN });
    const res = await environment(idp)(
      post(START_ROUTE, { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'WEB_AUTHN' }),
    );
    expect([res.statusCode, res.cookies]).toEqual([500, undefined]);
    expect(res.body).not.toContain(REFRESH);
  });

  it('answers a response that is neither tokens nor a challenge as a failure', async () => {
    const { idp } = cognito({ respondToAuthChallenge: async () => ({}) });
    const res = await environment(idp)(
      post(RESPOND_ROUTE, {
        challenge: 'WEB_AUTHN',
        session: SESSION,
        responses: { USERNAME: EMAIL, CREDENTIAL: '{}' },
      }),
    );
    expect(res.statusCode).toBe(500);
  });
});

describe('a refresh trades the cookie for fresh tokens and a rotated cookie', () => {
  it('exchanges the cookie with the secret and sets the rotated token', async () => {
    const { idp, of } = cognito();
    const res = await environment(idp)(carrying(REFRESH_ROUTE));
    expect(res.statusCode).toBe(200);
    expect(bodyOf(res)).toEqual({ idToken: ID, accessToken: ACCESS, expiresIn: 3600 });
    expect(res.cookies).toEqual([kept(ROTATED)]);
    expect(res.body).not.toContain(ROTATED);
    expect(of('getTokensFromRefreshToken')).toEqual([
      { RefreshToken: REFRESH, ClientId: CLIENT, ClientSecret: SECRET },
    ]);
  });

  // THE IDLE BOUND MOVES ON EVERY REFRESH: an answer with no new token still re-sets `Max-Age`.
  it('re-sets the cookie it was sent when Cognito rotates nothing', async () => {
    const { idp } = cognito({
      getTokensFromRefreshToken: async () => ({
        AuthenticationResult: { IdToken: ID, AccessToken: ACCESS, ExpiresIn: 3600 },
      }),
    });
    const res = await environment(idp)(carrying(REFRESH_ROUTE));
    expect(res.cookies).toEqual([kept(REFRESH)]);
  });

  it('refuses a request with no cookie, and clears it, asking Cognito nothing', async () => {
    const { idp, calls } = cognito();
    const res = await environment(idp)(post(REFRESH_ROUTE));
    expect([res.statusCode, res.body, res.cookies]).toEqual([
      401,
      '{"error":"not_authorized"}',
      [CLEARED],
    ]);
    expect(calls).toEqual([]);
  });

  // THE ORIGINAL IS NOT A SESSION: it is kept to be revoked, never to refresh with.
  it('refuses a request carrying only the original, and asks Cognito nothing', async () => {
    const { idp, calls } = cognito();
    const res = await environment(idp)(carrying(REFRESH_ROUTE, { origin: ORIGIN }));
    expect([res.statusCode, res.body, res.cookies]).toEqual([
      401,
      '{"error":"not_authorized"}',
      [CLEARED],
    ]);
    expect(calls).toEqual([]);
  });

  // RFC 10017 §6.2.2.2: a refresh token that is no longer valid ends the session. The original
  // stays, for the next sign-in to revoke: an expired or revoked token says nothing of a thief.
  for (const name of [
    'NotAuthorizedException',
    'UserNotFoundException',
    'InvalidParameterException',
  ]) {
    it(`clears the refresh cookie alone when Cognito answers ${name}, revoking nothing`, async () => {
      const { idp, of } = cognito({
        getTokensFromRefreshToken: async () => {
          throw refusal(name);
        },
      });
      const res = await environment(idp)(
        carrying(REFRESH_ROUTE, { refresh: REFRESH, origin: ORIGIN }),
      );
      expect([res.statusCode, res.body, res.cookies]).toEqual([
        401,
        '{"error":"not_authorized"}',
        [CLEARED],
      ]);
      expect(of('revokeToken')).toEqual([]);
    });
  }

  // A FAULT IS NOT A DEAD SESSION: clearing the cookie on a throttle would sign somebody out.
  it('keeps the cookie through a failure that says nothing about the token', async () => {
    const { idp, of } = cognito({
      getTokensFromRefreshToken: async () => {
        throw refusal('TooManyRequestsException');
      },
    });
    const res = await environment(idp)(
      carrying(REFRESH_ROUTE, { refresh: REFRESH, origin: ORIGIN }),
    );
    expect([res.statusCode, res.cookies]).toEqual([500, undefined]);
    expect(of('revokeToken')).toEqual([]);
  });
});

describe('a replayed token ends its whole family', () => {
  // RFC 9700 §4.14.2: an invalidated token presented again has the active one revoked. Cognito
  // revokes nothing, and only the live token or the original, when revoked, ends every branch.
  const replayed = (script: Partial<IdentityClient> = {}) =>
    cognito({
      getTokensFromRefreshToken: async () => {
        throw refusal('RefreshTokenReuseException', 'Refresh token reuse detected');
      },
      ...script,
    });
  const both = carrying(REFRESH_ROUTE, { refresh: ROTATED, origin: ORIGIN });

  it('revokes the original the browser carries, then clears both cookies', async () => {
    const { idp, of } = replayed();
    const res = await environment(idp)(both);
    expect([res.statusCode, res.body, res.cookies]).toEqual([
      401,
      '{"error":"not_authorized"}',
      FORGOTTEN,
    ]);
    expect(of('revokeToken')).toEqual([{ Token: ORIGIN, ClientId: CLIENT, ClientSecret: SECRET }]);
  });

  for (const name of ['UnsupportedTokenTypeException', 'InvalidParameterException']) {
    it(`counts an original Cognito answers ${name} as ended, and clears both`, async () => {
      const { idp, of } = replayed({
        revokeToken: async () => {
          throw refusal(name);
        },
      });
      const res = await environment(idp)(both);
      expect([res.statusCode, res.cookies]).toEqual([401, FORGOTTEN]);
      expect(of('revokeToken').map((input) => input.Token)).toEqual([ORIGIN]);
    });
  }

  // KEPT SO THE NEXT ATTEMPT REVOKES AGAIN, as a failed sign-out keeps its cookie.
  it('keeps both cookies when the revocation itself failed', async () => {
    const { idp, of } = replayed({
      revokeToken: async () => {
        throw refusal('TooManyRequestsException');
      },
    });
    const res = await environment(idp)(both);
    expect([res.statusCode, res.body, res.cookies]).toEqual([
      500,
      '{"error":"internal"}',
      undefined,
    ]);
    expect(of('revokeToken').map((input) => input.Token)).toEqual([ORIGIN]);
  });

  // A BROWSER WITH NO ORIGINAL GETS NOTHING REVOKED: every sign-in sets one, and a replayed token
  // other than the original, revoked, reaches no branch (measured).
  it('clears both cookies of a browser that carries no original, revoking nothing', async () => {
    const { idp, of } = replayed();
    const res = await environment(idp)(carrying(REFRESH_ROUTE));
    expect([res.statusCode, res.cookies]).toEqual([401, FORGOTTEN]);
    expect(of('revokeToken')).toEqual([]);
  });

  // THE ONE SIGN OF A STOLEN TOKEN THE POOL GIVES, so it is written down, without the token.
  it('logs a detected replay once, naming no token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await environment(replayed().idp)(both);
    expect(warn).toHaveBeenCalledTimes(1);
    for (const token of [ROTATED, ORIGIN]) {
      expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
    }
  });
});

describe('a sign-out revokes every token before it forgets them', () => {
  /** A pool that remembers what was revoked, and refuses a refresh with it the way Cognito does. */
  const revoking = () => {
    const revoked = new Set<string>();
    return cognito({
      revokeToken: async (input) => {
        revoked.add(input.Token);
        return {};
      },
      getTokensFromRefreshToken: async (input) => {
        if (revoked.has(input.RefreshToken)) {
          throw refusal('NotAuthorizedException', 'Refresh Token has been revoked');
        }
        return SIGNED_IN;
      },
    });
  };

  // BOTH, because the two cookies can belong to two families: the original alone leaves a refresh
  // cookie of another family refreshing, and the refresh token alone may be a fork's dead sibling.
  it('revokes the original and the refresh token with the secret, then clears both cookies', async () => {
    const { idp, of } = revoking();
    const res = await environment(idp)(
      carrying(SIGN_OUT_ROUTE, { refresh: REFRESH, origin: ORIGIN }),
    );
    expect([res.statusCode, res.body, res.cookies]).toEqual([
      200,
      '{"status":"signed_out"}',
      FORGOTTEN,
    ]);
    expect(of('revokeToken')).toEqual([
      { Token: ORIGIN, ClientId: CLIENT, ClientSecret: SECRET },
      { Token: REFRESH, ClientId: CLIENT, ClientSecret: SECRET },
    ]);
  });

  it('revokes a token both cookies hold once', async () => {
    const { idp, of } = revoking();
    const res = await environment(idp)(
      carrying(SIGN_OUT_ROUTE, { refresh: ORIGIN, origin: ORIGIN }),
    );
    expect([res.statusCode, res.cookies]).toEqual([200, FORGOTTEN]);
    expect(of('revokeToken').map((input) => input.Token)).toEqual([ORIGIN]);
  });

  it('revokes the original a browser carries alone', async () => {
    const { idp, of } = revoking();
    const res = await environment(idp)(carrying(SIGN_OUT_ROUTE, { origin: ORIGIN }));
    expect([res.statusCode, res.cookies]).toEqual([200, FORGOTTEN]);
    expect(of('revokeToken').map((input) => input.Token)).toEqual([ORIGIN]);
  });

  it('revokes the refresh token of a browser that carries no original', async () => {
    const { idp, of } = revoking();
    const res = await environment(idp)(carrying(SIGN_OUT_ROUTE));
    expect([res.statusCode, res.cookies]).toEqual([200, FORGOTTEN]);
    expect(of('revokeToken')).toEqual([{ Token: REFRESH, ClientId: CLIENT, ClientSecret: SECRET }]);
  });

  it('refuses the old cookie replayed after it, and clears it again', async () => {
    const { idp } = revoking();
    const relay = environment(idp);
    await relay(carrying(SIGN_OUT_ROUTE));
    const replayed = await relay(carrying(REFRESH_ROUTE));
    expect([replayed.statusCode, replayed.cookies]).toEqual([401, [CLEARED]]);
  });

  it('clears both cookies of a caller who had neither, asking Cognito nothing', async () => {
    const { idp, calls } = cognito();
    const res = await environment(idp)(post(SIGN_OUT_ROUTE));
    expect([res.statusCode, res.cookies]).toEqual([200, FORGOTTEN]);
    expect(calls).toEqual([]);
  });

  for (const name of ['UnsupportedTokenTypeException', 'InvalidParameterException']) {
    it(`treats ${name} as a token already dead, and clears both cookies`, async () => {
      const { idp } = cognito({
        revokeToken: async () => {
          throw refusal(name);
        },
      });
      const res = await environment(idp)(carrying(SIGN_OUT_ROUTE));
      expect([res.statusCode, res.cookies]).toEqual([200, FORGOTTEN]);
    });

    // AN ORIGINAL COGNITO CANNOT PARSE says nothing of the refresh token beside it.
    it(`still revokes the refresh token when the original answers ${name}`, async () => {
      const { idp, of } = cognito({
        revokeToken: async (input) => {
          if (input.Token === ORIGIN) throw refusal(name);
          return {};
        },
      });
      const res = await environment(idp)(
        carrying(SIGN_OUT_ROUTE, { refresh: REFRESH, origin: ORIGIN }),
      );
      expect([res.statusCode, res.cookies]).toEqual([200, FORGOTTEN]);
      expect(of('revokeToken').map((input) => input.Token)).toEqual([ORIGIN, REFRESH]);
    });
  }

  // KEPT SO A RETRY CAN STILL REVOKE IT: forgetting a live token would leave it usable elsewhere.
  for (const [which, failing] of [
    ['the original', ORIGIN],
    ['the refresh token', REFRESH],
  ]) {
    it(`keeps both cookies when revoking ${which} failed, after trying the other`, async () => {
      const { idp, of } = cognito({
        revokeToken: async (input) => {
          if (input.Token === failing) throw refusal('TooManyRequestsException');
          return {};
        },
      });
      const res = await environment(idp)(
        carrying(SIGN_OUT_ROUTE, { refresh: REFRESH, origin: ORIGIN }),
      );
      expect([res.statusCode, res.body, res.cookies]).toEqual([
        500,
        '{"error":"internal"}',
        undefined,
      ]);
      expect(of('revokeToken').map((input) => input.Token)).toEqual([ORIGIN, REFRESH]);
    });
  }

  // `RevokeToken` NAMES A CLIENT-AUTH FAILURE DIFFERENTLY from the sign-in calls.
  it('retries a revocation refused for a secret that changed', async () => {
    const { idp, of } = cognito(
      {
        revokeToken: async (input) => {
          if (input.ClientSecret !== ROTATED_SECRET) throw refusal('UnauthorizedException');
          return {};
        },
      },
      [SECRET, ROTATED_SECRET],
    );
    const res = await environment(idp)(carrying(SIGN_OUT_ROUTE));
    expect([res.statusCode, res.cookies]).toEqual([200, FORGOTTEN]);
    expect(of('revokeToken')).toHaveLength(2);
  });

  // IN TURN, so the first call's re-read serves the second: in parallel, the second refusal would
  // land inside the five minutes a re-read waits, and be answered as a failure.
  it('revokes both with a secret that changed, reading it once more', async () => {
    const { idp, of } = cognito(
      {
        revokeToken: async (input) => {
          if (input.ClientSecret !== ROTATED_SECRET) throw refusal('UnauthorizedException');
          return {};
        },
      },
      [SECRET, ROTATED_SECRET],
    );
    const res = await environment(idp)(
      carrying(SIGN_OUT_ROUTE, { refresh: REFRESH, origin: ORIGIN }),
    );
    expect([res.statusCode, res.cookies]).toEqual([200, FORGOTTEN]);
    expect(of('revokeToken').map((input) => [input.Token, input.ClientSecret])).toEqual([
      [ORIGIN, SECRET],
      [ORIGIN, ROTATED_SECRET],
      [REFRESH, ROTATED_SECRET],
    ]);
    expect(of('describeUserPoolClient')).toHaveLength(2);
  });
});

describe('a request the relay does not answer at all', () => {
  const ROUTES: [string, ApiEvent][] = [
    [START_ROUTE, post(START_ROUTE, { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'WEB_AUTHN' })],
    [
      RESPOND_ROUTE,
      post(RESPOND_ROUTE, {
        challenge: 'WEB_AUTHN',
        session: SESSION,
        responses: { USERNAME: EMAIL, CREDENTIAL: '{}' },
      }),
    ],
    [REFRESH_ROUTE, carrying(REFRESH_ROUTE)],
    [SIGN_OUT_ROUTE, carrying(SIGN_OUT_ROUTE)],
  ];
  const forged: [string, Record<string, string | undefined>][] = [
    ['no custom header', { 'x-csrf': undefined }],
    ['the custom header with another value', { 'x-csrf': '0' }],
    ['a cross-site fetch', { 'sec-fetch-site': 'cross-site' }],
    ['a navigation typed into the address bar', { 'sec-fetch-site': 'none' }],
    ['no fetch metadata at all', { 'sec-fetch-site': undefined }],
  ];

  for (const [route, event] of ROUTES) {
    for (const [what, headers] of forged) {
      it(`refuses ${what} on ${route}, asking Cognito nothing`, async () => {
        const { idp, calls } = cognito();
        const res = await environment(idp)({
          ...event,
          headers: { ...event.headers, ...headers },
        });
        expect([res.statusCode, res.body, res.cookies]).toEqual([
          403,
          '{"error":"csrf"}',
          undefined,
        ]);
        expect(calls).toEqual([]);
      });
    }

    it(`admits a same-origin fetch on ${route}`, async () => {
      const res = await environment(cognito().idp)({
        ...event,
        headers: { ...event.headers, 'sec-fetch-site': 'same-origin' },
      });
      expect(res.statusCode).toBe(200);
    });
  }

  // API Gateway routes no GET here — every event is a POST — and the handler refuses one anyway.
  it('refuses a GET, asking Cognito nothing', async () => {
    const { idp, calls } = cognito();
    const res = await environment(idp)({
      ...carrying(REFRESH_ROUTE),
      routeKey: 'GET /auth/refresh',
    });
    expect([res.statusCode, res.cookies]).toEqual([400, undefined]);
    expect(calls).toEqual([]);
  });
});

describe('the handler answers rather than throwing', () => {
  // NO VARIABLES AND NO CREDENTIALS HERE, which is what makes this meaningful: an uncaught throw
  // would reach the caller as API Gateway's own 502.
  it('answers a function missing its pool with its own 500', async () => {
    vi.unstubAllEnvs();
    const res = await handler(
      post(START_ROUTE, { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'WEB_AUTHN' }),
    );
    expect([res.statusCode, res.body]).toEqual([500, '{"error":"internal"}']);
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: 60 });
