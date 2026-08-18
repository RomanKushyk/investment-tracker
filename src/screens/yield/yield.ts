// Pure data-shaping for the Yield screen (cumulative-% chart + summary table)
// — not in src/lib, that layer stays untouched per this task's scope. Covered
// by yield.test.ts.
import {
  annualizedPct,
  investedByAsset,
  investedOwnByAsset,
  latestQuotes,
  payoutsNetByAsset,
  portfolioStart,
  reinvestedByAsset,
  soldAmountByAsset,
  totalReturnPct,
  yieldSinceStart,
} from '../../core/derive';
import type { Asset, Snapshot, Transaction } from '../../core/types';
import { daysBetween, latestSnapshotDate } from '../../core/dates';
import { xirr, type CashFlow } from '../../core/xirr';

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
  // S9b total-return family (D13, additive — the columns may DISAGREE with
  // deltaTotal by design: the audit's illusion-of-loss triple). undefined =
  // no quote (same guard as above); null = core zero-denominator guard /
  // non-converged xirr. Both render "—".
  totalReturn: number | null | undefined; // fraction (totalReturnPct, ÷ investedOwn)
  xirr: number | null | undefined; // fraction, money-weighted annualized
}

// Per-asset dated flows for xirr (S9b): buys/reinvests out (−), payouts and
// sells/redemptions in (+), tax rows out (−, netting payouts to net-of-tax at
// their own dates), plus the carried-forward latest quote as the terminal
// value on the latest snapshot date. deposit/withdrawal rows are portfolio
// cash moves, never asset flows — skipped even when they carry an assetId
// (the transaction form always attaches the selected asset).
function assetCashFlows(
  assetId: string,
  transactions: Transaction[],
  terminalValue: number,
  terminalDate: string,
): CashFlow[] {
  const flows: CashFlow[] = [];
  for (const t of transactions) {
    if (t.assetId !== assetId) continue;
    switch (t.type) {
      case 'buy':
      case 'reinvest':
      case 'tax':
        flows.push({ date: t.date, amount: -t.amount });
        break;
      case 'sell':
      case 'redemption':
      case 'dividend_accrual':
      case 'interest_payout':
        flows.push({ date: t.date, amount: t.amount });
        break;
      default:
        break; // deposit/withdrawal — portfolio-level cash, not an asset flow
    }
  }
  flows.push({ date: terminalDate, amount: terminalValue });
  return flows;
}

export function yieldTableRows(
  assets: Asset[],
  snapshots: Snapshot[],
  transactions: Transaction[],
): YieldTableRow[] {
  const values = latestQuotes(snapshots);
  const invested = investedByAsset(transactions);
  const investedOwn = investedOwnByAsset(transactions);
  const reinvested = reinvestedByAsset(transactions);
  const payoutsNet = payoutsNetByAsset(transactions);
  const sold = soldAmountByAsset(transactions);
  const now = latestSnapshotDate(snapshots);
  const start = portfolioStart(assets, snapshots, transactions);
  // Both guards, not one: `now` is missing with no snapshots and `start` with
  // no rows at all. 0 keeps `annualizedPct`'s existing no-basis branch (A24).
  const daysHeld = now && start ? daysBetween(start, now) : 0;

  return assets.map((asset) => {
    const value = values[asset.id];
    const inv = invested[asset.id] ?? 0;
    if (value === undefined || now === undefined) {
      return {
        asset,
        invested: inv,
        value: undefined,
        deltaTotal: undefined,
        annualized: undefined,
        vsExpectedPp: undefined,
        totalReturn: undefined,
        xirr: undefined,
      };
    }
    const deltaTotal = yieldSinceStart(value, inv);
    const annualized = annualizedPct(value, inv, daysHeld);
    return {
      asset,
      invested: inv,
      value,
      deltaTotal,
      annualized,
      vsExpectedPp: annualized * 100 - asset.expectedPct,
      totalReturn: totalReturnPct(
        value,
        payoutsNet[asset.id] ?? 0,
        sold[asset.id] ?? 0,
        investedOwn[asset.id] ?? 0,
        reinvested[asset.id] ?? 0,
      ),
      xirr: xirr(assetCashFlows(asset.id, transactions, value, now)),
    };
  });
}

// S9b "(ann.)" clarity suffix token: true while the portfolio history is
// under a full year (daysHeld from the derived portfolio start to the latest
// snapshot < 365) — with less than a year of flows the money-weighted rate is
// an extrapolation, so the header carries the clarity label. The component owns
// the "(ann.)" copy (D8); no snapshots → true (nothing to relativize yet).
//
// Takes all three tables since A24, matching `yieldTableRows` — the start is
// derived from every one of them, so asking for snapshots alone would answer a
// different question than the one the header asks.
export function xirrIsExtrapolated(
  assets: Asset[],
  snapshots: Snapshot[],
  transactions: Transaction[],
): boolean {
  const now = latestSnapshotDate(snapshots);
  const start = portfolioStart(assets, snapshots, transactions);
  return !now || !start || daysBetween(start, now) < 365;
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
