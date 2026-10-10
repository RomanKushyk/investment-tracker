// The staged import over PGlite: begin, parts, commit and abort through the routes, the live
// dataset read between them, and the dead generations collected by later writes (*User schema and
// deletes*, #391).
import { createHash, randomUUID } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';
import { MAX_BODY_BYTES } from '@quirenote/core/ops';
import type { Asset, Transaction } from '@quirenote/core/types';
import type { PriceRow } from '@quirenote/core/valuation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ceilingClient, freshDb, refusingCommit } from './__fixtures__/pglite';
import { applyUserSchema, insertUser, writeLedger } from './__fixtures__/user-ledger';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import { connect } from './dsql';
import type { ApiEvent, ApiResult, EmptyResult } from './http';
import {
  ABORT_ROUTE,
  BEGIN_ROUTE,
  COMMIT_ROUTE,
  MAX_PART_ROWS,
  PART_ROUTE,
  RESPONSES,
  imports,
} from './imports';
import { readLedger } from './ledger';
import type { SqlClient } from './migrate';
import {
  MUTATIONS_ROUTE,
  STATE_ROUTE,
  handler as rawHandler,
  mutations as mutationsRoute,
  state as stateRoute,
  type MutationDeps,
} from './mutations';
import { proveRouteContract, recorder } from './route-contract';

vi.mock('./dsql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dsql')>()),
  connect: vi.fn(),
}));

const { observed, record } = recorder(BEGIN_ROUTE);

const SUB = '9f1e2d3c-0000-4000-8000-0000000000d4';
const EMAIL = 'owner@quirenote.com';
const TWIN = '9f1e2d3c-0000-4000-8000-0000000000e5';
const TWIN_EMAIL = 'twin@quirenote.com';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pad = (n: number) => String(n).padStart(2, '0');

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
): Transaction => ({ id: u(n), date, type: 'buy', assetId: u(of), amount, quantity });
const price = (of: number, asOf: string, value: number, observedAt?: string): PriceRow => ({
  assetId: u(of),
  asOf,
  price: value,
  ...(observedAt === undefined ? {} : { observedAt }),
});

type State = { assets: Asset[]; transactions: Transaction[]; prices: PriceRow[] };
type Part = { assets?: Asset[]; transactions?: Transaction[]; prices?: PriceRow[] };

/** What the live dataset holds before an import: a generation of its own to replace. */
const OLD: State = {
  assets: [asset(91, { name: 'Old', createdAt: '2026-01-02T09:00:00' })],
  transactions: [
    deposit(92, '2026-01-01'),
    ...Array.from({ length: 8 }, (_, i) => deposit(100 + i, `2026-01-${pad(10 + i)}`, 10)),
  ],
  prices: Array.from({ length: 4 }, (_, i) => price(91, `2026-01-${pad(20 + i)}`, 5 + i)),
};
const OLD_ROWS = OLD.assets.length + OLD.transactions.length + OLD.prices.length;

/** What an import brings: 63 rows, in the order `GET /state` answers them. */
const NEW: State = {
  assets: [1, 2, 3].map((n) => asset(n, { createdAt: `2026-03-0${n}T09:00:00` })),
  transactions: [
    deposit(10, '2026-03-01', 1_000_000),
    ...Array.from({ length: 19 }, (_, i) =>
      buy(11 + i, 1 + (i % 3), `2026-03-${pad(2 + i)}`, 100, 1),
    ),
  ],
  prices: Array.from({ length: 40 }, (_, i) =>
    price(
      1 + (i % 3),
      `2026-04-${pad(1 + Math.floor(i / 3))}`,
      10 + i / 100,
      '2026-04-20T10:00:00',
    ),
  ),
};

/** Every row in order, assets before the rows naming them, `size` to a part. */
const partsOf = (s: State, size: number): Part[] => {
  const rows = [
    ...s.assets.map((r) => ['assets', r] as const),
    ...s.transactions.map((r) => ['transactions', r] as const),
    ...s.prices.map((r) => ['prices', r] as const),
  ];
  const parts: Part[] = [];
  rows.forEach(([table, row], i) => {
    if (i % size === 0) parts.push({});
    const part = parts[parts.length - 1] as Record<string, unknown[]>;
    (part[table] ??= []).push(row);
  });
  return parts;
};

// A SECOND READING of the digest rules, independent of the module's: SHA-256 of the bytes sent, and
// the manifest's SHA-256 of the parts' raw digests in part order, as S3's checksum of checksums.
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('base64');
const bodyOf = (part: Part) => JSON.stringify(part);
const composite = (parts: Part[]) =>
  sha(Buffer.concat(parts.map((p) => Buffer.from(sha(Buffer.from(bodyOf(p))), 'base64'))));
const manifestOf = (parts: Part[]) => ({
  assets: parts.reduce((n, p) => n + (p.assets?.length ?? 0), 0),
  transactions: parts.reduce((n, p) => n + (p.transactions?.length ?? 0), 0),
  prices: parts.reduce((n, p) => n + (p.prices?.length ?? 0), 0),
  digest: composite(parts),
});

let db: PGlite;

const deps = (over: Partial<MutationDeps> = {}): MutationDeps => ({
  user: db as unknown as SqlClient,
  token: () => randomUUID(),
  sleep: async () => {},
  ...over,
});

const caller = (sub = SUB, email = EMAIL) => ({
  authorizer: { jwt: { claims: { token_use: 'id', sub, email } } },
});

const tag = async () =>
  `"${
    (
      await db.query<{ v: string }>(
        'SELECT data_version::text AS v FROM app_user WHERE user_id = $1',
        [SUB],
      )
    ).rows[0].v
  }"`;

type Who = { sub?: string; email?: string };

