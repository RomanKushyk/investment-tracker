// Pure derivations — every displayed figure comes from these. No I/O.
// Reference-reconciliation rules are pinned in docs/decisions/README.md D5.
import type { Asset, Snapshot, Transaction } from './types';
import type { PeriodWindow } from './period';
import { xirr, type CashFlow } from './xirr';

/**
 * The first day the portfolio existed — DERIVED, never declared (A24).
 *
 * It was `export const PORTFOLIO_START = '2026-02-03'` until 2026-08-18: a
 * literal that every annualized figure divides by. True of the demo seed and
 * false of every other dataset, which made `/yield`'s whole annualized column,
 * `/overview`'s "since 03.02" and `/attributes`' daysHeld wrong for anyone
 * whose portfolio did not start on that Tuesday. The repo's own rule says every
 * portfolio figure derives from stored data, and a date that divides all the
 * others is a portfolio figure.
 *
 * THE EARLIEST OF THREE SIGNALS, not any one of them. The question the value
 * answers is "on what day is there evidence this portfolio existed", and three
 * different rows can carry that evidence: a transaction, a snapshot, or an
 * asset declaring when it was first bought. Any one is sufficient, so the
 * answer is the earliest of them.
 *
 * The direction matters and is the reason this is a `min` rather than a pick.
 * A start that lands too LATE divides a long return by a short span and prints
 * a rate nobody earned; too early only understates. The concrete case is an
 * asset carrying `firstPurchase: '2020-01-01'` that was added without
 * back-filling the ledger — the transactions begin in 2026, and believing them
 * alone would turn six years of holding into six months.
 *
 * `undefined` on an empty dataset: there is no start, and every caller renders
 * "—" rather than dividing by a span it invented. Dates are ISO `yyyy-MM-dd`,
 * so `<` is chronological — the same property `byDate` already relies on.
 *
 * NOT per-asset, deliberately. Callers apply this ONE date to every asset,
 * which is D5#5's pinned v1 simplification ("global PORTFOLIO_START basis")
 * and is why an asset bought in June is still annualized over the portfolio's
 * whole span. Changing that moves D5-pinned figures and is a decision, not a
 * refactor — see `PLAN-OPEN.md` O23.
 */
export function portfolioStart(
  assets: Asset[],
  snaps: Snapshot[],
  txs: Transaction[],
): string | undefined {
  let earliest: string | undefined;
  const consider = (d: string | undefined) => {
    if (d && (earliest === undefined || d < earliest)) earliest = d;
  };
  for (const a of assets) consider(a.firstPurchase);
  for (const s of snaps) consider(s.date);
  for (const t of txs) consider(t.date);
  return earliest;
}

const byDate = (snaps: Snapshot[]) => [...snaps].sort((a, b) => a.date.localeCompare(b.date));

/**
 * Quote PER ASSET as of a date — partial snapshots included, and the HEADLINE
 * basis (D5#1) when the bound is omitted.
 *
 * THE BOUND IS WHAT MAKES A PERIOD POSSIBLE (A27). Nothing in this file was
 * date-bounded before Phase 8: every function took the whole array and answered
 * since-inception. Rather than grow a second merge beside the first, the
 * unbounded accessors below now delegate here — one implementation, two names,
 * because a second copy of this arithmetic would be a second answer.
 *
 * A STOCK, in the brief's terms: a level at an instant, so a window gives it
 * the window's END and never its length.
 *
 * WEALTH-MANAGEMENT-ARCHITECTURE §4 ("latest price per asset, strict
 * querying not array manipulation"): resolved by merging sorted snapshots
 * per asset. Deliberately BETTER than the doc's §4.1 note "return 0 when a
 * quote is missing": an asset simply absent from recent snapshots keeps its
 * last known quote (merge semantics), and an asset never quoted stays
 * ABSENT from the result — "pending", rendered as "—" — rather than a fake
 * 0 that would corrupt headlineTotal and every share/net figure built on it
 * (documented improvement, see docs/reference/FORMULA-AUDIT.md §4).
 */
