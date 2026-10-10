// `GET /view` over PGlite: the caller's rows and the archive's in one database, each read through
// the module the route uses, so every answer here is one the route really gives.
import { readFileSync } from 'node:fs';

import type { PGlite } from '@electric-sql/pglite';
import { PERIOD_OPTIONS } from '@quirenote/core/period';
import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '@quirenote/core/seed';
import type { Transaction } from '@quirenote/core/types';
import { rebuildSnapshots, type PriceRow } from '@quirenote/core/valuation';
import { buildView } from '@quirenote/core/view/build';
import {
  balancesBody,
  dayQuotes,
  deleteCounts,
  seriesBody,
  type ViewBody,
} from '@quirenote/core/view/serve';
import { asPriceRows, LONG_ROWS } from '@quirenote/core/view/test-ledgers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import {
  applyUserSchema,
  insertUser,
  withUuids,
  writeLedger,
  type LedgerRows,
} from './__fixtures__/user-ledger';
import { deleteAsset } from './asset-delete';
import { handler as capture } from './capture';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import { connect } from './dsql';
import type { ApiEvent, ApiResult, EmptyResult } from './http';
import type { SqlClient } from './migrate';
import type { StoredRate } from './official-rate';
import { proveRouteContract, recorder } from './route-contract';
import {
  BALANCES_ROUTE,
  EXPOSED,
  RESPONSES,
  ROUTE,
  SERIES_ROUTE,
  derivationId,
  handler as rawHandler,
  view as viewRoute,
  type ViewDeps,
} from './view';

vi.mock('./dsql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dsql')>()),
  connect: vi.fn(),
  connectAsArchiveReader: vi.fn(),
}));

// Watched, not replaced: the build's input is what the route hands core, and nothing in the body
// reads a bond's payment dates yet.
vi.mock('@quirenote/core/view/build', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quirenote/core/view/build')>();
  return { ...actual, buildView: vi.fn(actual.buildView) };
});

// Neither six nor the length of any page below: a route that cut its own pages would show it.
vi.mock('@quirenote/core/view/balances-page', () => ({ BALANCES_PAGE_SIZE: 5 }));

const { observed, record } = recorder(ROUTE);
const view = async (deps: ViewDeps, event: ApiEvent) => record(event, await viewRoute(deps, event));

const SUB = '9f1e2d3c-0000-4000-8000-0000000000d4';
const EMAIL = 'owner@quirenote.com';
const TWIN = '9f1e2d3c-0000-4000-8000-0000000000e5';
const TWIN_EMAIL = 'twin@quirenote.com';

const TODAY = '2026-07-28';
/** Noon in Kyiv on `TODAY`. */
const NOW = Date.parse(`${TODAY}T09:00:00Z`);
const RATE: StoredRate = { rate: 41.4983, date: TODAY };

// The seed, with energy linked: the archive prices it after the user's last price, so both sources
// reach the body.
const ENERGY_REF = 'inzhur-energy';
const LEDGER: LedgerRows = withUuids({
  assets: SEED_ASSETS.map((a) =>
    a.id === 'energy' ? { ...a, inzhur: { kind: 'fund', ref: ENERGY_REF } } : a,
  ),
  transactions: SEED_TRANSACTIONS,
  userPrices: asPriceRows(buildSeedSnapshots(), SEED_TRANSACTIONS)!,
});
const ENERGY = LEDGER.assets.find((a) => a.inzhur?.ref === ENERGY_REF)!.id;
const BOND = LEDGER.assets[SEED_ASSETS.findIndex((a) => a.id === 'ovdp8976')].id;
const BOND_REF = 'UA4000238976';
const PAYMENT_DATES = ['2026-02-25', '2026-08-26', '2027-02-24'];

/** `BOND`, …8976 in the seed, linked to the provider as a bond. */
async function linkBond() {
  await db.query(`UPDATE asset SET provider_kind = 'bond', provider_ref = $1 WHERE id = $2`, [
    BOND_REF,
    BOND,
  ]);
}
const terms = (asOf: string, ref: string, dates: readonly string[]) =>
  db.query(
    `INSERT INTO bond_terms (as_of, ref, terms_sha256, maturity, payment_schedule, observed_at,
                             parser_version)
     VALUES ($1, $2, '', NULL, $3, now(), '2')`,
    [asOf, ref, JSON.stringify(dates.map((date) => ({ date, amount: 39.46 })))],
  );
const ARCHIVE: [asOf: string, price: number][] = [
  ['2026-07-26', 10.2],
  ['2026-07-27', 10.35],
];

let db: PGlite;
let rate: StoredRate | undefined;
let opened: number;
let ended: number;

