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
import { addMonths, dayBefore, daysBetween } from './dates';
import { unitsByAsset } from './derive';
import type { Asset, PayoutSchedule, Transaction } from './types';
// The coupon convention lives in a LEAF module — see `ovdp.ts` for why it is not
// declared here, where it was.
import { OVDP_FACE_UAH, PAYMENTS_PER_YEAR } from './ovdp';

// Re-exported because every existing citation of these two names points here.
export { OVDP_FACE_UAH, PAYMENTS_PER_YEAR };

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
 * ₴ ONE coupon payment brings for a position of `units`.
 *
 *     ratePct / 100 / paymentsPerYear × FACE × units
 *
 * THE RATE IS THE FIXED PROPERTY, the amount is not. A bond's coupon rate is set
 * at issuance and never moves; the ₴ it pays moves every time the holding does —
 * which is why the stored amount this replaces went stale on every purchase, the
 * same defect issue #31 reported for `Asset.inzhur.units`.
 *
 * It agrees with the provider's own schedule BY CONSTRUCTION rather than by
 * coincidence: `ratePct / 100 × 1000 / 2 = ratePct × 5`, and `ratePct × 5` is
 * exactly the per-unit coupon the feed publishes. So a linked bond valued from
 * the rate and one valued from `paymentSchedule` cannot disagree.
 *
 * `couponAmount` is the LEGACY fallback — a whole-position ₴ figure the form used
 * to ask for. It is returned unscaled, because it never knew how many units it
 * was counting; the seed's two bonds are the reason it still has to work.
 */