export function quotesAsOf(snaps: Snapshot[], asOf?: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of byDate(snaps)) {
    if (asOf !== undefined && s.date > asOf) break; // sorted, so the rest are later too
    Object.assign(out, s.quotes);
  }
  return out;
}

/** `quotesAsOf` with no bound — see the note above it for why this delegates. */
export function latestQuotes(snaps: Snapshot[]): Record<string, number> {
  return quotesAsOf(snaps);
}

export function cashAsOf(snaps: Snapshot[], asOf?: string): number {
  const upTo = byDate(snaps).filter((s) => asOf === undefined || s.date <= asOf);
  return upTo.length ? upTo[upTo.length - 1].cash : 0;
}

export function latestCash(snaps: Snapshot[]): number {
  return cashAsOf(snaps);
}

export function headlineTotalAsOf(snaps: Snapshot[], asOf?: string): number {
  return (
    Object.values(quotesAsOf(snaps, asOf)).reduce((a, b) => a + b, 0) + cashAsOf(snaps, asOf)
  );
}

export function headlineTotal(snaps: Snapshot[]): number {
  return headlineTotalAsOf(snaps);
}

/**
 * The transactions a window covers — **inclusive at both ends**.
 *
 * A one-line filter with a whole function around it on purpose (Phase 8 brief
 * § G-5): three screens each writing their own boundary test is three chances
 * to disagree about whether the opening day counts. It does, at both ends, and
 * this is the only place that says so.
 *
 * Returns a new array in the caller's order — the order is a display concern
 * everywhere it is used, and a filter that silently sorted would be a second
 * behaviour hiding inside a first.
 */
export function transactionsIn(txs: Transaction[], w: PeriodWindow): Transaction[] {
  return txs.filter((t) => t.date >= w.from && t.date <= w.to);
}

// Balances-only: the most recent snapshot quoting every given asset.
export function latestCompleteSnapshot(
  snaps: Snapshot[],
  assetIds: string[],
): Snapshot | undefined {
  const sorted = byDate(snaps);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (assetIds.every((id) => sorted[i].quotes[id] !== undefined)) return sorted[i];
  }
  return undefined;
}

// Σ quotes + cash of ONE snapshot (Balances rows / area chart).
export function totalCapital(s: Snapshot): number {
  return Object.values(s.quotes).reduce((a, b) => a + b, 0) + s.cash;
}

function sumByAsset(txs: Transaction[], types: readonly Transaction['type'][]) {
  const out: Record<string, number> = {};
  for (const t of txs) {
    if (types.includes(t.type)) out[t.assetId] = (out[t.assetId] ?? 0) + t.amount;
  }
  return out;
}

export function investedByAsset(txs: Transaction[]): Record<string, number> {
  return sumByAsset(txs, ['buy', 'reinvest']);
}

export function reinvestedByAsset(txs: Transaction[]): Record<string, number> {
  return sumByAsset(txs, ['reinvest']);
}

export function reinvestedTotal(txs: Transaction[]): number {
  return Object.values(reinvestedByAsset(txs)).reduce((a, b) => a + b, 0);
}

export function depositedTotal(txs: Transaction[]): number {
  return txs.filter((t) => t.type === 'deposit').reduce((a, t) => a + t.amount, 0);
}

/**
 * Σvalues + Σsold − Σinvested, cash EXCLUDED → +₴4,452.61 / +3.08% on seed
 * (`sold` is 0 there — nothing has ever been sold or redeemed).
 *
 * The `sold` term is not cosmetic. A closed position has no quote, so it leaves
 * `values` entirely, while its cost basis stays in `invested` — without the
 * proceeds the metric reads the whole position as a total loss. On the seed, a
 * redemption of …8976 (invested 15 390,00) would turn +₴4 452,61 into
 * −₴11 393,69: a sign inversion, on the day the user does the correct thing.
 *
 * This stays inside the capital-gain family (FORMULA-AUDIT / D13): sale and
 * redemption proceeds are returned capital, not income. Payouts belong to
 * `totalNetProfit` and are deliberately still absent here.
 */
