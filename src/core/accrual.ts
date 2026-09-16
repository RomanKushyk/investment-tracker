// Fixed-yield automation, the PURE half: nothing here writes.
//
// Day count is ACT/365 throughout (docs/reference/FORMULA-AUDIT.md ruling 4),
// with ONE exception — spreading a KNOWN coupon over its own period amortises a
// cash flow rather than annualising a rate, so it divides by the real period.
// Money this module CREATES is rounded ONCE, at creation, to kopecks.
import { addMonths, dayBefore, daysBetween } from './dates';
import { unitsByAsset } from './derive';
import type { Asset, PayoutSchedule, Transaction } from './types';
// The coupon convention lives in a LEAF module — `ovdp.ts` says why.
import { OVDP_FACE_UAH, PAYMENTS_PER_YEAR } from './ovdp';

// Re-exported because every existing citation of these two names points here.
export { OVDP_FACE_UAH, PAYMENTS_PER_YEAR };

const MONTHS_PER_PERIOD: Record<PayoutSchedule, number | undefined> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  maturity: undefined, // one payment, on the maturity date
  none: undefined,
};

const MAX_GRID_STEPS = 500;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface AccrualFallback {
  expectedPct: number;
  invested: number;
}

/**
 * ₴ ONE coupon brings, as `ratePct / 100 / paymentsPerYear × FACE × units`.
 * THE RATE IS THE FIXED PROPERTY, the amount is not, and it agrees with the
 * provider’s schedule BY CONSTRUCTION: `ratePct / 100 × 1000 / 2 = ratePct × 5`
 * is exactly the per-unit coupon the feed publishes. `couponAmount` is the
 * LEGACY fallback, unscaled because it never knew how many units it counted.
 */
export function couponPerPayment(asset: Asset, units: number | undefined): number | undefined {
  // GATED ON THE YIELD TYPE: a caller that forgot would get a coupon for a
  // `div_cap` asset carrying a legacy `couponAmount`.
  if (asset.yieldType !== 'fixed_coupon') return undefined;

  const perYear = PAYMENTS_PER_YEAR[asset.payoutSchedule];
  const rate = asset.couponRatePct;

  // THE LEDGER FIRST, THEN THE LINK’S LEGACY TOTAL — `matchAssets`’ rule. The
  // count is `undefined` only when NOBODY knows.
  const held = units ?? asset.inzhur?.units;

  // A CLOSED POSITION PAYS NO COUPON, whichever figure would have answered, which
  // is why this sits ABOVE the rate branch. It lived inside, and a legacy bond
  // fell past it to `couponAmount` and reported a coupon for a holding that is gone.
  if (held !== undefined && held <= 0) return undefined;
  if (rate !== undefined && rate > 0 && perYear > 0) {
    // UNKNOWN AND ZERO ARE DIFFERENT QUESTIONS: `undefined` means the ledger cannot
    // count this asset, so the RATE cannot answer either and the legacy amount is
    // all the asset has. `<= 0` is handled above, for every source.
    if (held === undefined) return asset.couponAmount;
    return round2(((rate / 100) * OVDP_FACE_UAH * held) / perYear);
  }
  return asset.couponAmount;
}

/**
 * **Pass `periodDays` whenever the real period is known** — accrual is then
 * ACT/ACT in-period and lands EXACTLY on the coupon. Without it the annualised
 * approximation never lands: the real bonds pay every 182 days, not six calendar
 * months, so the error is structural at the boundary, where the confirm card
 * prefills an amount. Kept because `payoutSchedule` alone carries no dates.
 */
export function dailyAccrual(
  couponAmount: number | undefined,
  schedule: PayoutSchedule,
  fallback?: AccrualFallback,
  periodDays?: number,
): number {
  const perYear = PAYMENTS_PER_YEAR[schedule];
  if (couponAmount !== undefined && couponAmount > 0 && perYear > 0) {
    if (periodDays !== undefined && periodDays > 0) return couponAmount / periodDays;
    return (couponAmount * perYear) / 365;
  }
  if (fallback === undefined || fallback.expectedPct <= 0 || fallback.invested <= 0) return 0;
  return ((fallback.expectedPct / 100) * fallback.invested) / 365;
}

