// `GET /me` and `GET /me/account` over PGlite: the caller's row, its dataset and the gate in one
// database, and the pool's answer from a stub (*Cloud target*, *Auth model*).
import { createHash } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';
import { SETTINGS_DEFAULTS } from '@quirenote/core/settings';
import type { Asset, Transaction } from '@quirenote/core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { applyUserSchema, insertUser, writeLedger } from './__fixtures__/user-ledger';
import { authorize } from './authorize';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import { connect } from './dsql';
import { declarationOf, type ApiEvent, type ApiResult, type EmptyResult } from './http';
import {
  ACCOUNT_ROUTE,
  ME_ROUTE,
  RESPONSES,
  identityReader,
  me,
  meAccount,
  type IdentityReader,
  type MeDeps,
} from './me';
import type { SqlClient } from './migrate';
import { handler as rawHandler } from './mutations';
import { proveRouteContract, recorder } from './route-contract';

vi.mock('./dsql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dsql')>()),
  connect: vi.fn(),
}));

const { observed, record } = recorder(ME_ROUTE);

const SUB = '9f1e2d3c-0000-4000-8000-0000000000d4';
const EMAIL = 'owner@quirenote.com';
const TWIN = '9f1e2d3c-0000-4000-8000-0000000000e5';
const TWIN_EMAIL = 'twin@quirenote.com';
const POOL = 'eu-north-1_TestPool';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const asset = (n: number): Asset => ({
  id: u(n),
  name: 'REIT',
  code: 'RE',
  colorKey: 'reit',
  yieldType: 'dividends',
  expectedPct: 10,
  targetPct: 25,
  payoutSchedule: 'monthly',
  firstPurchase: '2026-03-02',
  createdAt: '2026-03-02T09:00:00',
});
const deposit = (n: number, date: string): Transaction => ({
  id: u(n),
  date,
  type: 'deposit',
  assetId: '',
  amount: 1000,
});

/** The `identities` attribute as Cognito writes it on a local user a provider is linked to. */
const linked = (providerName: string) =>
  JSON.stringify([
    {
      userId: '1234567890',
      providerName,
      providerType: providerName,
      issuer: null,
      primary: false,
      dateCreated: 1760000000000,
    },
  ]);

let db: PGlite;
let asked: { UserPoolId: string; Username: string }[];
let attributes: { Name?: string; Value?: string }[];
let status: string;
let factorsAsked: { UserPoolId: string; Username: string }[];
let factors: string[] | undefined;

const identity: IdentityReader = {
  adminGetUser: async (input) => {
    asked.push(input);
    return { UserAttributes: attributes, UserStatus: status };
  },
  adminGetUserAuthFactors: async (input) => {
    factorsAsked.push(input);
    return { ConfiguredUserAuthFactors: factors };
  },
};

const deps = (over: Partial<MeDeps> = {}): MeDeps => ({
  user: db as unknown as SqlClient,
  identity,
  userPoolId: POOL,
  ...over,
});

/** `username: null` sends a token with no `cognito:username`. */
type Caller = {
  route?: string;
  sub?: string;
  email?: string;
  username?: string | null;
  ifNoneMatch?: string;
};
// A local user's pool username is its `sub` here, the pool signing in by address.
const event = (o: Caller = {}): ApiEvent => ({
  routeKey: o.route ?? ME_ROUTE,
  headers: o.ifNoneMatch === undefined ? {} : { 'if-none-match': o.ifNoneMatch },
  isBase64Encoded: false,
  requestContext: {
    authorizer: {
      jwt: {
        claims: {
          token_use: 'id',
          sub: o.sub ?? SUB,
          email: o.email ?? EMAIL,
          ...(o.username === null ? {} : { 'cognito:username': o.username ?? o.sub ?? SUB }),
        },
      },
    },
  },
});

/** Each built body beside the declaration it went out under: the proof matches an answer by status,
 *  name and headers only, so a key the route adds reaches the document through this list alone. */
const bodies: { name: string; body: object; example: unknown }[] = [];

/** `record`, keeping the body as well: every answer this file observes goes through here. */
const observe = <T extends ApiResult | EmptyResult>(e: ApiEvent, res: T): T => {
  record(e, res);
  const declared = declarationOf(res);
  if (declared !== undefined && 'example' in declared && 'body' in res) {
    bodies.push({
      name: declared.name,
      body: JSON.parse(res.body) as object,
      example: declared.example,
    });
  }
  return res;
};

