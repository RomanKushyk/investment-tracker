// `POST /me/deletion` on PGlite with every migration (#573): the caller deletes their own account,
// and only behind a sign-in under five minutes old (*Auth model*). Each deletion is read back: the
// answer alone would pass a route that answered 200 and deleted nothing.
import type { PGlite } from '@electric-sql/pglite';
import { MAX_BODY_BYTES } from '@quirenote/core/ops';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { applyUserSchema, insertUser, writeLedger } from './__fixtures__/user-ledger';
import type { AccountIdentity } from './account-delete';
import {
  DELETION_ROUTE,
  REQUEST_BODY,
  RESPONSES,
  type DeletionDeps,
  deleteOwnAccount,
  handler as rawHandler,
} from './deletion';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import { connect } from './dsql';
import type { ApiEvent, ApiResult, EmptyResult } from './http';
import type { SqlClient } from './migrate';
import { proveRouteContract, recorder } from './route-contract';

vi.mock('./dsql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dsql')>()),
  connect: vi.fn(),
}));

const { observed, record } = recorder(DELETION_ROUTE);

const POOL = 'eu-north-1_EXAMPLE';
const SUB = '9f1e2d3c-0000-4000-8000-0000000000e7';
const EMAIL = 'leaving@quirenote.com';
/** The clock every test reads, in milliseconds. */
const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const NOW_S = NOW / 1000;
const NOW_BODY = { timing: 'now' };

let db: PGlite;
let pooled: Set<string>;
let calls: string[];

const missing = () =>
  Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' });
const identity: AccountIdentity = {
  adminUserGlobalSignOut: async ({ Username }) => {
    calls.push(`signOut ${Username}`);
    if (!pooled.has(Username)) throw missing();
    return {};
  },
  adminDeleteUser: async ({ Username }) => {
    calls.push(`delete ${Username}`);
    if (!pooled.delete(Username)) throw missing();
    return {};
  },
  listUsers: async () => ({ Users: [] }),
};

const deps = (over: Partial<DeletionDeps> = {}): DeletionDeps => ({
  user: db as unknown as SqlClient,
  identity,
  userPoolId: POOL,
  now: () => NOW,
  ...over,
});

type Claims = Record<string, unknown>;
const claims = (over: Claims = {}): Claims => ({
  token_use: 'id',
  sub: SUB,
  email: EMAIL,
  email_verified: 'true',
  // As the HTTP API hands a claim on: text.
  auth_time: String(NOW_S - 30),
  ...over,
});

const event = (body: unknown, c: Claims = claims(), raw?: string): ApiEvent => ({
  routeKey: DELETION_ROUTE,
  headers: { 'content-type': 'application/json' },
  body: raw ?? JSON.stringify(body),
  requestContext: { authorizer: { jwt: { claims: c as Record<string, string> } } },
});

const post = async (body: unknown, o: { c?: Claims; raw?: string; d?: DeletionDeps } = {}) => {
  const e = event(body, o.c, o.raw);
  return record(e, await deleteOwnAccount(o.d ?? deps(), e));
};

const answer = (res: ApiResult | EmptyResult) =>
  [res.statusCode, 'body' in res ? JSON.parse(res.body) : undefined] as const;

const rowOf = async (email = EMAIL) =>
  (await db.query<{ user_id: string }>('SELECT user_id FROM app_user WHERE email = $1', [email]))
    .rows;

const ledger = {
  assets: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'REIT',
      code: 'RE',
      colorKey: 'reit' as const,
      yieldType: 'dividends' as const,
      expectedPct: 10,
      targetPct: 25,
      payoutSchedule: 'monthly' as const,
      firstPurchase: '2026-03-02',
      createdAt: '2026-03-02T09:00:00',
    },
  ],
  transactions: [],
  userPrices: [{ assetId: '00000000-0000-4000-8000-000000000001', asOf: '2026-03-02', price: 5 }],
};