const beginEvent = (body: string, o: Who = {}): ApiEvent => ({
  routeKey: BEGIN_ROUTE,
  headers: {},
  body,
  requestContext: caller(o.sub, o.email),
});
type PartOptions = Who & {
  /** The raw body, in place of the part's JSON. */
  body?: string;
  /** The header's value; `null` sends none. Unless named, the SHA-256 of the body. */
  digest?: string | null;
  base64?: boolean;
};
const partEvent = (id: string, n: number | string, part: Part, o: PartOptions = {}): ApiEvent => {
  const text = o.body ?? bodyOf(part);
  const digest = o.digest === undefined ? `sha-256=:${sha(Buffer.from(text, 'utf8'))}:` : o.digest;
  return {
    routeKey: PART_ROUTE,
    pathParameters: { id, part: String(n) },
    headers: digest === null ? {} : { 'content-digest': digest },
    body: o.base64 ? Buffer.from(text, 'utf8').toString('base64') : text,
    isBase64Encoded: o.base64 ?? false,
    requestContext: caller(o.sub, o.email),
  };
};
const commitEvent = (id: string, ifMatch: string | null, o: Who = {}): ApiEvent => ({
  routeKey: COMMIT_ROUTE,
  pathParameters: { id },
  headers: ifMatch === null ? {} : { 'if-match': ifMatch },
  requestContext: caller(o.sub, o.email),
});
const abortEvent = (id: string, o: Who = {}): ApiEvent => ({
  routeKey: ABORT_ROUTE,
  pathParameters: { id },
  headers: {},
  requestContext: caller(o.sub, o.email),
});

const send = async (event: ApiEvent, d = deps()) => record(event, await imports(d, event));

const answer = (res: ApiResult | EmptyResult) => [
  res.statusCode,
  'body' in res ? (JSON.parse(res.body) as unknown) : undefined,
];

const begin = async (parts: Part[], over: Record<string, unknown> = {}, d = deps()) => {
  const res = (await send(
    beginEvent(JSON.stringify({ ...manifestOf(parts), ...over })),
    d,
  )) as ApiResult;
  expect(res.statusCode).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
};
const stage = (id: string, n: number | string, part: Part, o: PartOptions = {}, d = deps()) =>
  send(partEvent(id, n, part, o), d);
const commit = async (id: string, ifMatch?: string | null, d = deps()) =>
  send(commitEvent(id, ifMatch === undefined ? await tag() : ifMatch), d);
const abort = (id: string, d = deps()) => send(abortEvent(id), d);

/** Begin, every part in order, commit: the whole import as a client drives it. */
const importAll = async (parts: Part[], d = deps()) => {
  const id = await begin(parts, {}, d);
  for (const [i, part] of parts.entries()) {
    expect(answer(await stage(id, i + 1, part, {}, d))).toEqual([200, expect.anything()]);
  }
  return { id, committed: await commit(id, undefined, d) };
};

const state = async (): Promise<State> => {
  const event: ApiEvent = { routeKey: STATE_ROUTE, headers: {}, requestContext: caller() };
  const res = (await stateRoute(deps(), event)) as ApiResult;
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body) as State;
};

/** One `POST /mutations` under the current tag and a fresh key, which must land. */
const write = async (ops: unknown[], d = deps()) => {
  const event: ApiEvent = {
    routeKey: MUTATIONS_ROUTE,
    headers: { 'idempotency-key': randomUUID(), 'if-match': await tag() },
    body: JSON.stringify({ ops }),
    requestContext: caller(),
  };
  const res = (await mutationsRoute(d, event)) as ApiResult;
  expect([res.statusCode, res.body]).toEqual([200, expect.any(String)]);
};

const pointers = async () =>
  (
    await db.query<{ live: string | null; staged: string | null }>(
      'SELECT dataset_id AS live, import_dataset_id AS staged FROM app_user WHERE user_id = $1',
      [SUB],
    )
  ).rows[0];