export function couponPerPayment(asset: Asset, units: number | undefined): number | undefined {
  // GATED ON THE YIELD TYPE, like `couponProjection` one screen down. Four call
  // sites filter on it themselves — `Seasonality` after the fact, `Attributes`
  // by sitting inside the bond branch — and a fifth that forgets would get a
  // coupon figure for a `div_cap` asset that happens to carry a legacy
  // `couponAmount`. The seed's REIT is one field away from being that asset.
  if (asset.yieldType !== 'fixed_coupon') return undefined;

  const perYear = PAYMENTS_PER_YEAR[asset.payoutSchedule];
  const rate = asset.couponRatePct;

  // THE LEDGER FIRST, THEN THE LINK'S LEGACY TOTAL — the same two-source rule
  // `matchAssets` applies (`fromLedger ?? link.units`) and `couponPrefill`
  // repeats. This function was the one consumer that read only the ledger, so a
  // pre-D117 linked bond with `inzhur.units` but no quantities fell past a rate
  // it HAD to the stale whole-position `couponAmount` — while the coupon card
  // one screen over scaled the feed's per-unit figure by the very count this
  // ignored. Two figures for one coupon is what D119 exists to end, and the
  // count is `undefined` only when NOBODY knows (D117's third state).
  const held = units ?? asset.inzhur?.units;

  // A RATE, ONCE STATED, OWNS THE ANSWER WHENEVER THE LEDGER CAN COUNT THE
  // POSITION — and "the position is closed" is a count, so it owns that answer
  // too. The first cut let a closed position fall PAST the rate to the legacy
  // amount, so a bond given a rate and then sold out reported the old
  // whole-position ₴ figure: `/attributes` printed "₴1 240 twice a year" for a
  // position that no longer exists, the coupon card prefilled a ₴1 240
  // transaction, and `/overview` projected it as `estimated: false`.
  //
  // THE ONE CASE WHERE THE LEGACY AMOUNT STANDS ALONGSIDE A RATE is an
  // UNCOUNTABLE ledger, and the block inside the rate branch below is where that
  // is argued. It is not an oversight and deleting it is a regression: `rate ×
  // units` has no answer when `units` is unknown, so suppressing the fallback
  // there empties the coupon out of four screens at once. Read the two together
  // — neither absolute is the whole rule.
  // A CLOSED POSITION PAYS NO COUPON, whichever figure would have answered, and
  // that is why this cannot live inside the rate branch below. It did, and a
  // legacy bond — both of the seed's — fell straight past it to `couponAmount`
  // and reported its whole stated coupon for a holding that is gone: in
  // `/attributes`, in `/overview`'s next payouts as `estimated: false`, in both
  // `/seasonality` axes, and prefilled into the due card. The rule is about the
  // HOLDING, not about which source priced it.
  if (held !== undefined && held <= 0) return undefined;
  if (rate !== undefined && rate > 0 && perYear > 0) {
    // UNKNOWN AND ZERO ARE DIFFERENT QUESTIONS, and collapsing them broke a real
    // case each way.
    //
    // `undefined` — the ledger cannot count this asset at all, so the RATE
    // cannot answer either. The legacy amount still can, and it is the only
    // figure the asset has: suppressing it here emptied the coupon out of
    // `/attributes`, the due card, the ghost accrual and the projection at once,
    // for exactly the pre-#31 bonds the fallback exists to protect.
    //
    // `<= 0` is handled ABOVE, for every source rather than only this one.
    if (held === undefined) return asset.couponAmount;
    return round2(((rate / 100) * OVDP_FACE_UAH * held) / perYear);
  }
  return asset.couponAmount;
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
  /**
   * ₴ one coupon pays ON ITS OWN DATE — a function, not a number.
   *
   * A NUMBER WAS WRONG AS SOON AS THE FIGURE STARTED SCALING (D119). The caller
   * derives it from the units held on the DRAFTED date, and this function then
   * multiplied it by every coupon that landed earlier in the gap — coupons the
   * position was a different size for. Hold 10 units through a coupon on 25.08,
   * buy 10 more on 30.08, draft 31.08: the gap subtracted 20 units' worth of a
   * payment that paid on 10, understating the ghost by half a coupon at exactly
   * the boundary the user is looking at. One figure cannot answer for two dates.
   *
   * A PARAMETER, and required, because this function used to read
   * `asset.couponAmount` itself. Once D119 made the divisor
   * `couponPerPayment(asset, units)`, the ghost climbed toward one number and
   * subtracted another: on a rate-only bond the gap returned 0 and the ghost
   * carried a whole coupon it should have dropped; on a seed bond given a rate
   * it climbed toward ₴7 840 while the gap subtracted ₴1 240. The comment at
   * the call site already named the invariant — "if the accrual rate and the
   * gap count ever disagreed about when a coupon lands, the ghost would drift
   * by a whole coupon" — and reading the amount from two places is how they
   * disagreed about WHAT one lands. The caller now hands over a RESOLVER rather
   * than a number, so the two can still never differ about which coupon — only
   * about its size, which is the one thing that legitimately varies by date.
   */
  perCouponAt: (couponDate: string) => number | undefined,
  fromExclusive: string,
  toInclusive: string,
  schedule?: readonly string[],
): number {
  const anchor = asset.nextCoupon;
  if (!anchor) return 0;
  // NO PAIRING GUARD HERE, AND THAT IS DELIBERATE. The rule it enforced is real
  // — if `dailyAccrual` has no coupon figure to climb toward, the gap must
  // subtract none — but this function cannot ask the question. It sees a
  // resolver keyed by DATE; the daily rate was built from the drafted date's
  // holding, which the caller holds and this does not. A first cut asked
  // `perCouponAt(toInclusive)` and got a different answer on the same day: the
  // caller counts units INCLUSIVE of the drafted date, the resolver counts them
  // as of the day before, so a position closed and re-opened on that date
  // suppressed the whole gap while the accrual climbed normally.
  //
  // The guard lives in `accrualSuggestion`, where both figures are in hand.

  // The provider's own dates beat any grid derived from them. The real bonds
  // pay every 182 days and always on a Wednesday, which no month arithmetic
  // reproduces: from a 25.03.2026 anchor the grid is 2 days late by the next
  // coupon and 5 days late by 2028. Dates deduped because the final row lands
  // twice — the last coupon and the principal share the maturity date, and only
  // one of them is a coupon.
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

  let total = 0;
  for (let i = 0; i < MAX_GRID_STEPS; i++) {
    const date = addMonths(anchor, (startIndex + i) * months);
    if (date > toInclusive) break;
    if (date > fromExclusive) total += perCouponAt(date) ?? 0;
  }
  return total;
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
  /** What one payment pays — `couponPerPayment`, i.e. the rate scaled by the units held (D119), or the legacy stated `couponAmount` when the asset has no rate. */
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
/**
 * The DATE of the next unsettled occurrence — the walk without the amount.
 *
 * SPLIT OUT because `scheduledCouponMonths` needs only the date and was paying
 * for a `unitsByAsset` walk of the whole ledger per asset, per render, to build
 * a figure it threw away. That is the shape the `perCouponAt` parameter was added
 * to `couponsInGap` to end, arriving one function over.
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
    // Same stepper the confirm writes with, so the walk can never land on a date
    // the roll would not produce (and it stops at maturity rather than past it).
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
  // ONE WALK, shared with the date-only caller above — the amount is what this
  // function adds, not a second traversal of the same grid.
  const date = nextUnsettledCouponDate(asset, transactions, opts);
  if (date === undefined) return undefined;
  // UNITS AS OF THE DAY THE COUPON DATE OPENED, not today's — the holding on the
  // payment date is what determines what that payment brings, and this amount
  // prefills a transaction (D119).
  //
  // `dayBefore`, and it must be the SAME bound `DailyQuotes` computes
  // `unitsOnCouponDate` with — that comment carries the reasoning and the
  // maturity/redemption tie it turns on. This site had the inclusive bound and
  // lost the one coupon whose amount is known exactly, in the card title and in
  // `couponPrefill`'s last resort. Two bounds for one quantity is the divergence
  // `couponsInGap` was fixed for.
  const held = unitsByAsset(transactions, dayBefore(date))[asset.id];
  return { date, amount: couponPerPayment(asset, held) };
}

export interface DueCoupon {
  assetId: string;
  /** The scheduled date that has arrived (the next unsettled occurrence). */
  date: string;
  /** 0 = due today; > 0 = overdue by that many days (S5's warn date pill). */
  overdueDays: number;
  /** What one payment pays — `couponPerPayment` (D119), legacy amount as fallback. */
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
export function couponProjection(
  asset: Asset,
  invested: number,
  /**
   * Units held on the projected date, or `undefined` when the ledger cannot say.
   * REQUIRED rather than optional, for the reason `NO_UNITS` gives in
   * `daily-quotes/suggestions.ts`: while it defaulted, a caller that forgot it
   * got the pre-#31 whole-position figure for free AND skipped the closed-
   * position guard below — the buggy path was the cheap one. Explicit
   * `undefined` is a real answer ("nobody knows"); an omitted argument is not.
   */
  units: number | undefined,
): CouponProjection | undefined {
  if (asset.yieldType !== 'fixed_coupon') return undefined;
  const date = asset.nextCoupon || asset.maturity;
  if (!date) return undefined;

  // The rate scaled by the ledger's units, or the legacy stated amount — either
  // is a STATED coupon, so neither is `estimated`. Only the expectedPct share
  // below is (D119).
  // A CLOSED POSITION PROJECTS NOTHING, and this has to be asked BEFORE the
  // estimate. `couponPerPayment` returns `undefined` for two different reasons —
  // "no stated figure at all" and "the position is closed" — and only the first
  // may fall through to `expectedPct`. It did fall through for both, and the
  // estimate cannot catch it: `investedByAsset` sums `buy`/`reinvest` and is
  // never reduced by a `sell`, so `invested` stays positive forever and a
  // sold-out bond kept projecting a coupon, relabelled `estimated: true`.
  if (units !== undefined && units <= 0) return undefined;
  const stated = couponPerPayment(asset, units);
  if (stated !== undefined && stated > 0) return { amount: stated, date, estimated: false };

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
  // The DATE-ONLY walk: this function never reads the amount, and asking for
  // one cost a full ledger traversal per asset per render.
  const open = nextUnsettledCouponDate(asset, transactions);
  const anchor = open ?? (asset.nextCoupon === undefined ? asset.maturity : undefined);
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

/**
 * THE OCCURRENCE A DELETED PAYOUT WAS SETTLING, when deleting it has to move the
 * pointer BACK — and `undefined` when it does not.
 *
 * A47/A48's review found the hole and it was a real one: `CouponDueCard`'s
 * confirm writes the payout AND rolls `asset.nextCoupon` forward, while deleting
 * that row from the ledger only removed the transaction. `nextUnsettledCoupon`
 * walks the grid FORWARD from the pointer and never looks behind it, so the
 * occurrence vanished from the ledger, from the due cards, from the reminders and
 * from income at once — with nothing on any screen to say it had.
 *
 * D23 IS WHAT DECIDES THE ANSWER: the stored pointer moves only through a
 * confirm. A delete is that confirm being taken back, so the pointer goes back
 * with it — the owner's ruling, 2026-08-25.
 *
 * THE PAYOUT'S OWN DATE IS THE RESTORE POINT, and that needs no backward stepper
 * (there is none): the confirm dates its transaction on the COUPON's date, so a
 * confirmed payout carries the occurrence it settled. Rolling the pointer to an
 * OLDER occurrence than the immediate predecessor is safe by construction —
 * `nextUnsettledCoupon` steps forward over everything still settled, so the walk
 * surfaces the reopened one and then returns to where it was.
 *
 * `remaining` is the ledger AFTER the delete: a duplicate payout still covering
 * that occurrence leaves the pointer alone, because the occurrence is still
 * settled.
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
  // A payout ON or AFTER the pointer never moved it: the pointer only ever sits
  // on an occurrence that is still open.
  if (pointer === undefined || deleted.date >= pointer) return undefined;
  const windowDays = opts.windowDays ?? COUPON_MATCH_WINDOW_DAYS;
  if (couponRecorded(remaining, asset.id, deleted.date, windowDays)) return undefined;
  return deleted.date;
}
