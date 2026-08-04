// Fixed-yield automation, PURE half — S4 (ghost accrual suggestions) and S5
// (the coupon-due card) of design/extensions/daily-quotes-live.dc.html.
//
// G5 restated where it is decided: nothing in this module writes anything. It
// turns stored data into a NUMBER the UI may offer, or TOKENS describing an
// occurrence — the user's Confirm/Save press stays the only write path.
//
// Day count is ACT/365 throughout (D13 / docs/FORMULA-AUDIT.md ruling 4).
// Money this module CREATES (a suggested quote, a coupon estimate) is rounded
// once, at creation, to kopecks — the same rule core/inzhur/parse.ts follows:
// D13's "round at display only" governs derivations over stored data, not a
// value that is about to be shown in an input and saved from it.
import { addMonths, daysBetween } from './dates';
import type { Asset, PayoutSchedule, Transaction } from './types';

/** Coupon payments per year, by payout schedule (0 = the schedule pays none). */
const PAYMENTS_PER_YEAR: Record<PayoutSchedule, number> = {
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  maturity: 1,
  none: 0,
};

/** Months between two consecutive coupons; undefined = no recurring period. */
const MONTHS_PER_PERIOD: Record<PayoutSchedule, number | undefined> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  maturity: undefined, // one payment, on the maturity date
  none: undefined,
};

/** Safety net while walking a coupon grid (a corrupt schedule must not spin). */
const MAX_GRID_STEPS = 500;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface AccrualFallback {
  /** `Asset.expectedPct` — an annual 0–100 percentage (the stored field's unit). */
  expectedPct: number;
  /** Capital invested in the asset (buys + reinvests). */
  invested: number;
}

/**
 * ₴ a fixed-coupon position accrues per day. Primary basis: the stated coupon
 * spread over its period (`couponAmount × payments/year ÷ 365`). Fallback for an
 * asset whose coupon attributes were never filled in: `expectedPct × invested ÷
 * 365` — the plan's pinned fallback. 0 means "not derivable" and callers must
 * then suggest nothing.
 */
export function dailyAccrual(
  couponAmount: number | undefined,
  schedule: PayoutSchedule,
  fallback?: AccrualFallback,
): number {
  const perYear = PAYMENTS_PER_YEAR[schedule];
  if (couponAmount !== undefined && couponAmount > 0 && perYear > 0) {
    return (couponAmount * perYear) / 365;
  }
  if (fallback === undefined || fallback.expectedPct <= 0 || fallback.invested <= 0) return 0;
  return ((fallback.expectedPct / 100) * fallback.invested) / 365;
}

/**
 * Σ of the coupons whose payment date falls in `(fromExclusive, toInclusive]`,
 * per the asset's own schedule anchored on `nextCoupon`.
 *
 * The gap crossing MATTERS: a bond's price DROPS by the coupon on payment day,
 * so a carry-forward that only adds accrual would over-suggest by one coupon
 * (an explicit plan Verify item). The grid is walked from the anchor because
 * `nextCoupon` may sit on either side of the gap — before it once the user has
 * confirmed that coupon, after it while the payment is still pending.
 */
export function couponsInGap(asset: Asset, fromExclusive: string, toInclusive: string): number {
  const amount = asset.couponAmount;
  const anchor = asset.nextCoupon;
  if (amount === undefined || amount <= 0 || !anchor) return 0;

  const months = MONTHS_PER_PERIOD[asset.payoutSchedule];
  if (months === undefined) {
    return anchor > fromExclusive && anchor <= toInclusive ? amount : 0;
  }

  // EVERY grid date is computed FROM THE ANCHOR (`anchor + k periods`), never by
  // stepping a running date: `addMonths` clamps to month-end (2026-08-31 −1m →
  // 2026-07-31 −1m → 2026-06-30), so back-stepping and then forward-stepping is
  // NOT an inverse — an anchor past the 28th drifted onto a grid the asset never
  // pays on and over-counted a coupon, which the S4 ghost then subtracted from a
  // money value the user accepts with one press.
  const [anchorYear, anchorMonth] = anchor.split('-').map(Number);
  const [fromYear, fromMonth] = fromExclusive.split('-').map(Number);
  const monthsToGap = (fromYear - anchorYear) * 12 + (fromMonth - anchorMonth);
  // One whole period of margin behind the gap start: a day-of-month difference
  // can never span a full period, so no counted date sits before this index.
  const startIndex = Math.floor(monthsToGap / months) - 1;

  let count = 0;
  for (let i = 0; i < MAX_GRID_STEPS; i++) {
    const date = addMonths(anchor, (startIndex + i) * months);
    if (date > toInclusive) break;
    if (date > fromExclusive) count++;
  }
  return count * amount;
}

