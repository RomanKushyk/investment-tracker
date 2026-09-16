// Pure data-shaping for the Yield screen, covered by yield.test.ts.
import {
  annualizedPct,
  basisIsShort,
  startDateByAsset,
  investedByAsset,
  investedOwnByAsset,
  payoutsNetByAsset,
  portfolioStart,
  quotesAsOf,
  reinvestedByAsset,
  soldAmountByAsset,
  totalReturnPct,
  yieldSinceStart,
} from '../../core/derive';
import { unnamedType, type Asset, type Snapshot, type Transaction } from '../../core/types';
import type { PeriodWindow } from '../../core/period';
import { dayBefore, daysBetween, latestSnapshotDate } from '../../core/dates';
import { xirr, type CashFlow } from '../../core/xirr';

export interface YieldTableRow {
  asset: Asset;
  invested: number;
  // undefined = no quote yet, and every field below too: an unquoted asset would
  // otherwise read -100% and scale into a huge annualized figure.
  value: number | undefined;
  deltaTotal: number | undefined; // fraction, e.g. 0.0441 -> "+4.41%"
  annualized: number | undefined; // fraction, on the WINDOW's span, not the portfolio's
  vsExpectedPp: number | undefined; // annualized(%) - expectedPct, in percentage points
  /** The two fields above are divided by a span this asset did not materially live
   *  through, so `/yield` mutes them. Not a suppression — the figure is unchanged. */
  shortBasis: boolean;
  // May DISAGREE with deltaTotal by design. *Metric families and windows*
  totalReturn: number | null | undefined; // fraction (totalReturnPct, ÷ investedOwn)
  xirr: number | null | undefined; // fraction, money-weighted annualized
}

// A VALUE-RETURNING switch, because a statement switch has no return type to fail
// against: a ninth `TxType` reaches `default: break` and leaves the series short by
// whatever that row carried, with nothing to notice.
function assetFlowAmount(t: Transaction): number | null {
  switch (t.type) {
    case 'buy':
    case 'reinvest':
      return -t.amount;
    case 'dividend_accrual':
    case 'interest_payout':
      // `taxWithheld < amount` is a CHECK, so this never flips sign.
      return t.amount - (t.taxWithheld ?? 0);
    case 'sell':
    case 'redemption':
      return t.amount;
    case 'deposit':
    case 'withdrawal':
      return null; // portfolio-level cash, not an asset flow
    default:
      return unnamedType(t.type, null);
  }
}

// A deposit or withdrawal is portfolio cash and never an asset flow, so it is skipped
// even when it carries an assetId. `openValue` is the position the window INHERITED,
// entering as an outflow on the opening date; 0 for the full history.
function assetCashFlows(
  assetId: string,
  transactions: Transaction[],
  terminalValue: number,
  terminalDate: string,
  openValue = 0,
  openDate?: string,
): CashFlow[] {
  const flows: CashFlow[] = [];
  if (openValue > 0 && openDate !== undefined) flows.push({ date: openDate, amount: -openValue });
  for (const t of transactions) {
    if (t.assetId !== assetId) continue;
    const amount = assetFlowAmount(t);
    if (amount !== null) flows.push({ date: t.date, amount });
  }
  flows.push({ date: terminalDate, amount: terminalValue });
  return flows;
}

/** The table, unwindowed. It DELEGATES because the full history IS a window, and two
 *  implementations would be two chances to disagree. */
export function yieldTableRows(
  assets: Asset[],
  snapshots: Snapshot[],
  transactions: Transaction[],
): YieldTableRow[] {
  const from = portfolioStart(assets, snapshots, transactions);
  const to = latestSnapshotDate(snapshots);
  if (from === undefined || to === undefined) {
    return yieldTableRowsIn(assets, snapshots, transactions, undefined);
  }
  return yieldTableRowsIn(assets, snapshots, transactions, { from, to, clamped: false });
}

/**
 * The table over a WINDOW. EVERY COLUMN REDUCES TO ITS UNWINDOWED FORM at the full
 * history, which is what lets the delegation above work, and the reduction turns on
 * one choice: THE OPENING POSITION IS VALUED THE DAY BEFORE THE WINDOW OPENS. Both
 * ends are inclusive, so valuing it ON `from` counts a purchase dated there twice, and
 * the day before the first transaction has no snapshots. Disposals have to count, or
 * a sale inside the window reads as a loss. `undefined` means no window at all.
 */
