// Pure data-shaping for the Yield screen (cumulative-% chart + summary table)
// — not in src/lib, that layer stays untouched per this task's scope. Covered
// by yield.test.ts.
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
import type { Asset, Snapshot, Transaction } from '../../core/types';
import type { PeriodWindow } from '../../core/period';
import { dayBefore, daysBetween, latestSnapshotDate } from '../../core/dates';
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
  // fraction. THE BASIS IS THE WINDOW'S SPAN, not the portfolio's — and that is
  // now settled rather than contested: D80 (owner's ruling on O24) supersedes
  // the v1 contract that pinned the PORTFOLIO_START basis "regardless of
  // window". A39 changed the code and left this line claiming the opposite for
  // three days. `shortBasis` below is the treatment D80 requires with it.
  annualized: number | undefined;
  vsExpectedPp: number | undefined; // annualized(%) - expectedPct, in percentage points
  /**
   * true = `annualized` and `vsExpectedPp` are divided by a span this asset did
   * not materially live through, so `/yield` renders both in `muted` (F-3/D80).
   * Not a suppression: the figure stays byte-identical and every D5-pinned
   * number is still reproducible — the mark says trust it less, the same signal
   * the XIRR column already uses for null.
   */
  shortBasis: boolean;
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
// `openValue` is the position the window INHERITED — money already committed
// before the first flow inside it, so it enters as an outflow on the opening
// date exactly as a purchase would. It is 0 for the full history (nothing was
// held the day before the first transaction), which is what makes the windowed
// rate reduce to the unwindowed one.
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

/**
 * The table, unwindowed — every figure since the portfolio began (D5).
 *
 * DELEGATES, exactly as `latestQuotes` delegates to `quotesAsOf` (A27): the
 * full history IS a window, so keeping two implementations would be keeping two
 * chances to disagree. `Від початку` is not a special case in the code, it is
 * the widest value of the one parameter.
 */
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
 * The table over a WINDOW (A39, extension § S2).
 *
 * EVERY COLUMN REDUCES TO ITS UNWINDOWED FORM when the window is the full
 * history, and that is the property the whole design hangs on — it is what lets
 * `yieldTableRows` delegate, and it is pinned by a test that compares the two
 * row-for-row on the seed. The reduction works because of one choice:
 *
 * THE OPENING POSITION IS VALUED THE DAY BEFORE THE WINDOW OPENS. `transactionsIn`
 * includes both ends, so a purchase dated on `from` is one of the window's own
 * flows; valuing the position ON `from` would count it twice. The day before the
 * portfolio's first transaction has no snapshots, so the full-history opening
 * value is 0 and every term below collapses.
 *
 * WHAT A WINDOW CHANGES, COLUMN BY COLUMN, and none of it is a new formula —
 * each is the shipped one with a windowed basis:
 *
 * · the BASIS stops being "everything ever bought" and becomes what the window
 *   inherited plus what it bought: `open + investedInside`. F-6 is right that
 *   `Вкладено, ₴` then means something else, and the header is A39's to change.
 * · DISPOSALS COUNT. `close + soldInside` against that basis, because without
 *   the sold term a sale inside the window reads as a loss — the sheet's F-7
 *   named it and the seed cannot show it, having no sells.
 * · `Річна` divides by the WINDOW's days, not the portfolio's. F-2 measured
 *   what that does: `annualizedPct` is linear, so a 30-day window multiplies by
 *   12,17 and the column triples while Δ barely moves.
 * · XIRR takes the opening position as an outflow dated at `from`.
 *
 * `undefined` for the window means there is no window at all — no start or no
 * end — and every row comes back in its no-quote shape, which is what the
 * screens already render as an empty state.
 */