export interface QuoteSuggestionInput {
  /** The asset's most recent quote before the date being quoted. */
  lastQuote: number;
  /** That quote's date. */
  lastDate: string;
  /** The date being quoted (the Daily-quotes selected date). */
  today: string;
  /** ₴ accrued per day — `dailyAccrual`. */
  daily: number;
  /** Σ coupons paid in (lastDate, today] — `couponsInGap`. */
  couponsInGap: number;
  /** Accrual stops here: a redeemed bond's price no longer drifts. */
  maturity?: string;
}

/**
 * S4's ghost value: last quote carried forward by the daily accrual, minus any
 * coupon paid in the gap, CLAMPED AT MATURITY. `null` = suggest nothing (no
 * accrual basis, nothing to carry forward, or a non-positive result — the input
 * only accepts positive numbers).
 */
export function suggestedQuote(input: QuoteSuggestionInput): number | null {
  const { lastQuote, lastDate, today, daily, maturity } = input;
  if (daily <= 0) return null;
  // Clamp: days accrue up to maturity and no further.
  const until = maturity !== undefined && maturity < today ? maturity : today;
  const days = daysBetween(lastDate, until);
  if (days <= 0) return null;
  const value = lastQuote + daily * days - input.couponsInGap;
  return value <= 0 ? null : round2(value);
}

/**
 * How many days around a due date a recorded `interest_payout` still counts AS
 * that coupon. A payment lands on or a little around its scheduled date; every
 * schedule's period (≥ 1 month) is far wider than this window, so a catch-up
 * roll can never be silenced by the coupon before it.
 */
export const COUPON_MATCH_WINDOW_DAYS = 7;

/**
 * Is a coupon scheduled for `date` already recorded? The one dedupe predicate,
 * shared by `dueCoupons` (S5 cards) and `core/reminders` (S6 coupon banners) so
 * a manually entered coupon silences BOTH surfaces by the same rule.
 */
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
  /** The occurrence's scheduled date, on the asset's own coupon grid. */
  date: string;
  /** The asset's stated `couponAmount`, when it has one. */
  amount: number | undefined;
}

export interface CouponWalkOptions {
  /** Recorded-payout match window (defaults to `COUPON_MATCH_WINDOW_DAYS`). */
  windowDays?: number;
  /**
   * Derived ids the user has already settled by hand — an S5 skip files
   * `coupon:<assetId>:<date>` (D21), and a skipped occurrence must not block the
   * ones behind it.
   */
  dismissed?: readonly string[];
}

/**
 * The next coupon occurrence still OPEN for an asset: walk its own grid forward
 * from `nextCoupon`, stepping over every occurrence already SETTLED — recorded
 * as an `interest_payout` inside the match window, or skipped from the S5 card.
 *
 * Why a walk and not `asset.nextCoupon` itself: `nextCoupon` only ever moves
 * through the S5 confirm, so a coupon the user recorded in the Transaction panel
 * (or skipped, or whose roll failed after the payout was written) left the field
 * frozen on a settled date — and the dedupe then silenced the card AND the
 * banners for that asset forever. Reading the grid instead of the pointer makes
 * the surfaces self-healing and delivers the brief's pinned S5 `skipped` rule
 * ("the NEXT coupon date suggests normally"). Nothing here writes: the pointer
 * is still rolled only by the user's Confirm press (G5).
 */
export function nextUnsettledCoupon(
  asset: Asset,
  transactions: Transaction[],
  opts: CouponWalkOptions = {},
): CouponOccurrence | undefined {
  if (asset.yieldType !== 'fixed_coupon') return undefined;
  let date = asset.nextCoupon;
  if (!date) return undefined;

  const windowDays = opts.windowDays ?? COUPON_MATCH_WINDOW_DAYS;
  const dismissed = opts.dismissed ?? [];

  for (let i = 0; i < MAX_GRID_STEPS; i++) {
    const settled =
      couponRecorded(transactions, asset.id, date, windowDays) ||
      dismissed.includes(couponReminderId(asset.id, date));
    if (!settled) return { date, amount: asset.couponAmount };
    // Same stepper the confirm writes with, so the walk can never land on a date
    // the roll would not produce (and it stops at maturity rather than past it).
    const roll = rollNextCoupon(asset, date);
    if (roll === undefined || roll.kind === 'matured') return undefined;
    date = roll.nextCoupon;
  }
  return undefined;
}