export function netResult(
  values: Record<string, number>,
  invested: Record<string, number>,
  sold = 0,
): { uah: number; pct: number } {
  const v = Object.values(values).reduce((a, b) => a + b, 0);
  const i = Object.values(invested).reduce((a, b) => a + b, 0);
  const uah = v + sold - i;
  return { uah, pct: i === 0 ? 0 : uah / i };
}

export function yieldSinceStart(value: number, invested: number): number {
  return invested === 0 ? 0 : value / invested - 1;
}

export function annualizedPct(value: number, invested: number, daysHeld: number): number {
  return daysHeld === 0 ? 0 : (yieldSinceStart(value, invested) * 365) / daysHeld;
}

export function sharePct(value: number, total: number): number {
  return total === 0 ? 0 : (value / total) * 100;
}

export function allocationDeltaPp(share: number, targetPct: number): number {
  return share - targetPct;
}

// Overweight sell: linear share of the (unchanged) total → REIT trim ₴9,095.
export function trimAmount(share: number, targetPct: number, total: number): number {
  return ((share - targetPct) / 100) * total;
}

/**
 * Buy with NEW money — the total grows with the purchase (D5#4):
 * x such that (value + x) / (total + x) = target → …8976 top-up ₴11,429.49.
 *
 * WEALTH-MANAGEMENT-ARCHITECTURE §3.1 (moving-target rebalance): this IS the
 * doc's RequiredTranche = (target×total − value) / (1 − target), which
 * accounts for the injection growing the denominator — the naive
 * `target×total − value` never mathematically reaches the target share.
 * Verified identical on the pinned fixture ₴11,429.49 (docs/reference/FORMULA-AUDIT.md §3).
 *
 * The doc's other branch — `if (TargetShare <= CurrentShare) RequiredTranche
 * = 0` — lives in the CALLERS, not here: this returns a negative tranche for
 * an at/over-target input, and allocation.rebalancePlan / overview.
 * mostUnderweightAsset only invoke it for under-target assets (the ±0.5pp
 * band routes over-target to trimAmount). Callers must keep that guard.
 */
export function topUpAmount(value: number, targetPct: number, total: number): number {
  const t = targetPct / 100;
  return (t * total - value) / (1 - t);
}

// Headline KPI composition (sidebar capital card): one derivation site so the
// shell never re-implements the latestQuotes/investedByAsset/netResult chain
// that Overview's KPI grid is built from.
export function headlineKpis(
  snaps: Snapshot[],
  txs: Transaction[],
): { total: number; net: { uah: number; pct: number } } {
  return {
    total: headlineTotal(snaps),
    net: netResult(latestQuotes(snaps), investedByAsset(txs), soldAmount(txs)),
  };
}

// dividend_accrual → dividends; interest_payout → coupons (counted on accrual, §6.5).
export function incomeReceived(txs: Transaction[]): {
  dividends: number;
  coupons: number;
  total: number;
} {
  let dividends = 0;
  let coupons = 0;
  for (const t of txs) {
    if (t.type === 'dividend_accrual') dividends += t.amount;
    else if (t.type === 'interest_payout') coupons += t.amount;
  }
  return { dividends, coupons, total: dividends + coupons };
}

// ---------------------------------------------------------------------------
// WEALTH-MANAGEMENT-ARCHITECTURE reconciliation (P1 feat/formula-parity).
// The doc's §1/§2/§5 formula families, implemented additively next to the v1
// capital-gain metrics (which stay untouched — they ARE the doc's CapitalGain
// family, relabeled in P2). Full audit record: docs/reference/FORMULA-AUDIT.md.
// All *Pct functions return FRACTIONS (0.053 = +5.3%), matching
// yieldSinceStart; zero denominators return null (rendered "—"), never
// NaN/Infinity.
// ---------------------------------------------------------------------------