beforeEach(async () => {
  db = await freshDb();
  await applyUserSchema(db);
  await insertUser(db, SUB, EMAIL);
  await writeLedger(db, SUB, ledger);
  pooled = new Set([EMAIL]);
  calls = [];
  vi.stubEnv('OPEN_REGISTRATION', 'false');
  vi.mocked(connect).mockRejectedValue(new Error('no cluster in a test'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('deleting your own account', () => {
  it('deletes the row, its data and the identity, and says so', async () => {
    expect(answer(await post(NOW_BODY))).toEqual([200, { status: 'deleted' }]);
    expect(await rowOf()).toEqual([]);
    expect((await db.query('SELECT 1 FROM asset')).rows).toEqual([]);
    expect(pooled.size).toBe(0);
    expect(calls).toContain(`signOut ${EMAIL}`);
  });

  it('does not wait on the terms: an account that holds none is deleted all the same', async () => {
    await db.query('UPDATE app_user SET terms_version = NULL, terms_accepted_at = NULL');
    expect(answer(await post(NOW_BODY))).toEqual([200, { status: 'deleted' }]);
  });
});

describe('only behind a sign-in under five minutes old', () => {
  it('takes a sign-in 299 seconds old', async () => {
    const res = await post(NOW_BODY, { c: claims({ auth_time: String(NOW_S - 299) }) });
    expect(answer(res)).toEqual([200, { status: 'deleted' }]);
  });

  it.each([
    ['300 seconds old', String(NOW_S - 300)],
    ['an hour old', String(NOW_S - 3_600)],
    ['absent', undefined],
    ['not a number', 'soon'],
    ['a fraction', `${NOW_S - 10}.5`],
  ])('refuses one %s, and touches nothing', async (_, authTime) => {
    const c = claims({ auth_time: authTime });
    if (authTime === undefined) delete c.auth_time;
    expect(answer(await post(NOW_BODY, { c }))).toEqual([
      401,
      { error: 'insufficient_user_authentication' },
    ]);
    expect(await rowOf()).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it('reads the claim as a number too, the form the token itself carries', async () => {
    const res = await post(NOW_BODY, { c: claims({ auth_time: NOW_S - 10 }) });
    expect(answer(res)).toEqual([200, { status: 'deleted' }]);
  });
});

describe('the body names the timing', () => {
  it.each([
    ['no timing', {}],
    ['another timing', { timing: '30d' }],
    ['an extra key', { timing: 'now', also: 1 }],
    ['an array', ['now']],
  ])('refuses %s, and touches nothing', async (_, body) => {
    expect(answer(await post(body))).toEqual([400, { error: 'invalid_request' }]);
    expect(await rowOf()).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it('refuses a body that is not JSON', async () => {
    expect((await post(undefined, { raw: '{' })).statusCode).toBe(400);
  });

  it('refuses a body past the shared ceiling', async () => {
    const res = await post(undefined, { raw: 'x'.repeat(MAX_BODY_BYTES + 1) });
    expect(res.statusCode).toBe(413);
  });

  it('publishes the one timing it takes', () => {
    const { schema } = REQUEST_BODY.content['application/json'];
    expect(schema.required).toEqual(['timing']);
    expect(schema.properties.timing.enum).toEqual(['now']);
  });
});

describe('the refusals', () => {
  it('refuses the only super-admin, and touches nothing', async () => {
    await db.query("UPDATE app_user SET role = 'super_admin'");
    expect(answer(await post(NOW_BODY))).toEqual([409, { error: 'sole_super_admin' }]);
    expect(await rowOf()).toHaveLength(1);
    expect(calls).toEqual([]);
  });

  it('refuses a token that reaches the demo by its address', async () => {
    await insertUser(db, DEMO_USER_ID, DEMO_USER_EMAIL, 'active', 'demo');
    const c = claims({ sub: '9f1e2d3c-0000-4000-8000-0000000000d0', email: DEMO_USER_EMAIL });
    expect(answer(await post(NOW_BODY, { c }))).toEqual([403, { error: 'forbidden' }]);
    expect(await rowOf(DEMO_USER_EMAIL)).toHaveLength(1);
  });

  it.each([
    ['pending', 'pending'],
    ['rejected', 'rejected'],
  ])('answers a %s row as the gate does', async (status, error) => {
    // One statement, as `app_user_decided_ck` reads the status and the decision pair together.
    await db.query(
      `UPDATE app_user SET status = $1,
              decided_at = CASE WHEN $1 = 'pending' THEN NULL ELSE decided_at END,
              decided_by = CASE WHEN $1 = 'pending' THEN NULL ELSE decided_by END`,
      [status],
    );
    expect(answer(await post(NOW_BODY))).toEqual([403, { error }]);
    expect(await rowOf()).toHaveLength(1);
  });

  it('answers 500 when the function names no pool', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(NOW_BODY, { d: deps({ userPoolId: undefined }) });
    expect(answer(res)).toEqual([500, { error: 'internal' }]);
    expect(await rowOf()).toHaveLength(1);
  });

  it('answers 500 when the cluster fails part way, and the next ask finishes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: SqlClient = {
      query: (text, values) =>
        /^\s*DELETE FROM app_user/.test(text)
          ? Promise.reject(new Error('the cluster said no'))
          : db.query(text, values),
    };
    expect(answer(await post(NOW_BODY, { d: deps({ user: failing }) }))).toEqual([
      500,
      { error: 'internal' },
    ]);
    expect(answer(await post(NOW_BODY))).toEqual([200, { status: 'deleted' }]);
    expect(pooled.size).toBe(0);
  });
});

describe("the caller's own pool username", () => {
  it('goes with a row whose address the pool no longer holds', async () => {
    pooled = new Set(['Google_1234567890']);
    const c = claims({ 'cognito:username': 'Google_1234567890' });
    expect(answer(await post(NOW_BODY, { c }))).toEqual([200, { status: 'deleted' }]);
    expect(calls).toContain('signOut Google_1234567890');
    expect(pooled.size).toBe(0);
    expect(await rowOf()).toEqual([]);
  });
});

describe('a deletion that stopped after the row, before the identity', () => {
  beforeEach(async () => {
    await db.query('DELETE FROM user_price');
    await db.query('DELETE FROM asset');
    await db.query('UPDATE app_user SET dataset_id = NULL');
    await db.query('DELETE FROM dataset');
    await db.query('DELETE FROM account');
    await db.query('DELETE FROM app_user');
  });

  // The function ships no registration switch, so the gate reads it closed.
  it('is finished when asked again, and no row is made', async () => {
    vi.stubEnv('OPEN_REGISTRATION', undefined);
    const sent: string[] = [];
    const watched: SqlClient = {
      query: (text, values) => {
        sent.push(text);
        return db.query(text, values);
      },
    };
    const res = await post(NOW_BODY, { d: deps({ user: watched }) });
    expect(answer(res)).toEqual([200, { status: 'deleted' }]);
    expect(sent.filter((t) => /INSERT INTO (app_user|account|dataset)/.test(t))).toEqual([]);
    expect(pooled.size).toBe(0);
  });

  it("reaches the caller's own pool username, which the address does not find", async () => {
    pooled = new Set(['Google_1234567890']);
    const c = claims({ 'cognito:username': 'Google_1234567890' });
    expect(answer(await post(NOW_BODY, { c }))).toEqual([200, { status: 'deleted' }]);
    expect(calls).toContain('signOut Google_1234567890');
    expect(pooled.size).toBe(0);
  });

  it.each([
    ['unverified', 'false'],
    ['unasserted', undefined],
  ])('touches no identity under an address the provider left %s', async (_, verified) => {
    const c = claims({ email_verified: verified });
    if (verified === undefined) delete c.email_verified;
    expect(answer(await post(NOW_BODY, { c }))).toEqual([403, { error: 'forbidden' }]);
    expect(calls).toEqual([]);
    expect(pooled.size).toBe(1);
  });

  it('still asks for a fresh sign-in', async () => {
    const c = claims({ auth_time: String(NOW_S - 600) });
    expect((await post(NOW_BODY, { c })).statusCode).toBe(401);
    expect(pooled.size).toBe(1);
  });
});

describe('the function that serves it', () => {
  it('serves the deletion at /me/deletion', () => {
    expect(DELETION_ROUTE).toBe('POST /me/deletion');
  });

  it('closes its connection after answering', async () => {
    let ended = 0;
    vi.mocked(connect).mockResolvedValue({
      query: (text: string, values?: unknown[]) => db.query(text, values),
      end: async () => {
        ended += 1;
      },
    } as unknown as Awaited<ReturnType<typeof connect>>);
    // Stale, so the answer comes before any call to the pool this test has no client for.
    const e = event(NOW_BODY, claims({ auth_time: '1' }));
    expect(record(e, await rawHandler(e)).statusCode).toBe(401);
    expect(ended).toBe(1);
  });

  it('answers a connection failure with its own 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = event(NOW_BODY);
    expect(answer(record(e, await rawHandler(e)))).toEqual([500, { error: 'internal' }]);
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: 25 });
