// The relay is the only way a browser gets a token, and the only holder of the client secret. What
// these tests pin is where each token goes — the refresh token into an HttpOnly cookie and nowhere
// else, the access token sealed into one only the relay can open — and what a request must carry
// to be answered at all.
import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GOOGLE_BEGIN_ROUTE,
  GOOGLE_COMPLETE_ROUTE,
  PASSKEY_COMPLETE_ROUTE,
  PASSKEY_LIST_ROUTE,
  PASSKEY_START_ROUTE,
  REFRESH_ROUTE,
  RESPOND_ROUTE,
  RESPONSES,
  SIGN_OUT_ROUTE,
  START_ROUTE,
  type IdentityClient,
  createRelay,
  handler as rawHandler,
  redeemWith,
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
/** The account an access token names, in its payload's `sub`, as Cognito's own do. */
const ACCOUNT = '5a1b2c3d-0000-4000-8000-0000000000a1';
const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
const ACCESS = jwt({ sub: ACCOUNT, token_use: 'access' });
const REFRESH = 'refresh.token.jwe';
const ROTATED = 'rotated.refresh.token.jwe';
/** A family's original, from a sign-in before this request: never `REFRESH`, so a test can tell
 *  which of the two was revoked. */
const ORIGIN = 'origin.refresh.token.jwe';
/** The managed-login domain, where Cognito's OAuth endpoints live. */
const DOMAIN = 'auth.example.test';
const CALLBACK = 'https://app.example.test/auth/callback';
const CODE = 'the-authorization-code';
/** A flow a begin already bound to this browser: 43 base64url characters each, as 32 bytes give. */
const STATE = 'S'.repeat(43);
const VERIFIER = 'V'.repeat(43);
/** What `DescribeUserPoolClient` lists: a client without Google, and one with it. */
const WITHOUT_GOOGLE = ['COGNITO'];
const WITH_GOOGLE = ['COGNITO', 'Google'];

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
/** THE ACCESS TOKEN, SEALED: base64url, which a JWT's dots are not, for as long as the token lives.
 *  RFC 10017 §6.1.3.2 — a BFF's cookie holding an access token "SHOULD" be encrypted. */
const sealedFor = (seconds: number) =>
  expect.stringMatching(
    new RegExp(`^__Host-Http-access=[A-Za-z0-9_-]+; Max-Age=${seconds}; ${ATTRIBUTES}$`),
  );
const sealed = sealedFor(3600);
const CLEARED = `__Host-Http-refresh=; Max-Age=0; ${ATTRIBUTES}`;
const ACCESS_CLEARED = `__Host-Http-access=; Max-Age=0; ${ATTRIBUTES}`;
/** A session that ended: its refresh cookie and the access token sealed beside it. */
const ENDED = [CLEARED, ACCESS_CLEARED];
const FORGOTTEN = [CLEARED, `__Host-Http-origin=; Max-Age=0; ${ATTRIBUTES}`, ACCESS_CLEARED];
/** The Google flow's state and verifier: fifteen minutes, as Auth.js keeps its pair. */
const flow = (state: string, verifier: string) =>
  `__Host-Http-google=${state}.${verifier}; Max-Age=900; ${ATTRIBUTES}`;
const FLOW_CLEARED = `__Host-Http-google=; Max-Age=0; ${ATTRIBUTES}`;

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

type Jar = { refresh?: string; origin?: string; google?: string; access?: string };

/** What a browser sends, the original FIRST where there is one: a cookie is found by its name,
 *  never by its place. */
