// `importChartHistory` on PGlite with the cluster connection and the network replaced: each fund's
// chart answers with the recorded body, and the clock stands on the day the bodies were recorded.
import { readFileSync } from 'node:fs';

import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { handler } from './capture';
import {
  CHART_ASSETS,
  CHART_EXCLUSIONS,
  chartUrl,
  parseChart,
  type ChartBasis,
  type ChartPoint,
} from './chart-history';
import { connect } from './dsql';

vi.mock('./dsql', () => ({ connect: vi.fn() }));

const BODY: Record<number, string> = Object.fromEntries(
  [13, 21].map((id) => [
    id,
    readFileSync(new URL(`./__fixtures__/chart-${id}-2026-10-21.json`, import.meta.url), 'utf8'),
  ]),
);
const POINTS: Record<string, ChartPoint[]> = Object.fromEntries(
  Object.entries(CHART_ASSETS).map(([ref, id]) => [ref, parseChart(BODY[id], ref, id)]),
);

/** The day the bodies were recorded on; both already carry a point for it. */
const TODAY = '2026-10-21';
const API_ROBOTS = 'https://api.inzhur.reit/robots.txt';

let db: PGlite;
/** An observation insert to fail, by a value it carries, to reach the import's rollback. */
let failOn: RegExp | undefined;
/** How each chart answers; the default is its recorded body. */
let answer: (id: number) => Response;
/** Run once, just before the import opens its transaction: another writer committing between the
 *  plan's read and its write. */
let racing: (() => Promise<unknown>) | undefined;
let requested: string[];