/** Rows of every table a generation keys, the dataset row included, in generation `id`. */
const rowsIn = async (id: string) =>
  (
    await db.query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM asset WHERE dataset_id = $1)
             + (SELECT count(*) FROM "transaction" WHERE dataset_id = $1)
             + (SELECT count(*) FROM user_price WHERE dataset_id = $1)
             + (SELECT count(*) FROM import_part WHERE dataset_id = $1)
             + (SELECT count(*) FROM import_manifest WHERE dataset_id = $1)
             + (SELECT count(*) FROM dataset WHERE id = $1))::int AS n`,
      [id],
    )
  ).rows[0].n;

/** Rows of the generations `user` owns that neither pointer names. */
const garbage = async (user = SUB) => {
  const { rows } = await db.query<{ id: string }>(
    `SELECT g.id FROM dataset g JOIN app_user u ON u.user_id = g.user_id
      WHERE u.user_id = $1 AND g.id IS DISTINCT FROM u.dataset_id
        AND g.id IS DISTINCT FROM u.import_dataset_id`,
    [user],
  );
  let n = 0;
  for (const { id } of rows) n += await rowsIn(id);
  return n;
};

/** Staged rows of the open import. */
const staged = async () => {
  const { staged: id } = await pointers();
  return id === null ? 0 : rowsIn(id);
};

beforeEach(async () => {
  db = await freshDb();
  await applyUserSchema(db);
  await insertUser(db, SUB, EMAIL);
  await writeLedger(db, SUB, {
    assets: OLD.assets,
    transactions: OLD.transactions,
    userPrices: OLD.prices,
  });
  vi.stubEnv('OPEN_REGISTRATION', 'false');
  vi.mocked(connect).mockRejectedValue(new Error('no cluster in a test'));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** OLD as `GET /state` answers it: the fixture stamps every price with the time it wrote it. */
const oldState = async () => {
  const s = await state();
  expect(s.prices.map(({ assetId, asOf, price: p }) => ({ assetId, asOf, price: p }))).toEqual(
    OLD.prices,
  );
  expect([s.assets, s.transactions]).toEqual([OLD.assets, OLD.transactions]);
  return s;
};

describe('an import larger than one transaction', () => {
  it('replaces the dataset in parts, no transaction mutating past the ceiling', async () => {
    const ceiling = ceilingClient(db, 20);
    const d = deps({ user: ceiling.client, maxPartRows: 15, batchRows: 10 });
    const parts = partsOf(NEW, 15);
    expect(parts).toHaveLength(5);
    const { committed } = await importAll(parts, d);
    expect(answer(committed)).toEqual([200, { etag: await tag() }]);
    expect(await state()).toEqual(NEW);
    expect(ceiling.seen.peak).toBeGreaterThan(0);
    expect(ceiling.seen.peak).toBeLessThanOrEqual(20);
  });

  // THE CEILING IS REAL: the same rows as one part are refused by it, so the parts are what fit.
  it('is refused by the ceiling when every row goes in one part', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({ user: ceilingClient(db, 20).client, maxPartRows: 100 });
    const [all] = partsOf(NEW, 100);
    const id = await begin([all], {}, d);
    expect((await stage(id, 1, all, {}, d)).statusCode).toBe(500);
    expect(await staged()).toBe(2);
  });

  it('bounds a part at a few hundred rows, AWS’s loading guidance', () => {
    expect(MAX_PART_ROWS).toBe(500);
  });
});

describe('while parts are staged', () => {
  it('answers every read with the old dataset', async () => {
    const parts = partsOf(NEW, 15);
    const id = await begin(parts);
    await stage(id, 1, parts[0]);
    await stage(id, 2, parts[1]);
    expect(await staged()).toBeGreaterThan(30);
    const before = await oldState();
    const ledger = await readLedger(db as unknown as SqlClient, SUB);
    expect([ledger.assets, ledger.transactions, ledger.userPrices]).toEqual([
      before.assets,
      before.transactions,
      before.prices,
    ]);
  });
});

describe('the commit', () => {
  it('moves the live pointer to the staged generation and bumps the tag', async () => {
    const before = await tag();
    const { id, committed } = await importAll(partsOf(NEW, 15));
    expect(await tag()).not.toBe(before);
    expect(answer(committed)).toEqual([200, { etag: await tag() }]);
    expect((committed as ApiResult).headers.etag).toBe(await tag());
    expect(await pointers()).toEqual({ live: id, staged: null });
    expect(await state()).toEqual(NEW);
  });

  it('is refused 412 against a stale If-Match, and the live dataset stays as it was', async () => {
    const parts = partsOf(NEW, 15);
    const id = await begin(parts);
    for (const [i, part] of parts.entries()) await stage(id, i + 1, part);
    const stale = await tag();
    await write([{ op: 'asset.add', asset: asset(95, { createdAt: '2026-02-01T09:00:00' }) }]);
    expect(answer(await commit(id, stale))).toEqual([412, { error: 'precondition_failed' }]);
    const after = await state();
    expect(after.assets.map((a) => a.id)).toEqual([u(91), u(95)]);
    expect(after.transactions).toEqual(OLD.transactions);
    // Still open: under the current tag it lands.
    expect((await commit(id)).statusCode).toBe(200);
    expect(await state()).toEqual(NEW);
  });

  it.each([null, '*'])(
    'is refused 428 under If-Match %s, which names no state',
    async (ifMatch) => {
      const id = await begin([]);
      expect(answer(await commit(id, ifMatch))).toEqual([428, { error: 'precondition_required' }]);
    },
  );

  // A commit that landed under an error, or whose answer was lost, is asked again with the tag it
  // was sent with, stale by then: AIP-155 answers "the previously successful request".
  it('answers a commit that already landed with the tag it left, even under its stale tag', async () => {
    const parts = partsOf(NEW, 15);
    const id = await begin(parts);
    for (const [i, part] of parts.entries()) await stage(id, i + 1, part);
    const sent = await tag();
    const first = await commit(id, sent);
    expect(answer(await commit(id, sent))).toEqual(answer(first));
    expect(await state()).toEqual(NEW);
  });

  it('replaces the dataset with nothing when the import has no part', async () => {
    const id = await begin([]);
    expect((await commit(id)).statusCode).toBe(200);
    expect(await state()).toEqual({ assets: [], transactions: [], prices: [] });
  });

  it.each([u(404), 'not-a-uuid'])('answers 404 for an import that is not open: %s', async (id) => {
    expect(answer(await commit(id))).toEqual([404, { error: 'no_such_import' }]);
  });
});

describe('an import that does not commit', () => {
  it('leaves the live dataset as it was when aborted', async () => {
    const parts = partsOf(NEW, 15);
    const id = await begin(parts);
    await stage(id, 1, parts[0]);
    const aborted = await abort(id);
    expect(aborted).toEqual({ statusCode: 204, headers: {} });
    await oldState();
    expect(answer(await stage(id, 2, parts[1]))).toEqual([404, { error: 'no_such_import' }]);
    expect(answer(await commit(id))).toEqual([404, { error: 'no_such_import' }]);
    expect(answer(await abort(id))).toEqual([404, { error: 'no_such_import' }]);
  });

  it('leaves the live dataset as it was when abandoned for another begin', async () => {
    const parts = partsOf(NEW, 15);
    const first = await begin(parts);
    await stage(first, 1, parts[0]);
    const second = await begin(parts);
    expect(second).not.toBe(first);
    expect(answer(await stage(first, 2, parts[1]))).toEqual([404, { error: 'no_such_import' }]);
    expect(answer(await commit(first))).toEqual([404, { error: 'no_such_import' }]);
    await oldState();
    for (const [i, part] of parts.entries()) await stage(second, i + 1, part);
    expect((await commit(second)).statusCode).toBe(200);
    expect(await state()).toEqual(NEW);
  });

  it('is no one else’s to stage, commit or abort', async () => {
    await insertUser(db, TWIN, TWIN_EMAIL);
    await writeLedger(db, TWIN, { assets: [], transactions: [], userPrices: [] });
    const parts = partsOf(NEW, 15);
    const id = await begin(parts);
    const theirs = { sub: TWIN, email: TWIN_EMAIL };
    expect(answer(await send(partEvent(id, 1, parts[0], theirs)))).toEqual([
      404,
      { error: 'no_such_import' },
    ]);
    expect(answer(await send(commitEvent(id, '"0"', theirs)))).toEqual([
      404,
      { error: 'no_such_import' },
    ]);
    expect(answer(await send(abortEvent(id, theirs)))).toEqual([404, { error: 'no_such_import' }]);
    expect(await pointers()).toEqual({ live: expect.any(String), staged: id });
    expect(await staged()).toBe(2);
  });
});

describe('a part sent again', () => {
  it('is a no-op when its number and body are the ones staged', async () => {
    const parts = partsOf(NEW, 15);
    const id = await begin(parts);
    const first = await stage(id, 1, parts[0]);
    expect(answer(first)).toEqual([200, { part: 1, digest: sha(Buffer.from(bodyOf(parts[0]))) }]);
    const rows = await staged();
    expect(answer(await stage(id, 1, parts[0]))).toEqual(answer(first));
    expect(await staged()).toBe(rows);
  });

  it('is refused as a conflict when its number holds another body', async () => {
    const parts = partsOf(NEW, 15);
    const id = await begin(parts);
    await stage(id, 1, parts[0]);
    const rows = await staged();
    expect(answer(await stage(id, 1, parts[1]))).toEqual([409, { error: 'part_conflict' }]);
    expect(await staged()).toBe(rows);
  });
});

describe('the commit checks the staged parts and rows against the manifest', () => {
  it('names the first part missing from the run', async () => {
    const parts = partsOf(NEW, 25);
    const id = await begin(parts);
    await stage(id, 1, parts[0]);
    await stage(id, 3, parts[2]);
    expect(answer(await commit(id))).toEqual([
      409,
      { error: 'manifest_mismatch', field: 'part', expected: 2, actual: 3 },
    ]);
    await oldState();
    // Still open: the missing part lands and so does the commit.
    await stage(id, 2, parts[1]);
    expect((await commit(id)).statusCode).toBe(200);
    expect(await state()).toEqual(NEW);
  });

  it('names the digest when the parts are not the ones it promised', async () => {
    const parts = partsOf(NEW, 25);
    const id = await begin(parts);
    await stage(id, 1, parts[0]);
    await stage(id, 2, parts[1]);
    expect(answer(await commit(id))).toEqual([
      409,
      {
        error: 'manifest_mismatch',
        field: 'digest',
        expected: composite(parts),
        actual: composite(parts.slice(0, 2)),
      },
    ]);
    await oldState();
  });

  it.each(['assets', 'transactions', 'prices'] as const)(
    'names a count of %s other than it promised',
    async (table) => {
      const parts = partsOf(NEW, 25);
      const promised = manifestOf(parts)[table] + 1;
      const id = await begin(parts, { [table]: promised });
      for (const [i, part] of parts.entries()) await stage(id, i + 1, part);
      expect(answer(await commit(id))).toEqual([
        409,
        { error: 'manifest_mismatch', field: table, expected: promised, actual: promised - 1 },
      ]);
      await oldState();
    },
  );
});

describe('a whole-dataset rule refuses the part that breaks it', () => {
  // Each case: the parts before it stage, the breaking one is refused naming its rule and stages
  // nothing, and the commit that follows is refused, the live dataset untouched.
  const refusesAt = async (parts: Part[], at: number, table: string, code: string) => {
    const id = await begin(parts);
    for (const [i, part] of parts.slice(0, at).entries()) {
      expect((await stage(id, i + 1, part)).statusCode).toBe(200);
    }
    const before = await staged();
    expect(answer(await stage(id, at + 1, parts[at]))).toEqual([
      422,
      { error: 'invalid_part', table, issues: [{ code }] },
    ]);
    expect(await staged()).toBe(before);
    expect((await commit(id)).statusCode).toBe(409);
    await oldState();
  };

  it('refuses an asset id staged before', async () => {
    await refusesAt([{ assets: [asset(1)] }, { assets: [asset(1)] }], 1, 'assets', 'duplicate-key');
  });

  it('refuses an asset id twice in one part', async () => {
    await refusesAt([{ assets: [asset(1), asset(1)] }], 0, 'assets', 'duplicate-key');
  });

  it('refuses a transaction id staged before', async () => {
    await refusesAt(
      [{ assets: [asset(1)], transactions: [deposit(10)] }, { transactions: [deposit(10)] }],
      1,
      'transactions',
      'duplicate-key',
    );
  });

  it('refuses a transaction naming no asset', async () => {
    await refusesAt(
      [{ assets: [asset(1)] }, { transactions: [buy(11, 7, '2026-03-02', 100, 1)] }],
      1,
      'transactions',
      'unknown-asset-id',
    );
  });

  it('refuses a price naming no asset', async () => {
    await refusesAt(
      [{ assets: [asset(1)] }, { prices: [price(7, '2026-03-05', 10)] }],
      1,
      'prices',
      'unknown-asset-id',
    );
  });

  it('refuses a second price for one asset and day', async () => {
    await refusesAt(
      [
        { assets: [asset(1)], prices: [price(1, '2026-03-05', 10)] },
        { prices: [price(1, '2026-03-05', 11)] },
      ],
      1,
      'prices',
      'duplicate-price',
    );
  });

  // The order the keys impose: an asset is staged before any part naming it.
  it('refuses a row whose asset a later part brings', async () => {
    await refusesAt(
      [{ transactions: [buy(11, 1, '2026-03-02', 100, 1)] }, { assets: [asset(1)] }],
      0,
      'transactions',
      'unknown-asset-id',
    );
  });
});

describe('a part is checked row by row before it stages', () => {
  const refusal = async (part: Part) => {
    const id = await begin([part]);
    const res = await stage(id, 1, part);
    expect(await staged()).toBe(2);
    return answer(res);
  };

  it('refuses an asset the store would not keep, naming the row and field', async () => {
    expect(await refusal({ assets: [asset(1), asset(2, { code: 'R' })] })).toEqual([
      422,
      {
        error: 'invalid_part',
        table: 'assets',
        index: 1,
        issues: [{ field: 'code', code: 'invalid' }],
      },
    ]);
  });

  it('refuses an id that is not a uuid', async () => {
    expect(await refusal({ assets: [asset(1, { id: 'reit' })] })).toEqual([
      422,
      {
        error: 'invalid_part',
        table: 'assets',
        index: 0,
        issues: [{ field: 'id', code: 'invalid', value: 'reit' }],
      },
    ]);
  });

  it('refuses a position row without its count', async () => {
    const noCount: Record<string, unknown> = { ...buy(11, 1, '2026-03-02', 100, 1) };
    delete noCount.quantity;
    expect(
      await refusal({ assets: [asset(1)], transactions: [noCount as unknown as Transaction] }),
    ).toEqual([
      422,
      {
        error: 'invalid_part',
        table: 'transactions',
        index: 0,
        issues: [{ field: 'quantity', code: 'units-missing-on-position-row' }],
      },
    ]);
  });

  it('refuses an asset row naming no asset, and a portfolio row naming one', async () => {
    expect(
      await refusal({ transactions: [{ ...buy(11, 1, '2026-03-02', 100, 1), assetId: '' }] }),
    ).toEqual([
      422,
      {
        error: 'invalid_part',
        table: 'transactions',
        index: 0,
        issues: [{ field: 'assetId', code: 'asset-missing-on-asset-row' }],
      },
    ]);
    expect(
      await refusal({ assets: [asset(1)], transactions: [{ ...deposit(10), assetId: u(1) }] }),
    ).toEqual([
      422,
      {
        error: 'invalid_part',
        table: 'transactions',
        index: 0,
        issues: [{ field: 'assetId', code: 'invalid', value: u(1) }],
      },
    ]);
  });

  it('refuses a price not above zero', async () => {
    expect(await refusal({ assets: [asset(1)], prices: [price(1, '2026-03-05', 0)] })).toEqual([
      422,
      {
        error: 'invalid_part',
        table: 'prices',
        index: 0,
        issues: [expect.objectContaining({ field: 'price', code: 'expected-positive-amount' })],
      },
    ]);
  });
});

describe('a value the store cannot hold refuses the part, naming its table', () => {
  it('refuses a note holding a NUL, which no text column takes', async () => {
    const part: Part = { transactions: [{ ...deposit(10), note: 'a\u0000b' }] };
    const id = await begin([part]);
    expect(answer(await stage(id, 1, part))).toEqual([
      422,
      { error: 'invalid_part', table: 'transactions', issues: [{ code: 'invalid' }] },
    ]);
    expect(await staged()).toBe(2);
  });

  it('answers 500 for a caller with no account, which provisioning always writes', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await db.query(
      'DELETE FROM "transaction" t USING app_user u WHERE u.user_id = $1 AND t.user_id = u.user_id',
      [SUB],
    );
    await db.query('DELETE FROM account WHERE user_id = $1', [SUB]);
    const part: Part = { transactions: [deposit(10)] };
    const id = await begin([part]);
    expect(answer(await stage(id, 1, part))).toEqual([500, { error: 'internal' }]);
    expect(error).toHaveBeenCalled();
  });
});

describe('a part is bounded and its body verified', () => {
  const PART: Part = { assets: [asset(1)] };

  it('refuses a body over the byte bound 413, naming the bound', async () => {
    const body = JSON.stringify({ assets: [asset(1, { name: 'x'.repeat(MAX_BODY_BYTES) })] });
    const id = await begin([PART]);
    expect(answer(await stage(id, 1, PART, { body }))).toEqual([
      413,
      { error: 'payload_too_large', max: MAX_BODY_BYTES },
    ]);
  });

  it('refuses more rows than the part bound, naming it', async () => {
    const part = { assets: [asset(1), asset(2), asset(3)] };
    const d = deps({ maxPartRows: 2 });
    const id = await begin([part], {}, d);
    expect(answer(await stage(id, 1, part, {}, d))).toEqual([
      400,
      { error: 'too_many_part_rows', max: 2 },
    ]);
  });

  it.each([
    ['no Content-Digest', null],
    ['a digest in hex', `sha-256=:${createHash('sha256').update('x').digest('hex')}:`],
    [
      'an algorithm it does not take',
      `sha-512=:${createHash('sha512').update('x').digest('base64')}:`,
    ],
  ])('refuses a part with %s', async (_, digest) => {
    const id = await begin([PART]);
    expect(answer(await stage(id, 1, PART, { digest }))).toEqual([
      400,
      { error: 'invalid_digest' },
    ]);
  });

  // A body cut short in transit fails its digest, which a client can send again, before it fails
  // as JSON.
  it('checks the digest before reading the body as JSON', async () => {
    const id = await begin([PART]);
    const whole = `sha-256=:${sha(Buffer.from(bodyOf(PART)))}:`;
    expect(
      answer(await stage(id, 1, PART, { body: bodyOf(PART).slice(0, 20), digest: whole })),
    ).toEqual([400, { error: 'digest_mismatch' }]);
  });

  it('refuses a body whose digest is another’s', async () => {
    const id = await begin([PART]);
    const other = `sha-256=:${sha(Buffer.from('another body'))}:`;
    expect(answer(await stage(id, 1, PART, { digest: other }))).toEqual([
      400,
      { error: 'digest_mismatch' },
    ]);
    expect(await staged()).toBe(2);
  });

  // RFC 8259 §8.1: JSON between systems is UTF-8. A Buffer's decoding would stage U+FFFD in place
  // of the byte the digest certified.
  it('refuses a body that is not UTF-8, its digest notwithstanding', async () => {
    const id = await begin([PART]);
    const bytes = Buffer.from('{"assets":[{"name":"\u00ff"}]}', 'latin1');
    const event = partEvent(id, 1, PART, { digest: `sha-256=:${sha(bytes)}:` });
    const res = await send({ ...event, body: bytes.toString('base64'), isBase64Encoded: true });
    expect(answer(res)).toEqual([400, { error: 'invalid_request' }]);
  });

  it('takes the digest among others, and a body API Gateway sent in base64', async () => {
    const id = await begin([PART]);
    const own = `sha-256=:${sha(Buffer.from(bodyOf(PART)))}:`;
    const both = `sha-512=:${createHash('sha512').update('x').digest('base64')}:, ${own}`;
    expect((await stage(id, 1, PART, { digest: both, base64: true })).statusCode).toBe(200);
  });

  it.each([
    ['not JSON', '{'],
    ['no row', '{}'],
    ['an empty table', '{"assets":[]}'],
    ['a table it does not know', '{"snapshots":[{}]}'],
    ['a table that is not a list', '{"assets":{}}'],
    ['a __proto__ key', '{"assets":[{"__proto__":{}}]}'],
  ])('refuses a body with %s', async (_, body) => {
    const id = await begin([PART]);
    expect(answer(await stage(id, 1, PART, { body }))).toEqual([400, { error: 'invalid_request' }]);
  });

  it.each(['0', '10001', '1.5', 'one', '01'])('refuses part number %s', async (n) => {
    const id = await begin([PART]);
    expect(answer(await stage(id, n, PART))).toEqual([400, { error: 'invalid_request' }]);
  });
});

describe('the begin', () => {
  it('opens an import, naming it in Location', async () => {
    const res = (await send(beginEvent(JSON.stringify(manifestOf([]))))) as ApiResult;
    const { id } = JSON.parse(res.body) as { id: string };
    expect([res.statusCode, res.headers.location]).toEqual([201, `/imports/${id}`]);
    expect(await pointers()).toEqual({ live: expect.any(String), staged: id });
  });

  it.each([
    ['a negative count', { assets: -1 }],
    ['a fractional count', { prices: 1.5 }],
    ['a count past the column', { transactions: 2 ** 31 }],
    ['a count that is text', { assets: '1' }],
    ['a digest in hex', { digest: createHash('sha256').update('x').digest('hex') }],
    ['a digest not in canonical base64', { digest: `${'A'.repeat(42)}B=` }],
    ['a key it does not know', { parts: 3 }],
  ])('refuses a manifest with %s', async (_, over) => {
    const res = await send(beginEvent(JSON.stringify({ ...manifestOf([]), ...over })));
    expect(answer(res)).toEqual([400, { error: 'invalid_request' }]);
    expect((await pointers()).staged).toBeNull();
  });

  it('refuses a manifest missing a count, and one that is not JSON', async () => {
    const short: Record<string, unknown> = { ...manifestOf([]) };
    delete short.prices;
    expect(answer(await send(beginEvent(JSON.stringify(short))))).toEqual([
      400,
      { error: 'invalid_request' },
    ]);
    expect(answer(await send(beginEvent('{')))).toEqual([400, { error: 'invalid_request' }]);
  });

  it('refuses a body over the byte bound 413', async () => {
    const body = JSON.stringify({ ...manifestOf([]), pad: 'x'.repeat(MAX_BODY_BYTES) });
    expect(answer(await send(beginEvent(body)))).toEqual([
      413,
      { error: 'payload_too_large', max: MAX_BODY_BYTES },
    ]);
  });
});

describe('a stored price survives an export, an import and a second export', () => {
  // The three a ₴ quote cannot carry (*Cloud target*): each must come back exactly as stored.
  it('keeps one on a day its position holds none of, one below a kopeck, and one a backdated buy revalued', async () => {
    await write([{ op: 'dataset.clear' }]);
    const patchDay = (date: string, quotes: Record<string, number>) => ({
      op: 'snapshot.patch',
      date,
      patch: { quotes },
    });
    await write([
      { op: 'asset.add', asset: asset(1) },
      { op: 'asset.add', asset: asset(2, { createdAt: '2026-03-02T10:00:00' }) },
      { op: 'asset.add', asset: asset(3, { createdAt: '2026-03-02T11:00:00' }) },
      { op: 'transaction.add', transaction: deposit(10) },
      { op: 'transaction.add', transaction: buy(11, 1, '2026-03-02', 1000, 10) },
      { op: 'transaction.add', transaction: buy(12, 2, '2026-03-02', 1000, 10) },
      { op: 'transaction.add', transaction: buy(13, 3, '2026-03-02', 1000, 10) },
      patchDay('2026-03-05', { [u(1)]: 1100, [u(2)]: 0.004, [u(3)]: 1000.01 }),
    ]);
    await write([
      { op: 'transaction.delete', id: u(11) },
      { op: 'transaction.add', transaction: buy(14, 3, '2026-03-03', 300, 3) },
    ]);
    const first = await state();
    expect(first.prices.map((p) => p.price)).toEqual([110, 0.004 / 10, 1000.01 / 10]);

    await importAll(partsOf(first, 4));
    expect(await state()).toEqual(first);
  });
});

describe('dead generations are collected without a scheduled function', () => {
  it('collects them before the commit answers when the function has time to spare', async () => {
    const live = (await pointers()).live!;
    await importAll(partsOf(NEW, 25), deps({ remainingMs: () => 14_000, batchRows: 4 }));
    expect(await rowsIn(live)).toBe(0);
    expect(await garbage()).toBe(0);
  });

  it('collects one bounded batch on each later write, no transaction past the bound', async () => {
    const live = (await pointers()).live!;
    await importAll(partsOf(NEW, 25), deps({ remainingMs: () => 0 }));
    // The old generation and its dataset row, untouched by a commit with no time left.
    expect(await rowsIn(live)).toBe(OLD_ROWS + 1);

    const ceiling = ceilingClient(db, 4);
    const d = deps({ user: ceiling.client, batchRows: 4 });
    const left = [await garbage()];
    for (let n = 0; left[left.length - 1] > 0 && n < 20; n += 1) {
      await write([{ op: 'transaction.add', transaction: deposit(500 + n, '2026-05-01', 1) }], d);
      left.push(await garbage());
    }
    expect(left[left.length - 1]).toBe(0);
    // Every write took one bounded batch: the rows fell at each step and never by more than it.
    for (let i = 1; i < left.length; i += 1) {
      expect(left[i - 1] - left[i]).toBeGreaterThan(0);
      expect(left[i - 1] - left[i]).toBeLessThanOrEqual(4);
    }
    expect(ceiling.seen.peak).toBeLessThanOrEqual(4);
  });

  it('collects what a dataset.clear leaves and what an abort leaves', async () => {
    const parts = partsOf(NEW, 25);
    const id = await begin(parts);
    await stage(id, 1, parts[0]);
    await abort(id);
    await write([{ op: 'dataset.clear' }]);
    for (let n = 0; (await garbage()) > 0 && n < 40; n += 1) {
      await write([{ op: 'transaction.add', transaction: deposit(600 + n, '2026-05-01', 1) }]);
    }
    expect(await garbage()).toBe(0);
  });

  it('collects nothing on a refused request', async () => {
    // A write whose own collection is held to no rows leaves the generation the clear left.
    await write([{ op: 'dataset.clear' }], deps({ batchRows: 0 }));
    const before = await garbage();
    expect(before).toBeGreaterThan(0);
    const res = await send(beginEvent(JSON.stringify({ ...manifestOf([]), assets: -1 })));
    expect(res.statusCode).toBe(400);
    expect(await garbage()).toBe(before);
  });

  it('collects nothing on a read', async () => {
    await write([{ op: 'dataset.clear' }]);
    const before = await garbage();
    await state();
    expect(await garbage()).toBe(before);
  });

  it('leaves another user’s dead generation alone', async () => {
    await insertUser(db, TWIN, TWIN_EMAIL);
    await writeLedger(db, TWIN, { assets: [asset(1)], transactions: [], userPrices: [] });
    await db.query(
      `UPDATE app_user SET dataset_id = NULL WHERE user_id = $1`, // their generation, now dead
      [TWIN],
    );
    const theirs = await garbage(TWIN);
    expect(theirs).toBeGreaterThan(0);
    await write([{ op: 'dataset.clear' }]);
    for (let n = 0; (await garbage()) > 0 && n < 40; n += 1) {
      await write([{ op: 'transaction.add', transaction: deposit(700 + n, '2026-05-01', 1) }]);
    }
    expect(await garbage(TWIN)).toBe(theirs);
  });

  it('answers a write whose collection fails as if it had not run', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await write([{ op: 'dataset.clear' }]);
    const breaking: SqlClient = {
      query: (text, values) =>
        /^\s*DELETE FROM user_price/.test(text)
          ? Promise.reject(new Error('the cluster went away'))
          : db.query(text, values),
    };
    await write([{ op: 'transaction.add', transaction: deposit(800) }], deps({ user: breaking }));
    expect(error).toHaveBeenCalled();
  });
});

describe('an import left idle', () => {
  const age = (days: string) =>
    db.query(`UPDATE import_manifest SET staged_at = now() - $1::interval`, [days]);

  it('takes a part after six idle days', async () => {
    const parts = partsOf(NEW, 25);
    const id = await begin(parts);
    await stage(id, 1, parts[0]);
    await age('6 days');
    expect((await stage(id, 2, parts[1])).statusCode).toBe(200);
  });

  it('is gone after seven, and its generation is collected', async () => {
    const parts = partsOf(NEW, 25);
    const id = await begin(parts);
    await stage(id, 1, parts[0]);
    await age('7 days 1 minute');
    expect(answer(await stage(id, 2, parts[1]))).toEqual([404, { error: 'no_such_import' }]);
    expect(answer(await commit(id))).toEqual([404, { error: 'no_such_import' }]);
    await write([{ op: 'transaction.add', transaction: deposit(900, '2026-05-01', 1) }]);
    expect((await pointers()).staged).toBeNull();
    for (let n = 0; (await garbage()) > 0 && n < 40; n += 1) {
      await write([{ op: 'transaction.add', transaction: deposit(901 + n, '2026-05-01', 1) }]);
    }
    expect(await rowsIn(id)).toBe(0);
    // Nothing of the import landed: the live dataset is the old one and the deposits written since.
    const after = await state();
    expect([after.assets, after.transactions.slice(0, OLD.transactions.length)]).toEqual([
      OLD.assets,
      OLD.transactions,
    ]);
  });
});

describe('the gate, on every import route', () => {
  // One after another: the routes share one database, and the gate writes.
  const everyRoute = async (who: Who = {}) => {
    const id = u(404);
    const out: unknown[] = [];
    for (const event of [
      beginEvent(JSON.stringify(manifestOf([])), who),
      partEvent(id, 1, { assets: [asset(1)] }, who),
      commitEvent(id, '"0"', who),
      abortEvent(id, who),
    ]) {
      out.push(answer(await send(event))[1]);
    }
    return out;
  };

  it.each([
    ['pending', "UPDATE app_user SET status = 'pending', decided_at = NULL, decided_by = NULL"],
    ['rejected', "UPDATE app_user SET status = 'rejected'"],
  ])('refuses a %s applicant', async (error, sql) => {
    await db.query(sql);
    expect(await everyRoute()).toEqual(Array(4).fill({ error }));
  });

  it('tells a caller with no row that there is no application', async () => {
    expect(await everyRoute({ sub: TWIN, email: TWIN_EMAIL })).toEqual(
      Array(4).fill({ error: 'no_application' }),
    );
  });

  it('refuses the demo as a non-caller', async () => {
    await insertUser(db, DEMO_USER_ID, DEMO_USER_EMAIL, 'active', 'demo');
    expect(await everyRoute({ sub: TWIN, email: DEMO_USER_EMAIL })).toEqual(
      Array(4).fill({ error: 'forbidden' }),
    );
  });
});

// DSQL can answer a serialization failure for a transaction that committed: each route is sent
// again, and its first statement reads what the landed attempt left.
describe('a route sent again after a serialization failure', () => {
  it('answers a commit that landed under the error with the tag it left, applied once', async () => {
    const parts = partsOf(NEW, 25);
    const id = await begin(parts);
    for (const [i, part] of parts.entries()) await stage(id, i + 1, part);
    const before = Number((await tag()).slice(1, -1));
    const { client, sent } = refusingCommit(db, '40001', {
      after: /SET dataset_id = import_dataset_id/,
      lands: true,
    });
    const res = await commit(id, undefined, deps({ user: client }));
    expect(answer(res)).toEqual([200, { etag: `"${before + 1}"` }]);
    expect(await tag()).toBe(`"${before + 1}"`);
    expect(sent.filter((q) => q === 'BEGIN').length).toBeGreaterThan(1);
    expect(await state()).toEqual(NEW);
  });

  it('opens one import when a begin landed under the error', async () => {
    const { client } = refusingCommit(db, '40001', { after: /INTO import_manifest/, lands: true });
    const res = (await send(
      beginEvent(JSON.stringify(manifestOf([]))),
      deps({ user: client }),
    )) as ApiResult;
    const { id } = JSON.parse(res.body) as { id: string };
    expect([res.statusCode, (await pointers()).staged]).toEqual([201, id]);
    expect(await rowsIn(id)).toBe(2);
  });

  // Two sends of one part both write its manifest row, so DSQL refuses the later one's commit, as
  // if it had landed, and its retry reads the earlier's part.
  it('stages a part once when its commit landed under the error', async () => {
    const parts = partsOf(NEW, 25);
    const id = await begin(parts);
    const { client } = refusingCommit(db, '40001', {
      after: /INSERT INTO import_part/,
      lands: true,
    });
    expect(answer(await stage(id, 1, parts[0], {}, deps({ user: client })))).toEqual([
      200,
      { part: 1, digest: sha(Buffer.from(bodyOf(parts[0]))) },
    ]);
    expect(await staged()).toBe(2 + 1 + 25);
  });

  it('refuses the part another body took under its number before the retry', async () => {
    const parts = partsOf(NEW, 25);
    const id = await begin(parts);
    const { client } = refusingCommit(db, '40001', { after: /INSERT INTO import_part/ });
    // The refused attempt rolled back; another body takes the number before the retry reads it.
    let taken = false;
    const racing: SqlClient = {
      query: async (text, values) => {
        if (!taken && text === 'ROLLBACK') {
          taken = true;
          await client.query(text);
          return send(partEvent(id, 1, { assets: [asset(77)] })).then(() => ({ rows: [] }));
        }
        return client.query(text, values);
      },
    };
    expect(answer(await stage(id, 1, parts[0], {}, deps({ user: racing })))).toEqual([
      409,
      { error: 'part_conflict' },
    ]);
  });

  it('answers an abort that landed under the error as the abort it was', async () => {
    const id = await begin([]);
    const { client } = refusingCommit(db, '40001', {
      after: /SET import_dataset_id = NULL/,
      lands: true,
    });
    expect(await abort(id, deps({ user: client }))).toEqual({ statusCode: 204, headers: {} });
    expect((await pointers()).staged).toBeNull();
  });

  it('answers 404 to an abort retried after a commit of its import won', async () => {
    const id = await begin([]);
    // The abort's attempt is refused at its COMMIT, the import's commit landing first.
    let lost = false;
    const losing: SqlClient = {
      query: async (text, values) => {
        if (!lost && text === 'COMMIT') {
          lost = true;
          await db.query('ROLLBACK');
          await db.query(
            `UPDATE app_user SET dataset_id = import_dataset_id, import_dataset_id = NULL,
                    data_version = data_version + 1 WHERE user_id = $1`,
            [SUB],
          );
          throw Object.assign(new Error('change conflicts with another transaction (OC000)'), {
            code: '40001',
          });
        }
        return db.query(text, values);
      },
    };
    expect(answer(await abort(id, deps({ user: losing })))).toEqual([
      404,
      { error: 'no_such_import' },
    ]);
    expect(await pointers()).toEqual({ live: id, staged: null });
  });
});

describe('a failure answers rather than throws', () => {
  const events = () => [
    beginEvent(JSON.stringify(manifestOf([]))),
    partEvent(u(404), 1, { assets: [asset(1)] }),
    commitEvent(u(404), '"0"'),
    abortEvent(u(404)),
  ];

  it('answers a failing database with its own 500, on every route', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken: SqlClient = { query: () => Promise.reject(new Error('the cluster went away')) };
    for (const event of events()) {
      expect(answer(await send(event, deps({ user: broken })))).toEqual([
        500,
        { error: 'internal' },
      ]);
    }
  });

  it('answers a connection failure with its own 500, on every route', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const event of events()) {
      const res = await rawHandler(event);
      record(event, res);
      expect(answer(res)).toEqual([500, { error: 'internal' }]);
    }
  });

  it('routes each import through the function’s handler', async () => {
    const user = { query: db.query.bind(db), end: async () => {} };
    vi.mocked(connect).mockResolvedValue(user as unknown as Awaited<ReturnType<typeof connect>>);
    const res = (await rawHandler(beginEvent(JSON.stringify(manifestOf([]))))) as ApiResult;
    expect(res.statusCode).toBe(201);
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: 80 });