const cookiesOf = (jar: Jar) => [
  ...(jar.origin === undefined ? [] : [`__Host-Http-origin=${jar.origin}`]),
  'theme=dark',
  ...(jar.refresh === undefined ? [] : [`__Host-Http-refresh=${jar.refresh}`]),
  ...(jar.google === undefined ? [] : [`__Host-Http-google=${jar.google}`]),
  ...(jar.access === undefined ? [] : [`__Host-Http-access=${jar.access}`]),
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
/** What `StartWebAuthnRegistration` answers, and what the OS dialog makes of it. */
const CREATION_OPTIONS = { challenge: 'c', rp: { id: 'dev.quirenote.com', name: 'quirenote' } };
const CREDENTIAL = {
  id: 'cred',
  rawId: 'cred',
  type: 'public-key',
  response: { clientDataJSON: 'd' },
};

/** A pool that records every call. `secrets` is what successive `DescribeUserPoolClient` calls
 *  read, the last one repeated, beside the client's `providers`; every other call answers from
 *  `script`, else succeeds. */
const cognito = (
  script: Partial<IdentityClient> = {},
  secrets: (string | Error)[] = [SECRET],
  providers: string[] = WITHOUT_GOOGLE,
  callbacks: string[] = [CALLBACK],
) => {
  const calls: { op: keyof IdentityClient; input: Record<string, unknown> }[] = [];
  let reads = 0;
  const log = (op: keyof IdentityClient, input: unknown) =>
    calls.push({ op, input: input as Record<string, unknown> });
  const idp: IdentityClient = {
    describeUserPoolClient: async (input) => {
      log('describeUserPoolClient', input);
      const next = secrets[Math.min(reads++, secrets.length - 1)];
      if (next instanceof Error) throw next;
      return {
        UserPoolClient: {
          ClientSecret: next,
          SupportedIdentityProviders: providers,
          CallbackURLs: callbacks,
        },
      };
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
    redeemCode: async (input) => {
      log('redeemCode', input);
      return script.redeemCode
        ? script.redeemCode(input)
        : { id_token: ID, access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600 };
    },
    listWebAuthnCredentials: async (input) => {
      log('listWebAuthnCredentials', input);
      return script.listWebAuthnCredentials
        ? script.listWebAuthnCredentials(input)
        : { Credentials: [] };
    },
    startWebAuthnRegistration: async (input) => {
      log('startWebAuthnRegistration', input);
      return script.startWebAuthnRegistration
        ? script.startWebAuthnRegistration(input)
        : { CredentialCreationOptions: CREATION_OPTIONS };
    },
    completeWebAuthnRegistration: async (input) => {
      log('completeWebAuthnRegistration', input);
      return script.completeWebAuthnRegistration ? script.completeWebAuthnRegistration(input) : {};
    },
  };
  const of = (op: keyof IdentityClient) => calls.filter((c) => c.op === op).map((c) => c.input);
  return { idp, calls, of };
};

/** Every answer this file is given, for the criterion at its end: none carries the access token. */
const answered: ApiResult[] = [];
const seen = (event: ApiEvent, result: ApiResult) => {
  answered.push(result);
  return record(event, result);
};

/** One execution environment: a relay whose secret cache survives between the calls it answers. */
const environment = (idp: IdentityClient, now?: () => number) => {
  const relay = createRelay(idp, now);
  return async (event: ApiEvent): Promise<ApiResult> => seen(event, await relay(event));
};

const handler = async (event: ApiEvent) => seen(event, await rawHandler(event));

const bodyOf = (res: ApiResult) => JSON.parse(res.body) as Record<string, unknown>;

const SIGN_IN = post(RESPOND_ROUTE, {
  challenge: 'WEB_AUTHN',
  session: SESSION,
  responses: { USERNAME: EMAIL, CREDENTIAL: '{}' },
});
/** The sealed access token an answer set, as the browser will send it back. */
const accessIn = (res: ApiResult) =>
  /^__Host-Http-access=([^;]+);/.exec(
    res.cookies?.find((cookie) => cookie.startsWith('__Host-Http-access=')) ?? '',
  )?.[1];
/** What a browser signed in through this relay holds: only a sign-in there can seal the token. */
const holding = async (relay: (event: ApiEvent) => Promise<ApiResult>) => {
  const access = accessIn(await relay(SIGN_IN));
  if (access === undefined) throw new Error('the sign-in sealed no access token');
  return access;
};
/** A passkey call, naming the account its tab shows, with the cookies a browser holds. */
const ASKED = { sub: ACCOUNT };
const asking = (route: string, jar: Jar, body: unknown = ASKED): ApiEvent => ({
  ...post(route, body),
  cookies: cookiesOf(jar),
});

beforeEach(() => {
  vi.stubEnv('USER_POOL_ID', POOL);
  vi.stubEnv('USER_POOL_CLIENT_ID', CLIENT);
  vi.stubEnv('AUTH_DOMAIN', DOMAIN);
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
    expect(bodyOf(res)).toEqual({ idToken: ID, expiresIn: 3600 });
    expect(res.cookies).toEqual([kept(REFRESH), origin(REFRESH), sealed]);
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
    expect(changed.cookies).toEqual([kept(REFRESH), origin(REFRESH), sealed]);
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
    expect([res.statusCode, res.cookies]).toEqual([200, [kept(REFRESH), origin(REFRESH), sealed]]);
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
    expect([res.statusCode, res.cookies]).toEqual([200, [kept(REFRESH), origin(REFRESH), sealed]]);
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
      expect([res.statusCode, res.cookies]).toEqual([
        200,
        [kept(REFRESH), origin(REFRESH), sealed],
      ]);
      expect(bodyOf(res)).toEqual({ idToken: ID, expiresIn: 3600 });
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
      expect.stringMatching(
        /^__Host-Http-access=[A-Za-z0-9_-]+; Max-Age=3600; Path=\/; Secure; HttpOnly; SameSite=Strict$/,
      ),
    ]);
    for (const cookie of res.cookies ?? []) expect(cookie).not.toMatch(/domain/i);
  });

  // NO LIFETIME, NO COOKIE: the app reads a pair without one as no answer, and the sealed token
  // would have no `Max-Age` to be given.
  it('answers tokens that carry no lifetime as a failure', async () => {
    const { idp } = cognito({
      getTokensFromRefreshToken: async () => ({
        AuthenticationResult: { IdToken: ID, AccessToken: ACCESS, RefreshToken: ROTATED },
      }),
    });
    const res = await environment(idp)(carrying(REFRESH_ROUTE));
    expect([res.statusCode, res.cookies]).toEqual([500, undefined]);
  });

  // THE SEALED TOKEN LIVES AS LONG AS THE TOKEN: past it, nothing in the cookie could be spent.
  it('keeps the sealed access token for as long as Cognito says the token lives', async () => {
    const { idp } = cognito({
      getTokensFromRefreshToken: async () => ({
        AuthenticationResult: { IdToken: ID, AccessToken: ACCESS, ExpiresIn: 1800 },
      }),
    });
    const res = await environment(idp)(carrying(REFRESH_ROUTE));
    expect(res.cookies).toEqual([kept(REFRESH), sealedFor(1800)]);
  });

  // THE SAME RULES FOR THE ORIGINAL, and `Max-Age` is the family's lifetime: no rotated token
  // outlives its original (AWS).
  it('holds the same token as the family’s original after a sign-in, for the family’s life', async () => {
    const res = await environment(cognito().idp)(signIn);
    expect(res.cookies).toEqual([
      '__Host-Http-refresh=refresh.token.jwe; Max-Age=7200; Path=/; Secure; HttpOnly; SameSite=Strict',
      '__Host-Http-origin=refresh.token.jwe; Max-Age=86400; Path=/; Secure; HttpOnly; SameSite=Strict',
      sealed,
    ]);
    for (const cookie of res.cookies ?? []) expect(cookie).not.toMatch(/domain/i);
  });

  // SET ONCE, NEVER MOVED: re-set by a refresh, the original would outlive its family.
  it('never re-sets the original on a refresh', async () => {
    const { idp, of } = cognito();
    const res = await environment(idp)(
      carrying(REFRESH_ROUTE, { refresh: REFRESH, origin: ORIGIN }),
    );
    expect(res.cookies).toEqual([kept(ROTATED), sealed]);
    expect(of('getTokensFromRefreshToken').map((input) => input.RefreshToken)).toEqual([REFRESH]);
  });

  it('is never sent as a header, where payload 2.0 would not repeat it', async () => {
    for (const event of [carrying(REFRESH_ROUTE), signIn]) {
      const res = await environment(cognito().idp)(event);
      expect(Object.keys(res.headers)).not.toContain('set-cookie');
    }
  });
});