const sumWhere = (txs: Transaction[], types: readonly Transaction['type'][]) =>
  txs.reduce((s, t) => (types.includes(t.type) ? s + t.amount : s), 0);

/**
 * Doc §2.1 InvestedOwn per asset — Σ 'buy' amounts ONLY.
 *
 * The doc filters `Type == "Buy" AND Source == "Own Funds"`; in this app
 * reinvestment is its own TxType ('reinvest', counted by reinvestedByAsset),
 * so every 'buy' row IS own-funded capital today. If a future dataset ever
 * records a buy funded from accrual sources, this filter gains the source
 * check (revisit trigger, see docs/reference/FORMULA-AUDIT.md).
 * Contrast investedByAsset (buys + reinvests) — the v1 capital-gain basis.
 */
export function investedOwnByAsset(txs: Transaction[]): Record<string, number> {
  return sumByAsset(txs, ['buy']);
}

/** Doc §2.1 PayoutsGross per asset — Σ interest_payout + dividend_accrual. */
export function payoutsGrossByAsset(txs: Transaction[]): Record<string, number> {
  return sumByAsset(txs, ['interest_payout', 'dividend_accrual']);
}

/** Doc §2.1 PayoutsGross, portfolio total. */
export function payoutsGross(txs: Transaction[]): number {
  return sumWhere(txs, ['interest_payout', 'dividend_accrual']);
}

/** Doc §2.1 TaxesPaid per asset — Σ 'tax' rows. */
export function taxesPaidByAsset(txs: Transaction[]): Record<string, number> {
  return sumByAsset(txs, ['tax']);
}

/** Doc §2.1 TaxesPaid, portfolio total. */
export function taxesPaid(txs: Transaction[]): number {
  return sumWhere(txs, ['tax']);
}

/** Doc §2.1 PayoutsNet per asset = PayoutsGross − TaxesPaid. */
export function payoutsNetByAsset(txs: Transaction[]): Record<string, number> {
  const gross = payoutsGrossByAsset(txs);
  const taxes = taxesPaidByAsset(txs);
  const out: Record<string, number> = { ...gross };
  for (const [assetId, tax] of Object.entries(taxes)) {
    out[assetId] = (out[assetId] ?? 0) - tax;
  }
  return out;
}

/** Doc §2.1 PayoutsNet, portfolio total (gross − taxes). */
export function payoutsNet(txs: Transaction[]): number {
  return payoutsGross(txs) - taxesPaid(txs);
}

/** Doc §2.1 SoldAmount per asset — Σ sell + redemption. */
export function soldAmountByAsset(txs: Transaction[]): Record<string, number> {
  return sumByAsset(txs, ['sell', 'redemption']);
}

/** Doc §2.1 SoldAmount, portfolio total — Σ sell + redemption. */
export function soldAmount(txs: Transaction[]): number {
  return sumWhere(txs, ['sell', 'redemption']);
}

/**
 * Doc §2.1 CapitalGain = value − investedOwn − reinvested — the UNREALIZED
 * price move only. Negative right after a payout even when the position is
 * profitable overall (the doc's "illusion of loss": …6475 shows −₴116,88
 * here while totalNetProfit is +₴238,52).
 */
export function capitalGain(value: number, investedOwn: number, reinvested: number): number {
  return value - investedOwn - reinvested;
}

/**
 * Doc §2.1 CapitalGainPercentage = capitalGain / (investedOwn + reinvested).
 * Fraction; null when nothing was ever injected (zero denominator).
 */
export function capitalGainPct(
  value: number,
  investedOwn: number,
  reinvested: number,
): number | null {
  const base = investedOwn + reinvested;
  return base === 0 ? null : capitalGain(value, investedOwn, reinvested) / base;
}

