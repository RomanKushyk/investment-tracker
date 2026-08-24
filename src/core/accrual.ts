// Fixed-yield automation, PURE half — S4 (ghost accrual suggestions) and S5
// (the coupon-due card) of design/extensions/daily-quotes-live.dc.html.
//
// G5 restated where it is decided: nothing in this module writes anything. It
// turns stored data into a NUMBER the UI may offer, or TOKENS describing an
// occurrence — the user's Confirm/Save press stays the only write path.
//
// Day count is ACT/365 throughout (D13 / docs/reference/FORMULA-AUDIT.md ruling 4) — with
// ONE deliberate exception: spreading a KNOWN coupon over its own period is an
// amortisation of a cash flow, not the annualisation of a rate, so it divides by
// the real period length when that is known. See `dailyAccrual`.
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
 * ₴ a fixed-coupon position accrues per day. 0 means "not derivable" and callers
 * must then suggest nothing.
 *
 * **Pass `periodDays` whenever the real coupon period is known** — from the
 * provider's `paymentSchedule`, as the gap between consecutive payments. Then
 * accrual is `couponAmount / periodDays` (ACT/ACT in-period) and it lands
 * EXACTLY on the coupon at the payment date.
 *
 * Without it, the annualised approximation `couponAmount × payments/year ÷ 365`
 * is used, and it never lands on the coupon: the user's real bonds pay every
 * 182 days (verified against the live feed — always a Wednesday, not "six
 * calendar months"), so a ₴1 240 semiannual coupon accrues at ₴6,7945/day and
 * reaches ₴1 236,60 over the period — ₴3,40 short. A 184-day period overshoots
 * to ₴1 250,19. The error is small daily and structural at the boundary, which
 * is exactly where the coupon-confirm card prefills an amount.
 *
 * The approximation is kept rather than removed because `payoutSchedule` alone
 * carries no dates — an asset with no linked schedule has nothing better.
 *
 * Fallback for an asset whose coupon attributes were never filled in:
 * `expectedPct × invested ÷ 365`. That one is period-independent by nature — it
 * is an annual yield, not a coupon — so `periodDays` does not apply to it.
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

/**
 * Days between the two scheduled payments bracketing `onIso` — the divisor
 * `dailyAccrual` wants. Undefined when the schedule cannot bracket the date
 * (fewer than two payments, or a date outside their span), in which case the
 * caller simply omits `periodDays` and takes the approximation.
 *
 * Dates are plain `yyyy-MM-dd`, so subtraction is exact integer day arithmetic
 * with no timezone in play.
 */
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
 * Σ of the coupons whose payment date falls in `(fromExclusive, toInclusive]`,
 * per the asset's own schedule anchored on `nextCoupon`.
 *
 * The gap crossing MATTERS: a bond's price DROPS by the coupon on payment day,
 * so a carry-forward that only adds accrual would over-suggest by one coupon
 * (an explicit plan Verify item).
 *
 * `schedule` — the provider's published payment dates. Pass them whenever they
 * exist; the month grid below is the FALLBACK for an asset with no linked
 * schedule, exactly as `dailyAccrual` keeps its annualised approximation.
 *
 * The grid is walked from the anchor because
 * `nextCoupon` may sit on either side of the gap — before it once the user has
 * confirmed that coupon, after it while the payment is still pending.
 */
export function couponsInGap(
  asset: Asset,
  fromExclusive: string,
  toInclusive: string,
  schedule?: readonly string[],
): number {
  const amount = asset.couponAmount;
  const anchor = asset.nextCoupon;
  if (amount === undefined || amount <= 0 || !anchor) return 0;

  // The provider's own dates beat any grid derived from them. The real bonds
  // pay every 182 days and always on a Wednesday, which no month arithmetic
  // reproduces: from a 25.03.2026 anchor the grid is 2 days late by the next
  // coupon and 5 days late by 2028. Dates deduped because the final row lands
  // twice — the last coupon and the principal share the maturity date, and only
  // one of them is a coupon.
  if (schedule !== undefined && schedule.length > 0) {
    const dates = [...new Set(schedule)];
    const count = dates.filter((d) => d > fromExclusive && d <= toInclusive).length;
    return count * amount;
  }

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
  // Published dates first, for the reason couponsInGap gives. The maturity
  // clamp below still applies: with a real schedule it becomes expressible from
  // the data rather than asserted, since the schedule ends there too.
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

/** A year is every month there is; a schedule cannot name a thirteenth. */
const MONTHS_IN_YEAR = 12;

/**
 * Every calendar month a bond still expects to pay in — the answer to D-5,
 * which the design sheet left open (A41).
 *
 * WHY THE SHEET COULD NOT ANSWER IT. Both formulations it tried were set
 * differences against `bondCouponInfo`, and that function holds no schedule:
 * its `months` is the months the bond HAS PAID in, plus the one `nextCoupon`
 * names. Subtracting the historical months leaves at most one, and nothing at
 * all once that coupon is paid. Per bucket the failure arrived after a year of
 * a monthly payer filling the calendar; per bond, after its own first cycle.
 *
 * THE SCHEDULE IS DERIVABLE, AND IT IS NOT DERIVED HERE. A first cut walked its
 * own month grid and disagreed with `rollNextCoupon` twice over: it BROKE when
 * the grid overshot `maturity`, where the roll CLAMPS and pays a final short
 * coupon (…6475 is 03.12.2026 + 6m = 03.06.2027 against a 27.05.2027 maturity,
 * so травень vanished — the ordinary case, since real Inzhur bonds pay every
 * 182 days and drift off the month grid), and it gated on today, where the app
 * gates on SETTLEMENT. Both are now `rollNextCoupon`'s and
 * `nextUnsettledCoupon`'s to answer, which is the only way two readings of one
 * schedule cannot exist.
 *
 * THE ANCHOR IS THE OCCURRENCE THE APP STILL OWES, not the stored pointer.
 * `nextCoupon` only ever moves through the S5 confirm, so the day after a
 * coupon falls due it still points into the past — a today-based cutoff dropped
 * серпень for a coupon the reminders were actively raising, while the day axis
 * kept drawing it because `couponProjection` takes no date at all. It is also
 * what ends the schedule: the confirm leaves `nextCoupon` on the final date
 * forever, so settlement, not the calendar, is what makes this go empty.
 *
 * A bond with no pointer at all falls back to `maturity`, matching
 * `couponProjection`'s own fallback (F-18) — the two must never disagree about
 * whether an asset pays.
 */
export function scheduledCouponMonths(asset: Asset, transactions: Transaction[]): number[] {
  if (asset.yieldType !== 'fixed_coupon') return [];
  const open = nextUnsettledCoupon(asset, transactions);
  const anchor = open?.date ?? (asset.nextCoupon === undefined ? asset.maturity : undefined);
  if (anchor === undefined) return [];

  let date = anchor;
  const months = new Set<number>();
  // Bounded by the calendar rather than by MAX_GRID_STEPS: `maturity` is
  // optional, so a semiannual bond without one never reports 'matured' and only
  // ever collects two distinct months — the twelve-month exit could not fire
  // and the walk ran its full 500 steps on every render.
  for (let i = 0; i < MONTHS_IN_YEAR; i++) {
    months.add(Number(date.slice(5, 7)));
    if (months.size === MONTHS_IN_YEAR) break;
    const roll = rollNextCoupon(asset, date);
    if (roll === undefined || roll.kind === 'matured') break;
    date = roll.nextCoupon;
  }
  return [...months].sort((a, b) => a - b);
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