// RFC 10017 §6.1.3.2: a BFF's cookie holding an access token "SHOULD" be encrypted, so a copied
// cookie store holds no token Cognito takes. Script never sees it: HttpOnly, and in no body.
describe('the access token is sealed into a cookie only the relay can open', () => {
  it('seals it at every sign-in, so the cookie holds no token', async () => {
    const relay = environment(cognito().idp);
    const [a, b] = [await holding(relay), await holding(relay)];
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toContain(ACCESS);
    expect(Buffer.from(a, 'base64url').toString('latin1')).not.toContain(ACCESS);
    // A NEW NONCE EVERY TIME, which GCM requires of one key (NIST SP 800-38D §8).
    expect(a).not.toBe(b);
  });

  // LAMBDA SCALES OUT: the next request may land in another environment, which read the same secret.
  it('opens in another environment that read the same secret', async () => {
    const access = await holding(environment(cognito().idp));
    const { idp, of } = cognito();
    const res = await environment(idp)(asking(PASSKEY_LIST_ROUTE, { access }));
    expect(res.statusCode).toBe(200);
    expect(of('listWebAuthnCredentials')).toEqual([{ AccessToken: ACCESS, MaxResults: 1 }]);
  });

  // A SECRET ROTATED IN PLACE leaves environments holding different ones, and Cognito refuses
  // neither while both are active: one that cannot open a cookie reads the secret again.
  it('opens a token sealed under a secret this environment has not read yet', async () => {
    const access = await holding(environment(cognito({}, [ROTATED_SECRET]).idp));
    const { idp, of } = cognito({}, [SECRET, ROTATED_SECRET]);
    const relay = environment(idp);
    await relay(post(START_ROUTE, { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'WEB_AUTHN' }));
    const res = await relay(asking(PASSKEY_LIST_ROUTE, { access }));
    expect(res.statusCode).toBe(200);
    expect(of('describeUserPoolClient')).toHaveLength(2);
  });

  // THE FLAG FIRST: its five-minute re-read may bring a rotated secret, and a refresh sealed under
  // the one it replaced would open nowhere that holds the new one, this environment included.
  it('seals a refresh under the secret it holds once the providers are read again', async () => {
    let clock = 0;
    const relay = environment(cognito({}, [SECRET, ROTATED_SECRET]).idp, () => clock);
    await relay(carrying(REFRESH_ROUTE));
    clock += 300_000;
    const access = accessIn(await relay(carrying(REFRESH_ROUTE)));
    const { idp, of } = cognito({}, [ROTATED_SECRET]);
    expect((await environment(idp)(asking(PASSKEY_LIST_ROUTE, { access }))).statusCode).toBe(200);
    expect(of('describeUserPoolClient')).toHaveLength(1);
  });

  // A RE-READ THAT FAILS IS NOT KEPT, or one throttle would leave the environment with no secret.
  it('refuses a cookie it cannot open when the re-read fails, and keeps the secret it read', async () => {
    const { idp } = cognito({}, [SECRET, refusal('TooManyRequestsException')]);
    const relay = environment(idp);
    const access = await holding(relay);
    expect((await relay(asking(PASSKEY_LIST_ROUTE, { access: 'A'.repeat(60) }))).statusCode).toBe(
      401,
    );
    expect((await relay(asking(PASSKEY_LIST_ROUTE, { access }))).statusCode).toBe(200);
  });

  // `UserPoolClientRead` allows five a second per pool, so junk cookies cost one read in five minutes.
  it('reads the secret again for a cookie it cannot open at most once every five minutes', async () => {
    let clock = 0;
    const { idp, of } = cognito();
    const relay = environment(idp, () => clock);
    const junk = asking(PASSKEY_LIST_ROUTE, { access: 'A'.repeat(60) });
    expect((await relay(junk)).statusCode).toBe(401);
    expect((await relay(junk)).statusCode).toBe(401);
    expect(of('describeUserPoolClient')).toHaveLength(2);
    clock += 300_000;
    await relay(junk);
    expect(of('describeUserPoolClient')).toHaveLength(3);
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
    // The temporary password taken back as the new one, which the pool's history refuses.
    ['PasswordHistoryPolicyViolationException', 400, '{"error":"reused_password"}'],
    ['InvalidParameterException', 400, '{"error":"invalid_request"}'],
    // AWS documents a wrong password's answer in its place.
    ['PasswordResetRequiredException', 401, '{"error":"not_authorized"}'],
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

  // `PasswordResetRequiredException` COMES AT THE START: some addresses with no account get it.
  for (const name of ['NotAuthorizedException', 'PasswordResetRequiredException']) {
    it(`answers a start that Cognito refuses with ${name} with 401, either preference`, async () => {
      const { idp } = cognito({
        initiateAuth: async () => {
          throw refusal(name);
        },
      });
      for (const body of [
        { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'WEB_AUTHN' },
        { USERNAME: EMAIL, PREFERRED_CHALLENGE: 'PASSWORD_SRP', SRP_A: 'a' },
      ]) {
        const res = await environment(idp)(post(START_ROUTE, body));
        expect([res.statusCode, res.body]).toEqual([401, '{"error":"not_authorized"}']);
      }
    });
  }

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
    expect(bodyOf(res)).toEqual({
      idToken: ID,
      expiresIn: 3600,
      google: false,
    });
    expect(res.cookies).toEqual([kept(ROTATED), sealed]);
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
    expect(res.cookies).toEqual([kept(REFRESH), sealed]);
  });

  // THE CLIENT IS READ, AND NOTHING ELSE: whether Google is on is what a signed-out page asks this
  // for, and no token is involved.
  it('refuses a request with no cookie, and clears it, asking Cognito for the client alone', async () => {
    const { idp, calls } = cognito();
    const res = await environment(idp)(post(REFRESH_ROUTE));
    expect([res.statusCode, res.body, res.cookies]).toEqual([
      401,
      '{"error":"not_authorized","google":false}',
      ENDED,
    ]);
    expect(calls.map((c) => c.op)).toEqual(['describeUserPoolClient']);
  });

  // THE ORIGINAL IS NOT A SESSION: it is kept to be revoked, never to refresh with.
  it('refuses a request carrying only the original, and asks Cognito for the client alone', async () => {
    const { idp, calls } = cognito();
    const res = await environment(idp)(carrying(REFRESH_ROUTE, { origin: ORIGIN }));
    expect([res.statusCode, res.body, res.cookies]).toEqual([
      401,
      '{"error":"not_authorized","google":false}',
      ENDED,
    ]);
    expect(calls.map((c) => c.op)).toEqual(['describeUserPoolClient']);
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
        '{"error":"not_authorized","google":false}',
        ENDED,
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
      '{"error":"not_authorized","google":false}',
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
  // other than the original, revoked, reaches no branch.
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
    expect([replayed.statusCode, replayed.cookies]).toEqual([401, ENDED]);
  });

  it('clears both cookies of a caller who had neither, asking Cognito for the client alone', async () => {
    const { idp, calls } = cognito();
    const res = await environment(idp)(post(SIGN_OUT_ROUTE));
    expect([res.statusCode, res.cookies]).toEqual([200, FORGOTTEN]);
    expect(calls.map((c) => c.op)).toEqual(['describeUserPoolClient']);
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

// RFC 9700 §2.1.1: PKCE, "securely bound to the client and the user agent in which the transaction
// was started". The pair lives in a cookie only this relay reads, drawn afresh for every redirect.
describe('Google: begin binds a new flow to this browser', () => {
  const google = () => cognito({}, [SECRET], WITH_GOOGLE);
  const begun = async (idp = google().idp) => {
    const res = await environment(idp)(post(GOOGLE_BEGIN_ROUTE));
    const pair = /^__Host-Http-google=([^;]*);/.exec(res.cookies?.[0] ?? '')?.[1] ?? '';
    const [state = '', verifier = ''] = pair.split('.');
    return { res, state, verifier, url: new URL(bodyOf(res).authorize as string) };
  };

  it('answers the authorize URL, straight to Google, with the state and an S256 challenge', async () => {
    const { res, state, verifier, url } = await begun();
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(`${url.origin}${url.pathname}`).toBe(`https://${DOMAIN}/oauth2/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: CLIENT,
      redirect_uri: CALLBACK,
      identity_provider: 'Google',
      scope: 'openid email profile',
      prompt: 'select_account',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
  });

  // RFC 7636 §4.1: "a 32-octet sequence", which base64url spells in 43 characters, the minimum.
  it('binds the state and the verifier to this browser for fifteen minutes', async () => {
    const { res, state, verifier } = await begun();
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.cookies).toEqual([flow(state, verifier)]);
  });

  it('never lets the verifier out of the cookie', async () => {
    const { res, verifier } = await begun();
    expect(res.body).not.toContain(verifier);
    expect(JSON.stringify(res.headers)).not.toContain(verifier);
  });

  it('draws a new state and verifier for every redirect', async () => {
    const { idp } = google();
    const [a, b] = [await begun(idp), await begun(idp)];
    expect(a.state).not.toBe(b.state);
    expect(a.verifier).not.toBe(b.verifier);
  });

  it('refuses when the client lists no Google, and binds nothing', async () => {
    const res = await environment(cognito().idp)(post(GOOGLE_BEGIN_ROUTE));
    expect([res.statusCode, res.body, res.cookies]).toEqual([
      404,
      '{"error":"google_disabled"}',
      undefined,
    ]);
  });

  it('answers its own failure when the client cannot be read', async () => {
    const { idp } = cognito({}, [refusal('TooManyRequestsException')], WITH_GOOGLE);
    const res = await environment(idp)(post(GOOGLE_BEGIN_ROUTE));
    expect([res.statusCode, res.cookies]).toEqual([500, undefined]);
  });

  it('answers its own failure when the client lists no callback', async () => {
    const { idp } = cognito({}, [SECRET], WITH_GOOGLE, []);
    const res = await environment(idp)(post(GOOGLE_BEGIN_ROUTE));
    expect([res.statusCode, res.cookies]).toEqual([500, undefined]);
  });
});

describe('Google: complete redeems the code in the browser that began, and only there', () => {
  const google = (script: Partial<IdentityClient> = {}, secrets = [SECRET]) =>
    cognito(script, secrets, WITH_GOOGLE);
  const completing = (jar: Jar = {}, body: unknown = { code: CODE, state: STATE }): ApiEvent => ({
    ...post(GOOGLE_COMPLETE_ROUTE, body),
    cookies: cookiesOf({ google: `${STATE}.${VERIFIER}`, ...jar }),
  });

  it('redeems the code with the verifier and the secret, then signs in as any sign-in does', async () => {
    const { idp, of } = google();
    const res = await environment(idp)(completing());
    expect(res.statusCode).toBe(200);
    expect(bodyOf(res)).toEqual({ idToken: ID, expiresIn: 3600 });
    expect(res.cookies).toEqual([kept(REFRESH), origin(REFRESH), sealed, FLOW_CLEARED]);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).not.toContain(REFRESH);
    expect(of('redeemCode')).toEqual([
      {
        domain: DOMAIN,
        client: CLIENT,
        secret: SECRET,
        code: CODE,
        redirectUri: CALLBACK,
        verifier: VERIFIER,
      },
    ]);
  });

  it('revokes every token the browser still carries once it has signed in', async () => {
    const { idp, of } = google();
    await environment(idp)(completing({ refresh: ROTATED, origin: ORIGIN }));
    expect(of('revokeToken').map((input) => input.Token)).toEqual([ORIGIN, ROTATED]);
  });

  // THE CRITERION: a code arriving in a browser that never began — no verifier — or with another
  // flow's state is refused before it is redeemed, and the flow it did not belong to stays.
  const unbound: [string, ApiEvent][] = [
    ['no flow cookie', post(GOOGLE_COMPLETE_ROUTE, { code: CODE, state: STATE })],
    ['a state the cookie does not hold', completing({}, { code: CODE, state: 'T'.repeat(43) })],
    ['a state of another length', completing({}, { code: CODE, state: STATE.slice(1) })],
    ['a cookie holding no verifier', completing({ google: STATE })],
    ['a cookie holding an empty verifier', completing({ google: `${STATE}.` })],
    ['a cookie holding more than a pair', completing({ google: `${STATE}.${VERIFIER}.x` })],
  ];
  for (const [what, event] of unbound) {
    it(`refuses ${what}, never asking for the tokens`, async () => {
      const { idp, of } = google();
      const res = await environment(idp)(event);
      expect([res.statusCode, res.body, res.cookies]).toEqual([
        401,
        '{"error":"not_authorized"}',
        undefined,
      ]);
      expect(of('redeemCode')).toEqual([]);
    });
  }

  const malformed: unknown[] = [
    { code: CODE },
    { code: CODE, state: STATE, extra: 'x' },
    { code: '', state: STATE },
    'text',
  ];
  for (const body of malformed) {
    it(`refuses the body ${JSON.stringify(body)}, asking Cognito nothing`, async () => {
      const { idp, calls } = google();
      const res = await environment(idp)(completing({}, body));
      expect([res.statusCode, res.body, res.cookies]).toEqual([
        400,
        '{"error":"invalid_request"}',
        undefined,
      ]);
      expect(calls).toEqual([]);
    });
  }

  // THE TOKEN ENDPOINT'S OWN REFUSALS (Cognito, *Token endpoint*): a spent or unknown code, a
  // redirect that does not match, a malformed request. Each ends this flow.
  for (const name of ['invalid_grant', 'unauthorized_client', 'invalid_request']) {
    it(`refuses a code the token endpoint answers ${name}, spends the flow, and logs the name`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { idp } = google({
        redeemCode: async () => {
          throw refusal(name);
        },
      });
      const res = await environment(idp)(completing({ refresh: ROTATED }));
      expect([res.statusCode, res.body, res.cookies]).toEqual([
        401,
        '{"error":"not_authorized"}',
        [FLOW_CLEARED],
      ]);
      expect(JSON.stringify(warn.mock.calls)).toContain(name);
      for (const needle of [CODE, STATE, VERIFIER]) {
        expect(JSON.stringify(warn.mock.calls)).not.toContain(needle);
      }
    });
  }

  it('answers its own failure when the client lists no callback', async () => {
    const { idp, of } = cognito({}, [SECRET], WITH_GOOGLE, []);
    const res = await environment(idp)(completing());
    expect([res.statusCode, res.cookies]).toEqual([500, undefined]);
    expect(of('redeemCode')).toEqual([]);
  });

  it('redeems again once with a secret that changed since it was read', async () => {
    const { idp, of } = google(
      {
        redeemCode: async (input) => {
          if (input.secret !== ROTATED_SECRET) throw refusal('invalid_client');
          return { id_token: ID, access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600 };
        },
      },
      [SECRET, ROTATED_SECRET],
    );
    const res = await environment(idp)(completing());
    expect(res.statusCode).toBe(200);
    expect(of('redeemCode').map((input) => input.secret)).toEqual([SECRET, ROTATED_SECRET]);
  });

  // A FAULT IS NOT A REFUSAL: the code may still be good, so nothing is cleared.
  it('answers a fault as its own failure, keeping the cookies', async () => {
    const { idp } = google({
      redeemCode: async () => {
        throw refusal('TypeError', 'fetch failed');
      },
    });
    const res = await environment(idp)(completing());
    expect([res.statusCode, res.body, res.cookies]).toEqual([
      500,
      '{"error":"internal"}',
      undefined,
    ]);
  });

  it('answers tokens missing what a session needs as a failure', async () => {
    const { idp } = google({ redeemCode: async () => ({ id_token: ID, access_token: ACCESS }) });
    expect((await environment(idp)(completing())).statusCode).toBe(500);
  });

  it('never puts the code, the state or the verifier in a log line', async () => {
    const { idp } = google({
      redeemCode: async () => {
        throw refusal('TypeError', 'fetch failed');
      },
    });
    await environment(idp)(completing());
    expect(console.error).toHaveBeenCalled();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls, (_, v: unknown) =>
      v instanceof Error ? `${v.name}: ${v.message}` : v,
    );
    for (const needle of [CODE, STATE, VERIFIER, SECRET]) {
      expect([needle, logged.includes(needle)]).toEqual([needle, false]);
    }
  });
});

// COGNITO, *Token endpoint*: "The token endpoint supports client_secret_basic", and "The
// authorization header string is Basic Base64Encode(client_id:client_secret)".
describe('the token endpoint', () => {
  const INPUT = {
    domain: DOMAIN,
    client: CLIENT,
    secret: SECRET,
    code: CODE,
    redirectUri: CALLBACK,
    verifier: VERIFIER,
  };
  const TOKENS_ANSWERED = {
    id_token: 'i',
    access_token: 'a',
    refresh_token: 'r',
    expires_in: 3600,
  };
  const answering = (status: number, body: string) =>
    vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => new Response(body, { status }),
    );

  it('posts the code, the redirect and the verifier as a form, the secret in Basic', async () => {
    const fetch = answering(200, JSON.stringify(TOKENS_ANSWERED));
    await redeemWith(fetch)(INPUT);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`https://${DOMAIN}/oauth2/token`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      authorization: `Basic ${Buffer.from(`${CLIENT}:${SECRET}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      grant_type: 'authorization_code',
      client_id: CLIENT,
      code: CODE,
      redirect_uri: CALLBACK,
      code_verifier: VERIFIER,
    });
  });

  it('hands back what it answers', async () => {
    const fetch = answering(200, JSON.stringify(TOKENS_ANSWERED));
    expect(await redeemWith(fetch)(INPUT)).toEqual(TOKENS_ANSWERED);
  });

  it('throws a refusal under its OAuth error name', async () => {
    const fetch = answering(400, '{"error":"invalid_grant"}');
    await expect(redeemWith(fetch)(INPUT)).rejects.toMatchObject({ name: 'invalid_grant' });
  });

  it('throws an answer it cannot read as a fault, never as a refusal', async () => {
    const fetch = answering(502, '<html>');
    await expect(redeemWith(fetch)(INPUT)).rejects.toMatchObject({ name: 'TokenEndpointFault' });
  });
});

// Supabase's `GET /settings` publishes `"google": true` for a sign-in page to read; here the
// answer every load already asks for carries it, so knowing costs no call of its own.
describe('a refresh says whether Google is on', () => {
  it('names it on the tokens', async () => {
    const { idp } = cognito({}, [SECRET], WITH_GOOGLE);
    const res = await environment(idp)(carrying(REFRESH_ROUTE));
    expect(bodyOf(res)).toEqual({
      idToken: ID,
      expiresIn: 3600,
      google: true,
    });
  });

  it('names it on a refusal, which is what a signed-out page reads', async () => {
    const { idp } = cognito({}, [SECRET], WITH_GOOGLE);
    const res = await environment(idp)(post(REFRESH_ROUTE));
    expect([res.statusCode, res.body]).toEqual([401, '{"error":"not_authorized","google":true}']);
  });

  // A DEPLOY THAT TURNS GOOGLE OFF changes the client, not the function: a warm environment reads
  // the providers again once they are five minutes old.
  it('reads the providers again once they are five minutes old', async () => {
    let clock = 0;
    const providers = [...WITH_GOOGLE];
    const { idp, of } = cognito({}, [SECRET], providers);
    const relay = environment(idp, () => clock);
    const google = async () => bodyOf(await relay(post(REFRESH_ROUTE))).google;
    expect(await google()).toBe(true);
    providers.splice(providers.indexOf('Google'), 1);
    clock += 299_999;
    expect(await google()).toBe(true);
    clock += 1;
    expect(await google()).toBe(false);
    expect(of('describeUserPoolClient')).toHaveLength(2);
  });

  // A FAILED RE-READ KEEPS WHAT WAS READ, the secret and the providers, for five minutes more: a
  // throttled read is not retried on every request.
  it('keeps the client it read when a later re-read fails, and waits to read again', async () => {
    let clock = 0;
    const { idp, of } = cognito({}, [SECRET, refusal('TooManyRequestsException')], WITH_GOOGLE);
    const relay = environment(idp, () => clock);
    const answered = async () => {
      const res = await relay(carrying(REFRESH_ROUTE));
      return [res.statusCode, bodyOf(res).google];
    };
    expect(await answered()).toEqual([200, true]);
    clock += 300_000;
    expect(await answered()).toEqual([200, true]);
    clock += 1;
    expect(await answered()).toEqual([200, true]);
    expect(of('getTokensFromRefreshToken').map((input) => input.ClientSecret)).toEqual([
      SECRET,
      SECRET,
      SECRET,
    ]);
    expect(of('describeUserPoolClient')).toHaveLength(2);
    clock += 299_999;
    await answered();
    expect(of('describeUserPoolClient')).toHaveLength(3);
  });

  it('begins by the providers as they are five minutes on', async () => {
    let clock = 0;
    const providers = [...WITH_GOOGLE];
    const { idp } = cognito({}, [SECRET], providers);
    const relay = environment(idp, () => clock);
    expect((await relay(post(GOOGLE_BEGIN_ROUTE))).statusCode).toBe(200);
    providers.splice(providers.indexOf('Google'), 1);
    clock += 300_000;
    expect((await relay(post(GOOGLE_BEGIN_ROUTE))).statusCode).toBe(404);
  });

  it('says it is off when the client cannot be read, and still answers the missing cookie', async () => {
    const { idp } = cognito({}, [refusal('TooManyRequestsException')], WITH_GOOGLE);
    const res = await environment(idp)(post(REFRESH_ROUTE));
    expect([res.statusCode, res.body, res.cookies]).toEqual([
      401,
      '{"error":"not_authorized","google":false}',
      ENDED,
    ]);
  });
});

// GlobalSignOut "doesn't clear the managed login session cookie"; the logout endpoint does, and the
// cookie is the auth domain's, so only a browser sent there can have it cleared.
describe('a sign-out names Cognito’s logout while Google is on', () => {
  const LOGOUT = `https://${DOMAIN}/logout?client_id=${CLIENT}`;

  it('hands back the logout endpoint for this client', async () => {
    const { idp } = cognito({}, [SECRET], WITH_GOOGLE);
    const res = await environment(idp)(
      carrying(SIGN_OUT_ROUTE, { refresh: REFRESH, origin: ORIGIN }),
    );
    expect([res.statusCode, bodyOf(res), res.cookies]).toEqual([
      200,
      { status: 'signed_out', logout: LOGOUT },
      FORGOTTEN,
    ]);
  });

  // COGNITO'S SESSION IS ITS OWN: nothing this relay holds says whether the browser has one.
  it('hands it back to a browser that carries no token too', async () => {
    const { idp } = cognito({}, [SECRET], WITH_GOOGLE);
    const res = await environment(idp)(post(SIGN_OUT_ROUTE));
    expect(bodyOf(res)).toEqual({ status: 'signed_out', logout: LOGOUT });
  });

  it('names none when the client lists no Google', async () => {
    const res = await environment(cognito().idp)(carrying(SIGN_OUT_ROUTE));
    expect(res.body).toBe('{"status":"signed_out"}');
  });

  it('names none when the client cannot be read, and still signs a tokenless browser out', async () => {
    const { idp } = cognito({}, [refusal('TooManyRequestsException')], WITH_GOOGLE);
    const res = await environment(idp)(post(SIGN_OUT_ROUTE));
    expect([res.statusCode, res.body, res.cookies]).toEqual([
      200,
      '{"status":"signed_out"}',
      FORGOTTEN,
    ]);
  });
});

// RFC 10017 §6.2.2.3: a token wider than the frontend needs "SHOULD NOT" go back to it, and this
// one's scope authorizes `DeleteUser` too, so the relay spends it on the passkey calls alone.
describe('the passkey calls, made with the token the relay holds', () => {
  const routes = [
    [PASSKEY_LIST_ROUTE, {}],
    [PASSKEY_START_ROUTE, {}],
    [PASSKEY_COMPLETE_ROUTE, { credential: CREDENTIAL }],
  ] as const;
  const passkeyCalls = (calls: { op: keyof IdentityClient }[]) =>
    calls.filter((c) => c.op.endsWith('WebAuthnCredentials') || c.op.endsWith('Registration'));

  for (const [credentials, passkey] of [
    [[], false],
    [[{ CredentialId: 'x' }], true],
  ] as const) {
    it(`lists with the token it sealed, and says ${passkey} for ${credentials.length} passkeys`, async () => {
      const { idp, of } = cognito({
        listWebAuthnCredentials: async () => ({ Credentials: [...credentials] }),
      });
      const relay = environment(idp);
      const res = await relay(asking(PASSKEY_LIST_ROUTE, { access: await holding(relay) }));
      expect([res.statusCode, bodyOf(res), res.cookies]).toEqual([200, { passkey }, undefined]);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(of('listWebAuthnCredentials')).toEqual([{ AccessToken: ACCESS, MaxResults: 1 }]);
    });
  }

  it('starts a registration with the token, and hands back Cognito’s options', async () => {
    const { idp, of } = cognito();
    const relay = environment(idp);
    const res = await relay(asking(PASSKEY_START_ROUTE, { access: await holding(relay) }));
    expect([res.statusCode, bodyOf(res), res.cookies]).toEqual([
      200,
      { options: CREATION_OPTIONS },
      undefined,
    ]);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(of('startWebAuthnRegistration')).toEqual([{ AccessToken: ACCESS }]);
  });

  it('completes it with the token and the credential the dialog made', async () => {
    const { idp, of } = cognito();
    const relay = environment(idp);
    const res = await relay(
      asking(
        PASSKEY_COMPLETE_ROUTE,
        { access: await holding(relay) },
        { sub: ACCOUNT, credential: CREDENTIAL },
      ),
    );
    expect([res.statusCode, bodyOf(res), res.cookies]).toEqual([
      200,
      { status: 'registered' },
      undefined,
    ]);
    expect(of('completeWebAuthnRegistration')).toEqual([
      { AccessToken: ACCESS, Credential: CREDENTIAL },
    ]);
  });

  // AN ANSWER COGNITO CANNOT GIVE OFFERS NOTHING: read as no passkeys, it would offer one.
  it('answers a list that carries no credentials as its own failure, never as none', async () => {
    const { idp } = cognito({ listWebAuthnCredentials: async () => ({}) });
    const relay = environment(idp);
    const res = await relay(asking(PASSKEY_LIST_ROUTE, { access: await holding(relay) }));
    expect([res.statusCode, res.body]).toEqual([500, '{"error":"internal"}']);
    // NAMED, where reading the length of nothing would log a TypeError nobody could act on.
    expect(console.error).toHaveBeenCalledWith('auth-relay: Cognito listed no credentials');
  });

  it('answers a start that carries no options as its own failure', async () => {
    const { idp } = cognito({ startWebAuthnRegistration: async () => ({}) });
    const relay = environment(idp);
    const res = await relay(asking(PASSKEY_START_ROUTE, { access: await holding(relay) }));
    expect([res.statusCode, res.body]).toEqual([500, '{"error":"internal"}']);
  });

  // NOTHING A BROWSER COULD FORGE OR CARRY IN FROM ELSEWHERE OPENS: no cookie, the token itself in
  // the clear, a sealed value altered or cut short, or one sealed under a secret since replaced.
  const unopenable: [string, (sealed: string) => Jar][] = [
    ['no access cookie', () => ({})],
    ['the token itself, unsealed', () => ({ access: ACCESS })],
    ['an empty cookie', () => ({ access: '' })],
    // IN THE MIDDLE, where every bit of a base64url character is data; the last may be padding.
    [
      'a sealed value with one character changed',
      (s) => ({ access: s.slice(0, 20) + (s[20] === 'A' ? 'B' : 'A') + s.slice(21) }),
    ],
    ['a sealed value cut short', (s) => ({ access: s.slice(0, 20) })],
  ];
  for (const [route, extra] of routes) {
    const body = { sub: ACCOUNT, ...extra };
    for (const [what, jar] of unopenable) {
      it(`refuses ${what} on ${route}, asking for no passkey`, async () => {
        const { idp, calls } = cognito();
        const relay = environment(idp);
        const res = await relay(asking(route, jar(await holding(relay)), body));
        expect([res.statusCode, res.body, res.cookies]).toEqual([
          401,
          '{"error":"not_authorized"}',
          undefined,
        ]);
        expect(passkeyCalls(calls)).toEqual([]);
      });
    }

    // THE COOKIE IS THE BROWSER'S, and another tab's sign-in replaces it: a tab acts for the account
    // it shows, or not at all.
    it(`refuses on ${route} a token sealed for another account than the tab names`, async () => {
      const { idp, calls } = cognito();
      const relay = environment(idp);
      const access = await holding(relay);
      const res = await relay(asking(route, { access }, { ...body, sub: 'another-account' }));
      expect([res.statusCode, res.body, res.cookies]).toEqual([
        401,
        '{"error":"not_authorized"}',
        undefined,
      ]);
      expect(passkeyCalls(calls)).toEqual([]);
    });

    it(`refuses on ${route} a sealed token that names no account`, async () => {
      const { idp, calls } = cognito({
        respondToAuthChallenge: async () => ({
          AuthenticationResult: { ...SIGNED_IN.AuthenticationResult, AccessToken: jwt({}) },
        }),
      });
      const relay = environment(idp);
      const res = await relay(asking(route, { access: await holding(relay) }, body));
      expect([res.statusCode, res.body]).toEqual([401, '{"error":"not_authorized"}']);
      expect(passkeyCalls(calls)).toEqual([]);
    });

    it(`refuses on ${route} a token sealed under a secret since replaced`, async () => {
      const access = await holding(environment(cognito().idp));
      const { idp, calls } = cognito({}, [ROTATED_SECRET]);
      const res = await environment(idp)(asking(route, { access }, body));
      expect([res.statusCode, res.body]).toEqual([401, '{"error":"not_authorized"}']);
      expect(passkeyCalls(calls)).toEqual([]);
    });

    // THE TOKEN COGNITO NO LONGER TAKES — expired, revoked, a user gone — is a session to renew;
    // a request it refuses is the caller's; anything else is a fault, and logged.
    const refusals: [string, number, string][] = [
      ['NotAuthorizedException', 401, '{"error":"not_authorized"}'],
      ['UserNotFoundException', 401, '{"error":"not_authorized"}'],
      ['PasswordResetRequiredException', 401, '{"error":"not_authorized"}'],
      ['InvalidParameterException', 400, '{"error":"invalid_request"}'],
      ['LimitExceededException', 400, '{"error":"invalid_request"}'],
      ['WebAuthnChallengeNotFoundException', 400, '{"error":"invalid_request"}'],
      ['WebAuthnClientMismatchException', 400, '{"error":"invalid_request"}'],
      ['WebAuthnCredentialNotSupportedException', 400, '{"error":"invalid_request"}'],
      ['WebAuthnOriginNotAllowedException', 400, '{"error":"invalid_request"}'],
      ['WebAuthnRelyingPartyMismatchException', 400, '{"error":"invalid_request"}'],
      ['TooManyRequestsException', 500, '{"error":"internal"}'],
      ['WebAuthnNotEnabledException', 500, '{"error":"internal"}'],
    ];
    for (const [name, status, answer] of refusals) {
      it(`answers ${name} on ${route} with ${status}, setting no cookie`, async () => {
        const refused = async () => {
          throw refusal(name);
        };
        const { idp } = cognito({
          listWebAuthnCredentials: refused,
          startWebAuthnRegistration: refused,
          completeWebAuthnRegistration: refused,
        });
        const relay = environment(idp);
        const res = await relay(asking(route, { access: await holding(relay) }, body));
        expect([res.statusCode, res.body, res.cookies]).toEqual([status, answer, undefined]);
        expect(vi.mocked(console.error).mock.calls.length > 0).toBe(status === 500);
      });
    }
  }

  const malformed: [string, unknown][] = [
    ...[PASSKEY_LIST_ROUTE, PASSKEY_START_ROUTE].flatMap((route) =>
      [{}, { sub: '' }, { sub: 7 }, { sub: ACCOUNT, extra: 'x' }, [ACCOUNT], 'text', null].map(
        (body): [string, unknown] => [route, body],
      ),
    ),
    ...[
      { credential: CREDENTIAL },
      { sub: ACCOUNT },
      { sub: '', credential: CREDENTIAL },
      { sub: ACCOUNT, credential: 'text' },
      { sub: ACCOUNT, credential: null },
      { sub: ACCOUNT, credential: [CREDENTIAL] },
      { sub: ACCOUNT, credential: CREDENTIAL, extra: 'x' },
      [CREDENTIAL],
      'text',
    ].map((body): [string, unknown] => [PASSKEY_COMPLETE_ROUTE, body]),
  ];
  for (const [route, body] of malformed) {
    it(`refuses ${route} with ${JSON.stringify(body)}, asking Cognito nothing`, async () => {
      const { idp, calls } = cognito();
      const relay = environment(idp);
      const access = await holding(relay);
      calls.length = 0;
      const res = await relay(asking(route, { access }, body));
      expect([res.statusCode, res.body, res.cookies]).toEqual([
        400,
        '{"error":"invalid_request"}',
        undefined,
      ]);
      expect(calls).toEqual([]);
    });
  }

  it('never puts the token or its sealed form in a log line', async () => {
    const { idp } = cognito({
      startWebAuthnRegistration: async () => {
        throw refusal('InternalErrorException');
      },
    });
    const relay = environment(idp);
    const access = await holding(relay);
    await relay(asking(PASSKEY_START_ROUTE, { access }));
    expect(console.error).toHaveBeenCalled();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls, (_, v: unknown) =>
      v instanceof Error ? `${v.name}: ${v.message}` : v,
    );
    for (const needle of [ACCESS, access, SECRET]) {
      expect([needle, logged.includes(needle)]).toEqual([needle, false]);
    }
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
    [GOOGLE_BEGIN_ROUTE, post(GOOGLE_BEGIN_ROUTE)],
    [
      GOOGLE_COMPLETE_ROUTE,
      {
        ...post(GOOGLE_COMPLETE_ROUTE, { code: CODE, state: STATE }),
        cookies: cookiesOf({ google: `${STATE}.${VERIFIER}` }),
      },
    ],
    // `SEALED` IS A PLACEHOLDER: only a sign-in in the same environment seals a token it can open.
    [PASSKEY_LIST_ROUTE, asking(PASSKEY_LIST_ROUTE, { access: 'SEALED' })],
    [PASSKEY_START_ROUTE, asking(PASSKEY_START_ROUTE, { access: 'SEALED' })],
    [
      PASSKEY_COMPLETE_ROUTE,
      asking(
        PASSKEY_COMPLETE_ROUTE,
        { access: 'SEALED' },
        { sub: ACCOUNT, credential: CREDENTIAL },
      ),
    ],
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
      const relay = environment(cognito({}, [SECRET], WITH_GOOGLE).idp);
      const access = event.cookies?.includes('__Host-Http-access=SEALED')
        ? await holding(relay)
        : undefined;
      const res = await relay({
        ...event,
        headers: { ...event.headers, 'sec-fetch-site': 'same-origin' },
        cookies: event.cookies?.map((cookie) =>
          cookie === '__Host-Http-access=SEALED' ? `__Host-Http-access=${access}` : cookie,
        ),
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

// THE PAGE HOLDS THE ID TOKEN ALONE (*Auth model*): over every answer this file was given and every
// example the document publishes, the access token is in no body, and in no cookie unsealed.
describe('no answer carries the access token, on any route', () => {
  const NAMED = /"access_?token"/i;

  it('puts the token in no body, no header and no cookie', () => {
    if (answered.length < 60) {
      throw new Error(`only ${answered.length} answers were recorded — run the whole file`);
    }
    const leaking = answered.filter((res) =>
      [res.body, JSON.stringify(res.headers), JSON.stringify(res.cookies ?? [])].some(
        (part) => part.includes(ACCESS) || NAMED.test(part),
      ),
    );
    expect(leaking).toEqual([]);
  });

  it('names no access token in any answer a route declares', () => {
    const examples = Object.entries(RESPONSES).flatMap(([route, answers]) =>
      answers.map(
        (answer) => [route, 'example' in answer ? JSON.stringify(answer.example) : ''] as const,
      ),
    );
    expect(examples.length).toBeGreaterThan(0);
    expect(examples.filter(([, example]) => NAMED.test(example))).toEqual([]);
  });

  it('names none in a body a route answers as written', () => {
    const bodies = Object.values(RESPONSES).flatMap((answers) =>
      answers.flatMap((answer) => ('body' in answer ? [answer.body] : [])),
    );
    expect(bodies.filter((body) => NAMED.test(body))).toEqual([]);
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: 60 });