/** Undefined when the schedule cannot bracket the date; the caller then omits it. */
export function couponPeriodDays(dates: string[], onIso: string): number | undefined {
  const sorted = [...new Set(dates)].sort();
  if (sorted.length < 2) return undefined;
  for (let i = 1; i < sorted.length; i += 1) {
    const from = sorted[i - 1]!;
    const to = sorted[i]!;
    if (onIso > from && onIso <= to) {
      return Math.round(
        (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
      );
    }
  }
  return undefined;
}

/**
 * The gap crossing MATTERS: a bond’s price DROPS by the coupon on payment day,
 * so a carry-forward that only added accrual would over-suggest by one coupon.
 */
export function couponsInGap(
  asset: Asset,
  /**
   * A RESOLVER, NOT A NUMBER, because one figure cannot answer for two dates: the
   * caller derives it from the units held on the DRAFTED date, and this multiplies
   * it by every coupon in the gap, which the position was a different size for.
   */
  perCouponAt: (couponDate: string) => number | undefined,
  fromExclusive: string,
  toInclusive: string,
  schedule?: readonly string[],
): number {
  const anchor = asset.nextCoupon;
  if (!anchor) return 0;
  // NO PAIRING GUARD HERE, DELIBERATELY: the rule is real, but the daily rate was
  // built from the drafted date’s holding, which the caller holds and this does
  // not. It lives in `accrualSuggestion`.

  // The provider’s own dates beat any grid derived from them — the real bonds pay
  // every 182 days and almost always on a Wednesday. Deduped because the last
  // the principal share the maturity date, and only one is a coupon.
  if (schedule !== undefined && schedule.length > 0) {
    const dates = [...new Set(schedule)];
    return dates
      .filter((d) => d > fromExclusive && d <= toInclusive)
      .reduce((sum, d) => sum + (perCouponAt(d) ?? 0), 0);
  }

  const months = MONTHS_PER_PERIOD[asset.payoutSchedule];
  if (months === undefined) {
    return anchor > fromExclusive && anchor <= toInclusive ? (perCouponAt(anchor) ?? 0) : 0;
  }

  // EVERY grid date is computed FROM THE ANCHOR, never by stepping a running date:
  // `addMonths` CLAMPS to month-end, so back-stepping then forward-stepping is NOT
  // an inverse — an anchor past the 28th drifts onto a grid the asset never pays
  // on and over-counts a coupon the ghost then subtracts.
  const [anchorYear, anchorMonth] = anchor.split('-').map(Number);
  const [fromYear, fromMonth] = fromExclusive.split('-').map(Number);
  const monthsToGap = (fromYear - anchorYear) * 12 + (fromMonth - anchorMonth);
  // One whole period of margin behind the gap start: a day-of-month difference can
  // never span a full period, so no counted date sits before this index.
  const startIndex = Math.floor(monthsToGap / months) - 1;

  let total = 0;
  for (let i = 0; i < MAX_GRID_STEPS; i++) {
    const date = addMonths(anchor, (startIndex + i) * months);
    if (date > toInclusive) break;
    if (date > fromExclusive) total += perCouponAt(date) ?? 0;
  }
  return total;
}

export interface QuoteSuggestionInput {
  lastQuote: number;
  lastDate: string;
  today: string;
  daily: number;
  couponsInGap: number;
  maturity?: string;
}

/** Last quote carried forward by the accrual, minus coupons in the gap, CLAMPED
 *  AT MATURITY. `null` = suggest nothing. */
export function suggestedQuote(input: QuoteSuggestionInput): number | null {
  const { lastQuote, lastDate, today, daily, maturity } = input;
  if (daily <= 0) return null;
  const until = maturity !== undefined && maturity < today ? maturity : today;
  const days = daysBetween(lastDate, until);
  if (days <= 0) return null;
  const value = lastQuote + daily * days - input.couponsInGap;
  return value <= 0 ? null : round2(value);
}

/** Every schedule’s period is far wider, so a catch-up roll cannot be silenced
 *  by the coupon before it. */
export const COUPON_MATCH_WINDOW_DAYS = 7;

/** The ONE dedupe predicate, shared with `core/reminders` so a manually entered
 *  coupon silences both surfaces by the same rule. */
export function couponRecorded(
  transactions: Transaction[],
  assetId: string,
  date: string,
  windowDays: number = COUPON_MATCH_WINDOW_DAYS,
): boolean {
  return transactions.some(
    (t) =>
      t.type === 'interest_payout' &&
      t.assetId === assetId &&
      Math.abs(daysBetween(date, t.date)) <= windowDays,
  );
}

export interface CouponOccurrence {
  date: string;
  amount: number | undefined;
}

export interface CouponWalkOptions {
  windowDays?: number;
  /** Ids the user settled by hand; a skipped occurrence must not block the ones
   *  behind it. */
  dismissed?: readonly string[];
}

/**
 * A WALK AND NOT `asset.nextCoupon`: the pointer moves only through the confirm,
 * so a coupon recorded in the Transaction panel left it frozen on a settled date
 * and the dedupe silenced the card AND the banners forever. SPLIT from the
 * amount-bearing version, which costs a whole-ledger walk per asset per render.
 */
export function nextUnsettledCouponDate(
  asset: Asset,
  transactions: Transaction[],
  opts: CouponWalkOptions = {},
): string | undefined {
  if (asset.yieldType !== 'fixed_coupon') return undefined;
  let date = asset.nextCoupon;
  if (!date) return undefined;

  const windowDays = opts.windowDays ?? COUPON_MATCH_WINDOW_DAYS;
  const dismissed = opts.dismissed ?? [];

  for (let i = 0; i < MAX_GRID_STEPS; i++) {
    const settled =
      couponRecorded(transactions, asset.id, date, windowDays) ||
      dismissed.includes(couponReminderId(asset.id, date));
    if (!settled) return date;
    // The same stepper the confirm writes with, so the walk cannot land on a date
    // the roll would not produce.
    const roll = rollNextCoupon(asset, date);
    if (roll === undefined || roll.kind === 'matured') return undefined;
    date = roll.nextCoupon;
  }
  return undefined;
}

export function nextUnsettledCoupon(
  asset: Asset,
  transactions: Transaction[],
  opts: CouponWalkOptions = {},
): CouponOccurrence | undefined {
  const date = nextUnsettledCouponDate(asset, transactions, opts);
  if (date === undefined) return undefined;
  // UNITS AS OF THE DAY THE COUPON DATE OPENED, not today’s, and it must be the
  // SAME bound `DailyQuotes` computes `unitsOnCouponDate` with — two bounds for one
  // quantity is the divergence `couponsInGap` was fixed for.
  const held = unitsByAsset(transactions, dayBefore(date))[asset.id];
  return { date, amount: couponPerPayment(asset, held) };
}

export interface DueCoupon {
  assetId: string;
  date: string;
  overdueDays: number;
  amount: number | undefined;
}

/** ONE occurrence per asset, so a settled one yields to the next instead of
 *  silencing the asset. */
export function dueCoupons(
  assets: Asset[],
  transactions: Transaction[],
  today: string,
  opts: CouponWalkOptions = {},
): DueCoupon[] {
  const due: DueCoupon[] = [];

  for (const asset of assets) {
    const occurrence = nextUnsettledCoupon(asset, transactions, opts);
    if (occurrence === undefined || occurrence.date > today) continue;
    due.push({
      assetId: asset.id,
      date: occurrence.date,
      overdueDays: daysBetween(occurrence.date, today),
      amount: occurrence.amount,
    });
  }

  return due.sort((a, b) => a.date.localeCompare(b.date));
}

export type CouponRoll = { kind: 'rolled'; nextCoupon: string } | { kind: 'matured' };

/**
 * The date NEVER moves past `maturity`: the final coupon lands on it, with the
 * principal. `from` overrides the start for callers that know the occurrence
 * they stepped off — the asset’s pointer may lag onto a date already settled.
 */
export function rollNextCoupon(
  asset: Asset,
  from?: string,
  schedule?: readonly string[],
): CouponRoll | undefined {
  const current = from ?? asset.nextCoupon;
  if (!current) return undefined;

  const maturity = asset.maturity;
  if (maturity !== undefined && current >= maturity) return { kind: 'matured' };

  const months = MONTHS_PER_PERIOD[asset.payoutSchedule];
  const scheduled =
    schedule === undefined ? undefined : [...new Set(schedule)].sort().find((d) => d > current);
  const next = scheduled ?? (months === undefined ? maturity : addMonths(current, months));
  if (next === undefined) return { kind: 'matured' }; // no period and no maturity date
  if (maturity !== undefined && next > maturity) return { kind: 'rolled', nextCoupon: maturity };
  return { kind: 'rolled', nextCoupon: next };
}

export interface CouponProjection {
  amount: number;
  date: string;
  estimated: boolean;
}

/**
 * Neither attribute is required: the amount falls back to the per-period share
 * of `expectedPct × invested` and the date to `maturity`. NO DATE IS EVER
 * INVENTED — with neither, the projection stays absent.
 */
export function couponProjection(
  asset: Asset,
  invested: number,
  /**
   * REQUIRED rather than optional: while it defaulted, a caller that forgot got
   * the whole-position figure AND skipped the closed-position guard below.
   */
  units: number | undefined,
): CouponProjection | undefined {
  if (asset.yieldType !== 'fixed_coupon') return undefined;
  const date = asset.nextCoupon || asset.maturity;
  if (!date) return undefined;

  // A CLOSED POSITION PROJECTS NOTHING, asked BEFORE the estimate: only "no stated
  // figure" may fall through, and `investedByAsset` is never reduced by a `sell`,
  // so a sold-out bond kept projecting, relabelled `estimated: true`.
  if (units !== undefined && units <= 0) return undefined;
  const stated = couponPerPayment(asset, units);
  if (stated !== undefined && stated > 0) return { amount: stated, date, estimated: false };

  const perYear = PAYMENTS_PER_YEAR[asset.payoutSchedule];
  if (perYear === 0 || asset.expectedPct <= 0 || invested <= 0) return undefined;
  const amount = round2(((asset.expectedPct / 100) * invested) / perYear);
  return amount <= 0 ? undefined : { amount, date, estimated: true };
}

const MONTHS_IN_YEAR = 12;

/**
 * THE SCHEDULE IS DERIVABLE, AND IT IS NOT DERIVED HERE. A private month grid
 * disagreed with `rollNextCoupon` twice: it broke where the roll CLAMPS to
 * `maturity`, and it gated on today where the app gates on SETTLEMENT. THE
 * ANCHOR IS THE OCCURRENCE THE APP STILL OWES, not the stored pointer.
 */
export function scheduledCouponMonths(asset: Asset, transactions: Transaction[]): number[] {
  if (asset.yieldType !== 'fixed_coupon') return [];
  // The DATE-ONLY walk: the amount would cost a full ledger traversal per asset
  // per render, and this never reads it.
  const open = nextUnsettledCouponDate(asset, transactions);
  const anchor = open ?? (asset.nextCoupon === undefined ? asset.maturity : undefined);
  if (anchor === undefined) return [];

  let date = anchor;
  const months = new Set<number>();
  // Bounded by the calendar rather than by MAX_GRID_STEPS: `maturity` is optional,
  // so a semiannual bond without one never reports 'matured', collects only two
  // distinct months, and ran its full step budget on every render.
  for (let i = 0; i < MONTHS_IN_YEAR; i++) {
    months.add(Number(date.slice(5, 7)));
    if (months.size === MONTHS_IN_YEAR) break;
    const roll = rollNextCoupon(asset, date);
    if (roll === undefined || roll.kind === 'matured') break;
    date = roll.nextCoupon;
  }
  return [...months].sort((a, b) => a - b);
}

/** Shared by the skip and the reminders so skipping the card silences the banner
 *  for the SAME occurrence — and both expire once the date passes out of scope. */
export function couponReminderId(assetId: string, date: string): string {
  return `coupon:${assetId}:${date}`;
}

/**
 * The occurrence a DELETED payout was settling — the confirm rolls the pointer
 * forward, and the forward-only walk never looks behind it, so deleting the row
 * alone made the occurrence vanish from every surface at once. THE PAYOUT’S OWN
 * DATE IS THE RESTORE POINT, needing no backward stepper.
 */
export function rollbackNextCoupon(
  asset: Asset,
  deleted: Transaction,
  remaining: Transaction[],
  opts: CouponWalkOptions = {},
): string | undefined {
  if (asset.yieldType !== 'fixed_coupon') return undefined;
  if (deleted.type !== 'interest_payout' || deleted.assetId !== asset.id) return undefined;
  const pointer = asset.nextCoupon;
  // A payout ON or AFTER the pointer never moved it: the pointer only ever sits on
  // an occurrence that is still open.
  if (pointer === undefined || deleted.date >= pointer) return undefined;
  const windowDays = opts.windowDays ?? COUPON_MATCH_WINDOW_DAYS;
  if (couponRecorded(remaining, asset.id, deleted.date, windowDays)) return undefined;
  return deleted.date;
}
