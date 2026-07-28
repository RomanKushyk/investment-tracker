// Pure data-shaping for the Yield screen (cumulative-% chart + summary table)
// — not in src/lib, that layer stays untouched per this task's scope. Covered
// by yield.test.ts.
import {
  annualizedPct,
  investedByAsset,
  latestQuotes,
  PORTFOLIO_START,
  yieldSinceStart,
} from '../../lib/derive';
import type { Asset, Snapshot, Transaction } from '../../lib/types';
import { daysBetween, latestSnapshotDate } from '../shared/dates';

export interface YieldTableRow {
  asset: Asset;
  invested: number;
  value: number;
  deltaTotal: number; // fraction, e.g. 0.0441 -> "+4.41%"
  annualized: number; // fraction, global PORTFORLIO_START basis (D5#5)
  vsExpectedPp: number; // annualized(%) - expectedPct, in percentage points
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
    const value = values[asset.id] ?? 0;
    const inv = invested[asset.id] ?? 0;
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
