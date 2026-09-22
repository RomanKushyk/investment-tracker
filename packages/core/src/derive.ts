// Pure derivations — every displayed figure comes from these. No I/O.
// *Derived figures and the seed* holds the reconciliation rules.
import {
  isPayout,
  movesPosition,
  PAYOUT_TYPES,
  unitDelta,
  unnamedType,
  type Asset,
  type Snapshot,
  type Transaction,
} from './types';
import type { PeriodWindow } from './period';
import { xirr, type CashFlow } from './xirr';

/**
 * The first day the portfolio existed — the EARLIEST of a transaction, a
 * snapshot, or an asset’s own `firstPurchase`. A `min` and not a pick, because
 * the direction is not symmetric: too LATE divides a long return by a short
 * span and prints a rate nobody earned, too early only understates. ONE date
 * for every asset — `xirr` is the per-asset answer. *Derived figures and the seed*
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

export function startDateByAsset(assets: Asset[], txs: Transaction[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of assets) if (a.firstPurchase) out[a.id] = a.firstPurchase;
  for (const t of txs) {
    if (!t.assetId) continue;
    const cur = out[t.assetId];
    if (cur === undefined || t.date < cur) out[t.assetId] = t.date;
  }
  return out;
}

export function assetStart(asset: Asset, txs: Transaction[]): string | undefined {
  let earliest = asset.firstPurchase;
  for (const t of txs) {
    if (t.assetId !== asset.id) continue;
    if (earliest === undefined || t.date < earliest) earliest = t.date;
  }
  return earliest;
}

/**
 * How far short of the basis a holding may fall before `Річна` stops being a rate
 * it can support: present for `h` of `n` days understates by `n / h`, and `проти
 * очікуваної` is in percentage points, so this is where that reaches one point.
 */
export const SHORT_BASIS_TOLERANCE = 0.1;

export function basisIsShort(heldDays: number, basisDays: number): boolean {
  // ONLY the basis short-circuits, never `heldDays`: zero or negative holding is
  // the MAXIMUM shortfall, and exempting it leaves the worst row unmarkable.
  if (basisDays <= 0) return false;
  return heldDays < basisDays * (1 - SHORT_BASIS_TOLERANCE);
}

const byDate = (snaps: Snapshot[]) => [...snaps].sort((a, b) => a.date.localeCompare(b.date));

/**
 * A STOCK, so a window gives it the window’s END. AN ASSET NEVER QUOTED STAYS
 * ABSENT, never 0 — a deliberate deviation from doc §4.1
 * (`docs/reference/FORMULA-AUDIT.md` §4). Absent renders "—"; a fake 0 corrupts
 * `headlineTotal` and every share and net figure built on it.
 */
export function quotesAsOf(snaps: Snapshot[], asOf?: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of byDate(snaps)) {
    if (asOf !== undefined && s.date > asOf) break; // sorted, so the rest are later too
    Object.assign(out, s.quotes);
  }
  return out;
}

export function latestQuotes(snaps: Snapshot[]): Record<string, number> {
  return quotesAsOf(snaps);
}

/**
 * Both halves at one instant WHEN BOUND: the quotes merged up to `asOf` and the
 * ledger summed to the same day. A date before the first valuation returns the cash
 * alone rather than 0 — money deposited before anything was valued is still capital.
 *
 * UNBOUND THE TWO HALVES SIT ON A SEAM, because the ledger runs to its last row while
 * the quotes stop at the last snapshot. A row entered SINCE that snapshot therefore
 * moves cash with no valuation opposite it: a late deposit raises the total, correctly,
 * and a late BUY lowers it by the whole amount until the day is quoted, because the
 * units it bought are not valued yet. That is the seam, not a loss, and `quotesAsOf`
 * states the half it comes from: an unquoted asset is ABSENT, never 0. It closes when
 * value stops coming from snapshots — `valueAsOf` is that door.
 */
