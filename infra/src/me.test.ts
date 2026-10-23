// `GET /me` over PGlite: the caller's row, its dataset and the gate in one database, and the pool's
// answer from a stub (*Cloud target*, *Auth model*).
import type { PGlite } from '@electric-sql/pglite';
import { SETTINGS_DEFAULTS } from '@quirenote/core/settings';
import type { Asset, Transaction } from '@quirenote/core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { applyUserSchema, insertUser, writeLedger } from './__fixtures__/user-ledger';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import { connect } from './dsql';
import type { ApiEvent, ApiResult, EmptyResult } from './http';
import { ME_ROUTE, RESPONSES, identityReader, me, type IdentityReader, type MeDeps } from './me';
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

const identity: IdentityReader = {
  adminGetUser: async (input) => {
    asked.push(input);
    return { UserAttributes: attributes };
  },
};

const deps = (over: Partial<MeDeps> = {}): MeDeps => ({
  user: db as unknown as SqlClient,
  identity,
  userPoolId: POOL,
  ...over,
});

/** `username: null` sends a token with no `cognito:username`. */
type Caller = { sub?: string; email?: string; username?: string | null; ifNoneMatch?: string };
// A local user's pool username is its `sub` here, the pool signing in by address.
const event = (o: Caller = {}): ApiEvent => ({
  routeKey: ME_ROUTE,
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

const read = async (o: Parameters<typeof event>[0] = {}, d: MeDeps = deps()) => {
  const e = event(o);
  return record(e, await me(d, e));
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
  vi.stubEnv('OPEN_REGISTRATION', 'false');
  vi.mocked(connect).mockRejectedValue(new Error('no cluster in a test'));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("the caller's own account", () => {
  it('answers a user with its role, address, id, member-since day and settings', async () => {
    await db.query(`UPDATE app_user SET settings = '{"language":"en"}' WHERE user_id = $1`, [SUB]);
    expect(answer(await read())).toEqual([
      200,
      {
        userId: SUB,
        email: EMAIL,
        role: 'user',
        memberSince: '2026-03-02',
        googleLinked: false,
        assets: 0,
        transactions: 0,
        settings: { ...SETTINGS_DEFAULTS, language: 'en' },
      },
    ]);
  });

  it('answers a super-admin with its role', async () => {
    await db.query(`UPDATE app_user SET role = 'super_admin' WHERE user_id = $1`, [SUB]);
    expect(answer(await read())[1]).toMatchObject({ role: 'super_admin' });
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

  it('carries no status, application date, decider, version or dataset', async () => {
    const [, body] = answer(await read());
    expect(Object.keys(body as object).sort()).toEqual(
      [
        'assets',
        'email',
        'googleLinked',
        'memberSince',
        'role',
        'settings',
        'transactions',
        'userId',
      ].sort(),
    );
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
    expect(answer(await read())[1]).toMatchObject({
      assets: 2,
      transactions: 3,
      firstTransaction: '2026-03-09',
    });
  });

  it('omits the first transaction day while there is none, never null', async () => {
    await writeLedger(db, SUB, { assets: [asset(1)], transactions: [], userPrices: [] });
    const [, body] = answer(await read());
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
    const [, body] = answer(await read());
    expect(body).toMatchObject({ assets: 0, transactions: 0 });
    expect(body).not.toHaveProperty('firstTransaction');
  });
});

describe('Google linked, from the pool', () => {
  it("asks the pool for the caller's own user, by its pool username", async () => {
    await read();
    expect(asked).toEqual([{ UserPoolId: POOL, Username: SUB }]);
  });

  // An open registration lets a Google sign-in with no local account in as a profile of its own,
  // whose `sub` names no local user.
  it('asks for a profile Google made by its own username, and finds Google linked', async () => {
    attributes.push({ Name: 'identities', Value: linked('Google') });
    await read({ username: 'Google_1234567890' });
    expect(asked).toEqual([{ UserPoolId: POOL, Username: 'Google_1234567890' }]);
    expect(answer(await read({ username: 'Google_1234567890' }))[1]).toMatchObject({
      googleLinked: true,
    });
  });

  it('refuses a token that names no pool username, and asks the pool nothing', async () => {
    expect(answer(await read({ username: null }))).toEqual([403, { error: 'forbidden' }]);
    expect(asked).toEqual([]);
  });

  it('is true when a Google identity is linked to the account', async () => {
    attributes.push({ Name: 'identities', Value: linked('Google') });
    expect(answer(await read())[1]).toMatchObject({ googleLinked: true });
  });

  it('is false when no identity is linked', async () => {
    expect(answer(await read())[1]).toMatchObject({ googleLinked: false });
  });

  it('is false when only another provider is linked', async () => {
    attributes.push({ Name: 'identities', Value: linked('SignInWithApple') });
    expect(answer(await read())[1]).toMatchObject({ googleLinked: false });
  });
});

describe('the validator', () => {
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

  it('moves the tag when the dataset gains a row', async () => {
    const etag = etagOf(await read());
    await writeLedger(db, SUB, { assets: [asset(1)], transactions: [], userPrices: [] });
    expect((await read({ ifNoneMatch: etag })).statusCode).toBe(200);
  });

  it('moves the tag when a Google identity is linked', async () => {
    const etag = etagOf(await read());
    attributes.push({ Name: 'identities', Value: linked('Google') });
    expect((await read({ ifNoneMatch: etag })).statusCode).toBe(200);
  });
});

describe('the gate', () => {
  const refuses = async (expected: string, o: Parameters<typeof event>[0] = {}) => {
    expect(answer(await read(o))).toEqual([403, { error: expected }]);
    expect(asked).toEqual([]);
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

  it('refuses the demo as a non-caller', async () => {
    await insertUser(db, DEMO_USER_ID, DEMO_USER_EMAIL, 'active', 'demo');
    await refuses('forbidden', { sub: TWIN, email: DEMO_USER_EMAIL });
  });
});

describe('a failure answers rather than throws', () => {
  it('answers a failing database with its own 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken: SqlClient = { query: () => Promise.reject(new Error('the cluster went away')) };
    expect(answer(await read({}, deps({ user: broken })))).toEqual([500, { error: 'internal' }]);
  });

  it('answers a failing pool with its own 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: IdentityReader = {
      adminGetUser: () => Promise.reject(new Error('the pool went away')),
    };
    expect(answer(await read({}, deps({ identity: failing })))).toEqual([
      500,
      { error: 'internal' },
    ]);
  });

  it('answers a function with no pool named with its own 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(answer(await read({}, deps({ userPoolId: undefined })))).toEqual([
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
    const pool = vi.spyOn(identityReader, 'adminGetUser').mockResolvedValue({ UserAttributes: [] });
    const e = event();
    const res = record(e, (await rawHandler(e)) as ApiResult);
    expect(answer(res)[0]).toBe(200);
    expect(pool).toHaveBeenCalledExactlyOnceWith({ UserPoolId: POOL, Username: SUB });
    expect(ended()).toBe(1);
  });

  it('routes GET /me to the route and closes its connection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ended = connected();
    // No USER_POOL_ID on the test's environment: the route's own 500 proves it was reached.
    vi.stubEnv('USER_POOL_ID', '');
    const e = event();
    const res = record(e, (await rawHandler(e)) as ApiResult);
    expect(answer(res)).toEqual([500, { error: 'internal' }]);
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toContain('USER_POOL_ID');
    expect(ended()).toBe(1);
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: 25 });