const read = async (o: Parameters<typeof event>[0] = {}, d: MeDeps = deps()) => {
  const e = event(o);
  return observe(e, await (e.routeKey === ACCOUNT_ROUTE ? meAccount : me)(d, e));
};

const answer = (res: ApiResult | EmptyResult): [number, unknown] => [
  res.statusCode,
  'body' in res ? JSON.parse(res.body) : undefined,
];
const etagOf = (res: ApiResult | EmptyResult) => res.headers?.etag as string;

beforeEach(async () => {
  db = await freshDb();
  await applyUserSchema(db);
  await insertUser(db, SUB, EMAIL);
  // 22:30 UTC is half past midnight in Kyiv: the day served is Kyiv's, not the instant's UTC date.
  await db.query(`UPDATE app_user SET decided_at = '2026-03-01T22:30:00Z' WHERE user_id = $1`, [
    SUB,
  ]);
  await writeLedger(db, SUB, { assets: [], transactions: [], userPrices: [] });
  asked = [];
  attributes = [
    { Name: 'sub', Value: SUB },
    { Name: 'email', Value: EMAIL },
  ];
  // A user who set a password; the pool lists factors it does not offer, so EMAIL_OTP rides along.
  status = 'CONFIRMED';
  factorsAsked = [];
  factors = ['PASSWORD', 'EMAIL_OTP'];
  vi.stubEnv('OPEN_REGISTRATION', 'false');
  vi.mocked(connect).mockRejectedValue(new Error('no cluster in a test'));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** A client that lists the statements sent through it. */
const watching = () => {
  const sent: string[] = [];
  const watched = {
    query: (text: string, values?: unknown[]) => {
      sent.push(text);
      return db.query(text, values);
    },
  } as unknown as SqlClient;
  return { sent, watched };
};

const account = (o: Caller = {}, d: MeDeps = deps()) => read({ ...o, route: ACCOUNT_ROUTE }, d);

// The tag is a digest of these bytes, so a key moved inside the body moves every client's tag.
const digest = (text: string) =>
  `W/"${createHash('sha256').update(text, 'utf8').digest('base64url')}"`;
const settings = JSON.stringify(SETTINGS_DEFAULTS);

// Read on every load beside `/view`, so it answers from the gate's row alone (#600).
describe("GET /me, the caller from the gate's row", () => {
  it('answers a user with its id, address, role and settings, and nothing else', async () => {
    await db.query(`UPDATE app_user SET settings = '{"language":"en"}' WHERE user_id = $1`, [SUB]);
    expect(answer(await read())).toEqual([
      200,
      {
        userId: SUB,
        email: EMAIL,
        role: 'user',
        settings: { ...SETTINGS_DEFAULTS, language: 'en' },
      },
    ]);
  });

  it('answers the only super-admin with its role, and no profile field', async () => {
    await db.query(`UPDATE app_user SET role = 'super_admin' WHERE user_id = $1`, [SUB]);
    expect(answer(await read())).toEqual([
      200,
      { userId: SUB, email: EMAIL, role: 'super_admin', settings: SETTINGS_DEFAULTS },
    ]);
  });

  // The only super-admin is the case that asked the most: the pool twice and the sole query.
  it('asks the pool nothing and the database nothing beyond the gate, 200 or 304', async () => {
    await db.query(`UPDATE app_user SET role = 'super_admin' WHERE user_id = $1`, [SUB]);
    const gate = watching();
    expect('caller' in (await authorize(gate.watched, event()))).toBe(true);
    expect(gate.sent.length).toBeGreaterThan(0);

    const fresh = watching();
    const res = await read({}, deps({ user: fresh.watched }));
    expect(res.statusCode).toBe(200);
    expect(fresh.sent).toEqual(gate.sent);

    const again = watching();
    const unchanged = await read({ ifNoneMatch: etagOf(res) }, deps({ user: again.watched }));
    expect(unchanged.statusCode).toBe(304);
    expect(again.sent).toEqual(gate.sent);

    expect(asked).toEqual([]);
    expect(factorsAsked).toEqual([]);
  });

  it('answers with no pool named and a token that names no pool username', async () => {
    const res = await read({ username: null }, deps({ userPoolId: undefined }));
    expect(res.statusCode).toBe(200);
  });

  it('serves the settings sanitised, an unknown or invalid field dropped', async () => {
    await db.query(
      `UPDATE app_user SET settings = '{"theme":"dark","period":"1y","language":"en"}' WHERE user_id = $1`,
      [SUB],
    );
    expect(answer(await read())[1]).toMatchObject({
      settings: { ...SETTINGS_DEFAULTS, language: 'en' },
    });
  });

  it('keeps its keys in one order, the bytes its tag is a digest of', async () => {
    const text = `{"userId":"${SUB}","email":"${EMAIL}","role":"user","settings":${settings}}`;
    const res = await read();
    expect('body' in res ? res.body : undefined).toBe(text);
    expect(etagOf(res)).toBe(digest(text));
  });
});

describe('the validator of GET /me', () => {
  it('sends a weak tag, kept by the browser alone and revalidated on every use', async () => {
    const res = await read();
    expect(etagOf(res)).toMatch(/^W\/"[A-Za-z0-9_-]+"$/);
    expect(res.headers?.['cache-control']).toBe('private, no-cache');
  });

  it('answers an unchanged If-None-Match with a 304 and no body', async () => {
    const etag = etagOf(await read());
    const res = await read({ ifNoneMatch: etag });
    expect(res.statusCode).toBe(304);
    expect('body' in res && res.body !== '').toBe(false);
    expect(res.headers).toMatchObject({ etag, 'cache-control': 'private, no-cache' });
  });

  it('moves the tag when the settings change', async () => {
    const etag = etagOf(await read());
    await db.query(`UPDATE app_user SET settings = '{"language":"en"}' WHERE user_id = $1`, [SUB]);
    const res = await read({ ifNoneMatch: etag });
    expect(res.statusCode).toBe(200);
    expect(etagOf(res)).not.toBe(etag);
  });

  it('moves the tag when the role changes', async () => {
    const etag = etagOf(await read());
    await db.query(`UPDATE app_user SET role = 'super_admin' WHERE user_id = $1`, [SUB]);
    const res = await read({ ifNoneMatch: etag });
    expect(res.statusCode).toBe(200);
    expect(etagOf(res)).not.toBe(etag);
  });

  // The counts are `/me/account`'s, so a write of the dataset leaves this read unchanged.
  it('keeps the tag when the dataset gains a row', async () => {
    const etag = etagOf(await read());
    await writeLedger(db, SUB, { assets: [asset(1)], transactions: [], userPrices: [] });
    expect((await read({ ifNoneMatch: etag })).statusCode).toBe(304);
  });
});

// The profile's fields, read by `/profile` alone.
describe("GET /me/account, the profile's fields", () => {
  it('answers the member-since day, the ways in and the counts, and nothing else', async () => {
    await db.query(`UPDATE app_user SET settings = '{"language":"en"}' WHERE user_id = $1`, [SUB]);
    expect(answer(await account())).toEqual([
      200,
      {
        memberSince: '2026-03-02',
        googleLinked: false,
        passwordSet: true,
        assets: 0,
        transactions: 0,
      },
    ]);
  });

  it('names the only super-admin, whom a deletion refuses', async () => {
    await db.query(`UPDATE app_user SET role = 'super_admin' WHERE user_id = $1`, [SUB]);
    expect(answer(await account())[1]).toMatchObject({ soleSuperAdmin: true });
  });

  it('does not ask for an ordinary user', async () => {
    const { sent, watched } = watching();
    const res = await account({}, deps({ user: watched }));
    expect(res.statusCode).toBe(200);
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.filter((t) => t.includes('AS sole'))).toEqual([]);
  });

  it('omits it while another super-admin is active, and for a user', async () => {
    expect(answer(await account())[1]).not.toHaveProperty('soleSuperAdmin');
    await db.query(`UPDATE app_user SET role = 'super_admin' WHERE user_id = $1`, [SUB]);
    await insertUser(db, TWIN, TWIN_EMAIL, 'active', 'super_admin');
    expect(answer(await account())[1]).not.toHaveProperty('soleSuperAdmin');
  });

  // A super-admin a scheduled deletion holds reaches no route, so the one left free is the only one.
  it('names the only one while every other super-admin is held by a scheduled deletion', async () => {
    await db.query(`UPDATE app_user SET role = 'super_admin' WHERE user_id = $1`, [SUB]);
    await insertUser(db, TWIN, TWIN_EMAIL, 'active', 'super_admin');
    await db.query(
      `UPDATE app_user SET deletion_due = '2099-12-31', deletion_requested_at = now()
        WHERE user_id = $1`,
      [TWIN],
    );
    expect(answer(await account())[1]).toMatchObject({ soleSuperAdmin: true });
  });

  it("keeps a user's keys in one order, the bytes its tag is a digest of", async () => {
    await writeLedger(db, SUB, {
      assets: [asset(1)],
      transactions: [deposit(10, '2026-03-09')],
      userPrices: [],
    });
    const text =
      `{"memberSince":"2026-03-02","googleLinked":false,"passwordSet":true,"assets":1,` +
      `"transactions":1,"firstTransaction":"2026-03-09"}`;
    const res = await account();
    expect('body' in res ? res.body : undefined).toBe(text);
    expect(etagOf(res)).toBe(digest(text));
  });

  it("keeps the only super-admin's keys in one order, the bytes its tag is a digest of", async () => {
    await db.query(`UPDATE app_user SET role = 'super_admin' WHERE user_id = $1`, [SUB]);
    const text =
      `{"memberSince":"2026-03-02","googleLinked":false,"passwordSet":true,"assets":0,` +
      `"transactions":0,"soleSuperAdmin":true}`;
    const res = await account();
    expect('body' in res ? res.body : undefined).toBe(text);
    expect(etagOf(res)).toBe(digest(text));
  });
});

describe('what the account holds', () => {
  it('counts the assets and transactions, and names the first transaction day', async () => {
    await writeLedger(db, SUB, {
      assets: [asset(1), asset(2)],
      transactions: [
        deposit(10, '2026-04-05'),
        deposit(11, '2026-03-09'),
        deposit(12, '2027-01-01'),
      ],
      userPrices: [],
    });
    expect(answer(await account())[1]).toMatchObject({
      assets: 2,
      transactions: 3,
      firstTransaction: '2026-03-09',
    });
  });

  it('omits the first transaction day while there is none, never null', async () => {
    await writeLedger(db, SUB, { assets: [asset(1)], transactions: [], userPrices: [] });
    const [, body] = answer(await account());
    expect(body).toMatchObject({ assets: 1, transactions: 0 });
    expect(body).not.toHaveProperty('firstTransaction');
  });

  it("counts the caller's dataset, not another user's", async () => {
    await insertUser(db, TWIN, TWIN_EMAIL);
    await writeLedger(db, TWIN, {
      assets: [asset(3)],
      transactions: [deposit(13, '2025-01-01')],
      userPrices: [],
    });
    const [, body] = answer(await account());
    expect(body).toMatchObject({ assets: 0, transactions: 0 });
    expect(body).not.toHaveProperty('firstTransaction');
  });
});

describe('Google linked, from the pool', () => {
  it("asks the pool for the caller's own user, by its pool username", async () => {
    await account();
    expect(asked).toEqual([{ UserPoolId: POOL, Username: SUB }]);
  });

  // An open registration lets a Google sign-in with no local account in as a profile of its own,
  // whose `sub` names no local user.
  it('asks for a profile Google made by its own username, and finds Google linked', async () => {
    attributes.push({ Name: 'identities', Value: linked('Google') });
    await account({ username: 'Google_1234567890' });
    expect(asked).toEqual([{ UserPoolId: POOL, Username: 'Google_1234567890' }]);
    expect(answer(await account({ username: 'Google_1234567890' }))[1]).toMatchObject({
      googleLinked: true,
    });
  });

  it('refuses a token that names no pool username, and asks the pool nothing', async () => {
    expect(answer(await account({ username: null }))).toEqual([403, { error: 'forbidden' }]);
    expect(asked).toEqual([]);
  });

  it('is true when a Google identity is linked to the account', async () => {
    attributes.push({ Name: 'identities', Value: linked('Google') });
    expect(answer(await account())[1]).toMatchObject({ googleLinked: true });
  });

  it('is false when no identity is linked', async () => {
    expect(answer(await account())[1]).toMatchObject({ googleLinked: false });
  });

  it('is false when only another provider is linked', async () => {
    attributes.push({ Name: 'identities', Value: linked('SignInWithApple') });
    expect(answer(await account())[1]).toMatchObject({ googleLinked: false });
  });
});

describe('a password of its own, from the pool', () => {
  it("asks the pool for the caller's own factors, by its pool username", async () => {
    await account({ username: 'Google_1234567890' });
    expect(factorsAsked).toEqual([{ UserPoolId: POOL, Username: 'Google_1234567890' }]);
  });

  it('is true when PASSWORD is configured on a confirmed user', async () => {
    expect(answer(await account())[1]).toMatchObject({ passwordSet: true });
  });

  // An approved account that only ever signs in through Google holds just the invitation's
  // password, which is not its own (ASVS 5.0.0 6.4.1) and expires unused.
  it('is false while the invitation password was never changed, though PASSWORD is listed', async () => {
    status = 'FORCE_CHANGE_PASSWORD';
    expect(answer(await account())[1]).toMatchObject({ passwordSet: false });
  });

  it('is false when a reset is required', async () => {
    status = 'RESET_REQUIRED';
    expect(answer(await account())[1]).toMatchObject({ passwordSet: false });
  });

  it('is false for a confirmed user whose factors lack PASSWORD', async () => {
    factors = ['WEB_AUTHN', 'EMAIL_OTP'];
    expect(answer(await account())[1]).toMatchObject({ passwordSet: false });
  });

  it('is false when the pool lists no factor at all', async () => {
    factors = undefined;
    expect(answer(await account())[1]).toMatchObject({ passwordSet: false });
  });
});

describe('the validator of GET /me/account', () => {
  it('sends a weak tag, kept by the browser alone and revalidated on every use', async () => {
    const res = await account();
    expect(etagOf(res)).toMatch(/^W\/"[A-Za-z0-9_-]+"$/);
    expect(res.headers?.['cache-control']).toBe('private, no-cache');
  });

  it('answers an unchanged If-None-Match with a 304 and no body', async () => {
    const etag = etagOf(await account());
    const res = await account({ ifNoneMatch: etag });
    expect(res.statusCode).toBe(304);
    expect('body' in res && res.body !== '').toBe(false);
    expect(res.headers).toMatchObject({ etag, 'cache-control': 'private, no-cache' });
  });

  it('moves the tag when the dataset gains a row', async () => {
    const etag = etagOf(await account());
    await writeLedger(db, SUB, { assets: [asset(1)], transactions: [], userPrices: [] });
    expect((await account({ ifNoneMatch: etag })).statusCode).toBe(200);
  });

  it('moves the tag when a Google identity is linked', async () => {
    const etag = etagOf(await account());
    attributes.push({ Name: 'identities', Value: linked('Google') });
    expect((await account({ ifNoneMatch: etag })).statusCode).toBe(200);
  });

  it('moves the tag when the account sets its password', async () => {
    status = 'FORCE_CHANGE_PASSWORD';
    const etag = etagOf(await account());
    status = 'CONFIRMED';
    expect((await account({ ifNoneMatch: etag })).statusCode).toBe(200);
  });

  // The settings are no field of it, so their write leaves the profile's read unchanged.
  it('keeps the tag when only the settings change', async () => {
    const etag = etagOf(await account());
    await db.query(`UPDATE app_user SET settings = '{"language":"en"}' WHERE user_id = $1`, [SUB]);
    expect((await account({ ifNoneMatch: etag })).statusCode).toBe(304);
  });
});

describe.each([ME_ROUTE, ACCOUNT_ROUTE])('the gate, on %s', (route) => {
  const refuses = async (expected: string, o: Parameters<typeof event>[0] = {}) => {
    expect(answer(await read({ ...o, route }))).toEqual([403, { error: expected }]);
    expect(asked).toEqual([]);
    expect(factorsAsked).toEqual([]);
  };

  it('tells a pending applicant to wait', async () => {
    await db.query("UPDATE app_user SET status = 'pending', decided_at = NULL, decided_by = NULL");
    await refuses('pending');
  });

  it('tells a rejected applicant to stop', async () => {
    await db.query("UPDATE app_user SET status = 'rejected'");
    await refuses('rejected');
  });

  it('tells a caller with no row there is no application', async () => {
    await refuses('no_application', { sub: TWIN, email: TWIN_EMAIL });
  });

  it('asks a caller whose row holds no terms version to accept them', async () => {
    await db.query('UPDATE app_user SET terms_version = NULL, terms_accepted_at = NULL');
    await refuses('terms');
  });

  it('answers an account a scheduled deletion holds with the date', async () => {
    await db.query(
      "UPDATE app_user SET deletion_due = '2099-12-31', deletion_requested_at = now()",
    );
    const res = await read({ route });
    expect([res.statusCode, 'body' in res ? res.body : undefined]).toEqual([
      403,
      '{"error":"scheduled","date":"2099-12-31","cancellable":false}',
    ]);
  });

  it('refuses the demo as a non-caller', async () => {
    await insertUser(db, DEMO_USER_ID, DEMO_USER_EMAIL, 'active', 'demo');
    await refuses('forbidden', { sub: TWIN, email: DEMO_USER_EMAIL });
  });
});

describe.each([ME_ROUTE, ACCOUNT_ROUTE])('a failure answers rather than throws, on %s', (route) => {
  it('answers a failing database with its own 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken: SqlClient = { query: () => Promise.reject(new Error('the cluster went away')) };
    expect(answer(await read({ route }, deps({ user: broken })))).toEqual([
      500,
      { error: 'internal' },
    ]);
  });
});

