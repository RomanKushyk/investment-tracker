// `POST /mutations` and `GET /state` over PGlite: the caller's dataset, the key table and the gate
// in one database, each reached through the module the routes use (*User schema and deletes*).
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { PGlite } from '@electric-sql/pglite';
import { validateImport } from '@quirenote/core/backup/import';
import { buildBackup, parseBackup } from '@quirenote/core/backup/json';
import { MAX_BODY_BYTES, MAX_OPS } from '@quirenote/core/ops';
import type { Asset, Snapshot, Transaction } from '@quirenote/core/types';
import { snapshotsOfPrices, type PriceRow } from '@quirenote/core/valuation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb, refusingCommit } from './__fixtures__/pglite';
import { applyUserSchema, insertUser, writeLedger } from './__fixtures__/user-ledger';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import { connect } from './dsql';
import type { ApiEvent, ApiResult, EmptyResult } from './http';
import type { SqlClient } from './migrate';
import {
  CLAIM_WINDOW_SECONDS,
  MAX_ROWS,
  MUTATIONS_ROUTE,
  RESPONSES,
  STATE_ROUTE,
  canonical,
  fingerprintOf,
  handler as rawHandler,
  mutations as mutationsRoute,
  state as stateRoute,
  type MutationDeps,
} from './mutations';
import { proveRouteContract, recorder } from './route-contract';
import { view, type ViewDeps } from './view';

vi.mock('./dsql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dsql')>()),
  connect: vi.fn(),
}));

const { observed, record } = recorder(MUTATIONS_ROUTE);

const SUB = '9f1e2d3c-0000-4000-8000-0000000000d4';
const EMAIL = 'owner@quirenote.com';
const TWIN = '9f1e2d3c-0000-4000-8000-0000000000e5';
const TWIN_EMAIL = 'twin@quirenote.com';
const STAGED = '9f1e2d3c-0000-4000-8000-0000000000c3';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const asset = (n: number, over: Partial<Asset> = {}): Asset => ({
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
  ...over,
});
const deposit = (n: number, date = '2026-03-01', amount = 100_000): Transaction => ({
  id: u(n),
  date,
  type: 'deposit',
  assetId: '',
  amount,
});
const buy = (
  n: number,
  of: number,
  date: string,
  amount: number,
  quantity: number,
): Transaction => ({
  id: u(n),
  date,
  type: 'buy',
  assetId: u(of),
  amount,
  quantity,
});
const sell = (
  n: number,
  of: number,
  date: string,
  amount: number,
  quantity: number,
): Transaction => ({
  ...buy(n, of, date, amount, quantity),
  type: 'sell',
});

const addAsset = (a: Asset) => ({ op: 'asset.add', asset: a });
const addTx = (t: Transaction) => ({ op: 'transaction.add', transaction: t });
const put = (date: string, quotes: Record<string, number>, savedAt?: string) => ({
  op: 'snapshot.put',
  snapshot: { date, quotes, ...(savedAt === undefined ? {} : { savedAt }) },
});

let db: PGlite;
let slept: number[];

const deps = (over: Partial<MutationDeps> = {}): MutationDeps => ({
  user: db as unknown as SqlClient,
  token: () => randomUUID(),
  sleep: async (ms) => {
    slept.push(ms);
  },
  ...over,
});

const caller = (sub = SUB, email = EMAIL) => ({
  authorizer: { jwt: { claims: { token_use: 'id', sub, email } } },
});

const version = async () =>
  (
    await db.query<{ v: string }>(
      'SELECT data_version::text AS v FROM app_user WHERE user_id = $1',
      [SUB],
    )
  ).rows[0].v;
const tag = async () => `"${await version()}"`;

type Send = {
  /** A fresh key unless named; `null` sends none. */
  key?: string | null;
  /** The current tag unless named; `null` sends none. */
  ifMatch?: string | null;
  /** The raw body, in place of `{ ops }`. */
  body?: string;
  base64?: boolean;
  d?: MutationDeps;
  sub?: string;
  email?: string;
};

const mutationEvent = async (ops: unknown[] | undefined, o: Send = {}): Promise<ApiEvent> => {
  const headers: Record<string, string> = {};
  const key = o.key === undefined ? randomUUID() : o.key;
  if (key !== null) headers['idempotency-key'] = key;
  const ifMatch = o.ifMatch === undefined ? await tag() : o.ifMatch;
  if (ifMatch !== null) headers['if-match'] = ifMatch;
  const text = o.body ?? JSON.stringify({ ops });
  return {
    routeKey: MUTATIONS_ROUTE,
    headers,
    body: o.base64 ? Buffer.from(text, 'utf8').toString('base64') : text,
    isBase64Encoded: o.base64 ?? false,
    requestContext: caller(o.sub, o.email),
  };
};

const post = async (ops: unknown[] | undefined, o: Send = {}) => {
  const event = await mutationEvent(ops, o);
  return record(event, (await mutationsRoute(o.d ?? deps(), event)) as ApiResult);
};

const get = async (headers: Record<string, string> = {}, sub = SUB, email = EMAIL, d = deps()) => {
  const event: ApiEvent = { routeKey: STATE_ROUTE, headers, requestContext: caller(sub, email) };
  return record(event, await stateRoute(d, event));
};

const answer = (res: ApiResult | EmptyResult) => [
  res.statusCode,
  'body' in res ? (JSON.parse(res.body) as unknown) : undefined,
];

type State = { assets: Asset[]; transactions: Transaction[]; prices: PriceRow[] };
const state = async (): Promise<State> => {
  const res = (await get()) as ApiResult;
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body) as State;
};
/** The ₴ quotes the exported prices make, as `/view` rounds them. */
const quotesOf = (s: Pick<State, 'transactions' | 'prices'>) =>
  snapshotsOfPrices(s.transactions, s.prices);