/**
 * Doc §2.1 TotalNetProfit = value + payoutsNet + sold − investedOwn −
 * reinvested — realized cash (net of taxes) + unrealized value, the honest
 * both-families metric.
 */
export function totalNetProfit(
  value: number,
  payoutsNetAmount: number,
  sold: number,
  investedOwn: number,
  reinvested: number,
): number {
  return value + payoutsNetAmount + sold - investedOwn - reinvested;
}

/**
 * Doc §2.1 TotalReturnPercentage = totalNetProfit / investedOwn — the
 * denominator is EXTERNAL capital only (investedOwn, NOT + reinvested):
 * reinvested cash is system-generated, and counting it would dilute the
 * return the user's own money earned (same rationale as §5's NetDeposits
 * denominator). Fraction; null when investedOwn is 0.
 */
export function totalReturnPct(
  value: number,
  payoutsNetAmount: number,
  sold: number,
  investedOwn: number,
  reinvested: number,
): number | null {
  return investedOwn === 0
    ? null
    : totalNetProfit(value, payoutsNetAmount, sold, investedOwn, reinvested) / investedOwn;
}

/**
 * Doc §2.1 CashYieldPercentage = payoutsNet / (investedOwn + reinvested) —
 * realized cash generated per unit of injected capital. Fraction; null on
 * zero denominator.
 */
export function cashYieldPct(
  payoutsNetAmount: number,
  investedOwn: number,
  reinvested: number,
): number | null {
  const base = investedOwn + reinvested;
  return base === 0 ? null : payoutsNetAmount / base;
}

/**
 * The PORTFOLIO's money-weighted annualized rate (A25) — the annualized
 * counterpart of `globalRoi`, which measures the same thing without regard to
 * when the money arrived.
 *
 * THE BOUNDARY IS EXTERNAL CAPITAL, and that is the whole design. `deposit`
 * and `withdrawal` are the only rows that cross the portfolio's edge —
 * `netDeposits` below already draws the line there, citing doc §5.1. Buys,
 * sells, reinvests, payouts and taxes move money WITHIN the boundary: between
 * the cash pot and the assets, or between assets. Whatever they did is already
 * in `terminalValue`, so feeding them in as flows would count them twice.
 *
 * This is exactly what makes it different from the per-asset XIRR in
 * `screens/yield/yield.ts`, which is the mirror image: it takes the buys,
 * sells and payouts and SKIPS deposits and withdrawals, because at the asset's
 * boundary those are the internal ones. Neither is more correct; they answer
 * about different boundaries.
 *
 * Signs follow `CashFlow`'s convention, from the investor's side: a deposit is
 * money going in, so negative; a withdrawal comes back, so positive; the
 * terminal value is what is still there to come back, so positive.
 *
 * `terminalDate` is `latestSnapshotDate(snapshots)` and `terminalValue` is
 * `headlineTotal(snapshots)` — passed in rather than derived here so the
 * function stays a pure function of its arguments, the same shape
 * `assetCashFlows` uses. Null with no snapshots, and null through `xirr`'s own
 * guards when the flows are degenerate.
 *
 * NOT YET DISPLAYED ANYWHERE, deliberately: where this figure belongs on
 * screen is a design question and belongs to `PLAN-NOW.md` A26's brief (G7).
 * It is tested, not dead.
 */
export function portfolioXirr(
  txs: Transaction[],
  terminalValue: number,
  terminalDate: string | undefined,
): number | null {
  if (!terminalDate) return null;
  const flows: CashFlow[] = [];
  for (const t of txs) {
    // The assetId a deposit carries is noise — the transaction form attaches
    // the selected asset to every row it writes. Only the type matters here.
    if (t.type === 'deposit') flows.push({ date: t.date, amount: -t.amount });
    else if (t.type === 'withdrawal') flows.push({ date: t.date, amount: t.amount });
  }
  flows.push({ date: terminalDate, amount: terminalValue });
  return xirr(flows);
}