// `/me` asks the pool nothing, so only the profile's read can fail on it.
describe('a failure of the pool answers rather than throws, on GET /me/account', () => {
  const route = ACCOUNT_ROUTE;

  it('answers a failing pool with its own 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: IdentityReader = {
      ...identity,
      adminGetUser: () => Promise.reject(new Error('the pool went away')),
    };
    expect(answer(await read({ route }, deps({ identity: failing })))).toEqual([
      500,
      { error: 'internal' },
    ]);
  });

  it("answers a pool that refuses the factors' read with its own 500", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: IdentityReader = {
      ...identity,
      adminGetUserAuthFactors: () => Promise.reject(new Error('the pool went away')),
    };
    expect(answer(await read({ route }, deps({ identity: failing })))).toEqual([
      500,
      { error: 'internal' },
    ]);
  });

  it('answers a function with no pool named with its own 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(answer(await read({ route }, deps({ userPoolId: undefined })))).toEqual([
      500,
      { error: 'internal' },
    ]);
    expect(asked).toEqual([]);
  });
});

describe('the function that serves it', () => {
  const connected = () => {
    let ended = 0;
    vi.mocked(connect).mockResolvedValue({
      query: (text: string, values?: unknown[]) => db.query(text, values),
      end: async () => {
        ended += 1;
      },
    } as unknown as Awaited<ReturnType<typeof connect>>);
    return () => ended;
  };

  it("answers through the pool reader, told the function's pool", async () => {
    const ended = connected();
    vi.stubEnv('USER_POOL_ID', POOL);
    const pool = vi
      .spyOn(identityReader, 'adminGetUser')
      .mockResolvedValue({ UserAttributes: [], UserStatus: 'CONFIRMED' });
    const held = vi
      .spyOn(identityReader, 'adminGetUserAuthFactors')
      .mockResolvedValue({ ConfiguredUserAuthFactors: ['PASSWORD'] });
    const e = event({ route: ACCOUNT_ROUTE });
    const res = observe(e, (await rawHandler(e)) as ApiResult);
    expect(answer(res)).toEqual([200, expect.objectContaining({ passwordSet: true })]);
    expect(pool).toHaveBeenCalledExactlyOnceWith({ UserPoolId: POOL, Username: SUB });
    expect(held).toHaveBeenCalledExactlyOnceWith({ UserPoolId: POOL, Username: SUB });
    expect(ended()).toBe(1);
  });

  it('routes GET /me to the route and closes its connection', async () => {
    const ended = connected();
    const e = event();
    const res = observe(e, (await rawHandler(e)) as ApiResult);
    expect(answer(res)).toEqual([
      200,
      { userId: SUB, email: EMAIL, role: 'user', settings: SETTINGS_DEFAULTS },
    ]);
    expect(ended()).toBe(1);
  });

  it('routes GET /me/account to the account read and closes its connection', async () => {
    const ended = connected();
    vi.stubEnv('USER_POOL_ID', POOL);
    vi.spyOn(identityReader, 'adminGetUser').mockResolvedValue({
      UserAttributes: [],
      UserStatus: 'CONFIRMED',
    });
    vi.spyOn(identityReader, 'adminGetUserAuthFactors').mockResolvedValue({
      ConfiguredUserAuthFactors: ['PASSWORD'],
    });
    const e = event({ route: ACCOUNT_ROUTE });
    const res = observe(e, (await rawHandler(e)) as ApiResult);
    expect(answer(res)).toEqual([
      200,
      {
        memberSince: '2026-03-02',
        googleLinked: false,
        passwordSet: true,
        assets: 0,
        transactions: 0,
      },
    ]);
    expect(ended()).toBe(1);
  });
});

const MINIMUM = 25;

describe('the document', () => {
  it('shows every key a built answer carries in the example it went out under', () => {
    if (observed.length < MINIMUM || bodies.length === 0) {
      throw new Error('this check reads every body the file observed; run the whole file');
    }
    const unshown = bodies.flatMap(({ name, body, example }) =>
      Object.keys(body)
        .filter((key) => !Object.hasOwn(example as object, key))
        .map((key) => `${name}: ${key}`),
    );
    expect([...new Set(unshown)]).toEqual([]);
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: MINIMUM });