/** Rows of `table` in the caller's live dataset. */
const live = async (table: 'asset' | 'transaction' | 'user_price') =>
  (
    await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${table}" x JOIN app_user u ON u.dataset_id = x.dataset_id
        WHERE u.user_id = $1`,
      [SUB],
    )
  ).rows[0].n;
const keyRows = async () =>
  (
    await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM mutation_key WHERE user_id = $1',
      [SUB],
    )
  ).rows[0].n;

const OK = async (ops: unknown[], o: Send = {}) => {
  const res = await post(ops, o);
  expect(answer(res)).toEqual([200, expect.anything()]);
  return JSON.parse(res.body) as { etag: string; results: Record<string, unknown>[] };
};

/** Every statement sent, the first word of each, for a client that wraps the database. */
const watching = (inner: SqlClient = db as unknown as SqlClient) => {
  const sent: string[] = [];
  const client: SqlClient = {
    query: (text, values) => {
      sent.push(text);
      return inner.query(text, values);
    },
  };
  return { client, sent };
};

const conflict = (code: string) =>
  Object.assign(new Error('change conflicts with another transaction (OC000)'), { code });

beforeEach(async () => {
  db = await freshDb();
  await applyUserSchema(db);
  await insertUser(db, SUB, EMAIL);
  await writeLedger(db, SUB, { assets: [], transactions: [], userPrices: [] });
  vi.stubEnv('OPEN_REGISTRATION', 'false');
  vi.mocked(connect).mockRejectedValue(new Error('no cluster in a test'));
  slept = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('a batch of ops', () => {
  it('lands every op in order and answers the new tag in its header and its body', async () => {
    const res = await post([
      addAsset(asset(1)),
      addTx(deposit(10)),
      addTx(buy(11, 1, '2026-03-02', 1000, 10)),
    ]);
    expect(answer(res)).toEqual([200, { etag: '"1"', results: [{}, {}, {}] }]);
    expect(res.headers.etag).toBe('"1"');
    const s = await state();
    expect(s.assets).toEqual([asset(1)]);
    expect(s.transactions).toEqual([deposit(10), buy(11, 1, '2026-03-02', 1000, 10)]);
  });

  it('lands whole or not at all: a key the second op breaks leaves the first unwritten', async () => {
    const res = await post([addAsset(asset(1)), addTx(deposit(10)), addAsset(asset(1))]);
    expect(answer(res)).toEqual([409, { error: 'duplicate_id', index: 2 }]);
    expect([
      await live('asset'),
      await live('transaction'),
      await version(),
      await keyRows(),
    ]).toEqual([0, 0, '0', 0]);
  });

  it('refuses a row the store would refuse at its field, before any op runs', async () => {
    expect(answer(await post([addTx(deposit(10)), addAsset(asset(1, { code: 'ABC' }))]))).toEqual([
      422,
      { error: 'invalid_op', index: 1, issues: [{ field: 'code', code: 'invalid' }] },
    ]);
    expect([await live('transaction'), await version(), await keyRows()]).toEqual([0, '0', 0]);
  });

  // The text type refuses a NUL the row schemas take: the store's refusal, answered as the op's own.
  it('answers a value the store refuses as the op’s own, and lands nothing', async () => {
    expect(
      answer(await post([addTx(deposit(10)), addAsset(asset(1, { name: 'RE\u0000IT' }))])),
    ).toEqual([422, { error: 'invalid_op', index: 1, issues: [{ code: 'invalid' }] }]);
    expect([await live('transaction'), await version(), await keyRows()]).toEqual([0, '0', 0]);
  });

  it('names the index of the op that failed', async () => {
    const res = await post([
      addTx(deposit(1)),
      addTx(deposit(2)),
      addTx({ ...deposit(3), date: '2026-02-30' }),
    ]);
    expect(answer(res)).toEqual([
      422,
      { error: 'invalid_op', index: 2, issues: [{ field: 'date', code: 'expected-date' }] },
    ]);
  });

  // JSON:API Atomic, Spanner and Datastore apply a batch in order; two ops on one entity are then
  // defined by that order.
  it('lets two ops touch one day, the second seeing the first', async () => {
    await OK([
      addAsset(asset(1)),
      addTx(deposit(10)),
      addTx(buy(11, 1, '2026-03-02', 1000, 10)),
      addTx(buy(12, 1, '2026-03-08', 1000, 10)),
    ]);
    const res = await OK([
      put('2026-03-05', { [u(1)]: 1234.5 }),
      { op: 'snapshot.move', from: '2026-03-05', to: '2026-03-10' },
    ]);
    expect(res.results).toEqual([{ dropped: [] }, { dropped: [] }]);
    expect(quotesOf(await state()).map(({ date, quotes }) => ({ date, quotes }))).toEqual([
      { date: '2026-03-10', quotes: { [u(1)]: 1234.5 } },
    ]);
  });

  it('lets a later op land in the dataset an earlier clear began', async () => {
    await OK([addAsset(asset(1))]);
    const old = (
      await db.query<{ id: string }>(
        'SELECT dataset_id::text AS id FROM app_user WHERE user_id = $1',
        [SUB],
      )
    ).rows[0].id;
    await OK([addAsset(asset(2)), { op: 'dataset.clear' }, addAsset(asset(3))]);
    expect((await state()).assets.map((a) => a.id)).toEqual([u(3)]);
    const kept = await db.query<{ id: string }>(
      'SELECT id::text FROM asset WHERE dataset_id = $1 ORDER BY id',
      [old],
    );
    expect(kept.rows.map((r) => r.id)).toEqual([u(1), u(2)]);
  });

  it('lands a new asset and the transaction naming it together, or neither', async () => {
    await OK([addAsset(asset(1)), addTx(deposit(10))]);
    // Refused while the batch runs, after the asset was written.
    const twice = await post([
      addAsset(asset(2)),
      addTx({ ...buy(10, 2, '2026-03-02', 1000, 10) }),
    ]);
    expect(answer(twice)).toEqual([409, { error: 'duplicate_id', index: 1 }]);
    // Refused before anything runs.
    const noCount: Partial<Transaction> = buy(11, 3, '2026-03-02', 1000, 10);
    delete noCount.quantity;
    const counted = await post([addAsset(asset(3)), addTx(noCount as Transaction)]);
    expect(answer(counted)).toEqual([
      422,
      {
        error: 'invalid_op',
        index: 1,
        issues: [{ field: 'quantity', code: 'units-missing-on-position-row' }],
      },
    ]);
    expect((await state()).assets.map((a) => a.id)).toEqual([u(1)]);
  });

  it('refuses a patch that leaves a moving row without its count, sent alone', async () => {
    await OK([addAsset(asset(1)), addTx(deposit(10)), addTx(buy(11, 1, '2026-03-02', 1000, 10))]);
    const res = await post([{ op: 'transaction.patch', id: u(11), patch: { quantity: null } }]);
    expect(answer(res)).toEqual([
      422,
      {
        error: 'invalid_op',
        index: 0,
        issues: [{ field: 'quantity', code: 'units-missing-on-position-row' }],
      },
    ]);
    expect((await state()).transactions[1]).toEqual(buy(11, 1, '2026-03-02', 1000, 10));
  });

  it('merges a patch, null removing a member, and stores the merged row whole', async () => {
    await OK([addAsset(asset(1))]);
    await OK([{ op: 'asset.patch', id: u(1), patch: { name: 'Fund', maturity: '2027-01-01' } }]);
    await OK([{ op: 'asset.patch', id: u(1), patch: { maturity: null } }]);
    await OK([
      addTx(deposit(10)),
      { op: 'transaction.patch', id: u(10), patch: { note: 'top-up' } },
    ]);
    const s = await state();
    expect(s.assets).toEqual([asset(1, { name: 'Fund' })]);
    expect(s.transactions).toEqual([{ ...deposit(10), note: 'top-up' }]);
  });

  it('refuses a patch that changes an id, or names an asset that is not there', async () => {
    await OK([addAsset(asset(1))]);
    expect(answer(await post([{ op: 'asset.patch', id: u(1), patch: { id: u(2) } }]))).toEqual([
      422,
      { error: 'invalid_op', index: 0, issues: [{ field: 'id', code: 'invalid' }] },
    ]);
    expect(answer(await post([{ op: 'asset.patch', id: u(9), patch: { name: 'x' } }]))).toEqual([
      422,
      {
        error: 'invalid_op',
        index: 0,
        issues: [{ field: 'id', code: 'unknown-asset-id', value: u(9) }],
      },
    ]);
  });

  it('deletes exactly one transaction, and none of a staged generation’s', async () => {
    await OK([addAsset(asset(1)), addTx(deposit(10)), addTx(buy(11, 1, '2026-03-02', 1000, 10))]);
    await db.query('INSERT INTO dataset (user_id, id, created_at) VALUES ($1, $2, now())', [
      SUB,
      STAGED,
    ]);
    await db.query('UPDATE app_user SET import_dataset_id = $2 WHERE user_id = $1', [SUB, STAGED]);
    await writeLedger(db, SUB, { assets: [], transactions: [deposit(11)], userPrices: [] }, STAGED);
    await OK([{ op: 'transaction.delete', id: u(11) }]);
    expect(await live('transaction')).toBe(1);
    const staged = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM transaction WHERE dataset_id = $1',
      [STAGED],
    );
    expect(staged.rows[0].n).toBe(1);
  });

  // AIP-135: a delete of what is not there is NOT_FOUND; a retried delete replays instead.
  it('refuses deleting a transaction or a day that is not there', async () => {
    expect(answer(await post([{ op: 'transaction.delete', id: u(1) }]))).toEqual([
      422,
      { error: 'invalid_op', index: 0, issues: [{ field: 'id', code: 'invalid', value: u(1) }] },
    ]);
    expect(answer(await post([{ op: 'snapshot.delete', date: '2026-03-05' }]))).toEqual([
      422,
      {
        error: 'invalid_op',
        index: 0,
        issues: [{ field: 'date', code: 'invalid', value: '2026-03-05' }],
      },
    ]);
  });

  it('refuses an id the dataset already holds', async () => {
    await OK([addAsset(asset(1))]);
    expect(answer(await post([addTx(deposit(10)), addAsset(asset(1))]))).toEqual([
      409,
      { error: 'duplicate_id', index: 1 },
    ]);
  });

  it('refuses an id that is no UUID, and a deposit that names an asset', async () => {
    expect(answer(await post([addAsset({ ...asset(1), id: 'reit' })]))).toEqual([
      422,
      { error: 'invalid_op', index: 0, issues: [{ field: 'id', code: 'invalid', value: 'reit' }] },
    ]);
    await OK([addAsset(asset(1))]);
    expect(answer(await post([addTx({ ...deposit(10), assetId: u(1) })]))).toEqual([
      422,
      {
        error: 'invalid_op',
        index: 0,
        issues: [{ field: 'assetId', code: 'invalid', value: u(1) }],
      },
    ]);
  });

  it('accepts no account op, or any op it does not name', async () => {
    expect(answer(await post([{ op: 'account.delete', id: u(1) }]))).toEqual([
      422,
      { error: 'invalid_op', index: 0, issues: [{ field: 'op', code: 'invalid' }] },
    ]);
  });
});

describe('snapshots stored as prices', () => {
  beforeEach(async () => {
    await OK([
      addAsset(asset(1)),
      addAsset(asset(2, { name: 'Energy', code: 'EN', colorKey: 'energy' })),
      addTx(deposit(10)),
      addTx(buy(11, 1, '2026-03-02', 1000, 10)),
      addTx(buy(12, 2, '2026-03-02', 2000, 16.1486)),
      addTx(sell(13, 1, '2026-03-08', 1100, 10)),
    ]);
  });

  it('drops and names a quote of a position held none of that day, and stores none for it', async () => {
    const res = await OK([put('2026-03-10', { [u(1)]: 500, [u(2)]: 2017.33 })]);
    expect(res.results).toEqual([{ dropped: [u(1)] }]);
    const { rows } = await db.query<{ id: string }>('SELECT asset_id::text AS id FROM user_price');
    expect(rows.map((r) => r.id)).toEqual([u(2)]);
    expect(quotesOf(await state())).toEqual([
      { date: '2026-03-10', quotes: { [u(2)]: 2017.33 }, savedAt: expect.any(String) },
    ]);
  });

  it('gives back the quotes it was given, and the witness time it was told', async () => {
    await OK([put('2026-03-05', { [u(1)]: 100.01, [u(2)]: 2017.33 }, '2026-03-05T18:00:00')]);
    expect(quotesOf(await state())).toEqual([
      {
        date: '2026-03-05',
        quotes: { [u(1)]: 100.01, [u(2)]: 2017.33 },
        savedAt: '2026-03-05T18:00:00',
      },
    ]);
  });

  it('replaces the day it puts', async () => {
    await OK([put('2026-03-05', { [u(1)]: 100, [u(2)]: 2000 })]);
    await OK([put('2026-03-05', { [u(2)]: 2100 })]);
    expect(quotesOf(await state()).map((s) => s.quotes)).toEqual([{ [u(2)]: 2100 }]);
  });

  it('refuses a quote of an asset the dataset does not hold', async () => {
    expect(answer(await post([put('2026-03-05', { [u(9)]: 10 })]))).toEqual([
      422,
      {
        error: 'invalid_op',
        index: 0,
        issues: [{ field: `quotes.${u(9)}`, code: 'unknown-quote-asset', value: u(9) }],
      },
    ]);
  });

  it('refuses moving a day onto a stored one, or a day with nothing stored', async () => {
    await OK([put('2026-03-05', { [u(2)]: 2000 }), put('2026-03-06', { [u(2)]: 2001 })]);
    const move = (from: string, to: string) => ({ op: 'snapshot.move', from, to });
    expect(answer(await post([move('2026-03-05', '2026-03-06')]))).toEqual([
      422,
      {
        error: 'invalid_op',
        index: 0,
        issues: [{ field: 'to', code: 'duplicate-key', value: '2026-03-06' }],
      },
    ]);
    expect(answer(await post([move('2026-03-04', '2026-03-07')]))).toEqual([
      422,
      {
        error: 'invalid_op',
        index: 0,
        issues: [{ field: 'from', code: 'invalid', value: '2026-03-04' }],
      },
    ]);
  });

  // A price on a day that values nothing is exported as stored, so the client sees what refuses the move.
  it('refuses moving onto a stored day that values nothing, which the export shows', async () => {
    await OK([put('2026-03-07', { [u(1)]: 1100 }), put('2026-03-05', { [u(2)]: 2100 })]);
    // The sale moves before the 7th, so that day values nothing.
    await OK([{ op: 'transaction.patch', id: u(13), patch: { date: '2026-03-06' } }]);
    expect((await state()).prices.map((p) => [p.asOf, p.assetId])).toEqual([
      ['2026-03-05', u(2)],
      ['2026-03-07', u(1)],
    ]);
    expect(
      answer(await post([{ op: 'snapshot.move', from: '2026-03-05', to: '2026-03-07' }])),
    ).toEqual([
      422,
      {
        error: 'invalid_op',
        index: 0,
        issues: [{ field: 'to', code: 'duplicate-key', value: '2026-03-07' }],
      },
    ]);
    const { rows } = await db.query<{ id: string }>(
      `SELECT asset_id::text AS id FROM user_price WHERE as_of = '2026-03-07'`,
    );
    expect(rows.map((r) => r.id)).toEqual([u(1)]);
  });

  it('deletes a stored day', async () => {
    await OK([put('2026-03-05', { [u(2)]: 2000 }), { op: 'snapshot.delete', date: '2026-03-05' }]);
    expect((await state()).prices).toEqual([]);
  });
});

describe('the bounds', () => {
  it('refuses more ops than the bound, naming it, and takes exactly the bound', async () => {
    const deposits = (n: number) => Array.from({ length: n }, (_, i) => addTx(deposit(i + 1)));
    expect(answer(await post(deposits(MAX_OPS + 1)))).toEqual([
      400,
      { error: 'too_many_ops', max: MAX_OPS },
    ]);
    await OK(deposits(MAX_OPS));
    expect(await live('transaction')).toBe(MAX_OPS);
  });

  it('refuses a body past the bound, naming it, however it was encoded', async () => {
    const big = JSON.stringify({
      ops: [addTx({ ...deposit(1), note: 'x' })],
      pad: 'x'.repeat(MAX_BODY_BYTES),
    });
    for (const base64 of [false, true]) {
      expect(answer(await post(undefined, { body: big, base64 }))).toEqual([
        413,
        { error: 'payload_too_large', max: MAX_BODY_BYTES },
      ]);
    }
  });

  it('refuses a body that is not one list of ops', async () => {
    for (const body of [
      'not json',
      '[]',
      '{"ops":[]}',
      '{"ops":{}}',
      JSON.stringify({ ops: [addTx(deposit(1))], extra: 1 }),
      `{"ops":[{"op":"dataset.clear","__proto__":{}}]}`,
    ]) {
      expect([body, answer(await post(undefined, { body }))]).toEqual([
        body,
        [400, { error: 'invalid_request' }],
      ]);
    }
  });

  it('refuses a missing or malformed key before anything is claimed', async () => {
    for (const key of [null, 'abc', `"${randomUUID()}"`]) {
      expect(answer(await post([{ op: 'dataset.clear' }], { key }))).toEqual([
        400,
        { error: 'invalid_idempotency_key' },
      ]);
    }
    expect(await keyRows()).toBe(0);
  });

  it('refuses a request with no precondition, or with *, as one that needs one', async () => {
    for (const ifMatch of [null, '*', '"0", *']) {
      expect(answer(await post([{ op: 'dataset.clear' }], { ifMatch }))).toEqual([
        428,
        { error: 'precondition_required' },
      ]);
    }
    expect([await keyRows(), await version()]).toEqual([0, '0']);
  });

  it('refuses more mutated rows than the bound, naming the op and the count', async () => {
    const res = await post([addTx(deposit(1)), addTx(deposit(2)), addTx(deposit(3))], {
      d: deps({ maxRows: 2 }),
    });
    expect(answer(res)).toEqual([409, { error: 'too_many_rows', index: 2, count: 3, max: 2 }]);
    expect(await live('transaction')).toBe(0);
  });

  it('holds a request to fewer rows than one transaction may mutate', () => {
    expect(MAX_ROWS).toBe(2500);
  });

  // The cluster's own refusal of a transaction past its row ceiling.
  it('answers the cluster’s row ceiling as the same refusal', async () => {
    const { client } = watching();
    const ceiling: SqlClient = {
      query: (text, values) =>
        text.includes('INSERT INTO "transaction"')
          ? Promise.reject(
              Object.assign(new Error('transaction row limit exceeded'), { code: '54000' }),
            )
          : client.query(text, values),
    };
    const res = await post([addTx(deposit(1))], { d: deps({ user: ceiling }) });
    expect(answer(res)).toEqual([409, { error: 'too_many_rows', index: 0, max: MAX_ROWS }]);
    expect(await keyRows()).toBe(0);
  });
});

describe('deleting an asset larger than one request', () => {
  // A deposit, six buys and six prices: twelve children.
  beforeEach(async () => {
    const buys = Array.from({ length: 6 }, (_, i) =>
      addTx(buy(11 + i, 1, `2026-03-0${i + 2}`, 1000, 10)),
    );
    const prices = Array.from({ length: 6 }, (_, i) =>
      put(`2026-03-0${i + 2}`, { [u(1)]: 1000 * (i + 1) }),
    );
    await OK([addAsset(asset(1)), addTx(deposit(10)), ...buys, ...prices]);
  });

  const valid = async () => {
    const s = await state();
    const text = JSON.stringify(
      buildBackup(s.assets, s.prices, s.transactions, undefined, 'live', '2026-10-09T10:00:00', 2),
    );
    expect(parseBackup(text).ok).toBe(true);
  };

  it('is refused with the rows it needs, then emptied step by step, each step a valid dataset', async () => {
    const d = deps({ maxRows: 5 });
    expect(answer(await post([{ op: 'asset.delete', id: u(1) }], { d }))).toEqual([
      409,
      { error: 'too_many_rows', index: 0, count: 13, max: 5 },
    ]);
    await valid();
    for (const remaining of [7, 2, 0]) {
      const res = await OK([{ op: 'asset.prune', id: u(1) }], { d });
      expect(res.results).toEqual([{ remaining }]);
      await valid();
    }
    await OK([{ op: 'asset.delete', id: u(1) }], { d });
    await valid();
    const s = await state();
    expect([s.assets, s.transactions, s.prices]).toEqual([[], [deposit(10)], []]);
  });

  it('clears a dataset larger than the bound in one request', async () => {
    await OK([{ op: 'dataset.clear' }], { d: deps({ maxRows: 5 }) });
    expect(await state()).toEqual({ assets: [], transactions: [], prices: [] });
  });
});

describe('the precondition', () => {
  it('refuses a stale tag 412 and changes nothing', async () => {
    await OK([addTx(deposit(1))]);
    const res = await post([addTx(deposit(2)), { op: 'dataset.clear' }], { ifMatch: '"0"' });
    expect(answer(res)).toEqual([412, { error: 'precondition_failed' }]);
    expect([await live('transaction'), await version(), await keyRows()]).toEqual([1, '1', 1]);
  });

  it('passes a list that holds the current tag anywhere', async () => {
    await OK([addTx(deposit(1))], { ifMatch: '"7", "0"' });
  });

  it('takes the tag /view’s body carries, and answers the next one', async () => {
    const viewDeps: ViewDeps = {
      user: db as unknown as SqlClient,
      archive: () => Promise.reject(new Error('no linked asset, no archive')),
      rate: { served: async () => undefined },
      now: () => Date.parse('2026-07-28T09:00:00Z'),
      derivationId: 'derivation-a',
    };
    const viewEvent: ApiEvent = { routeKey: 'GET /view', headers: {}, requestContext: caller() };
    const read = (await view(viewDeps, viewEvent)) as ApiResult;
    const { etag } = JSON.parse(read.body) as { etag: string };
    const written = await OK([addTx(deposit(1))], { ifMatch: etag });
    expect(written.etag).toBe('"1"');
    expect(answer(await post([addTx(deposit(2))], { ifMatch: etag }))[0]).toBe(412);
  });

  it('moves a version past 2^53 as text', async () => {
    await db.query('UPDATE app_user SET data_version = 9007199254740993 WHERE user_id = $1', [SUB]);
    expect((await OK([addTx(deposit(1))], { ifMatch: '"9007199254740993"' })).etag).toBe(
      '"9007199254740994"',
    );
  });
});

describe('the idempotency key', () => {
  it('replays a completed request rather than applying it twice', async () => {
    const key = randomUUID();
    const first = await post([addTx(deposit(1))], { key, ifMatch: '"0"' });
    const again = await post([addTx(deposit(1))], { key, ifMatch: '"0"' });
    expect(again.statusCode).toBe(200);
    expect([again.body, again.headers.etag]).toEqual([first.body, first.headers.etag]);
    expect([await live('transaction'), await version()]).toEqual([1, '1']);
  });

  it('is resolved before the precondition, so a replay of the caller’s own request succeeds', async () => {
    const key = randomUUID();
    await OK([addTx(deposit(1))], { key });
    // The tag the first request sent is stale now.
    expect((await post([addTx(deposit(1))], { key, ifMatch: '"0"' })).statusCode).toBe(200);
  });

  it('replays a body sent with its keys in another order and other spacing', async () => {
    const key = randomUUID();
    await OK([addTx(deposit(1))], { key });
    const reordered = `{ "ops" : [ { "transaction": ${JSON.stringify(
      Object.fromEntries(Object.entries(deposit(1)).reverse()),
    )}, "op": "transaction.add" } ] }`;
    expect((await post(undefined, { key, body: reordered, ifMatch: '"0"' })).statusCode).toBe(200);
    expect(await live('transaction')).toBe(1);
  });

  it('refuses the same key with another body', async () => {
    const key = randomUUID();
    await OK([addTx(deposit(1))], { key });
    expect(answer(await post([addTx(deposit(2))], { key }))).toEqual([
      422,
      { error: 'key_reused' },
    ]);
  });

  it('refuses a key whose first request is still running, distinguishably', async () => {
    const key = randomUUID();
    const body = { ops: [addTx(deposit(1))] };
    await db.query(
      `INSERT INTO mutation_key (user_id, key, fingerprint, token, claimed_at, in_progress_until, expires_at)
       VALUES ($1, $2, $3, $4, now(), now() + interval '20 seconds', now() + interval '24 hours')`,
      [SUB, key, fingerprintOf(body), randomUUID()],
    );
    expect(answer(await post(body.ops, { key }))).toEqual([409, { error: 'request_in_flight' }]);
    expect(await live('transaction')).toBe(0);
  });

  it('takes over a claim abandoned past its window, and applies', async () => {
    const key = randomUUID();
    const body = { ops: [addTx(deposit(1))] };
    await db.query(
      `INSERT INTO mutation_key (user_id, key, fingerprint, token, claimed_at, in_progress_until, expires_at)
       VALUES ($1, $2, $3, $4, now() - interval '1 minute', now() - interval '40 seconds',
               now() + interval '23 hours')`,
      [SUB, key, fingerprintOf(body), randomUUID()],
    );
    await OK(body.ops, { key });
    expect(await live('transaction')).toBe(1);
  });

  it('loses a takeover to another request that took the claim first', async () => {
    const key = randomUUID();
    const body = { ops: [addTx(deposit(1))] };
    await db.query(
      `INSERT INTO mutation_key (user_id, key, fingerprint, token, claimed_at, in_progress_until, expires_at)
       VALUES ($1, $2, $3, $4, now() - interval '1 minute', now() - interval '40 seconds',
               now() + interval '23 hours')`,
      [SUB, key, fingerprintOf(body), randomUUID()],
    );
    // Between this request's read of the claim and its takeover, another one takes it.
    const racing: SqlClient = {
      query: async (text, values) => {
        if (text.includes('UPDATE mutation_key SET fingerprint')) {
          await db.query('UPDATE mutation_key SET token = $1 WHERE key = $2', [randomUUID(), key]);
        }
        return db.query(text, values) as never;
      },
    };
    expect(answer(await post(body.ops, { key, d: deps({ user: racing }) }))).toEqual([
      409,
      { error: 'request_in_flight' },
    ]);
  });

  it('applies a key past its lifetime as a new request', async () => {
    const key = randomUUID();
    await db.query(
      `INSERT INTO mutation_key (user_id, key, fingerprint, token, claimed_at, in_progress_until, expires_at,
                                 response_status, response_body)
       VALUES ($1, $2, $3, $4, now() - interval '2 days', now() - interval '2 days' + interval '20 seconds',
               now() - interval '1 day', 200, '{"etag":"\\"9\\"","results":[]}')`,
      [SUB, key, 'f'.repeat(64), randomUUID()],
    );
    await OK([addTx(deposit(1))], { key });
    expect(await live('transaction')).toBe(1);
  });

  it('stores only a success: a refusal releases the key for a corrected request', async () => {
    const key = randomUUID();
    expect((await post([addAsset(asset(1, { code: 'ABC' }))], { key })).statusCode).toBe(422);
    expect(await keyRows()).toBe(0);
    await OK([addAsset(asset(1))], { key });
  });

  it('holds a claim for the function’s timeout and five seconds, and the key for a day', async () => {
    await OK([addTx(deposit(1))]);
    const { rows } = await db.query<{ live: number; kept: number }>(
      `SELECT extract(epoch FROM in_progress_until - claimed_at)::int AS live,
              extract(epoch FROM expires_at - claimed_at)::int AS kept FROM mutation_key`,
    );
    expect(rows).toEqual([{ live: CLAIM_WINDOW_SECONDS, kept: 24 * 60 * 60 }]);
  });

  it('fingerprints the route and the decoded body, keys in order and no whitespace', () => {
    const body = { ops: [{ op: 'dataset.clear' }] };
    expect(canonical([MUTATIONS_ROUTE, body])).toBe(
      '["POST /mutations",{"ops":[{"op":"dataset.clear"}]}]',
    );
    expect(fingerprintOf(body)).toBe(
      createHash('sha256')
        .update(canonical([MUTATIONS_ROUTE, body]), 'utf8')
        .digest('hex'),
    );
  });
});

describe('a serialization failure', () => {
  it('is retried, and the batch applies once', async () => {
    const { client, sent } = refusingCommit(db, '40001', { after: /SET response_status/ });
    await OK([addTx(deposit(1))], { d: deps({ user: client }) });
    expect(slept).toEqual([20]);
    expect([await live('transaction'), await version()]).toEqual([1, '1']);
    expect(sent.filter((s) => s === 'BEGIN')).toHaveLength(3);
  });

  it('is retried as XX000 too', async () => {
    const { client } = refusingCommit(db, 'XX000', { after: /SET response_status/ });
    await OK([addTx(deposit(1))], { d: deps({ user: client }) });
    expect(slept).toEqual([20]);
  });

  it('never retries a stale precondition', async () => {
    await OK([addTx(deposit(1))]);
    const { client, sent } = watching();
    expect(
      (await post([addTx(deposit(2))], { ifMatch: '"0"', d: deps({ user: client }) })).statusCode,
    ).toBe(412);
    expect(slept).toEqual([]);
    expect(sent.filter((s) => s === 'BEGIN')).toHaveLength(2);
  });

  it('answers a commit that landed under the error from what it stored, not by applying again', async () => {
    const { client, sent } = refusingCommit(db, '40001', {
      after: /SET response_status/,
      lands: true,
    });
    const res = await post([addTx(deposit(1))], { d: deps({ user: client }) });
    expect(answer(res)).toEqual([200, { etag: '"1"', results: [{}] }]);
    expect([await live('transaction'), await version()]).toEqual([1, '1']);
    expect(sent.filter((s) => s === 'BEGIN')).toHaveLength(2);
    expect(slept).toEqual([]);
  });

  it('gives up after the last delay, answering 500 and releasing the key', async () => {
    // Every apply's COMMIT is refused; the claim's goes through.
    let armed = false;
    const always: SqlClient = {
      query: async (text, values) => {
        if (text === 'COMMIT' && armed) {
          armed = false;
          await db.query('ROLLBACK');
          throw conflict('40001');
        }
        if (text.includes('SET response_status')) armed = true;
        return db.query(text, values) as never;
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post([addTx(deposit(1))], { d: deps({ user: always }) });
    expect(answer(res)).toEqual([500, { error: 'internal' }]);
    expect(slept).toEqual([20, 80, 200]);
    expect([await live('transaction'), await keyRows()]).toEqual([0, 0]);
  });

  it('holds a claim whose last commit landed under the error, and applies under it', async () => {
    let commits = 0;
    let armed = false;
    const late: SqlClient = {
      query: async (text, values) => {
        if (text === 'COMMIT' && armed) {
          armed = false;
          commits += 1;
          await db.query(commits < 4 ? 'ROLLBACK' : 'COMMIT');
          throw conflict('40001');
        }
        if (text.startsWith('INSERT INTO mutation_key')) armed = true;
        return db.query(text, values) as never;
      },
    };
    const res = await post([addTx(deposit(1))], { d: deps({ user: late }) });
    expect(answer(res)).toEqual([200, { etag: '"1"', results: [{}] }]);
    expect(slept).toEqual([20, 80, 200]);
    expect([await live('transaction'), await version()]).toEqual([1, '1']);
  });

  // A claim refused before it landed is simply tried again; a read that fails meanwhile is one
  // more serialization failure, not the end of the request.
  it('retries a refused claim even when a read fails between attempts', async () => {
    let armed = false;
    let failNextRead = false;
    const flaky: SqlClient = {
      query: async (text, values) => {
        if (text === 'COMMIT' && armed) {
          armed = false;
          failNextRead = true;
          await db.query('ROLLBACK');
          throw conflict('40001');
        }
        if (text.startsWith('INSERT INTO mutation_key') && slept.length === 0) armed = true;
        if (text.startsWith('SELECT k.fingerprint') && failNextRead) {
          failNextRead = false;
          throw conflict('XX000');
        }
        return db.query(text, values) as never;
      },
    };
    const res = await post([addTx(deposit(1))], { d: deps({ user: flaky }) });
    expect(answer(res)).toEqual([200, { etag: '"1"', results: [{}] }]);
    expect([await live('transaction'), await version()]).toEqual([1, '1']);
  });

  it('releases a claim that landed on the last attempt when the read after it fails', async () => {
    let commits = 0;
    let armed = false;
    let failNextRead = false;
    const late: SqlClient = {
      query: async (text, values) => {
        if (text === 'COMMIT' && armed) {
          armed = false;
          commits += 1;
          await db.query(commits < 4 ? 'ROLLBACK' : 'COMMIT');
          if (commits === 4) failNextRead = true;
          throw conflict('40001');
        }
        if (text.startsWith('INSERT INTO mutation_key')) armed = true;
        if (text.startsWith('SELECT k.fingerprint') && failNextRead) {
          failNextRead = false;
          throw conflict('XX000');
        }
        return db.query(text, values) as never;
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post([addTx(deposit(1))], { d: deps({ user: late }) });
    expect(answer(res)).toEqual([500, { error: 'internal' }]);
    expect([await live('transaction'), await keyRows()]).toEqual([0, 0]);
  });

  it('releases the key when the read after a failure fails too', async () => {
    let armed = false;
    let failNextRead = false;
    const broken: SqlClient = {
      query: async (text, values) => {
        if (text === 'COMMIT' && armed) {
          armed = false;
          failNextRead = true;
          await db.query('ROLLBACK');
          throw conflict('40001');
        }
        if (text.includes('SET response_status')) armed = true;
        // The read after the apply's refused commit fails.
        if (text.startsWith('SELECT k.fingerprint') && failNextRead) {
          failNextRead = false;
          throw conflict('XX000');
        }
        return db.query(text, values) as never;
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post([addTx(deposit(1))], { d: deps({ user: broken }) });
    expect(answer(res)).toEqual([500, { error: 'internal' }]);
    expect([await live('transaction'), await keyRows()]).toEqual([0, 0]);
  });

  it('answers the last attempt’s commit that landed under the error from what it stored', async () => {
    // Three refused without landing, the fourth landed and still answered 40001.
    let commits = 0;
    let armed = false;
    const late: SqlClient = {
      query: async (text, values) => {
        if (text === 'COMMIT' && armed) {
          armed = false;
          commits += 1;
          await db.query(commits < 4 ? 'ROLLBACK' : 'COMMIT');
          throw conflict('40001');
        }
        if (text.includes('SET response_status')) armed = true;
        return db.query(text, values) as never;
      },
    };
    const res = await post([addTx(deposit(1))], { d: deps({ user: late }) });
    expect(answer(res)).toEqual([200, { etag: '"1"', results: [{}] }]);
    expect(slept).toEqual([20, 80, 200]);
    expect([await live('transaction'), await version()]).toEqual([1, '1']);
  });
});

describe('expired keys', () => {
  const aged = (user: string, key = randomUUID()) =>
    db.query(
      `INSERT INTO mutation_key (user_id, key, fingerprint, token, claimed_at, in_progress_until, expires_at,
                                 response_status, response_body)
       VALUES ($1, $2, $3, $4, now() - interval '2 days', now() - interval '2 days' + interval '20 seconds',
               now() - interval '1 day', 200, '{}')`,
      [user, key, 'f'.repeat(64), randomUUID()],
    );

  it('are removed by a later mutation, with no schedule, and another user’s stay', async () => {
    await insertUser(db, TWIN, TWIN_EMAIL);
    await aged(SUB);
    await aged(TWIN);
    await OK([addTx(deposit(1))]);
    const { rows } = await db.query<{ user_id: string; n: number }>(
      `SELECT user_id::text, count(*)::int AS n FROM mutation_key GROUP BY user_id ORDER BY user_id`,
    );
    // The caller's aged key is gone and this request's is kept.
    expect(rows).toEqual([
      { user_id: SUB, n: 1 },
      { user_id: TWIN, n: 1 },
    ]);
  });

  it('are removed a hundred at a time', async () => {
    for (let i = 0; i < 150; i += 1) await aged(SUB);
    await OK([addTx(deposit(1))]);
    expect(await keyRows()).toBe(50 + 1);
  });

  it('cost the answer nothing when the sweep fails', async () => {
    const failing: SqlClient = {
      query: (text, values) =>
        text.startsWith('DELETE FROM mutation_key WHERE (user_id, key)')
          ? Promise.reject(new Error('sweep refused'))
          : (db.query(text, values) as never),
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await OK([addTx(deposit(1))], { d: deps({ user: failing }) });
    expect(logged).toHaveBeenCalled();
  });
});

describe('GET /state', () => {
  // Every field a row can carry and each of the eight types.
  const BOND = asset(2, {
    name: 'OVDP',
    code: 'GB',
    colorKey: 'ovdp6475',
    yieldType: 'fixed_coupon',
    payoutSchedule: 'semiannual',
    expectedPct: 16.4,
    targetPct: 0,
    maturity: '2027-02-25',
    couponRatePct: 16.25,
    couponAmount: 81.25,
    nextCoupon: '2027-02-25',
    inzhur: { kind: 'bond', ref: 'UA4000238976' },
    createdAt: '2026-03-03T10:00:00',
  });
  const LEDGER: Transaction[] = [
    deposit(10),
    { ...buy(11, 1, '2026-03-02', 1000, 10), unitPrice: 100, note: 'перша' },
    buy(12, 2, '2026-03-03', 10_576.7, 10),
    {
      id: u(13),
      date: '2026-03-20',
      type: 'dividend_accrual',
      assetId: u(1),
      amount: 50,
      taxWithheld: 9.5,
    },
    { id: u(14), date: '2026-03-21', type: 'interest_payout', assetId: u(2), amount: 40 },
    { id: u(15), date: '2026-03-21', type: 'reinvest', assetId: u(1), amount: 40, quantity: 0.4 },
    {
      id: u(16),
      date: '2026-03-22',
      type: 'redemption',
      assetId: u(2),
      amount: 1000.01,
      quantity: 1,
    },
    sell(17, 1, '2026-03-23', 110, 1),
    { id: u(18), date: '2026-03-24', type: 'withdrawal', assetId: '', amount: 500 },
  ];
  const SNAPSHOTS: Snapshot[] = [
    {
      date: '2026-03-05',
      quotes: { [u(1)]: 1020.5, [u(2)]: 10_600.11 },
      savedAt: '2026-03-05T18:00:00',
    },
    { date: '2026-03-25', quotes: { [u(1)]: 950.37, [u(2)]: 9_600 } },
  ];

  const write = async () => {
    await OK([addAsset(asset(1)), addAsset(BOND), ...LEDGER.map(addTx)]);
    await OK(SNAPSHOTS.map((s) => put(s.date, s.quotes, s.savedAt)));
  };

  it('answers the live dataset in the model’s shape, each stored price a row', async () => {
    await write();
    const s = await state();
    expect(Object.keys(s)).toEqual(['assets', 'transactions', 'prices']);
    expect(s.assets).toEqual([asset(1), BOND]);
    expect(s.transactions).toEqual(LEDGER);
    // By day, then asset; each over the units held that day: 10 and 10, then 9.4 and 9.
    expect(s.prices).toEqual([
      { assetId: u(1), asOf: '2026-03-05', price: 1020.5 / 10, observedAt: '2026-03-05T18:00:00' },
      {
        assetId: u(2),
        asOf: '2026-03-05',
        price: 10_600.11 / 10,
        observedAt: '2026-03-05T18:00:00',
      },
      { assetId: u(1), asOf: '2026-03-25', price: 950.37 / 9.4, observedAt: expect.any(String) },
      { assetId: u(2), asOf: '2026-03-25', price: 9_600 / 9, observedAt: expect.any(String) },
    ]);
  });

  // Absent is core's only spelling of none.
  it('leaves out a witness time the store never recorded', async () => {
    await write();
    await db.query(`UPDATE user_price SET observed_at = NULL WHERE as_of = '2026-03-25'`);
    const { prices } = await state();
    expect(prices.map((p) => Object.hasOwn(p, 'observedAt'))).toEqual([true, true, false, false]);
  });

  it('exports what the backup importer takes, and what the ops write back as the same dataset', async () => {
    await write();
    const first = await state();
    const text = JSON.stringify(
      buildBackup(
        first.assets,
        first.prices,
        first.transactions,
        undefined,
        'live',
        '2026-10-09T10:00:00',
        2,
      ),
    );
    const imported = validateImport(text);
    if (!imported.ok) throw new Error('expected the export to import');
    const { assets, transactions, prices } = imported.envelope;
    expect({ assets, transactions, prices }).toEqual(first);
    await OK([
      { op: 'dataset.clear' },
      ...assets.map(addAsset),
      ...transactions.map(addTx),
      ...quotesOf({ transactions, prices }).map((s) => put(s.date, s.quotes, s.savedAt)),
    ]);
    expect(await state()).toEqual(first);
  });

  // Three prices no ₴ quote carries, each exported as stored: `/view` carries each on to later held
  // days, so a restore must keep it (*Cloud target*).
  it('exports a price on a day a later edit left its position holding none of', async () => {
    await OK([
      addAsset(asset(1)),
      addTx(deposit(10)),
      addTx(buy(11, 1, '2026-03-02', 1000, 10)),
      put('2026-03-05', { [u(1)]: 1100 }),
    ]);
    await OK([{ op: 'transaction.delete', id: u(11) }]);
    expect((await state()).prices).toEqual([
      { assetId: u(1), asOf: '2026-03-05', price: 110, observedAt: expect.any(String) },
    ]);
    await OK([{ op: 'snapshot.delete', date: '2026-03-05' }]);
    expect((await state()).prices).toEqual([]);
  });

  it('exports a price whose held value rounds below a kopeck', async () => {
    await OK([
      addAsset(asset(1)),
      addTx(deposit(10)),
      addTx(buy(11, 1, '2026-03-02', 1000, 10)),
      put('2026-03-05', { [u(1)]: 0.004 }),
    ]);
    const { prices } = await state();
    expect(prices.map((p) => p.price)).toEqual([0.004 / 10]);
    // The case is real: at the day's 10 units it quotes no kopeck.
    expect(Math.round(10 * prices[0].price * 100) / 100).toBe(0);
  });

  it('exports a price whose day a backdated buy gave other units than it was stored at', async () => {
    await OK([
      addAsset(asset(1)),
      addTx(deposit(10)),
      addTx(buy(11, 1, '2026-03-02', 1000, 10)),
      put('2026-03-05', { [u(1)]: 1000.01 }),
    ]);
    await OK([addTx(buy(12, 1, '2026-03-03', 300, 3))]);
    const { prices } = await state();
    expect(prices.map((p) => p.price)).toEqual([1000.01 / 10]);
    // The case is real: a quote rounded to kopecks at the day's 13 units divides back to another price.
    expect(Math.round(13 * prices[0].price * 100) / 100 / 13).not.toBe(prices[0].price);
  });

  // The deploy smoke-tests the bundle's export against keys it keeps by hand, in a step only the
  // post-merge deploy runs.
  it('answers the keys the deploy smoke test expects', async () => {
    const workflow = readFileSync(
      new URL('../../.github/workflows/deploy-backend.yml', import.meta.url),
      'utf8',
    );
    const pinned = [
      ...workflow.matchAll(/Object\.keys\(JSON\.parse\(ok\.body\)\)\.join\(\) !== '([^']*)'/g),
    ];
    expect(pinned).toHaveLength(1);
    expect(pinned[0][1]).toBe(Object.keys(await state()).join());
  });

  it('answers under the strong tag, kept by no cache', async () => {
    const res = (await get()) as ApiResult;
    expect([res.headers.etag, res.headers['cache-control']]).toEqual(['"0"', 'private, no-store']);
  });

  it('answers 304 to its own tag, and 412 to a stale If-Match', async () => {
    const unchanged = await get({ 'if-none-match': '"0"' });
    expect(unchanged).toEqual({
      statusCode: 304,
      headers: { etag: '"0"', 'cache-control': 'private, no-store' },
    });
    expect(answer(await get({ 'if-match': '"3"' }))).toEqual([
      412,
      { error: 'precondition_failed' },
    ]);
    expect((await get({ 'if-match': '*' })).statusCode).toBe(200);
  });
});

describe('the gate', () => {
  const both = async (expected: string) => {
    const mutated = await post([addTx(deposit(1))], { ifMatch: '"0"' });
    const read = (await get()) as ApiResult;
    expect([answer(mutated), answer(read)]).toEqual([
      [403, { error: expected }],
      [403, { error: expected }],
    ]);
  };

  it('tells a pending applicant to wait, on either route', async () => {
    await db.query("UPDATE app_user SET status = 'pending', decided_at = NULL, decided_by = NULL");
    await both('pending');
  });

  it('tells a rejected applicant to stop, on either route', async () => {
    await db.query("UPDATE app_user SET status = 'rejected'");
    await both('rejected');
  });

  it('tells a caller with no row that there is no application, on either route', async () => {
    const mutated = await post([addTx(deposit(1))], {
      ifMatch: '"0"',
      sub: TWIN,
      email: TWIN_EMAIL,
    });
    const read = await get({}, TWIN, TWIN_EMAIL);
    expect([answer(mutated)[1], answer(read)[1]]).toEqual([
      { error: 'no_application' },
      { error: 'no_application' },
    ]);
  });

  it('refuses the demo as a non-caller, on either route', async () => {
    await insertUser(db, DEMO_USER_ID, DEMO_USER_EMAIL, 'active', 'demo');
    const mutated = await post([addTx(deposit(1))], {
      ifMatch: '"0"',
      sub: TWIN,
      email: DEMO_USER_EMAIL,
    });
    const read = await get({}, TWIN, DEMO_USER_EMAIL);
    expect([answer(mutated)[1], answer(read)[1]]).toEqual([
      { error: 'forbidden' },
      { error: 'forbidden' },
    ]);
  });
});

describe('a failure answers rather than throws', () => {
  const broken: SqlClient = { query: () => Promise.reject(new Error('the cluster went away')) };

  it('answers a failing database with its own 500, on either route', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mutated = await post([addTx(deposit(1))], { ifMatch: '"0"', d: deps({ user: broken }) });
    const read = await get({}, SUB, EMAIL, deps({ user: broken }));
    expect([answer(mutated), answer(read)]).toEqual([
      [500, { error: 'internal' }],
      [500, { error: 'internal' }],
    ]);
  });

  it('answers a connection failure with its own 500, on either route', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const event of [
      await mutationEvent([addTx(deposit(1))], { ifMatch: '"0"' }),
      { routeKey: STATE_ROUTE, headers: {}, requestContext: caller() },
    ]) {
      const res = await rawHandler(event);
      record(event, res);
      expect(answer(res)).toEqual([500, { error: 'internal' }]);
    }
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: 60 });
