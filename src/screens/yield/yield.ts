// Pure data-shaping for the Yield screen (cumulative-% chart + summary table)
// — not in src/lib, that layer stays untouched per this task's scope. Covered
// by yield.test.ts.
import {
  annualizedPct,
  investedByAsset,
  latestQuotes,
  PORTFOLIO_START,
  yieldSinceStart,
} from '../../core/derive';
import type { Asset, Snapshot, Transaction } from '../../core/types';
import { daysBetween, latestSnapshotDate } from '../../core/dates';

export interface YieldTableRow {
  asset: Asset;
  invested: number;
  // undefined = no quote saved yet (fields below are undefined too — an
  // unquoted asset would otherwise read yieldSinceStart(0, invested) = -100%,
  // then get scaled into a huge bogus annualized % against the global
  // daysHeld basis; render "—" instead, same guard as Attributes' actualAnnualizedPct).
  value: number | undefined;
  deltaTotal: number | undefined; // fraction, e.g. 0.0441 -> "+4.41%"
  annualized: number | undefined; // fraction, global PORTFORLIO_START basis (D5#5)
  vsExpectedPp: number | undefined; // annualized(%) - expectedPct, in percentage points
}

export function yieldTableRows(
  assets: Asset[],
  snapshots: Snapshot[],
  transactions: Transaction[],
): YieldTableRow[] {
  const values = latestQuotes(snapshots);
  const invested = investedByAsset(transactions);
  const now = latestSnapshotDate(snapshots);
  const daysHeld = now ? daysBetween(PORTFOLIO_START, now) : 0;

  return assets.map((asset) => {
    const value = values[asset.id];
    const inv = invested[asset.id] ?? 0;
    if (value === undefined) {
      return { asset, invested: inv, value: undefined, deltaTotal: undefined, annualized: undefined, vsExpectedPp: undefined };
    }
    const deltaTotal = yieldSinceStart(value, inv);
    const annualized = annualizedPct(value, inv, daysHeld);
    return { asset, invested: inv, value, deltaTotal, annualized, vsExpectedPp: annualized * 100 - asset.expectedPct };
  });
}

export interface YieldSeriesPoint {
  date: string;
  [assetId: string]: string | number | undefined;
}

// One point per snapshot date; each asset's value is its cumulative %% return
// (fraction*100) using invested-to-date (buys+reinvests dated <= that day).
// Missing before an asset's first purchase — recharts draws a natural gap.
export function cumulativeYieldSeries(
  snapshots: Snapshot[],
  transactions: Transaction[],
  assets: Asset[],
): YieldSeriesPoint[] {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));

  return sorted.map((s) => {
    const point: YieldSeriesPoint = { date: s.date };
    for (const asset of assets) {
      const quote = s.quotes[asset.id];
      if (quote === undefined) continue;
      const investedToDate = transactions
        .filter(
          (t) => t.assetId === asset.id && (t.type === 'buy' || t.type === 'reinvest') && t.date <= s.date,
        )
        .reduce((sum, t) => sum + t.amount, 0);
      if (investedToDate === 0) continue;
      point[asset.id] = yieldSinceStart(quote, investedToDate) * 100;
    }
    return point;
  });
}
