// The provider's app chart, one point per calendar day of an open fund's buy and nav, to the rows
// the archive lacks: a copied observation that never displaces a held one (*The price archive*).
// Pure: the parsed charts and the archive's rows in, the rows out, and the DB half in `capture.ts`.
import { agrees, scaled, type ArchivedRow } from './derived-sell';
import { field } from './fund-history';

/** Stored per row, so a reader tells a chart point from a capture's quote, a snapshot's and the
 *  history file's. */
export const CHART_PARSER_VERSION = 'chart-1';

/** Each open fund's core asset id, the one its offer page keys it with (`FUND_SLUGS`). Held fixed
 *  rather than discovered, as `FUND_HISTORY_CATEGORIES` is: a chart the API no longer answers
 *  refuses the run. */
export const CHART_ASSETS: Readonly<Record<string, number>> = {
  'inzhur-energy': 13,
  'inzhur-reit': 21,
};

/** The request the provider's app sends for a fund's whole chart (*External sources*). */
export const chartUrl = (id: number) =>
  `https://api.inzhur.reit/core/api/v1/assets/${id}/graph?period=all`;

export type ChartBasis = 'buy' | 'nav';
export const CHART_BASES: readonly ChartBasis[] = ['buy', 'nav'];

export interface ChartExclusion {
  ref: string;
  basis: ChartBasis;
  asOf: string;
}

const listed = (ref: string, basis: ChartBasis, days: readonly string[]): ChartExclusion[] =>
  days.map((asOf) => ({ ref, basis, asOf }));

/** Held keys the chart restates, each left as the archive holds it. A listed key that agrees, or
 *  that holds nothing on a day the capture never read, refuses, so the list cannot go stale unseen. */
export const CHART_EXCLUSIONS: readonly ChartExclusion[] = [
  ...listed('inzhur-energy', 'nav', [
    '2024-12-02',
    '2025-01-01',
    '2025-01-02',
    '2025-02-02',
    '2025-03-01',
    '2025-03-02',
    '2025-04-01',
    '2025-04-02',
    '2025-05-02',
    '2025-06-02',
    '2025-06-04',
    '2025-07-02',
    '2025-08-01',
    '2025-10-01',
    '2025-10-02',
    '2025-11-28',
    '2025-12-01',
    '2026-01-01',
    '2026-01-02',
    '2026-02-02',
    '2026-02-03',
    '2026-02-04',
    '2026-02-05',
    '2026-04-01',
    '2026-05-01',
    '2026-06-01',
    '2026-06-27',
    '2026-07-01',
    '2026-09-01',
  ]),
  ...listed('inzhur-energy', 'buy', ['2026-09-01']),
  ...listed('inzhur-reit', 'nav', [
    '2025-10-01',
    '2025-10-02',
    '2026-01-31',
    '2026-02-01',
    '2026-02-02',
    '2026-02-03',
    '2026-02-04',
    '2026-02-05',
    '2026-04-01',
    '2026-05-01',
    '2026-06-01',
    '2026-07-01',
    '2026-09-01',
    '2026-09-02',
  ]),
  ...listed('inzhur-reit', 'buy', ['2026-09-01', '2026-09-02']),
];

/** One calendar day of a chart: `marketPrice` is the dealer's buy, `nav` the NAV, each null where
 *  the provider priced nothing. There is no sell. */
export interface ChartPoint {
  date: string;
  marketPrice: number | null;
  nav: number | null;
}

/** DSQL mutates at most this many rows in one transaction, so a plan reaching it refuses. */
export const DSQL_TRANSACTION_ROWS = 3000;

/** A calendar day, not only its shape: a date the calendar lacks would fail in the archive read,
 *  naming no chart. */
const isCalendarDay = (date: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === date;
};

/** The chart `ref` asked for by `id`, as points in date order; any other body refuses by name,
 *  because a changed shape or a wrong asset must not be copied into the archive. */
export function parseChart(body: string, ref: string, id: number): ChartPoint[] {
  const refuse = (why: string) => new Error(`chart refused:\n${ref}: ${why}`);
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw refuse('not JSON');
  }
  const assetId = field(json, 'assetId');
  if (assetId !== id) throw refuse(`it answered asset ${String(assetId)}, not ${id}`);
  const list = field(json, 'dataPoints');
  if (!Array.isArray(list)) throw refuse('no dataPoints list');

  // A 0 is the provider's null, as the capture reads a nav of 0; a negative is a shape the chart
  // never had, and a price past four decimals could never be checked against a held row.
  const priceOf = (value: unknown, date: string, basis: ChartBasis): number | null => {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw refuse(`${date} ${basis} is not a number`);
    }
    if (value < 0) throw refuse(`${date} ${basis} is negative`);
    if (value === 0) return null;
    if (scaled(String(value)) === undefined)
      throw refuse(`${date} ${basis} has more than four decimals`);
    return value;
  };

  const seen = new Set<string>();
  const points = list.map((entry): ChartPoint => {
    const date = field(entry, 'date');
    if (typeof date !== 'string' || !isCalendarDay(date)) {
      throw refuse(`"${String(date)}" is not a date`);
    }
    if (seen.has(date)) throw refuse(`${date} is charted twice`);
    seen.add(date);
    return {
      date,
      marketPrice: priceOf(field(entry, 'marketPrice'), date, 'buy'),
      nav: priceOf(field(entry, 'nav'), date, 'nav'),
    };
  });
  return points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface ChartRow {
  asOf: string;
  ref: string;
  basis: ChartBasis;
  price: number;
}