export function yieldTableRowsIn(
  assets: Asset[],
  snapshots: Snapshot[],
  transactions: Transaction[],
  w: PeriodWindow | undefined,
): YieldTableRow[] {
  // FLOWS ARE CLIPPED AT THE BOTTOM ONLY, and that is not a shortcut (A39
  // review). Every window ends at `to` = the latest snapshot, so an upper clip
  // can never exclude anything but transactions entered SINCE the last
  // valuation — which are the most recent reality, and which `/portfolio`,
  // `/overview` and `/attributes` all count. A first draft used
  // `transactionsIn`, and a buy dated after the last snapshot vanished from
  // this screen while every other screen showed it: measured, 65 800 here
  // against 115 800 there, on the DEFAULT window. Reproduced and pinned below.
  //
  // No window means no valuation date, not no ledger: the flows are still every
  // transaction, which is what the old code reported and what a user who has
  // entered buys but not yet saved a snapshot must see.
  const flows = w === undefined ? transactions : transactions.filter((t) => t.date >= w.from);
  const open = w === undefined ? {} : quotesAsOf(snapshots, dayBefore(w.from));
  const values = w === undefined ? {} : quotesAsOf(snapshots, w.to);
  const invested = investedByAsset(flows);
  const investedOwn = investedOwnByAsset(flows);
  const reinvested = reinvestedByAsset(flows);
  const payoutsNet = payoutsNetByAsset(flows);
  const sold = soldAmountByAsset(flows);
  const now = w?.to;
  // 0 keeps `annualizedPct`'s existing no-basis branch (A24) — and a window can
  // now REACH it with data present, which the empty-dataset case never could:
  // `ytd` on 1 January resolves `from === to`. `annualizedPct` would then return
  // a fabricated 0 that renders as a measurement, and `проти очікуваної` would
  // read as the full expected rate missed. `undefined` is the honest answer, so
  // a zero-length window is treated as no basis at all (A39 review).
  const daysHeld = w === undefined ? 0 : daysBetween(w.from, w.to);
  const annualizable = daysHeld > 0;

  // F-3/D80 — WHICH ROWS CANNOT SUPPORT THEIR OWN BASIS. `daysHeld` above is one
  // span for every row (D5#5), so an asset bought partway through is annualized
  // over time it did not exist for. This says which ones, per row, against the
  // very basis the row is divided by — including at `Від початку`, where the
  // distortion has always been present and invisible.
  // Built as one pass beside `investedByAsset` and its siblings rather than
  // rescanned per row: `assetStart` walks the whole ledger, and calling it from
  // inside `assets.map` made this O(assets x transactions) on every render.
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
    // `+ sold` is the disposal term F-7 asked for. It is 0 on the seed, so the
    // full-history reduction is exact and every D5 figure is untouched.
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
      // THE DENOMINATOR CHANGES MEANING UNDER A WINDOW, and saying so is the
      // point (A39 review). `totalReturnPct`'s contract is "external capital
      // only — reinvested cash is system-generated and counting it dilutes the
      // return the user's own money earned". `openValue` is a MARKET value: it
      // embeds every prior reinvestment and every prior unrealized gain. Under
      // a window the question is necessarily different — "what did the capital
      // AT RISK when this window opened return over it" — and there is no way
      // to ask it without valuing the inherited position. The full history is
      // unaffected, because there `openValue` is 0 and the contract holds
      // exactly. Under any shorter window this column answers the windowed
      // question, and F-6's header problem is its sibling.
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

// S9b "(ann.)" clarity suffix token: true while the portfolio history is
// under a full year (daysHeld from the derived portfolio start to the latest
// snapshot < 365) — with less than a year of flows the money-weighted rate is
// an extrapolation, so the header carries the clarity label. The component owns
// the "(ann.)" copy (D8); no snapshots → true (nothing to relativize yet).
//
// Takes all three tables since A24, matching `yieldTableRows` — the start is
// derived from every one of them, so asking for snapshots alone would answer a
// different question than the one the header asks.
/**
 * Whether the money-weighted rate is an extrapolation — TRUE while the span it
 * is annualized from is under a year.
 *
 * IT MEASURES THE WINDOW, not the portfolio (A39 review). The suffix exists to
 * mark a rate inferred from too little time, and once the portfolio passes 365
 * days the portfolio-span version would drop the mark while a user on
 * `1 місяць` reads a column extrapolated from thirty. The full history is the
 * widest window, so this stays correct for the case it was written for.
 */
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

// One point per snapshot date; each asset's value is its cumulative %% return
// (fraction*100) using invested-to-date (buys+reinvests dated <= that day).
// Missing before an asset's first purchase — recharts draws a natural gap.
/**
 * The curve, unwindowed — delegates for the same reason the table does.
 */
export function cumulativeYieldSeries(
  snapshots: Snapshot[],
  transactions: Transaction[],
  assets: Asset[],
): YieldSeriesPoint[] {
  return cumulativeYieldSeriesIn(snapshots, transactions, assets, undefined);
}

/**
 * The curve over a WINDOW (A39, extension § S2).
 *
 * IT HAD TO BE WINDOWED TOO, and not merely clipped. Restricting the x-range
 * while every y stayed measured from inception would put a table that answers
 * "since 27.04" beside a curve that answers "since 03.02" — the same
 * incoherence A38's review caught one level up, where a header asserted a
 * window the figures below it contradicted.
 *
 * So the basis is rebased exactly as the table's is: what the window inherited,
 * plus what it bought up to each point. `undefined` means the whole history,
 * where the opening value is 0 and the expression collapses to the original.
 */
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
      // THE SAME DISPOSAL TERM THE TABLE TAKES. Without it the curve drew the
      // "~17 % loss on a position that merely returned cash" directly above a
      // table that had just stopped drawing it — the fix for F-7 applied in one
      // of the two places (A39 review). 0 on the seed, so the reduction holds.
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
