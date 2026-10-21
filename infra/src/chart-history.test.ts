import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FUND_SLUGS } from '@quirenote/core/inzhur/offer-page';
import {
  CHART_ASSETS,
  CHART_EXCLUSIONS,
  CHART_PARSER_VERSION,
  chartPlan,
  chartUrl,
  DSQL_TRANSACTION_ROWS,
  parseChart,
  type ChartExclusion,
  type ChartPoint,
} from './chart-history';
import type { ArchivedRow } from './derived-sell';

const body = (id: number) =>
  readFileSync(new URL(`./__fixtures__/chart-${id}-2026-10-21.json`, import.meta.url), 'utf8');
const ENERGY = parseChart(body(13), 'inzhur-energy', 13);
const REIT = parseChart(body(21), 'inzhur-reit', 21);

/** The day the bodies were recorded on, which both of them already price. */
const TODAY = '2026-10-21';

const point = (date: string, marketPrice: number | null, nav: number | null): ChartPoint => ({
  date,
  marketPrice,
  nav,
});

const archived = (
  asOf: string,
  ref: string,
  basis: string,
  price: string,
  parserVersion: string,
): ArchivedRow => ({ asOf, ref, basis, price, parserVersion });

/** The message a plan refuses with, or a failure when it does not refuse. */
function refusal(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected a refusal');
}

const plan = (
  charts: { ref: string; points: readonly ChartPoint[] }[],
  existing: ArchivedRow[] = [],
  exclusions: readonly ChartExclusion[] = [],
  captured: ReadonlySet<string> = new Set(),
) => chartPlan(charts, existing, TODAY, captured, exclusions);

const reit = (...points: ChartPoint[]) => [{ ref: 'inzhur-reit', points }];

describe('the chart route', () => {
  it('asks the app’s own request for each open fund, by the id the offer page keys it with', () => {
    expect(CHART_ASSETS).toEqual({ 'inzhur-energy': 13, 'inzhur-reit': 21 });
    for (const [ref, id] of Object.entries(CHART_ASSETS)) expect(FUND_SLUGS[id]).toBe(ref);
    expect(chartUrl(13)).toBe('https://api.inzhur.reit/core/api/v1/assets/13/graph?period=all');
    expect(CHART_PARSER_VERSION).toBe('chart-1');
  });
});

describe('parseChart', () => {
  it('reads one point per calendar day, in date order, with the two prices or their null', () => {
    expect(ENERGY).toHaveLength(708);
    expect(ENERGY[0]).toEqual(point('2024-11-13', null, null));
    expect(ENERGY[1]).toEqual(point('2024-11-14', 6034.19, 6034.19));
    expect(REIT[0]).toEqual(point('2025-09-01', 10, 10));
    expect(REIT.at(-1)).toEqual(point(TODAY, 11.6228, 11.5938));
  });

  it('refuses a body that is not the chart asked for, before anything is planned', () => {
    const refuse = (b: string) => refusal(() => parseChart(b, 'inzhur-reit', 21));
    expect(refuse('<html>')).toMatch(/^chart refused:\ninzhur-reit: not JSON/);
    expect(refuse('{"assetId":21}')).toMatch(/inzhur-reit: no dataPoints list/);
    expect(refuse(body(13))).toMatch(/inzhur-reit: it answered asset 13, not 21/);
  });

  it('refuses a repeated date and a price it cannot compare to the digit', () => {
    const chart = (points: unknown[]) => JSON.stringify({ assetId: 21, dataPoints: points });
    const refuse = (b: string) => refusal(() => parseChart(b, 'inzhur-reit', 21));
    expect(
      refuse(
        chart([
          { date: '2026-05-11', marketPrice: 10.8238, nav: 10.7166 },
          { date: '2026-05-11', marketPrice: 10.8238, nav: 10.7166 },
        ]),
      ),
    ).toMatch(/inzhur-reit: 2026-05-11 is charted twice/);
    expect(refuse(chart([{ date: '2026-05-11', marketPrice: 10.82381, nav: 10.7166 }]))).toMatch(
      /inzhur-reit: 2026-05-11 buy has more than four decimals/,
    );
    expect(refuse(chart([{ date: '2026-05-11', marketPrice: 'ten', nav: 10.7166 }]))).toMatch(
      /inzhur-reit: 2026-05-11 buy is not a number/,
    );
    expect(refuse(chart([{ date: 'May 11', marketPrice: 10.8238, nav: 10.7166 }]))).toMatch(
      /inzhur-reit: "May 11" is not a date/,
    );
    expect(refuse(chart([{ date: '2026-02-30', marketPrice: 10.8238, nav: 10.7166 }]))).toMatch(
      /inzhur-reit: "2026-02-30" is not a date/,
    );
    expect(refuse(chart([{ date: '2026-05-11', marketPrice: -10.8238, nav: 10.7166 }]))).toMatch(
      /inzhur-reit: 2026-05-11 buy is negative/,
    );
  });

  it('reads a 0 as the provider’s null, as the capture reads a nav of 0', () => {
    const parsed = parseChart(
      JSON.stringify({
        assetId: 21,
        dataPoints: [{ date: '2026-05-11', marketPrice: 0, nav: 10.7166 }],
      }),
      'inzhur-reit',
      21,
    );
    expect(parsed).toEqual([point('2026-05-11', null, 10.7166)]);
  });
});