/** A fund's first priced day: where the chart says it was listed. It says nothing about today. */
export interface ChartInstrument {
  ref: string;
  first: string;
}

/** What a run reports, per ref and basis. No money figure: the report is posted. */
export interface ChartBasisReport {
  written: number;
  /** Held keys left as they are because they agree. */
  agreed: number;
  /** Listed keys left as they are: a held disagreement, an uncomparable held row, or a free key
   *  on a captured day. */
  excluded: number;
  unpriced: number;
  from: string | null;
  to: string | null;
}

export interface ChartRefReport {
  ref: string;
  points: number;
  /** Points dated on or after the run's day, which tonight's capture observes. */
  provisional: number;
  bases: Record<ChartBasis, ChartBasisReport>;
}

const emptyBasis = (): ChartBasisReport => ({
  written: 0,
  agreed: 0,
  excluded: 0,
  unpriced: 0,
  from: null,
  to: null,
});

/** Every chart's rows for the days the archive lacks, or every refusal in one throw. A held key is
 *  never written and must agree to the digit unless it is listed; a refusal names no price. */
export function chartPlan(
  charts: readonly { ref: string; points: readonly ChartPoint[] }[],
  existing: readonly ArchivedRow[],
  today: string,
  /** The days the capture journal holds a successful read of the source for. */
  captured: ReadonlySet<string>,
  exclusions: readonly ChartExclusion[] = CHART_EXCLUSIONS,
): { rows: ChartRow[]; instruments: ChartInstrument[]; report: ChartRefReport[] } {
  const refusals: string[] = [];
  const held = new Map(existing.map((r) => [`${r.asOf} ${r.ref} ${r.basis}`, r]));
  const excluded = new Set(exclusions.map((e) => `${e.asOf} ${e.ref} ${e.basis}`));
  const met = new Set<string>();
  const rows: ChartRow[] = [];
  const instruments: ChartInstrument[] = [];
  const report: ChartRefReport[] = [];

  for (const { ref, points } of charts) {
    const bases: Record<ChartBasis, ChartBasisReport> = { buy: emptyBasis(), nav: emptyBasis() };
    let provisional = 0;
    let first: string | undefined;
    for (const p of points) {
      // The run's own day is still being struck: a copied point there would pre-empt tonight's
      // observation forever, the key being written once.
      if (p.date >= today) {
        provisional += 1;
        continue;
      }
      for (const basis of CHART_BASES) {
        const price = basis === 'buy' ? p.marketPrice : p.nav;
        const tally = bases[basis];
        if (price === null) {
          tally.unpriced += 1;
          continue;
        }
        first ??= p.date;
        const key = `${p.date} ${ref} ${basis}`;
        const isListed = excluded.has(key);
        if (isListed) met.add(key);
        const archived = held.get(key);
        if (archived === undefined) {
          // The payload of a captured day is kept forever and derives its own rows; a chart point
          // written first would stand in for them under ON CONFLICT DO NOTHING.
          if (captured.has(p.date)) {
            if (isListed) tally.excluded += 1;
            else refusals.push(`${key}: captured that day, so its payload is the source`);
            continue;
          }
          if (isListed) {
            refusals.push(`${key}: excluded, but the archive holds no row there`);
            continue;
          }
          rows.push({ asOf: p.date, ref, basis, price });
          tally.written += 1;
          tally.from ??= p.date;
          tally.to = p.date;
          continue;
        }
        if (scaled(archived.price) === undefined) {
          if (isListed) tally.excluded += 1;
          else
            refusals.push(`${key}: the archive's ${archived.parserVersion} row cannot be compared`);
          continue;
        }
        if (agrees(archived, price)) {
          if (isListed) {
            refusals.push(
              `${key}: excluded, but the archive's ${archived.parserVersion} row agrees`,
            );
          } else {
            tally.agreed += 1;
          }
          continue;
        }
        if (isListed) {
          tally.excluded += 1;
          continue;
        }
        refusals.push(`${key}: the archive's ${archived.parserVersion} row disagrees`);
      }
    }
    if (first !== undefined) instruments.push({ ref, first });
    report.push({ ref, points: points.length, provisional, bases });
  }

  for (const key of excluded) {
    if (!met.has(key)) refusals.push(`${key}: excluded, but the chart does not price it`);
  }
  const total = rows.length + instruments.length;
  if (total >= DSQL_TRANSACTION_ROWS) {
    refusals.push(
      `${total} rows to write, not under DSQL's ${DSQL_TRANSACTION_ROWS}-row transaction`,
    );
  }
  if (refusals.length > 0) throw new Error(`chart refused:\n${refusals.join('\n')}`);
  return { rows, instruments, report };
}