export function headlineTotalAsOf(snaps: Snapshot[], txs: Transaction[], asOf?: string): number {
  return (
    Object.values(quotesAsOf(snaps, asOf)).reduce((a, b) => a + b, 0) +
    freeCashFromLedger(txs, asOf)
  );
}

export function headlineTotal(snaps: Snapshot[], txs: Transaction[]): number {
  return headlineTotalAsOf(snaps, txs);
}

export function transactionsIn(txs: Transaction[], w: PeriodWindow): Transaction[] {
  return txs.filter((t) => t.date >= w.from && t.date <= w.to);
}

/**
 * NO UPPER BOUND: a window ends at the latest valuation, so an upper clip can
 * only exclude rows entered SINCE it — which is how a buy dated after the last
 * snapshot once vanished from `/yield`.
 */
export function transactionsFromWindow(
  txs: Transaction[],
  w: { from: string } | undefined,
): Transaction[] {
  return w === undefined ? txs : transactionsFrom(txs, w.from);
}

export function transactionsFrom(txs: Transaction[], from: string): Transaction[] {
  return txs.filter((t) => t.date >= from);
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

// Σ quotes of ONE snapshot + the free cash on ITS day (Balances rows / area chart).
export function totalCapital(s: Snapshot, txs: Transaction[]): number {
  return Object.values(s.quotes).reduce((a, b) => a + b, 0) + freeCashFromLedger(txs, s.date);
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

/**
 * ₴ per unit this holder PAID — the stored price before the division, which
 * loses the last kopiyka. THE EARLIEST purchase, never an average.
 */
export function purchaseUnitPrice(
  txs: Transaction[],
  assetId: string,
): { price: number; date: string } | undefined {
  const buys = txs
    .filter((t) => t.assetId === assetId && t.type === 'buy' && t.quantity !== undefined)
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = buys[0];
  if (first === undefined) return undefined;
  // THE DATE COMES BACK WITH THE PRICE: returning it alone sends the caller to
  // `asset.firstPurchase`, a form field editable independently of the ledger.
  const price =
    first.unitPrice ?? (first.quantity! > 0 ? first.amount / first.quantity! : undefined);
  return price === undefined || price <= 0 ? undefined : { price, date: first.date };
}

/**
 * A LEDGER CARRYING NO QUANTITIES MUST BE DISTINGUISHABLE FROM ONE HOLDING ZERO
 * UNITS — the first still needs `Asset.inzhur.units` to be valued, the second is
 * closed. NOT rounded.
 */
export interface LedgerUnits {
  /** Units held, per asset that the ledger can count completely. */
  units: Record<string, number>;
  /** RETURNED, because `units`’ missing keys cannot tell "has rows but one is
   *  uncounted" from "has no rows at all", and only the first means a stale total. */
  incomplete: string[];
}

export function unitsByAsset(txs: Transaction[], asOf?: string): Record<string, number> {
  return ledgerUnits(txs, asOf).units;
}

/** `unitsByAsset` plus the assets it declined to count — one walk, both answers. */
export function ledgerUnits(txs: Transaction[], asOf?: string): LedgerUnits {
  // COMPLETENESS FIRST: "any row has a quantity" is not equivalent, because
  // backfill is by hand. `moving` takes THE WHOLE LEDGER while `incomplete` is
  // bounded by `asOf`; bounding `moving` reports a PAST position as the larger.
  const within = (tx: Transaction) => asOf === undefined || tx.date <= asOf;
  const incomplete = new Set<string>();
  const moving = new Set<string>();
  for (const tx of txs) {
    if (!movesPosition(tx.type)) continue;
    moving.add(tx.assetId);
    if (within(tx) && tx.quantity === undefined) incomplete.add(tx.assetId);
  }

  // `Object.create(null)`, NOT `{}`, because the sum loop gates on `assetId in
  // out` and `in` walks the prototype chain. An asset id of `toString` or
  // `valueOf` — any non-empty string passes `assetRowSchema` — would `+=` against
  // an inherited function, which `positionValue` then multiplies.
  const out: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const assetId of moving) {
    if (!incomplete.has(assetId)) out[assetId] = 0;
  }

  for (const tx of txs) {
    if (!within(tx) || !(tx.assetId in out)) continue;
    out[tx.assetId] += unitDelta(tx);
  }
  return { units: out, incomplete: [...incomplete] };
}

/** Resolves ONE price per unit for one asset on one date, or nothing. The server
 *  passes the user’s overlay and the global archive; core never learns which is
 *  which, nor where either came from. */
export type PriceLookup = (assetId: string, asOf: string) => number | undefined;

/**
 * `value(a, D) = units(a, D) × coalesce(user_price(a, D), archive(a, D))`
 * (*Derived figures and the seed*). `undefined` where no price answers and where
 * the ledger cannot count the units — the rule `quotesAsOf` states above: an
 * unpriced asset stays ABSENT, because a fabricated 0 corrupts every total and
 * every share built on it.
 */
export function valueAsOf(
  assetId: string,
  asOf: string,
  txs: Transaction[],
  userPrice: PriceLookup,
  archive: PriceLookup,
): number | undefined {
  const units = ledgerUnits(txs, asOf).units[assetId];
  if (units === undefined) return undefined;
  const price = userPrice(assetId, asOf) ?? archive(assetId, asOf);
  return price === undefined ? undefined : units * price;
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

/** `sold` is not cosmetic: a closed position leaves `values` while its basis
 *  stays in `invested`, so without the proceeds this reads as a total loss. */
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

/** A denominator a share can be taken of. Free cash is the ledger's signed sum and
 *  nothing bounds it, so the total can be negative, zero or `NaN`. */
export function usableTotal(total: number): boolean {
  return Number.isFinite(total) && total > 0;
}

/** Negative OR unreadable: `!(cash >= 0)` is how `NaN` counts as short too. */
export function cashIsShort(cash: number): boolean {
  return !(cash >= 0);
}

/** The total shares are taken of: `NaN`, so never usable, while the ledger is short —
 *  negative cash shrinks the total, so the shares sum past 100 % even while it is positive. */
export function shareTotal(total: number, cash: number): number {
  return cashIsShort(cash) ? NaN : total;
}

/** ABSENT, never a fake 0, when the total is not usable or the value is negative —
 *  the rule `globalRoi` follows (*Metric families and windows*). */
export function sharePct(value: number, total: number): number | null {
  return usableTotal(total) && value >= 0 ? (value / total) * 100 : null;
}

export function allocationDeltaPp(share: number, targetPct: number): number {
  return share - targetPct;
}

// Overweight sell: linear share of the (unchanged) total.
export function trimAmount(share: number, targetPct: number, total: number): number {
  return ((share - targetPct) / 100) * total;
}

/**
 * Doc §3.1 RequiredTranche — the injection grows the denominator, so the naive
 * `target×total − value` never reaches the share. CALLERS MUST GUARD: the doc’s
 * `if (TargetShare <= CurrentShare) return 0` is not here, so an at-or-over
 * target returns a NEGATIVE tranche.
 */
export function topUpAmount(value: number, targetPct: number, total: number): number {
  const t = targetPct / 100;
  return (t * total - value) / (1 - t);
}

export function headlineKpis(
  snaps: Snapshot[],
  txs: Transaction[],
): { total: number; net: { uah: number; pct: number } } {
  return {
    total: headlineTotal(snaps, txs),
    net: netResult(latestQuotes(snaps), investedByAsset(txs), soldAmount(txs)),
  };
}

// Counted on ACCRUAL, not on receipt (doc §6.5).
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

// The architecture doc’s §1/§2/§5 families, beside the capital-gain metrics above
// rather than replacing them. Every *Pct returns a FRACTION and a zero
// denominator returns null, never NaN. docs/reference/FORMULA-AUDIT.md

const sumWhere = (txs: Transaction[], types: readonly Transaction['type'][]) =>
  txs.reduce((s, t) => (types.includes(t.type) ? s + t.amount : s), 0);

export function investedOwnByAsset(txs: Transaction[]): Record<string, number> {
  return sumByAsset(txs, ['buy']);
}

/** Doc §2.1 PayoutsGross per asset — Σ interest_payout + dividend_accrual. */
export function payoutsGrossByAsset(txs: Transaction[]): Record<string, number> {
  return sumByAsset(txs, PAYOUT_TYPES);
}

export function payoutsGross(txs: Transaction[]): number {
  return sumWhere(txs, PAYOUT_TYPES);
}

/**
 * Doc §2.1 TaxesPaid per asset. `isPayout` GATES IT AND THE DDL IS NOT A
 * SUBSTITUTE: a CHECK is unreachable from `core/`, the same reason
 * `POSITION_MOVING` is mirrored here. Ungated, a
 * `{ type: 'deposit', assetId: '', taxWithheld: 10 }` row counts in the total
 * and files under the EMPTY key, which nothing reads.
 */
export function taxesPaidByAsset(txs: Transaction[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of txs) {
    if (!isPayout(t.type) || t.taxWithheld === undefined) continue;
    out[t.assetId] = (out[t.assetId] ?? 0) + t.taxWithheld;
  }
  return out;
}

/** Doc §2.1 TaxesPaid, portfolio total. Gated as above, and for the same reason. */
export function taxesPaid(txs: Transaction[]): number {
  return txs.reduce((sum, t) => sum + (isPayout(t.type) ? (t.taxWithheld ?? 0) : 0), 0);
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

export function payoutsNet(txs: Transaction[]): number {
  return payoutsGross(txs) - taxesPaid(txs);
}

/** Doc §2.1 SoldAmount per asset — Σ sell + redemption. */
export function soldAmountByAsset(txs: Transaction[]): Record<string, number> {
  return sumByAsset(txs, ['sell', 'redemption']);
}

export function soldAmount(txs: Transaction[]): number {
  return sumWhere(txs, ['sell', 'redemption']);
}

/** Doc §2.1 CapitalGain — the UNREALIZED move only, so it reads negative right
 *  after a payout. The doc’s illusion of loss. */
export function capitalGain(value: number, investedOwn: number, reinvested: number): number {
  return value - investedOwn - reinvested;
}

/** Doc §2.1 CapitalGainPercentage = capitalGain / (investedOwn + reinvested). */
export function capitalGainPct(
  value: number,
  investedOwn: number,
  reinvested: number,
): number | null {
  const base = investedOwn + reinvested;
  return base === 0 ? null : capitalGain(value, investedOwn, reinvested) / base;
}

/** Doc §2.1 TotalNetProfit = value + payoutsNet + sold − investedOwn − reinvested. */
export function totalNetProfit(
  value: number,
  payoutsNetAmount: number,
  sold: number,
  investedOwn: number,
  reinvested: number,
): number {
  return value + payoutsNetAmount + sold - investedOwn - reinvested;
}

/** Doc §2.1 TotalReturnPercentage — EXTERNAL capital only, NOT + reinvested:
 *  reinvested cash is system-generated and would dilute what the user earned. */
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

/** Doc §2.1 CashYieldPercentage = payoutsNet / (investedOwn + reinvested). */
export function cashYieldPct(
  payoutsNetAmount: number,
  investedOwn: number,
  reinvested: number,
): number | null {
  const base = investedOwn + reinvested;
  return base === 0 ? null : payoutsNetAmount / base;
}

// `null` and NOT `undefined`, which the arms can also produce from an
// unvalidated Dexie read of a row missing its amount — that must reach `xirr`
// and become the «—» that says so, not be skipped as internal.
function externalFlowAmount(t: Transaction): number | null {
  switch (t.type) {
    case 'deposit':
      return -t.amount;
    case 'withdrawal':
      return t.amount;
    case 'buy':
    case 'sell':
    case 'redemption':
    case 'dividend_accrual':
    case 'interest_payout':
    case 'reinvest':
      return null;
    default:
      return unnamedType(t.type, null);
  }
}

/**
 * THE BOUNDARY IS EXTERNAL CAPITAL: only `deposit` and `withdrawal` cross the
 * portfolio’s edge, and everything else is already in `terminalValue`. The
 * per-asset XIRR in `view/yield.ts` is the MIRROR IMAGE.
 */
export function portfolioXirr(
  txs: Transaction[],
  terminalValue: number,
  terminalDate: string | undefined,
): number | null {
  if (!terminalDate) return null;
  const flows: CashFlow[] = [];
  for (const t of txs) {
    const amount = externalFlowAmount(t);
    if (amount !== null) flows.push({ date: t.date, amount });
  }
  flows.push({ date: terminalDate, amount: terminalValue });
  return xirr(flows);
}

/** Doc §5.1 NetDeposits = Σ deposits − Σ withdrawals (external capital only). */
export function netDeposits(txs: Transaction[]): number {
  return txs.reduce((s, t): number => {
    switch (t.type) {
      case 'deposit':
        return s + t.amount;
      case 'withdrawal':
        return s - t.amount;
      case 'buy':
      case 'sell':
      case 'redemption':
      case 'dividend_accrual':
      case 'interest_payout':
      case 'reinvest':
        return s;
      default:
        return unnamedType(t.type, s);
    }
  }, 0);
}

/** Doc §5.1 GlobalROI — EXTERNAL deposits only; reinvests in the denominator is
 *  the corruption §5 bans. Null when netDeposits ≤ 0, which would flip the sign. */
export function globalRoi(totalCapitalAmount: number, netDepositsAmount: number): number | null {
  return netDepositsAmount <= 0
    ? null
    : (totalCapitalAmount - netDepositsAmount) / netDepositsAmount;
}

/** Doc §2’s Tax Illusion. EVERY FIGURE HERE IS NET, category included; the
 *  gross `incomeReceived` answers a different question. */
export function incomeReceivedNet(txs: Transaction[]): {
  dividends: number;
  coupons: number;
  taxes: number;
  total: number;
} {
  let dividends = 0;
  let coupons = 0;
  let taxes = 0;
  for (const t of txs) {
    if (!isPayout(t.type)) continue;
    const net = t.amount - (t.taxWithheld ?? 0);
    if (t.type === 'dividend_accrual') dividends += net;
    else coupons += net;
    taxes += t.taxWithheld ?? 0;
  }
  return { dividends, coupons, taxes, total: dividends + coupons };
}

/**
 * Free cash on a date: the ledger’s signed sum up to it, and nothing stored
 * (*Metric families and windows*). Every row crosses the account, so there is no
 * exclusion left — a payout CREDITS `amount − coalesce(taxWithheld, 0)` and a
 * reinvest DEBITS its own amount, which is what makes a payout and a reinvest of
 * UNEQUAL size reportable where two exclusions could only ever net them to zero.
 *
 * The withholding is read off the payout rather than skipped, so it is not an
 * exclusion returning by another door: two columns of one row, nothing hidden.
 * Without it free cash overstates by every hryvnia ever withheld.
 *
 * `asOf` is INCLUSIVE of its own day, like every other bound here, so a window
 * valued the day before it opens counts each row exactly once.
 */
export function freeCashFromLedger(txs: Transaction[], asOf?: string): number {
  // The `default:` arm takes `never`, so a ninth type fails to COMPILE here — one
  // that slid past would be a zero nobody chose.
  return txs.reduce((s, t): number => {
    if (asOf !== undefined && t.date > asOf) return s;
    switch (t.type) {
      case 'deposit':
        return s + t.amount;
      case 'withdrawal':
        return s - t.amount;
      case 'buy':
      case 'reinvest':
        return s - t.amount;
      case 'sell':
      case 'redemption':
        return s + t.amount;
      case 'dividend_accrual':
      case 'interest_payout':
        return s + t.amount - (t.taxWithheld ?? 0);
      default:
        return unnamedType(t.type, s);
    }
  }, 0);
}