describe('chartPlan, what a point writes', () => {
  it('plans a buy row from marketPrice and a nav row from nav, dated by the point', () => {
    const { rows } = plan(reit(point('2026-05-11', 10.8238, 10.7166)));
    expect(rows).toEqual([
      { asOf: '2026-05-11', ref: 'inzhur-reit', basis: 'buy', price: 10.8238 },
      { asOf: '2026-05-11', ref: 'inzhur-reit', basis: 'nav', price: 10.7166 },
    ]);
  });

  it('plans nothing for a basis whose price is null, and counts it', () => {
    const { rows, report } = plan(
      reit(point('2026-05-10', null, null), point('2026-05-11', null, 10.7166)),
    );
    expect(rows).toEqual([
      { asOf: '2026-05-11', ref: 'inzhur-reit', basis: 'nav', price: 10.7166 },
    ]);
    expect(report[0].bases.buy).toMatchObject({ written: 0, unpriced: 2, from: null, to: null });
    expect(report[0].bases.nav).toMatchObject({ written: 1, unpriced: 1 });
  });

  it('plans nothing for the run’s own day or later: that point is tonight’s capture to observe', () => {
    const { rows, report } = plan(
      reit(point('2026-10-20', 11.5959, 11.567), point(TODAY, 11.6228, 11.5938)),
    );
    expect(rows.map((r) => r.asOf)).toEqual(['2026-10-20', '2026-10-20']);
    expect(report[0]).toMatchObject({ points: 2, provisional: 1 });
  });

  it('widens listed_from to the first priced point, whether or not the archive holds it', () => {
    const { instruments } = plan(
      reit(
        point('2025-08-31', null, null),
        point('2025-09-01', 10, 10),
        point('2025-09-02', 10, 10),
      ),
      [archived('2025-09-01', 'inzhur-reit', 'buy', '10', 'wayback-1')],
    );
    expect(instruments).toEqual([{ ref: 'inzhur-reit', first: '2025-09-01' }]);
  });

  it('reports per ref and basis, with no money figure', () => {
    const { report } = plan(
      reit(
        point('2026-05-10', 10.8, 10.7),
        point('2026-05-11', 10.8238, 10.7166),
        point('2026-05-12', null, 10.72),
      ),
      [archived('2026-05-11', 'inzhur-reit', 'nav', '10.7166', 'wayback-1')],
    );
    expect(report).toEqual([
      {
        ref: 'inzhur-reit',
        points: 3,
        provisional: 0,
        bases: {
          buy: {
            written: 2,
            agreed: 0,
            excluded: 0,
            unpriced: 1,
            from: '2026-05-10',
            to: '2026-05-11',
          },
          nav: {
            written: 2,
            agreed: 1,
            excluded: 0,
            unpriced: 0,
            from: '2026-05-10',
            to: '2026-05-12',
          },
        },
      },
    ]);
    expect(JSON.stringify(report)).not.toMatch(/10\.7|10\.8/);
  });

  it('refuses a plan DSQL’s transaction cannot hold, naming the count', () => {
    const points: ChartPoint[] = [];
    const start = Date.UTC(2020, 0, 1);
    for (let i = 0; i < 1500; i += 1) {
      points.push(point(new Date(start + i * 86_400_000).toISOString().slice(0, 10), 1, 1));
    }
    expect(DSQL_TRANSACTION_ROWS).toBe(3000);
    expect(refusal(() => plan(reit(...points)))).toMatch(
      /^chart refused:\n3001 rows to write, not under DSQL's 3000-row transaction/,
    );
    expect(plan(reit(...points.slice(1))).rows).toHaveLength(2998);
    // 2999 rows and one instrument reach the ceiling exactly, which refuses: the plan stays under it.
    const edge = [point('2019-12-31', 1, null), ...points.slice(1)];
    expect(refusal(() => plan(reit(...edge)))).toMatch(/^chart refused:\n3000 rows to write/);
  });
});