export interface DueCoupon {
  assetId: string;
  /** The scheduled date that has arrived (the next unsettled occurrence). */
  date: string;
  /** 0 = due today; > 0 = overdue by that many days (S5's warn date pill). */
  overdueDays: number;
  /** The asset's stated `couponAmount`, when it has one. */
  amount: number | undefined;
}

/**
 * S5: coupons whose date has arrived with NO matching `interest_payout` already
 * recorded — the dedupe that keeps a manually entered coupon from being offered
 * a second time (a plan Verify item). One occurrence per asset, taken from
 * `nextUnsettledCoupon`, so a settled occurrence yields the floor to the next
 * one instead of silencing the asset.
 */
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
 * The asset's next coupon date after the one just recorded — the single
 * `updateAsset` patch value the S5 confirm writes. `matured` is a flag only:
 * the date NEVER moves past `maturity` (the final coupon lands on it, together
 * with the principal), and an asset already at maturity stops suggesting.
 * `undefined` = nothing scheduled, nothing to roll.
 *
 * `from` overrides the starting date for callers that know the occurrence they
 * are stepping off (the confirm rolls from the date it just recorded, and
 * `nextUnsettledCoupon` walks with it) — the asset's own `nextCoupon` may lag
 * behind it and would otherwise roll to a date already settled.
 */
export function rollNextCoupon(asset: Asset, from?: string): CouponRoll | undefined {
  const current = from ?? asset.nextCoupon;
  if (!current) return undefined;

  const maturity = asset.maturity;
  if (maturity !== undefined && current >= maturity) return { kind: 'matured' };

  const months = MONTHS_PER_PERIOD[asset.payoutSchedule];
  const next = months === undefined ? maturity : addMonths(current, months);
  if (next === undefined) return { kind: 'matured' }; // no period and no maturity date
  if (maturity !== undefined && next > maturity) return { kind: 'rolled', nextCoupon: maturity };
  return { kind: 'rolled', nextCoupon: next };
}

export interface CouponProjection {
  amount: number;
  date: string;
  /** true = an `expectedPct` estimate, not a stated amount (the UI prefixes '~'). */
  estimated: boolean;
}

/**
 * The next coupon a fixed-coupon asset is expected to pay — the projection
 * behind Overview's "Next payouts" rows and Seasonality's expected bars.
 *
 * THE FIX (plan item): both projections used to require BOTH `couponAmount` and
 * `nextCoupon`, so a user-created bond missing either attribute was skipped
 * without a word. The amount now falls back to the per-period share of
 * `expectedPct × invested` (flagged `estimated`, rendered "~"), and the date
 * falls back to `maturity` — a payment date the asset itself states. No date is
 * ever invented: with neither date the projection stays absent. The demo seed
 * carries both attributes on both bonds, which is why the gap was invisible —
 * and why every D5-pinned figure is unchanged by this fallback.
 */
export function couponProjection(asset: Asset, invested: number): CouponProjection | undefined {
  if (asset.yieldType !== 'fixed_coupon') return undefined;
  const date = asset.nextCoupon || asset.maturity;
  if (!date) return undefined;

  if (asset.couponAmount !== undefined && asset.couponAmount > 0) {
    return { amount: asset.couponAmount, date, estimated: false };
  }

  const perYear = PAYMENTS_PER_YEAR[asset.payoutSchedule];
  if (perYear === 0 || asset.expectedPct <= 0 || invested <= 0) return undefined;
  const amount = round2(((asset.expectedPct / 100) * invested) / perYear);
  return amount <= 0 ? undefined : { amount, date, estimated: true };
}

/**
 * Derived id of one coupon occurrence. Shared by the S5 skip and the S6 coupon
 * reminders (`feat/reminders` reuses it), so skipping the card silences the
 * banner for the SAME occurrence — and both expire naturally once the date
 * passes out of scope (the derived-id doctrine).
 */
export function couponReminderId(assetId: string, date: string): string {
  return `coupon:${assetId}:${date}`;
}
