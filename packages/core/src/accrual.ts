// Fixed-yield automation, the PURE half: nothing here writes.
//
// Day count is ACT/365 throughout (docs/reference/FORMULA-AUDIT.md ruling 4),
// with ONE exception — spreading a KNOWN coupon over its own period amortises a
// cash flow rather than annualising a rate, so it divides by the real period.
// Money this module CREATES is rounded ONCE, at creation, to kopecks.
import { addDays, addMonths, dayBefore, daysBetween } from './dates';
import { holdsNone, unitsByAsset } from './derive';
import { movesPosition, type Asset, type PayoutSchedule, type Transaction } from './types';
// The coupon convention lives in a LEAF module — `ovdp.ts` says why.
import { OVDP_COUPON_PERIOD_DAYS, OVDP_FACE_UAH, PAYMENTS_PER_YEAR } from './ovdp';

// Re-exported because every existing citation of these two names points here.
export { OVDP_FACE_UAH, PAYMENTS_PER_YEAR };

// A semiannual coupon steps in days, `OVDP_COUPON_PERIOD_DAYS`, never on this grid.
const MONTHS_PER_PERIOD: Record<Exclude<PayoutSchedule, 'semiannual'>, number | undefined> = {
  monthly: 1,
  quarterly: 3,
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

  // A CLOSED POSITION PAYS NO COUPON, whichever figure would answer: inside the rate branch, a
  // legacy bond would fall past this to `couponAmount` and report a coupon for a closed holding.
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

/** **Pass `periodDays` whenever the real period is known**: accrual then lands EXACTLY on the
 *  coupon, where the annualised fallback for a dateless schedule misses the confirm’s prefill. */
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
  /** REQUIRED: behind a semiannual start on the maturity that no published date answers, the coupon
   *  before is the payout recorded for it, where one is. */
  transactions: readonly Transaction[],
  schedule?: readonly string[],
): number {
  const anchor = asset.nextCoupon;
  if (!anchor) return 0;
  // NO PAIRING GUARD HERE, DELIBERATELY: the rule is real, but the daily rate was
  // built from the drafted date’s holding, which the caller holds and this does
  // not. It lives in `accrualSuggestion`.

  // The provider’s own dates (OVDP-COUPON-STRUCTURE.md), deduped because the final coupon and the
  // principal share the maturity date and only one is a coupon.
  const dates = schedule !== undefined && schedule.length > 0 ? [...new Set(schedule)] : undefined;
  // `addDays` throws on a date no calendar has, and the walk owes nothing off one or off a clamp onto one.
  const start =
    asset.payoutSchedule === 'semiannual' && !noCalendarDate(anchor)
      ? publishedStart(asset, anchor, dates)
      : undefined;

  if (start !== undefined && !noCalendarDate(start)) {
    let total = 0;
    // Forward through the roll, so the gap counts what the walk offers, the bridge to the first date
    // served included; with the dates, a date inside the dedupe window of the last is that payment.
    let named: string | undefined;
    let date: string | undefined = start;
    for (let i = 0; date !== undefined && date <= toInclusive && i < MAX_GRID_STEPS; i++) {
      if (noCalendarDate(date)) break; // a maturity no calendar has, which the walk owes nothing on
      if (
        dates === undefined ||
        named === undefined ||
        daysBetween(named, date) > COUPON_MATCH_WINDOW_DAYS
      ) {
        if (date > fromExclusive) total += perCouponAt(date) ?? 0;
        named = date;
      }
      const roll = rollNextCoupon(asset, date, dates);
      date = roll?.kind === 'rolled' ? roll.nextCoupon : undefined;
    }
    // Back from the start, the coupons the confirm rolled past, stepped as the roll steps forward.
    let after = start;
    // A fold or a clamp leaves no step back from the maturity, so where no published date answers it,
    // the coupon before is the payout recorded for it, where one is.
    if (
      fromExclusive < start &&
      start === asset.maturity &&
      publishedPrev(start, dates) === undefined
    ) {
      // Outside the window that settles the maturity itself, within a folded period and a window of it.
      const lo = addDays(
        start,
        -(OVDP_COUPON_PERIOD_DAYS + FINAL_FOLD_DAYS + COUPON_MATCH_WINDOW_DAYS),
      );
      const hi = addDays(start, -COUPON_MATCH_WINDOW_DAYS);
      const near = transactions
        .filter((t) => t.type === 'interest_payout' && t.assetId === asset.id)
        .map((t) => t.date)
        .filter((d) => !noCalendarDate(d) && d >= lo && d < hi)
        .sort();
      // The latest coupon recorded, dated by its first entry: another inside the window is the same one.
      const last = near.at(-1);
      const recorded = last && near.find((d) => d >= addDays(last, -COUPON_MATCH_WINDOW_DAYS));
      if (recorded) {
        if (recorded <= fromExclusive) return total;
        if (recorded <= toInclusive) total += perCouponAt(recorded) ?? 0;
        after = recorded;
      }
    }
    for (let k = 0; k < MAX_GRID_STEPS; k++) {
      const before = publishedPrev(after, dates) ?? addDays(after, -OVDP_COUPON_PERIOD_DAYS);
      if (before <= fromExclusive) break;
      if (before <= toInclusive) total += perCouponAt(before) ?? 0;
      after = before;
    }
    return total;
  }

  // Where no walk is counted, the published dates stand as given.
  if (dates !== undefined) {
    return dates
      .filter((d) => d > fromExclusive && d <= toInclusive)
      .reduce((sum, d) => sum + (perCouponAt(d) ?? 0), 0);
  }
  if (asset.payoutSchedule === 'semiannual') return 0;

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

/** A final period no longer than this joins the one before it, as Strata's SMART_FINAL folds a stub:
 *  one payout settles every occurrence within the window, so it could settle both ends of it. */
const FINAL_FOLD_DAYS = 2 * COUPON_MATCH_WINDOW_DAYS;

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

// A date no calendar has, which a backup can carry (`2026-13-01`), has no day before it.
function noCalendarDate(iso: string): boolean {
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`));
}

/** Units held at the end of the day before `date`: the record date on which the NBU depository
 *  fixes who a coupon or redemption is paid to. `undefined` where the ledger cannot count them. */
export function unitsOnRecordDate(
  transactions: Transaction[],
  assetId: string,
  date: string,
): number | undefined {
  if (noCalendarDate(date)) return undefined;
  return unitsByAsset(transactions, dayBefore(date))[assetId];
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
  /** A linked bond's published payment dates, which the walk steps through, starting on the one the
   *  stored coupon date stands for where the asset's schedule has a period and one is within half. */
  schedule?: readonly string[];
}

/** A WALK AND NOT `asset.nextCoupon`, which only the confirm moves. It passes an occurrence
 *  recorded, dismissed, or not owed: the ledger held none of the bond on its record date. */
export function nextUnsettledCouponDate(
  asset: Asset,
  transactions: Transaction[],
  opts: CouponWalkOptions = {},
): string | undefined {
  return walkFrom(asset, asset.nextCoupon, transactions, opts, undefined);
}

/** The payment still owed, none before `onOrAfter`. With no coupon date stored, the maturity is the
 *  one occurrence, judged as a coupon is. The projection and the schedule anchor on it. */
export function owedCouponDate(
  asset: Asset,
  transactions: Transaction[],
  onOrAfter?: string,
  schedule?: readonly string[],
): string | undefined {
  return walkFrom(asset, asset.nextCoupon || asset.maturity, transactions, { schedule }, onOrAfter);
}

function walkFrom(
  asset: Asset,
  stored: string | undefined,
  transactions: Transaction[],
  opts: CouponWalkOptions,
  onOrAfter: string | undefined,
): string | undefined {
  if (asset.yieldType !== 'fixed_coupon') return undefined;
  if (!stored) return undefined;
  // Only a stored coupon date estimates a payment: the maturity a walk falls back to is the redemption.
  let date = stored === asset.nextCoupon ? publishedStart(asset, stored, opts.schedule) : stored;

  const windowDays = opts.windowDays ?? COUPON_MATCH_WINDOW_DAYS;
  const dismissed = opts.dismissed ?? [];
  // One pass over the ledger: each occurrence then reads only the asset’s own rows.
  const own = transactions.filter((t) => t.assetId === asset.id);
  // A payout beside the stored date pays the start unless a published date it is beside claims it,
  // owed and paid by no other; the start claiming it is harmless, as the walk then settles the start.
  const claimed = (t: Transaction) =>
    (opts.schedule ?? []).some((published) => {
      const d = notPastMaturity(asset, published);
      return (
        couponRecorded([t], asset.id, d, windowDays) &&
        !holdsNone(unitsOnRecordDate(own, asset.id, d)) &&
        !own.some((u) => u !== t && couponRecorded([u], asset.id, d, windowDays))
      );
    });
  const storedSettled =
    date !== stored &&
    (own.some((t) => couponRecorded([t], asset.id, stored, windowDays) && !claimed(t)) ||
      dismissed.includes(couponReminderId(asset.id, stored)));
  // Past the last row that moves the asset’s units, a holding of none stays none.
  const lastRow = own.reduce(
    (last, t) => (movesPosition(t.type) && t.date > last ? t.date : last),
    '',
  );

  for (let i = 0; i < MAX_GRID_STEPS; i++) {
    // The start or a step: a maturity no calendar has is reached by clamping onto it.
    if (noCalendarDate(date)) return undefined;
    const passed =
      (onOrAfter !== undefined && date < onOrAfter) ||
      couponRecorded(own, asset.id, date, windowDays) ||
      dismissed.includes(couponReminderId(asset.id, date)) ||
      (i === 0 && storedSettled);
    if (!passed) {
      if (!holdsNone(unitsOnRecordDate(own, asset.id, date))) return date;
      if (lastRow < date) return undefined;
    }
    // The same stepper the confirm writes with, so the walk cannot land on a date
    // the roll would not produce.
    const roll = rollNextCoupon(asset, date, opts.schedule);
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
  // THE RECORD DATE’S UNITS, not today’s, and the SAME bound `DailyQuotes` computes
  // `unitsOnCouponDate` with: two bounds for one quantity diverge.
  const held = unitsOnRecordDate(transactions, asset.id, date);
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
 * With the dates, a semiannual roll steps off the published date the occurrence stands for, as the
 * walk starts: the confirm on `/` rolls off the offered date, which a hand edit can leave off them.
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

  // `addDays` throws on a date no calendar has, where there is nothing to step from.
  if (asset.payoutSchedule === 'semiannual' && noCalendarDate(current)) return undefined;
  // A month grid's bridge measures half a period off the date before, and month lengths differ, so
  // mapping its steps would pass a date the walk bridged short of.
  const start =
    asset.payoutSchedule === 'semiannual' ? publishedStart(asset, current, schedule) : current;
  if (maturity !== undefined && start >= maturity) return { kind: 'matured' };
  const step = periodStep(asset, start);
  let next = publishedNext(start, step, schedule);
  if (next === undefined) {
    // A step past the maturity folds too; the clamp below reaches a maturity no calendar has.
    next =
      asset.payoutSchedule === 'semiannual' &&
      step !== undefined &&
      maturity !== undefined &&
      daysBetween(step, maturity) <= FINAL_FOLD_DAYS
        ? maturity
        : (step ?? maturity);
  }
  if (next === undefined) return { kind: 'matured' }; // no period and no maturity date
  if (maturity !== undefined && next > maturity) return { kind: 'rolled', nextCoupon: maturity };
  return { kind: 'rolled', nextCoupon: next };
}

/** One period on from `current`: a semiannual coupon by days, the others by months, a schedule with
 *  no period not at all. The one stepper, so the walk's start and its bridge share a half period. */
function periodStep(asset: Asset, current: string): string | undefined {
  if (asset.payoutSchedule === 'semiannual') return addDays(current, OVDP_COUPON_PERIOD_DAYS);
  const months = MONTHS_PER_PERIOD[asset.payoutSchedule];
  return months === undefined ? undefined : addMonths(current, months);
}

/** The published date a coupon date stands for: the nearest within half a period, the earlier at a
 *  tie, never past the maturity as the roll never is. With none that near, the date itself. */
function publishedStart(
  asset: Asset,
  stored: string,
  schedule: readonly string[] | undefined,
): string {
  if (schedule === undefined || noCalendarDate(stored)) return stored;
  const step = periodStep(asset, stored);
  if (step === undefined) return stored;
  const half = Math.floor(daysBetween(stored, step) / 2);
  let nearest: string | undefined;
  let distance = half + 1;
  for (const d of schedule) {
    const gap = Math.abs(daysBetween(stored, d));
    if (gap < distance || (gap === distance && nearest !== undefined && d < nearest)) {
      nearest = d;
      distance = gap;
    }
  }
  return nearest === undefined ? stored : notPastMaturity(asset, nearest);
}

/** A published date past the maturity is read as the maturity, as the roll clamps onto it. */
function notPastMaturity(asset: Asset, iso: string): string {
  return asset.maturity !== undefined && iso > asset.maturity ? asset.maturity : iso;
}

/** The first published date past the dedupe window of the date stepped off, as `couponRecorded`
 *  takes a date inside it for the same occurrence. Off the published dates, none more than half a
 *  period past the step: the provider drops a bond's older payments, and a jump would pass one. */
function publishedNext(
  current: string,
  step: string | undefined,
  schedule: readonly string[] | undefined,
): string | undefined {
  if (schedule === undefined || noCalendarDate(current)) return undefined;
  const before = addDays(current, -COUPON_MATCH_WINDOW_DAYS);
  const after = addDays(current, COUPON_MATCH_WINDOW_DAYS);
  let next: string | undefined;
  let published = false;
  for (const d of schedule) {
    if (d > after) next = next === undefined || d < next ? d : next;
    else if (d >= before) published = true;
  }
  if (next === undefined || step === undefined || published) return next;
  return next <= addDays(step, Math.floor(daysBetween(current, step) / 2)) ? next : undefined;
}

/** `publishedNext` in reverse, for the gap behind the start of a semiannual walk: the latest published
 *  date before the dedupe window of `current`, off the dates none more than half a period before the step. */
function publishedPrev(
  current: string,
  schedule: readonly string[] | undefined,
): string | undefined {
  if (schedule === undefined) return undefined;
  const step = addDays(current, -OVDP_COUPON_PERIOD_DAYS);
  const before = addDays(current, -COUPON_MATCH_WINDOW_DAYS);
  const after = addDays(current, COUPON_MATCH_WINDOW_DAYS);
  let prev: string | undefined;
  let published = false;
  for (const d of schedule) {
    if (d < before) prev = prev === undefined || d > prev ? d : prev;
    else if (d <= after) published = true;
  }
  if (prev === undefined || published) return prev;
  return prev >= addDays(step, -Math.floor(OVDP_COUPON_PERIOD_DAYS / 2)) ? prev : undefined;
}

export interface CouponProjection {
  amount: number;
  date: string;
  estimated: boolean;
}

/**
 * Neither attribute is required: the amount falls back to the per-period share
 * of `expectedPct × invested`, and the date is `owedCouponDate`'s. NO DATE IS EVER
 * INVENTED — with nothing owed, the projection stays absent.
 */
export function couponProjection(
  asset: Asset,
  invested: number,
  /**
   * REQUIRED rather than optional: with a default, a caller that forgot would get
   * the whole-position figure AND skip the closed-position guard below.
   */
  units: number | undefined,
  /** Walked for the date: the stored pointer may be settled, or not owed. */
  transactions: Transaction[],
  onOrAfter?: string,
  schedule?: readonly string[],
): CouponProjection | undefined {
  if (asset.yieldType !== 'fixed_coupon') return undefined;
  // A CLOSED POSITION PROJECTS NOTHING, asked BEFORE the estimate and the walk: `investedByAsset`
  // ignores a `sell`, so a sold-out bond would keep projecting, relabelled `estimated: true`.
  if (units !== undefined && units <= 0) return undefined;
  const date = owedCouponDate(asset, transactions, onOrAfter, schedule);
  if (!date) return undefined;

  const stated = couponPerPayment(asset, units);
  if (stated !== undefined && stated > 0) return { amount: stated, date, estimated: false };

  const perYear = PAYMENTS_PER_YEAR[asset.payoutSchedule];
  if (perYear === 0 || asset.expectedPct <= 0 || invested <= 0) return undefined;
  const amount = round2(((asset.expectedPct / 100) * invested) / perYear);
  return amount <= 0 ? undefined : { amount, date, estimated: true };
}

const MONTHS_IN_YEAR = 12;

/** `rollNextCoupon` steps the occurrences, CLAMPING to `maturity` as the roll does, from THE OCCURRENCE
 *  THE APP STILL OWES; a month counts only on units held on its payment’s record date. */
export function scheduledCouponMonths(
  asset: Asset,
  transactions: Transaction[],
  schedule?: readonly string[],
): number[] {
  if (asset.yieldType !== 'fixed_coupon') return [];
  const own = transactions.filter((t) => t.assetId === asset.id);
  // The DATE-ONLY walk: the amount would cost a full ledger traversal per asset
  // per render, and this never reads it.
  const anchor = owedCouponDate(asset, own, undefined, schedule);
  if (anchor === undefined) return [];

  let date = anchor;
  const months = new Set<number>();
  // A periodic coupon is named by its first year's month at its place in the cycle: 182-day steps
  // cross month ends over the years, and Seasonality adds a whole coupon per month named.
  const perYear = PAYMENTS_PER_YEAR[asset.payoutSchedule];
  const cycle: number[] = [];
  // Bounded by the calendar, not MAX_GRID_STEPS: a bond with no `maturity` never reports 'matured'.
  for (let i = 0; i < MONTHS_IN_YEAR; i++) {
    const month = Number(date.slice(5, 7));
    if (i < perYear) cycle.push(month);
    // The final coupon, folded or clamped onto the maturity, lands with the principal in its own month.
    const named = perYear > 1 && date !== asset.maturity ? (cycle[i % perYear] ?? month) : month;
    if (!holdsNone(unitsOnRecordDate(own, asset.id, date))) months.add(named);
    if (months.size === MONTHS_IN_YEAR) break;
    const roll = rollNextCoupon(asset, date, schedule);
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

/** The occurrence a DELETED payout settled: the confirm rolled the pointer past it, and the walk
 *  only looks forward. THE PAYOUT’S OWN DATE IS THE RESTORE POINT, needing no backward stepper. */
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