describe('chartPlan, a day the capture journal holds', () => {
  it('refuses to write a free key there: the payload is that day’s source', () => {
    const captured = new Set(['2026-05-11']);
    const p = point('2026-05-11', 10.8238, 10.7166);
    expect(refusal(() => plan(reit(p), [], [], captured)).split('\n')).toEqual([
      'chart refused:',
      '2026-05-11 inzhur-reit buy: captured that day, so its payload is the source',
      '2026-05-11 inzhur-reit nav: captured that day, so its payload is the source',
    ]);
    // A held key on a captured day is compared as any held key is.
    const { rows, report } = plan(
      reit(p),
      [
        archived('2026-05-11', 'inzhur-reit', 'buy', '10.8238', '2'),
        archived('2026-05-11', 'inzhur-reit', 'nav', '10.7166', '2'),
      ],
      [],
      captured,
    );
    expect(rows).toEqual([]);
    expect(report[0].bases.buy.agreed + report[0].bases.nav.agreed).toBe(2);
  });

  it('leaves a listed free key to the payload, and counts it excluded', () => {
    const captured = new Set(['2026-05-11']);
    const p = point('2026-05-11', 10.8238, 10.7166);
    const listed: ChartExclusion[] = [
      { ref: 'inzhur-reit', basis: 'buy', asOf: '2026-05-11' },
      { ref: 'inzhur-reit', basis: 'nav', asOf: '2026-05-11' },
    ];
    const { rows, report } = plan(reit(p), [], listed, captured);
    expect(rows).toEqual([]);
    expect(report[0].bases.buy).toMatchObject({ written: 0, excluded: 1 });
    expect(report[0].bases.nav).toMatchObject({ written: 0, excluded: 1 });
  });
});