beforeEach(async () => {
  db = await freshDb();
  failOn = undefined;
  racing = undefined;
  requested = [];
  answer = (id) => new Response(BODY[id], { status: 200 });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T04:00:00Z`));
  vi.mocked(connect).mockResolvedValue({
    query: async (text: string, values?: unknown[]) => {
      const insert = /^\s*INSERT INTO price_observation/.test(text);
      if (insert && failOn !== undefined && values?.some((v) => failOn!.test(String(v)))) {
        throw new Error('injected failure');
      }
      if (text.trim() === 'BEGIN' && racing !== undefined) {
        const race = racing;
        racing = undefined;
        await race();
      }
      const r = await db.query(text.replace(/\bINDEX\s+ASYNC\b/i, 'INDEX'), values);
      return { ...r, rowCount: r.affectedRows };
    },
    end: async () => {},
  } as unknown as Awaited<ReturnType<typeof connect>>);
  // The API host publishes no robots.txt, which RFC 9309 reads as no rule.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    requested.push(url);
    const id = /\/assets\/(\d+)\/graph\?period=all$/.exec(url)?.[1];
    return id === undefined ? new Response('', { status: 404 }) : answer(Number(id));
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const schema = () =>
  handler({ observe: { source: 'inzhur', from: '2026-09-01', to: '2026-09-01' } });
const run = () => handler({ importChartHistory: {} });

interface BasisReport {
  written: number;
  agreed: number;
  excluded: number;
  unpriced: number;
  from: string | null;
  to: string | null;
}
interface Report {
  observedAt: string;
  refs: {
    ref: string;
    points: number;
    provisional: number;
    bases: Record<ChartBasis, BasisReport>;
  }[];
}
const ofRef = (report: Report, ref: string) => report.refs.find((r) => r.ref === ref)!;

const rows = async (where = 'true', values: unknown[] = []) =>
  (
    await db.query<{ row: string }>(
      `SELECT concat_ws(' ', to_char(as_of, 'YYYY-MM-DD'), instrument_ref, basis, price::text,
                        parser_version) AS row
         FROM price_observation WHERE ${where} ORDER BY 1`,
      values,
    )
  ).rows.map((r) => r.row);

const observe = (asOf: string, ref: string, basis: string, price: string, parserVersion: string) =>
  db.query(
    `INSERT INTO price_observation
       (as_of, instrument_ref, basis, source, price, observed_at, parser_version)
     VALUES ($1, $2, $3, 'inzhur', $4, now(), $5)`,
    [asOf, ref, basis, price, parserVersion],
  );

const charted = (ref: string, asOf: string, basis: ChartBasis): number => {
  const p = POINTS[ref].find((x) => x.date === asOf);
  const price = basis === 'buy' ? p?.marketPrice : p?.nav;
  if (price === undefined || price === null) throw new Error(`${asOf} ${ref} ${basis} unpriced`);
  return price;
};

/** The committed exclusions are disagreements the deployed archive holds; here each is seeded as
 *  a row one whole unit off the chart, so the list is exercised and not refused as stale. */
const seedExclusions = async () => {
  for (const e of CHART_EXCLUSIONS) {
    const off = String(Math.round(charted(e.ref, e.asOf, e.basis)) + 1);
    await observe(e.asOf, e.ref, e.basis, off, 'fund-history-1');
  }
};
const excluded = (ref: string, basis: ChartBasis) =>
  CHART_EXCLUSIONS.filter((e) => e.ref === ref && e.basis === basis).length;

/** Priced days before the run's day in each recorded body: Energy's 76 unpriced days and the
 *  run-day point of each fund are taken out. */
const PRICED = { 'inzhur-energy': 708 - 76 - 1, 'inzhur-reit': 416 - 1 };

/** The nav seam between the price file and the first capture, 2026-07-07 … 2026-08-10. */
const SEAM = `basis = 'nav' AND as_of BETWEEN '2026-07-07' AND '2026-08-10'`;

describe('importChartHistory', () => {
  it('writes each fund’s buy and nav for every priced day before the run’s day, under chart-1', async () => {
    await schema();
    await seedExclusions();
    const result = (await run()) as Report;
    expect(requested).toEqual([API_ROBOTS, chartUrl(13), chartUrl(21)]);
    expect(await rows(`instrument_ref = 'inzhur-reit' AND as_of = '2026-05-11'`)).toEqual([
      '2026-05-11 inzhur-reit buy 10.8238 chart-1',
      '2026-05-11 inzhur-reit nav 10.7166 chart-1',
    ]);
    expect(await rows(`instrument_ref = 'inzhur-energy' AND as_of <= '2024-11-15'`)).toEqual([
      '2024-11-14 inzhur-energy buy 6034.19 chart-1',
      '2024-11-14 inzhur-energy nav 6034.19 chart-1',
    ]);
    for (const ref of Object.keys(CHART_ASSETS) as (keyof typeof PRICED)[]) {
      for (const basis of ['buy', 'nav'] as const) {
        expect(ofRef(result, ref).bases[basis].written).toBe(PRICED[ref] - excluded(ref, basis));
        expect(ofRef(result, ref).bases[basis].excluded).toBe(excluded(ref, basis));
      }
    }
    expect(ofRef(result, 'inzhur-energy')).toMatchObject({ points: 708, provisional: 1 });
    expect(ofRef(result, 'inzhur-energy').bases.buy).toMatchObject({
      unpriced: 76,
      from: '2024-11-14',
      to: '2026-10-20',
    });
    // The run's own day is tonight's capture to observe, never a copied point.
    expect(await rows(`as_of >= '${TODAY}'`)).toEqual([]);
    const stamps = await db.query<{ t: string }>(
      `SELECT DISTINCT to_char(observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS t
         FROM price_observation WHERE parser_version = 'chart-1'`,
    );
    expect(stamps.rows.map((r) => r.t)).toEqual([result.observedAt]);
  });

  it('leaves a held row as it is and counts it agreed, so the seam closes around the Wayback day', async () => {
    await schema();
    await seedExclusions();
    await observe('2026-07-28', 'inzhur-reit', 'nav', '11.0395', 'wayback-1');
    await observe('2026-05-11', 'inzhur-energy', 'nav', '6468.768200', 'fund-history-1');
    const result = (await run()) as Report;
    expect(await rows(`as_of = '2026-07-28' AND instrument_ref = 'inzhur-reit'`)).toEqual([
      '2026-07-28 inzhur-reit buy 11.1499 chart-1',
      '2026-07-28 inzhur-reit nav 11.0395 wayback-1',
    ]);
    expect(await rows(`as_of = '2026-05-11' AND instrument_ref = 'inzhur-energy'`)).toEqual([
      '2026-05-11 inzhur-energy buy 6533.4559 chart-1',
      '2026-05-11 inzhur-energy nav 6468.768200 fund-history-1',
    ]);
    expect(ofRef(result, 'inzhur-reit').bases.nav.agreed).toBe(1);
    expect(ofRef(result, 'inzhur-energy').bases.nav.agreed).toBe(1);
    expect(
      await rows(`instrument_ref = 'inzhur-reit' AND parser_version = 'chart-1' AND ${SEAM}`),
    ).toHaveLength(34);
  });

  it('writes nothing when a held row disagrees', async () => {
    await schema();
    await seedExclusions();
    await observe('2026-05-11', 'inzhur-reit', 'nav', '10.7167', 'fund-history-1');
    const before = await rows();
    await expect(run()).rejects.toThrow(
      /2026-05-11 inzhur-reit nav: the archive's fund-history-1 row disagrees/,
    );
    expect(await rows()).toEqual(before);
  });

  it('writes nothing the second time, every planned key now held and agreeing', async () => {
    await schema();
    await seedExclusions();
    const first = (await run()) as Report;
    const after = await rows();
    const second = (await run()) as Report;
    for (const ref of Object.keys(CHART_ASSETS)) {
      for (const basis of ['buy', 'nav'] as const) {
        expect(ofRef(second, ref).bases[basis]).toMatchObject({
          written: 0,
          agreed: ofRef(first, ref).bases[basis].written,
          excluded: excluded(ref, basis),
          from: null,
          to: null,
        });
      }
    }
    expect(await rows()).toEqual(after);
  });

  it('refuses a chart that is not a 200, or not the asset asked for, before anything is written', async () => {
    await schema();
    await seedExclusions();
    const before = await rows();
    answer = (id) => (id === 21 ? new Response('gone', { status: 404 }) : new Response(BODY[13]));
    await expect(run()).rejects.toThrow('chart refused:\ninzhur-reit: HTTP 404');
    expect(requested).toContain(chartUrl(13));
    answer = (id) => (id === 21 ? new Response(null, { status: 204 }) : new Response(BODY[13]));
    await expect(run()).rejects.toThrow('chart refused:\ninzhur-reit: HTTP 204');
    answer = (id) => new Response(BODY[id === 21 ? 13 : 21], { status: 200 });
    await expect(run()).rejects.toThrow(
      'chart refused:\ninzhur-energy: it answered asset 21, not 13',
    );
    expect(await rows()).toEqual(before);
  });

  it('refuses a free key on a day the capture journal holds, writing nothing', async () => {
    await schema();
    await seedExclusions();
    await db.query(
      `INSERT INTO price_capture (id, requested_at, as_of, source, ok, payload_gzip, payload_bytes,
                                  payload_sha256, parser_version)
       VALUES (gen_random_uuid(), now(), '2026-05-11', 'inzhur', true, '\\x00', 1, 'x', '2')`,
    );
    // A failed read the observer derives past is a captured day too.
    await db.query(
      `INSERT INTO price_capture (id, requested_at, as_of, source, ok, error, payload_gzip,
                                  payload_bytes, payload_sha256, parser_version)
       VALUES (gen_random_uuid(), now(), '2026-05-12', 'inzhur', false,
               'schedule absent: UA4000236475', '\\x00', 1, 'x', '2')`,
    );
    const before = await rows();
    const message = await run().then(
      () => 'no refusal',
      (err: Error) => err.message,
    );
    expect(message).toMatch(
      /2026-05-11 inzhur-energy buy: captured that day, so its payload is the source/,
    );
    expect(message).toMatch(/2026-05-12 inzhur-energy buy: captured that day/);
    expect(await rows()).toEqual(before);
  });

  it('writes no row when a write fails partway', async () => {
    await schema();
    await seedExclusions();
    const before = await rows();
    failOn = /^inzhur-reit$/;
    await expect(run()).rejects.toThrow('injected failure');
    expect(await rows()).toEqual(before);
  });

  it('refuses a key another writer filled between its read and its insert, writing nothing', async () => {
    await schema();
    await seedExclusions();
    const before = await rows();
    racing = () => observe('2026-05-11', 'inzhur-reit', 'buy', '1.00', '2');
    await expect(run()).rejects.toThrow(/written since the plan read the archive/);
    const after = await rows();
    expect(after).toHaveLength(before.length + 1);
    expect(after).toContain('2026-05-11 inzhur-reit buy 1.00 2');
    expect(after.filter((r) => r.endsWith(' chart-1'))).toEqual([]);
  });

  it('widens listed_from to the first priced point and claims nothing about last_seen_on', async () => {
    await schema();
    await seedExclusions();
    await db.query(
      `INSERT INTO instrument (ref, kind, currency, listed_from, last_seen_on)
       VALUES ('inzhur-energy', 'fund', 'UAH', '2026-08-11', '2026-10-20')`,
    );
    await run();
    const bounds = await db.query<{ ref: string; f: string; l: string | null }>(
      `SELECT ref, to_char(listed_from, 'YYYY-MM-DD') AS f, to_char(last_seen_on, 'YYYY-MM-DD') AS l
         FROM instrument WHERE kind = 'fund' ORDER BY ref`,
    );
    expect(bounds.rows).toEqual([
      { ref: 'inzhur-energy', f: '2024-11-14', l: '2026-10-20' },
      { ref: 'inzhur-reit', f: '2025-09-01', l: null },
    ]);
  });
});