const event = (headers: Record<string, string> = {}, sub = SUB, email = EMAIL): ApiEvent => ({
  routeKey: ROUTE,
  headers,
  requestContext: { authorizer: { jwt: { claims: { token_use: 'id', sub, email } } } },
});

/** A request to one of the three routes, each with a query it accepts unless given one; `null` is
 *  no query string at all, which payload 2.0 sends as no field. */
const ACCEPTED: Record<string, Record<string, string> | null> = {
  [ROUTE]: null,
  [SERIES_ROUTE]: { period: 'all' },
  [BALANCES_ROUTE]: {},
};
const on = (
  routeKey: string,
  query: Record<string, string> | null = ACCEPTED[routeKey],
  headers: Record<string, string> = {},
  sub = SUB,
  email = EMAIL,
): ApiEvent => ({
  ...event(headers, sub, email),
  routeKey,
  ...(query === null ? {} : { queryStringParameters: query }),
});
const ROUTES = [ROUTE, SERIES_ROUTE, BALANCES_ROUTE];

/** The rows the route reads, as core's bodies take them: the fixture and the archive's rows. */
const rowsOf = (
  ledger: LedgerRows,
  archiveRows = ARCHIVE.map(([asOf, price]) => ({ ref: ENERGY_REF, asOf, price })),
) => ({
  assets: ledger.assets,
  transactions: ledger.transactions,
  userPrices: ledger.userPrices,
  archiveRows,
  paymentDates: [],
  today: TODAY,
});

const deps = (over: Partial<ViewDeps> = {}): ViewDeps => ({
  user: db as unknown as SqlClient,
  archive: async () => {
    opened += 1;
    return {
      query: (text: string, values?: unknown[]) => db.query(text, values),
      end: async () => {
        ended += 1;
      },
    } as unknown as Awaited<ReturnType<ViewDeps['archive']>>;
  },
  rate: { served: async () => rate },
  now: () => NOW,
  derivationId: 'derivation-a',
  ...over,
});

const observe = (asOf: string, ref: string, price: number) =>
  db.query(
    `INSERT INTO price_observation (as_of, instrument_ref, basis, source, price, observed_at,
                                    parser_version)
     VALUES ($1, $2, 'sell', 'inzhur', $3, now(), '2')`,
    [asOf, ref, price],
  );

const tagOf = async (d = deps(), e = event()) => {
  const res = (await view(d, e)) as ApiResult;
  expect(res.statusCode).toBe(200);
  return res.headers.etag;
};