describe('chartPlan, a key the archive already holds', () => {
  const held = (price: string, parserVersion: string) =>
    archived('2026-05-11', 'inzhur-reit', 'nav', price, parserVersion);
  const p = point('2026-05-11', 10.8238, 10.7166);

  it('never writes it; it must agree to the digit whichever parser wrote it', () => {
    for (const [price, version] of [
      ['10.7166', '1'],
      ['10.716600', '2'],
      ['10.7166', 'wayback-1'],
      ['10.71660', 'fund-history-1'],
      ['10.7166', 'chart-1'],
    ]) {
      const { rows, report } = plan(reit(p), [held(price, version)]);
      expect(rows.map((r) => r.basis)).toEqual(['buy']);
      expect(report[0].bases.nav).toMatchObject({ written: 0, agreed: 1 });
    }
  });

  it('refuses a disagreement by ref, basis, day and the held row’s parser, naming no price', () => {
    for (const version of ['1', '2', 'wayback-1', 'fund-history-1']) {
      const message = refusal(() => plan(reit(p), [held('10.7167', version)]));
      expect(message).toBe(
        `chart refused:\n2026-05-11 inzhur-reit nav: the archive's ${version} row disagrees`,
      );
      expect(message).not.toMatch(/10\.716/);
    }
  });

  it('leaves a listed held price it cannot read as it is, and counts it excluded', () => {
    const listed: ChartExclusion[] = [{ ref: 'inzhur-reit', basis: 'nav', asOf: '2026-05-11' }];
    const { rows, report } = plan(reit(p), [held('10.71661', 'fund-history-1')], listed);
    expect(rows.map((r) => r.basis)).toEqual(['buy']);
    expect(report[0].bases.nav).toMatchObject({ written: 0, agreed: 0, excluded: 1 });
  });

  it('refuses a held price it cannot read to the digit, by name rather than as a disagreement', () => {
    expect(refusal(() => plan(reit(p), [held('10.71661', 'fund-history-1')]))).toBe(
      "chart refused:\n2026-05-11 inzhur-reit nav: the archive's fund-history-1 row cannot be compared",
    );
  });

  it('leaves a listed disagreement as it is, and counts it', () => {
    const listed: ChartExclusion[] = [{ ref: 'inzhur-reit', basis: 'nav', asOf: '2026-05-11' }];
    const { rows, report } = plan(reit(p), [held('10.7167', 'fund-history-1')], listed);
    expect(rows.map((r) => r.basis)).toEqual(['buy']);
    expect(report[0].bases.nav).toMatchObject({ written: 0, agreed: 0, excluded: 1 });
  });

  it('refuses a listed exclusion that agrees, has no held row, or is not a priced point', () => {
    const listed = (asOf: string, basis: 'buy' | 'nav' = 'nav'): ChartExclusion[] => [
      { ref: 'inzhur-reit', basis, asOf },
    ];
    expect(refusal(() => plan(reit(p), [held('10.7166', '2')], listed('2026-05-11')))).toBe(
      "chart refused:\n2026-05-11 inzhur-reit nav: excluded, but the archive's 2 row agrees",
    );
    expect(refusal(() => plan(reit(p), [], listed('2026-05-11')))).toBe(
      'chart refused:\n2026-05-11 inzhur-reit nav: excluded, but the archive holds no row there',
    );
    expect(refusal(() => plan(reit(p), [], listed('2026-05-12')))).toBe(
      'chart refused:\n2026-05-12 inzhur-reit nav: excluded, but the chart does not price it',
    );
    expect(
      refusal(() =>
        plan(reit(point('2026-05-11', null, 10.7166)), [], listed('2026-05-11', 'buy')),
      ),
    ).toBe('chart refused:\n2026-05-11 inzhur-reit buy: excluded, but the chart does not price it');
  });

  it('collects every refusal of a run in one throw', () => {
    const message = refusal(() =>
      plan(reit(p, point('2026-05-12', 10.83, 10.72)), [
        held('10.7167', '1'),
        archived('2026-05-12', 'inzhur-reit', 'buy', '10.84', '2'),
      ]),
    );
    expect(message.split('\n')).toEqual([
      'chart refused:',
      "2026-05-11 inzhur-reit nav: the archive's 1 row disagrees",
      "2026-05-12 inzhur-reit buy: the archive's 2 row disagrees",
    ]);
  });
});

describe('the committed exclusion list', () => {
  it('names only the two mapped funds, each key once, with a basis the chart carries', () => {
    const keys = CHART_EXCLUSIONS.map((e) => `${e.asOf} ${e.ref} ${e.basis}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of CHART_EXCLUSIONS) {
      expect(Object.keys(CHART_ASSETS)).toContain(e.ref);
      expect(['buy', 'nav']).toContain(e.basis);
      expect(e.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('is what the plan applies when no list is passed', () => {
    // One point per listed day, priced 1 on both bases, and a held row of 2 on each listed key.
    const charts = Object.keys(CHART_ASSETS).map((ref) => ({
      ref,
      points: [...new Set(CHART_EXCLUSIONS.filter((e) => e.ref === ref).map((e) => e.asOf))]
        .sort()
        .map((asOf) => point(asOf, 1, 1)),
    }));
    const held = CHART_EXCLUSIONS.map((e) =>
      archived(e.asOf, e.ref, e.basis, '2', 'fund-history-1'),
    );
    const { report } = chartPlan(charts, held, TODAY, new Set());
    const excluded = report.flatMap((r) => [r.bases.buy.excluded, r.bases.nav.excluded]);
    expect(excluded.reduce((a, b) => a + b, 0)).toBe(CHART_EXCLUSIONS.length);
  });
});