/** Doc §5.1 NetDeposits = Σ deposits − Σ withdrawals (external capital only). */
export function netDeposits(txs: Transaction[]): number {
  return txs.reduce((s, t) => {
    if (t.type === 'deposit') return s + t.amount;
    if (t.type === 'withdrawal') return s - t.amount;
    return s;
  }, 0);
}

/**
 * Doc §5.1 GlobalROI = (totalCapital − netDeposits) / netDeposits — global
 * performance against EXTERNAL user deposits only. Adding reinvests to the
 * denominator is exactly the corruption §5 bans (the v1 headline +3.08%
 * divides by buys+reinvests — it stays as the capital-gain-family KPI,
 * relabeled in P2; this is the additive doc-compliant metric: +4.08% on
 * seed). Fraction; null when netDeposits ≤ 0 (nothing external to measure
 * against — a non-positive denominator would flip the sign into nonsense).
 */
export function globalRoi(totalCapitalAmount: number, netDepositsAmount: number): number | null {
  return netDepositsAmount <= 0
    ? null
    : (totalCapitalAmount - netDepositsAmount) / netDepositsAmount;
}

/**
 * Net-of-tax variant of incomeReceived (doc §2's Tax Illusion: ignoring
 * taxes inflates gross ROI). dividends/coupons stay gross per category —
 * a 'tax' row carries only an assetId, not which payout it taxed, so
 * category-level attribution would be guesswork — and `total` is net:
 * dividends + coupons − taxes. The gross incomeReceived stays untouched
 * (it backs the D5-pinned ₴5,040.94 KPI).
 */
export function incomeReceivedNet(txs: Transaction[]): {
  dividends: number;
  coupons: number;
  taxes: number;
  total: number;
} {
  const { dividends, coupons } = incomeReceived(txs);
  const taxes = taxesPaid(txs);
  return { dividends, coupons, taxes, total: dividends + coupons - taxes };
}

/**
 * Ledger-derived free cash — PINNED v1 formulation (deliberate deviation
 * from doc §1.1, see docs/reference/FORMULA-AUDIT.md §1):
 *
 *   deposits − withdrawals − buys + sells + redemptions
 *
 * The doc's §1.1 also adds payouts and subtracts taxes/reinvestments. This
 * app EXCLUDES payout/reinvest/tax rows because:
 * - payouts are EXTERNAL unless reinvested — the user's real Inzhur config
 *   sends dividends to a bank account, so a payout row does not credit
 *   broker cash (the seed validates only under this rule: deposits
 *   143 176,37 − buys 143 168,62 = 7,75 ✓; the doc's verbatim formula would
 *   give 3 661,31 ✗);
 * - reinvest rows are funded by their paired same-date payout, so the pair
 *   nets to zero broker-cash effect either way;
 * - a future `destination` field on payout rows will bring broker-credited
 *   payouts into this sum (revisit trigger #1);
 * - every 'buy' is own-funded today; if a buy funded by accrual sources
 *   ever exists in the data, the buy term needs a source filter (revisit
 *   trigger #2).
 */
export function freeCashFromLedger(txs: Transaction[]): number {
  return txs.reduce((s, t) => {
    switch (t.type) {
      case 'deposit':
        return s + t.amount;
      case 'withdrawal':
        return s - t.amount;
      case 'buy':
        return s - t.amount;
      case 'sell':
      case 'redemption':
        return s + t.amount;
      default:
        return s; // payout/reinvest/tax rows are external to broker cash
    }
  }, 0);
}

/**
 * Reconciliation-check primitive (doc §1 SSOT, adapted): Snapshot.cash stays
 * the OBSERVED broker balance the user types; this returns stored − derived
 * so callers can warn when |drift| exceeds a tolerance — surfacing the
 * doc's "leaks" without making the ledger the system of record for cash.
 */
export function ledgerCashDrift(storedCash: number, txs: Transaction[]): number {
  return storedCash - freeCashFromLedger(txs);
}