beforeEach(async () => {
  db = await freshDb();
  await applyUserSchema(db);
  // The archive's tables from `ensureSchema` itself, as `sell-observations.test.ts` builds them.
  vi.mocked(connect).mockResolvedValue({
    query: (text: string, values?: unknown[]) =>
      db.query(text.replace(/\bINDEX\s+ASYNC\b/i, 'INDEX'), values),
    end: async () => {},
  } as unknown as Awaited<ReturnType<typeof connect>>);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await capture({ observe: { source: 'inzhur', from: '2026-09-01', to: '2026-09-01' } });
  vi.mocked(connect).mockReset();
  vi.mocked(connect).mockRejectedValue(new Error('no cluster in a test'));
  await insertUser(db, SUB, EMAIL);
  await writeLedger(db, SUB, LEDGER);
  for (const [asOf, price] of ARCHIVE) await observe(asOf, ENERGY_REF, price);
  vi.stubEnv('OPEN_REGISTRATION', 'false');
  rate = RATE;
  opened = 0;
  ended = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const byDateThenId = (a: Transaction, b: Transaction) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Every number in a value, so a NaN or an infinity cannot reach JSON as `null` unnoticed. */
const numbers = (value: unknown): number[] =>
  typeof value === 'number'
    ? [value]
    : value !== null && typeof value === 'object'
      ? Object.values(value).flatMap(numbers)
      : [];

describe('a signed-in caller gets every figure in one answer', () => {
  it('answers every period and every screen to one request with no parameter', async () => {
    const res = (await view(deps(), event())) as ApiResult;
    expect(res.statusCode).toBe(200);
    const { view: body } = JSON.parse(res.body) as { view: Record<string, unknown> };
    expect(Object.keys(body.periods as object).sort()).toEqual([...PERIOD_OPTIONS].sort());
    expect(Object.keys(body).sort()).toEqual(
      ['allocation', 'attributes', 'balances', 'capital', 'payouts', 'periods', 'portfolio'].sort(),
    );
  });

  // The criterion: the route's body is core's, computed here straight from the fixture.
  it('answers buildView over the same rows, with the rate beside it', async () => {
    const transactions = [...LEDGER.transactions].sort(byDateThenId);
    const index = (id: string) => LEDGER.assets.findIndex((a) => a.id === id);
    const user = [...LEDGER.userPrices].sort(
      (a, b) => index(a.assetId) - index(b.assetId) || a.asOf.localeCompare(b.asOf),
    );
    const archive: PriceRow[] = ARCHIVE.map(([asOf, price]) => ({ assetId: ENERGY, asOf, price }));
    const assets = [...LEDGER.assets].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    // The fixture stamps every price with the clock; the stamp is a fact of the day, so pin it.
    await db.query(`UPDATE user_price SET observed_at = '2026-07-20T10:15:30Z'`);
    const witnessed = user.map((p) => ({ ...p, observedAt: '2026-07-20T10:15:30' }));
    const expected = {
      view: buildView({
        assets: LEDGER.assets,
        transactions,
        snapshots: rebuildSnapshots(LEDGER.assets, transactions, { user, archive }, TODAY),
        today: TODAY,
      }),
      fx: RATE,
      assets,
      transactions,
      today: dayQuotes(transactions, witnessed, TODAY),
      deleteCounts: deleteCounts(assets, transactions, user),
      etag: '"0"',
    };
    expect(numbers(expected).every(Number.isFinite)).toBe(true);
    const res = (await view(deps(), event())) as ApiResult;
    expect(JSON.parse(res.body)).toEqual(JSON.parse(JSON.stringify(expected)));
  });

  it('opens the archive for a linked ledger, and closes it', async () => {
    await view(deps(), event());
    expect([opened, ended]).toEqual([1, 1]);
  });

  it('opens no archive for a ledger that links nothing', async () => {
    await db.query('UPDATE asset SET provider_kind = NULL, provider_ref = NULL');
    await tagOf();
    expect(opened).toBe(0);
  });

  it('opens no archive while every row is dated after today', async () => {
    await tagOf(deps({ now: () => Date.parse('2026-01-01T09:00:00Z') }));
    expect(opened).toBe(0);
  });

  it('asks for the rate of the day the body is built for', async () => {
    const asked: string[] = [];
    // A tenth of a second before midnight in Kyiv.
    const now = () => Date.parse('2026-07-28T20:59:59.900Z');
    await tagOf(
      deps({
        now,
        rate: {
          served: async (_client, day) => {
            asked.push(day);
            return rate;
          },
        },
      }),
    );
    expect(asked).toEqual([TODAY]);
  });

  it('sends a missing rate as null', async () => {
    rate = undefined;
    const res = (await view(deps(), event())) as ApiResult;
    expect(JSON.parse(res.body).fx).toBeNull();
  });

  // A row under the fund's ref too, which the archive never writes: the fund is refused by its
  // kind, not by the row's absence.
  it('hands the build each linked bond’s payment dates, and none for a fund', async () => {
    await linkBond();
    await terms('2026-07-27', BOND_REF, PAYMENT_DATES);
    await terms('2026-07-27', ENERGY_REF, ['2026-08-01']);
    vi.mocked(buildView).mockClear();

    expect((await view(deps(), event())).statusCode).toBe(200);
    expect(vi.mocked(buildView)).toHaveBeenCalledTimes(1);
    const [input] = vi.mocked(buildView).mock.calls[0];
    expect(input.paymentDates).toEqual(new Map([[BOND, PAYMENT_DATES]]));
  });
});

describe('the read’s validator', () => {
  it('is weak', async () => {
    expect(await tagOf()).toMatch(/^W\/"[A-Za-z0-9_-]+"$/);
  });

  it('is the same for the same inputs', async () => {
    expect(await tagOf()).toBe(await tagOf());
  });

  // ONE TEST PER INPUT: composing is only sound while the set is complete, and nothing else
  // documents it. Each moves exactly one.
  it('moves with the caller: two people with identical rows never share one', async () => {
    await insertUser(db, TWIN, TWIN_EMAIL);
    await writeLedger(db, TWIN, LEDGER);
    const [mine, theirs] = [await tagOf(), await tagOf(deps(), event({}, TWIN, TWIN_EMAIL))];
    const versions = await db.query<{ v: string }>('SELECT data_version::text AS v FROM app_user');
    expect(versions.rows.map((r) => r.v)).toEqual(['0', '0']);
    expect(theirs).not.toBe(mine);
  });

  it('moves with the stored version', async () => {
    const before = await tagOf();
    await db.query('UPDATE app_user SET data_version = data_version + 1 WHERE user_id = $1', [SUB]);
    expect(await tagOf()).not.toBe(before);
  });

  // The owner's ruling on #190: the strong tag a write sends back rides in the body.
  it('carries the write’s strong tag in its body, apart from its own weak one', async () => {
    const etagOf = async () =>
      (JSON.parse(((await view(deps(), event())) as ApiResult).body) as { etag: string }).etag;
    expect(await etagOf()).toBe('"0"');
    await db.query('UPDATE app_user SET data_version = data_version + 1 WHERE user_id = $1', [SUB]);
    expect(await etagOf()).toBe('"1"');
  });

  it('moves with the archive rows the ledger reads', async () => {
    const before = await tagOf();
    await observe('2026-07-28', ENERGY_REF, 10.4);
    expect(await tagOf()).not.toBe(before);
  });

  it('moves with the payment dates a linked bond is served', async () => {
    await linkBond();
    await terms('2026-07-27', BOND_REF, PAYMENT_DATES);
    const before = await tagOf();
    await terms('2026-07-28', BOND_REF, ['2026-02-25', '2026-08-25', '2027-02-24']);
    expect(await tagOf()).not.toBe(before);
  });

  it('moves with the rate served', async () => {
    const before = await tagOf();
    rate = { ...RATE, rate: 41.5 };
    expect(await tagOf()).not.toBe(before);
  });

  // A fallback rate from an earlier day tags apart from today's, even at the same value.
  it('moves with the day the rate is for', async () => {
    const before = await tagOf();
    rate = { ...RATE, date: '2026-07-27' };
    expect(await tagOf()).not.toBe(before);
  });

  it('moves with the Kyiv day', async () => {
    // 23:59 and 00:00 in Kyiv, summer time.
    const late = await tagOf(deps({ now: () => Date.parse('2026-07-28T20:59:00Z') }));
    const next = await tagOf(deps({ now: () => Date.parse('2026-07-28T21:00:00Z') }));
    expect(late).toBe(await tagOf());
    expect(next).not.toBe(late);
  });

  it('moves with the derivation identifier', async () => {
    expect(await tagOf(deps({ derivationId: 'derivation-b' }))).not.toBe(await tagOf());
  });
});

describe('the rows and facts the editors read', () => {
  const REIT = LEDGER.assets[SEED_ASSETS.findIndex((a) => a.id === 'reit')].id;
  const NEW_ID = '00000000-0000-4000-8000-0000000000f1';
  const deposit = (date: string): Transaction => ({
    id: NEW_ID,
    date,
    type: 'deposit',
    assetId: '',
    amount: 100,
  });
  const answer = async () =>
    JSON.parse(((await view(deps(), event())) as ApiResult).body) as ViewBody & { etag: string };

  it('answers every asset and every transaction, rows dated after today included', async () => {
    await writeLedger(db, SUB, {
      assets: [],
      transactions: [deposit('2026-08-15')],
      userPrices: [],
    });
    const body = await answer();
    expect(body.assets.map((a) => a.id).sort()).toEqual(LEDGER.assets.map((a) => a.id).sort());
    expect(body.transactions.map((t) => t.id).sort()).toEqual(
      [...LEDGER.transactions.map((t) => t.id), NEW_ID].sort(),
    );
    expect(body.transactions.at(-1)?.id).toBe(NEW_ID);
  });

  // A deposit today makes today a grid day, and the archive prices the fund today: the rebuilt
  // series quotes it, and the user recorded nothing.
  it('reports only the quotes the user recorded, not a carried grid day or an archive price', async () => {
    await writeLedger(db, SUB, { assets: [], transactions: [deposit(TODAY)], userPrices: [] });
    await observe(TODAY, ENERGY_REF, 10.4);
    const { today } = await answer();
    expect(today.date).toBe(TODAY);
    expect(today.quotes).toEqual({});
    expect(today.previous[REIT]).toEqual({ value: 68702.1, date: '2026-07-27' });
    // Not the archive's 26th and 27th, nor today.
    expect(today.previous[ENERGY]).toEqual({ value: 60086.09, date: '2026-07-25' });
  });

  it('reports a quote the user recorded today, and the last before it', async () => {
    await db.query(
      `INSERT INTO user_price (dataset_id, asset_id, as_of, price, observed_at)
       SELECT dataset_id, $1, $2, 11, now() FROM app_user WHERE user_id = $3`,
      [REIT, TODAY, SUB],
    );
    const { today } = await answer();
    expect(Object.keys(today.quotes)).toEqual([REIT]);
    expect(today.previous[REIT]).toEqual({ value: 68702.1, date: '2026-07-27' });
  });

  it('names the latest witness time of the user’s prices, whichever day carries it', async () => {
    await db.query('UPDATE user_price SET observed_at = NULL');
    expect((await answer()).today.savedAt).toBeNull();
    await db.query(`UPDATE user_price SET observed_at = '2026-07-20T10:15:30Z' WHERE as_of = $1`, [
      '2026-02-03',
    ]);
    await db.query(`UPDATE user_price SET observed_at = '2026-07-01T08:00:00Z' WHERE as_of = $1`, [
      '2026-07-27',
    ]);
    expect((await answer()).today.savedAt).toBe('2026-07-20T10:15:30');
  });

  // The count is what `asset.delete` removes: every price row of the asset, a day its position holds
  // none included.
  it('counts the rows deleting each asset removes', async () => {
    const quoted = LEDGER.assets[SEED_ASSETS.findIndex((a) => a.id === 'ovdp6475')].id;
    await db.query(
      `INSERT INTO user_price (dataset_id, asset_id, as_of, price, observed_at)
       SELECT dataset_id, $1, '2026-01-01', 100, now() FROM app_user WHERE user_id = $2`,
      [quoted, SUB],
    );
    const { deleteCounts: counted } = await answer();
    const rows = async (table: string, assetId: string) =>
      (
        await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${table} WHERE asset_id = $1`,
          [assetId],
        )
      ).rows[0].n;
    for (const { id } of LEDGER.assets) {
      const before = {
        transactions: await rows('"transaction"', id),
        quoteDays: await rows('user_price', id),
      };
      expect(counted[id]).toEqual(before);
      expect(await deleteAsset(db as unknown as SqlClient, SUB, id, 10_000)).toEqual({
        deleted: before.transactions + before.quoteDays + 1,
      });
    }
    expect(counted[quoted].quoteDays).toBeGreaterThan(0);
  });

  it('lists the body’s keys exactly, as the published example does', async () => {
    const keys = ['view', 'fx', 'assets', 'transactions', 'today', 'deleteCounts', 'etag'];
    const body = await answer();
    expect(Object.keys(body)).toEqual(keys);
    expect(Object.keys(body.today)).toEqual(['date', 'quotes', 'previous', 'savedAt']);
    const document = JSON.parse(
      readFileSync(new URL('../../docs/reference/openapi.json', import.meta.url), 'utf8'),
    );
    const example =
      document.paths['/view'].get.responses['200'].content['application/json'].examples.view.value;
    expect(Object.keys(example)).toEqual(keys);
    expect(Object.keys(example.today)).toEqual(Object.keys(body.today));
  });
});

describe('a repeated request', () => {
  it('is answered 304 with the validator and the cache policy, and nothing else', async () => {
    const etag = await tagOf();
    const res = (await view(deps(), event({ 'if-none-match': etag }))) as EmptyResult;
    expect(res).toEqual({
      statusCode: 304,
      headers: { etag, 'cache-control': 'private, no-cache' },
    });
    expect('body' in res).toBe(false);
    expect('content-type' in res.headers).toBe(false);
  });

  // RFC 9110 §13.1.2: If-None-Match compares weakly, so the tag without its `W/` still matches.
  it('matches by weak comparison', async () => {
    const etag = await tagOf();
    const res = await view(deps(), event({ 'if-none-match': etag.slice(2) }));
    expect(res.statusCode).toBe(304);
  });

  it('matches a list holding the tag anywhere', async () => {
    const etag = await tagOf();
    const res = await view(deps(), event({ 'if-none-match': `W/"elsewhere", ${etag}` }));
    expect(res.statusCode).toBe(304);
  });

  it('matches *, a current representation always existing', async () => {
    expect((await view(deps(), event({ 'if-none-match': '*' }))).statusCode).toBe(304);
  });

  it('answers in full to a tag it did not give', async () => {
    const res = await view(deps(), event({ 'if-none-match': 'W/"elsewhere"' }));
    expect(res.statusCode).toBe(200);
  });
});

describe('the read’s validator is no write precondition', () => {
  // RFC 9110 §13.1.1: If-Match compares strongly, and a weak tag never matches strongly.
  it('fails If-Match with its own tag', async () => {
    const etag = await tagOf();
    const res = (await view(deps(), event({ 'if-match': etag }))) as ApiResult;
    expect([res.statusCode, res.body]).toEqual([412, '{"error":"precondition_failed"}']);
  });

  it('fails If-Match with its own tag stripped of W/', async () => {
    const etag = await tagOf();
    expect((await view(deps(), event({ 'if-match': etag.slice(2) }))).statusCode).toBe(412);
  });

  it('passes If-Match: *', async () => {
    expect((await view(deps(), event({ 'if-match': '*' }))).statusCode).toBe(200);
  });
});

describe('what a browser may keep and read', () => {
  it('may be stored by the browser alone, and revalidated every time', async () => {
    const res = (await view(deps(), event())) as ApiResult;
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(res.headers['cache-control']).not.toContain('must-revalidate');
  });

  // The identifier is in the tag too, so a client holding an older one never gets a 304 for it.
  it('names the derivation it was built by, which a client of an older one can compare', async () => {
    const older = await tagOf(deps({ derivationId: 'derivation-a' }));
    const res = (await view(
      deps({ derivationId: 'derivation-b' }),
      event({ 'if-none-match': older }),
    )) as ApiResult;
    expect(res.statusCode).toBe(200);
    expect(res.headers['derivation-id']).toBe('derivation-b');
  });

  it('exposes exactly the headers a script reads', () => {
    expect([...EXPOSED].sort()).toEqual(['derivation-id', 'etag', 'location']);
  });

  it('carries the identifier the build defined', () => {
    expect(derivationId()).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe.each(ROUTES)('the gate of %s', (route) => {
  it('tells a pending applicant to wait', async () => {
    await db.query("UPDATE app_user SET status = 'pending', decided_at = NULL, decided_by = NULL");
    const res = (await view(deps(), on(route))) as ApiResult;
    expect([res.statusCode, res.body]).toEqual([403, '{"error":"pending"}']);
  });

  it('tells a rejected applicant to stop', async () => {
    await db.query("UPDATE app_user SET status = 'rejected'");
    const res = (await view(deps(), on(route))) as ApiResult;
    expect([res.statusCode, res.body]).toEqual([403, '{"error":"rejected"}']);
  });

  it('tells a caller with no row that there is no application', async () => {
    const res = (await view(deps(), on(route, undefined, {}, TWIN, TWIN_EMAIL))) as ApiResult;
    expect([res.statusCode, res.body]).toEqual([403, '{"error":"no_application"}']);
  });

  it('refuses the demo as a non-caller', async () => {
    await insertUser(db, DEMO_USER_ID, DEMO_USER_EMAIL, 'active', 'demo');
    const res = (await view(deps(), on(route, undefined, {}, TWIN, DEMO_USER_EMAIL))) as ApiResult;
    expect([res.statusCode, res.body]).toEqual([403, '{"error":"forbidden"}']);
  });
});

describe('a failure answers rather than throws', () => {
  it('answers a refused archive with its own 500, and closes the connection', async () => {
    const res = (await view(
      deps({
        archive: async () => {
          opened += 1;
          return {
            query: async () => {
              throw Object.assign(new Error('role not mapped'), { code: '28000' });
            },
            end: async () => {
              ended += 1;
            },
          } as unknown as Awaited<ReturnType<ViewDeps['archive']>>;
        },
      }),
      event(),
    )) as ApiResult;
    expect([res.statusCode, res.body]).toEqual([500, '{"error":"internal"}']);
    expect([opened, ended]).toEqual([1, 1]);
  });

  // The handler ends the user connection once this answers, and a missing rate is being stored on
  // it: a refused archive must not answer first.
  it('answers a refused archive only once the rate read has finished', async () => {
    let finished = false;
    const res = await view(
      deps({
        archive: async () => {
          throw Object.assign(new Error('role not mapped'), { code: '28000' });
        },
        rate: {
          served: async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
            finished = true;
            return rate;
          },
        },
      }),
      event(),
    );
    expect(res.statusCode).toBe(500);
    expect(finished).toBe(true);
  });

  // One error is thrown and answered; the other would leave no trace, a transport failure logging
  // no metric line of its own.
  it('logs the archive’s failure when the rate read fails too', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unreachable = new Error('archive unreachable');
    const res = await view(
      deps({
        archive: async () => {
          throw unreachable;
        },
        rate: {
          served: async () => {
            throw new Error('rate store failed');
          },
        },
      }),
      event(),
    );
    expect(res.statusCode).toBe(500);
    expect(logged.mock.calls.some((call) => call.includes(unreachable))).toBe(true);
  });

  // A route the template adds without a branch here: answered, and named in the log.
  it('answers a route it does not serve with a 500 that names it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await viewRoute(deps(), on('GET /view/other', null));
    expect(res).toEqual(expect.objectContaining({ statusCode: 500, body: '{"error":"internal"}' }));
    expect(logged.mock.calls.some((call) => call.includes('GET /view/other'))).toBe(true);
  });

  it.each(ROUTES)('answers a connection failure on %s with its own 500', async (route) => {
    const res = await rawHandler(on(route));
    record(on(route), res);
    expect(res).toEqual(expect.objectContaining({ statusCode: 500, body: '{"error":"internal"}' }));
  });

  it.each([SERIES_ROUTE, BALANCES_ROUTE])(
    'answers a refused archive on %s with a 500',
    async (route) => {
      const res = (await view(
        deps({
          archive: async () => {
            throw Object.assign(new Error('role not mapped'), { code: '28000' });
          },
        }),
        on(route),
      )) as ApiResult;
      expect([res.statusCode, res.body]).toEqual([500, '{"error":"internal"}']);
    },
  );
});

/** A 200's parsed body, the status checked first. */
const bodyOf = async <T>(e: ApiEvent, d = deps()): Promise<T> => {
  const res = (await view(d, e)) as ApiResult;
  expect([res.statusCode, res.body.slice(0, 80)]).toEqual([200, res.body.slice(0, 80)]);
  return JSON.parse(res.body) as T;
};

describe('GET /view/series answers one period’s curve', () => {
  // A ledger held since the January before, so the six windows open on six days.
  const LONG = withUuids(LONG_ROWS);
  const seriesOf = (period: string) =>
    bodyOf<{ period: string; series: unknown[] }>(
      on(SERIES_ROUTE, { period }, {}, TWIN, TWIN_EMAIL),
    );

  beforeEach(async () => {
    await insertUser(db, TWIN, TWIN_EMAIL);
    await writeLedger(db, TWIN, LONG);
  });

  it.each(PERIOD_OPTIONS)(
    '%s: core’s curve for that period, over the caller’s rows',
    async (period) => {
      expect(await seriesOf(period)).toEqual(
        JSON.parse(JSON.stringify(seriesBody(rowsOf(LONG, []), period))),
      );
    },
  );

  it('answers each period a curve no other period gets', async () => {
    const curves: string[] = [];
    for (const period of PERIOD_OPTIONS)
      curves.push(JSON.stringify((await seriesOf(period)).series));
    expect(new Set(curves).size).toBe(PERIOD_OPTIONS.length);
  });

  it('reads the archive as GET /view does', async () => {
    expect(await bodyOf(on(SERIES_ROUTE, { period: '1m' }))).toEqual(
      JSON.parse(JSON.stringify(seriesBody(rowsOf(LEDGER), '1m'))),
    );
  });
});

describe('GET /view/balances answers one page of the table', () => {
  type Page = {
    assets: string[];
    rows: unknown[];
    page: number;
    total: number;
    next: number | null;
  };
  const expected = (page: number) => JSON.parse(JSON.stringify(balancesBody(rowsOf(LEDGER), page)));

  it('answers the first page to a request naming none', async () => {
    expect(await bodyOf(on(BALANCES_ROUTE, {}))).toEqual(expected(0));
    expect(await bodyOf(on(BALANCES_ROUTE, null))).toEqual(expected(0));
  });

  it('answers the page asked for', async () => {
    expect(await bodyOf(on(BALANCES_ROUTE, { page: '3' }))).toEqual(expected(3));
  });

  // The constant is mocked to 5 for this file: a route cutting its own pages would answer 6.
  it('pages by the size core names', async () => {
    const first = await bodyOf<Page>(on(BALANCES_ROUTE, { page: '0' }));
    expect([first.rows.length, first.next]).toEqual([5, 1]);
  });

  it('names no next on the last page, and answers past it with no rows', async () => {
    const { total } = await bodyOf<Page>(on(BALANCES_ROUTE, { page: '0' }));
    const last = Math.ceil(total / 5) - 1;
    expect((await bodyOf<Page>(on(BALANCES_ROUTE, { page: String(last) }))).next).toBeNull();
    const past = await bodyOf<Page>(on(BALANCES_ROUTE, { page: String(last + 1) }));
    expect([past.rows, past.page, past.next]).toEqual([[], last + 1, null]);
  });

  it('names the caller’s assets, the cells’ order', async () => {
    const { assets } = await bodyOf<Page>(on(BALANCES_ROUTE, {}));
    expect([...assets].sort()).toEqual(LEDGER.assets.map((a) => a.id).sort());
  });
});

// Each request's tag is its own representation's: a client keeping one tag per route would otherwise
// be answered 304 for a period or a page it never stored.
describe('each parameterized read tags its own representation', () => {
  const tagOn = async (e: ApiEvent, d = deps()) => {
    const res = (await view(d, e)) as ApiResult;
    expect(res.statusCode).toBe(200);
    return res.headers.etag;
  };
  const SIBLINGS = [SERIES_ROUTE, BALANCES_ROUTE];

  it('gives every route, period and page a tag of its own', async () => {
    const tags: string[] = [];
    for (const e of [
      on(ROUTE),
      on(SERIES_ROUTE, { period: 'all' }),
      on(SERIES_ROUTE, { period: '1m' }),
      on(BALANCES_ROUTE, { page: '0' }),
      on(BALANCES_ROUTE, { page: '1' }),
    ]) {
      tags.push(await tagOn(e));
    }
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('tags the first page alike, named or not', async () => {
    expect(await tagOn(on(BALANCES_ROUTE, null))).toBe(
      await tagOn(on(BALANCES_ROUTE, { page: '0' })),
    );
  });

  it.each(SIBLINGS)('%s sends a weak tag, GET /view’s policy and its derivation', async (route) => {
    const res = (await view(deps(), on(route))) as ApiResult;
    expect(res.statusCode).toBe(200);
    expect(res.headers).toEqual({
      'content-type': 'application/json',
      etag: expect.stringMatching(/^W\/"[A-Za-z0-9_-]+"$/),
      'cache-control': 'private, no-cache',
      'derivation-id': 'derivation-a',
    });
  });

  it.each(SIBLINGS)('%s answers its own tag 304', async (route) => {
    const etag = await tagOn(on(route));
    const res = (await view(
      deps(),
      on(route, undefined, { 'if-none-match': etag }),
    )) as EmptyResult;
    expect(res).toEqual({
      statusCode: 304,
      headers: { etag, 'cache-control': 'private, no-cache' },
    });
  });

  it.each(SIBLINGS)('%s answers GET /view’s tag in full', async (route) => {
    const res = await view(deps(), on(route, undefined, { 'if-none-match': await tagOf() }));
    expect(res.statusCode).toBe(200);
  });

  // The rest of the read's inputs move it as they move GET /view's: one stands for them here.
  it.each(SIBLINGS)('%s moves with the stored version', async (route) => {
    const before = await tagOn(on(route));
    await db.query('UPDATE app_user SET data_version = data_version + 1 WHERE user_id = $1', [SUB]);
    expect(await tagOn(on(route))).not.toBe(before);
  });

  it.each(SIBLINGS)('%s fails If-Match with its own tag', async (route) => {
    const etag = await tagOn(on(route));
    const res = (await view(deps(), on(route, undefined, { 'if-match': etag }))) as ApiResult;
    expect([res.statusCode, res.body]).toEqual([412, '{"error":"precondition_failed"}']);
  });
});

describe('a period or page the route cannot read is refused by name', () => {
  const refused = (field: string, value?: string) => ({
    error: 'invalid_query',
    issues: [{ field, code: 'invalid', ...(value === undefined ? {} : { value }) }],
  });
  const answer = async (route: string, query: Record<string, string> | null, d = deps()) => {
    const res = (await view(d, on(route, query))) as ApiResult;
    return [res.statusCode, JSON.parse(res.body)];
  };

  // A stale tab is the known failure: a period retired from the list, or one never on it.
  it.each(['1y', 'ALL', '', '1m,3m', 'toString'])(
    'refuses the period %j rather than defaulting',
    async (period) => {
      expect(await answer(SERIES_ROUTE, { period })).toEqual([400, refused('period', period)]);
    },
  );

  it('refuses a series request naming no period', async () => {
    expect(await answer(SERIES_ROUTE, {})).toEqual([400, refused('period')]);
    expect(await answer(SERIES_ROUTE, null)).toEqual([400, refused('period')]);
  });

  it.each(['-1', '01', '+1', '1.0', '1e3', 'x', '', ' 1', '0,1', '9007199254740992'])(
    'refuses the page %j',
    async (page) => {
      expect(await answer(BALANCES_ROUTE, { page })).toEqual([400, refused('page', page)]);
    },
  );

  // AIP-211: authorization is checked before the request is validated, so a caller the gate
  // refuses hears that, whatever the query says.
  it.each([
    [SERIES_ROUTE, { period: '1y' }],
    [BALANCES_ROUTE, { page: 'x' }],
  ])('%s answers a pending caller its 403 before a bad query', async (route, query) => {
    await db.query("UPDATE app_user SET status = 'pending', decided_at = NULL, decided_by = NULL");
    const res = (await view(deps(), on(route, query))) as ApiResult;
    expect([res.statusCode, res.body]).toEqual([403, '{"error":"pending"}']);
  });

  // Checked once the gate admits the caller: a malformed request costs no ledger, rate or archive.
  it('refuses before the ledger is read', async () => {
    const asked: string[] = [];
    const user = {
      query: (text: string, values?: unknown[]) => {
        asked.push(text);
        return db.query(text, values);
      },
    } as unknown as SqlClient;
    let rated = 0;
    const d = deps({
      user,
      rate: {
        served: async () => {
          rated += 1;
          return rate;
        },
      },
    });
    expect(await answer(SERIES_ROUTE, { period: '1y' }, d)).toEqual([400, refused('period', '1y')]);
    expect(await answer(BALANCES_ROUTE, { page: 'x' }, d)).toEqual([400, refused('page', 'x')]);
    // The gate read the caller's row; nothing after it ran.
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.filter((text) => /READ ONLY/i.test(text))).toEqual([]);
    expect([rated, opened]).toEqual([0, 0]);
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: 30 });