export function yieldTableRowsIn(
  assets: Asset[],
  snapshots: Snapshot[],
  transactions: Transaction[],
  w: PeriodWindow | undefined,
): YieldTableRow[] {
  // FLOWS ARE CLIPPED AT THE BOTTOM ONLY, and that is not a shortcut. Every window ends
  // at the latest snapshot, so an upper clip excludes nothing but transactions entered
  // SINCE the last valuation — which every other screen counts, so clipping both ends
  // made a buy dated after the last snapshot vanish from this screen alone. No window
  // means no valuation date, not no ledger.
  const flows = w === undefined ? transactions : transactions.filter((t) => t.date >= w.from);
  const open = w === undefined ? {} : quotesAsOf(snapshots, dayBefore(w.from));
  const values = w === undefined ? {} : quotesAsOf(snapshots, w.to);
  const invested = investedByAsset(flows);
  const investedOwn = investedOwnByAsset(flows);
  const reinvested = reinvestedByAsset(flows);
  const payoutsNet = payoutsNetByAsset(flows);
  const sold = soldAmountByAsset(flows);
  const now = w?.to;
  // A ZERO-LENGTH span is reachable with data present — `ytd` on 1 January. Annualizing
  // it returns a fabricated 0 that renders as a measurement, so it counts as no basis.
  const daysHeld = w === undefined ? 0 : daysBetween(w.from, w.to);
  const annualizable = daysHeld > 0;

  // `daysHeld` is one span for every row by decision, so an asset bought partway through
  // is annualized over time it did not exist for. One pass, or it is quadratic.
  const startByAsset = startDateByAsset(assets, transactions);
  const shortBasisOf = (asset: Asset): boolean => {
    if (w === undefined) return false;
    const start = startByAsset[asset.id];
    if (start === undefined) return false;
    const held = daysBetween(start > w.from ? start : w.from, w.to);
    return basisIsShort(held, daysHeld);
  };

  return assets.map((asset) => {
    const value = values[asset.id];
    const openValue = open[asset.id] ?? 0;
    const inv = openValue + (invested[asset.id] ?? 0);
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
        shortBasis: false,
      };
    }

    const closed = value + (sold[asset.id] ?? 0);
    const deltaTotal = yieldSinceStart(closed, inv);
    const annualized = annualizable ? annualizedPct(closed, inv, daysHeld) : undefined;
    return {
      asset,
      invested: inv,
      value,
      deltaTotal,
      annualized,
      shortBasis: annualized === undefined ? false : shortBasisOf(asset),
      vsExpectedPp: annualized === undefined ? undefined : annualized * 100 - asset.expectedPct,
      // THE DENOMINATOR CHANGES MEANING UNDER A WINDOW. `totalReturnPct` counts
      // external capital only, but `openValue` is a MARKET value and embeds every
      // prior reinvestment and unrealized gain — so a window necessarily asks the
      // other question, what the capital AT RISK when it opened returned, and that
      // cannot be asked without valuing the inherited position. The full history is
      // unaffected, because there `openValue` is 0.
      totalReturn: totalReturnPct(
        value,
        payoutsNet[asset.id] ?? 0,
        sold[asset.id] ?? 0,
        openValue + (investedOwn[asset.id] ?? 0),
        reinvested[asset.id] ?? 0,
      ),
      xirr: xirr(assetCashFlows(asset.id, flows, value, now, openValue, w?.from)),
    };
  });
}

/** Whether the money-weighted rate is an extrapolation. IT MEASURES THE WINDOW, not
 *  the portfolio: the portfolio-span version drops the mark after a year while a user
 *  on the shortest window reads a column extrapolated from thirty days. */
export function xirrIsExtrapolatedIn(w: PeriodWindow | undefined): boolean {
  return w === undefined || daysBetween(w.from, w.to) < 365;
}

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

/** The curve, unwindowed — delegates for the same reason the table does. A point is
 *  missing before an asset's first purchase, and recharts draws a natural gap. */
export function cumulativeYieldSeries(
  snapshots: Snapshot[],
  transactions: Transaction[],
  assets: Asset[],
): YieldSeriesPoint[] {
  return cumulativeYieldSeriesIn(snapshots, transactions, assets, undefined);
}

/** The curve over a WINDOW — windowed, not merely clipped: restricting the x-range
 *  while every y stayed measured from inception puts a table answering one question
 *  beside a curve answering another. The basis is rebased as the table's is. */
export function cumulativeYieldSeriesIn(
  snapshots: Snapshot[],
  transactions: Transaction[],
  assets: Asset[],
  w: PeriodWindow | undefined,
): YieldSeriesPoint[] {
  const inWindow =
    w === undefined ? snapshots : snapshots.filter((s) => s.date >= w.from && s.date <= w.to);
  const sorted = [...inWindow].sort((a, b) => a.date.localeCompare(b.date));
  const open = w === undefined ? {} : quotesAsOf(snapshots, dayBefore(w.from));
  const openedOn = w?.from;

  return sorted.map((s) => {
    const point: YieldSeriesPoint = { date: s.date };
    for (const asset of assets) {
      const quote = s.quotes[asset.id];
      if (quote === undefined) continue;
      const upTo = (t: Transaction) =>
        t.assetId === asset.id &&
        t.date <= s.date &&
        (openedOn === undefined || t.date >= openedOn);
      const boughtToDate = transactions
        .filter((t) => upTo(t) && (t.type === 'buy' || t.type === 'reinvest'))
        .reduce((sum, t) => sum + t.amount, 0);
      // THE SAME DISPOSAL TERM THE TABLE TAKES, or the curve draws a loss on a
      // position that merely returned cash, directly above a table that does not.
      const soldToDate = transactions
        .filter((t) => upTo(t) && (t.type === 'sell' || t.type === 'redemption'))
        .reduce((sum, t) => sum + t.amount, 0);
      const basis = (open[asset.id] ?? 0) + boughtToDate;
      if (basis === 0) continue;
      point[asset.id] = yieldSinceStart(quote + soldToDate, basis) * 100;
    }
    return point;
  });
}
