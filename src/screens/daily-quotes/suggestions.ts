// Per-screen pure glue for the fixed-yield suggestions (S4 ghost quotes, S5
// coupon card) — imports core only, returns numbers/tokens, no English (G1/D8).
//
// G5: everything here PROPOSES. The ghost value never enters the draft store
// until the user accepts it, and the coupon prefill is a form default the user
// confirms — both paths run through the components, which own the writes.
import {
  couponPeriodDays,
  couponPerPayment,
  couponsInGap,
  dailyAccrual,
  suggestedQuote,
  type DueCoupon,
} from '../../core/accrual';
import { checkQuote, type QuoteVerdict } from '../../core/inzhur/dcf';
import { couponForecast, matchAssets, NO_UNITS, type ParsedFeed } from '../../core/inzhur/parse';
import type { Asset, Snapshot } from '../../core/types';

import { lastQuoteBefore } from './quotes';

// `NO_UNITS` lives beside the `matchAssets` that reads it, in `inzhur/parse.ts`,
// and carries there the argument for why a units record is `Object.create(null)`
// and why the parameters that take one are required rather than optional.

/**
 * The provider's published payment dates for `asset`. Undefined for an unlinked
 * asset, or a feed that does not carry it — every caller then falls back to the
 * month grid.
 *
 * One extractor on purpose: the accrual divisor, the gap count and the roll all
 * have to agree about which dates exist, and the cheapest way to guarantee that
 * is for them to read the same function.
 */
export function feedSchedule(asset: Asset, feed: ParsedFeed | undefined): string[] | undefined {
  if (feed === undefined) return undefined;
  const [match] = matchAssets([asset], feed, NO_UNITS).linked;
  if (match === undefined) return undefined;
  const dates = match.quote.paymentSchedule.map((p) => p.date);
  return dates.length > 0 ? dates : undefined;
}

/**
 * A6: what the pricing model says about this row's quote — is it fresh, stale,
 * or re-priced?
 *
 * `undefined` = no check is possible, which is different from a clean result:
 * the row is not a linked bond, or the feed does not publish a yield for it.
 * The verdict's own `not_applicable` covers the case where the model applies in
 * principle but the schedule is spent (a `completed` bond, D31).
 *
 * Nothing here is stored or applied. It PROPOSES a reading of the provider's
 * own number, and the number itself stays exactly as published (G5) — the whole
 * point is that a stale value is recorded as the observed fact, never silently
 * corrected to a computed one.
 */
export function bondQuoteCheck(
  asset: Asset,
  feed: ParsedFeed | undefined,
  /**
   * The date the PAYLOAD was fetched on — never the date selected in the
   * picker, and never "today" when the payload came from the cache.
   *
   * Two bugs lived here. Dating a live quote against a back-dated snapshot made
   * the model see a price ~0.4 ₴ off and cry "yield revised" on every linked
   * bond, on the ordinary act of recording a missed day. And dating a cached
   * payload against today reported the provider as stale when only the local
   * cache was — the app blaming the feed for its own age.
   */
  fetchedOnIso: string | undefined,
): QuoteVerdict | undefined {
  if (feed === undefined || fetchedOnIso === undefined) return undefined;
  const [match] = matchAssets([asset], feed, NO_UNITS).linked;
  if (match === undefined) return undefined;
  const { quote } = match;
  if (quote.kind !== 'bond') return undefined;
  const published = quote.returnRates?.sell;
  if (published === undefined) return undefined;
  return checkQuote(quote.sellUAH, quote.paymentSchedule, published, fetchedOnIso);
}

function feedPeriodDays(
  asset: Asset,
  feed: ParsedFeed | undefined,
  onIso: string,
): number | undefined {
  const dates = feedSchedule(asset, feed);
  return dates === undefined ? undefined : couponPeriodDays(dates, onIso);
}

/**
 * S4: the ghost value for one row — the asset's last quote carried forward by
 * its coupon accrual. `null` = no ghost (not a bond, never quoted, no accrual
 * basis, already quoted for this date).
 *
 * Inzhur-linked rows are NOT excluded here: a successful fetch fills a real
 * draft, and a filled draft hides the ghost by itself (S4 precedence) — while a
 * linked bond whose fetch has not run yet still deserves the fallback.
 *
 * `feed` only sharpens the accrual: the provider's `paymentSchedule` gives the
 * REAL period length (182 days, not "half of 365"), so the ghost lands on the
 * coupon instead of drifting a few hryvnia off it by the payment date. Without
 * a feed the annualised approximation stands, exactly as before.
 */
export function accrualSuggestion(
  asset: Asset,
  snapshots: Snapshot[],
  invested: number,
  selectedDate: string,
  /** The live payload, or `undefined` when none is in hand. */
  feed: ParsedFeed | undefined,
  /**
   * Units held on `selectedDate` — D119. The ghost climbs toward the coupon this
   * position actually earns, so it must scale with the holding; before the rate
   * replaced the stored amount it climbed toward a hand-typed constant while the
   * coupon card beside it prefilled the feed's per-unit figure × units. Two
   * numbers for one coupon, on one screen.
   *
   * REQUIRED, not optional — see `NO_UNITS` above. Explicit `undefined` means
   * "the ledger cannot say"; an omitted argument used to mean the same thing by
   * accident, which made the pre-#31 behaviour the default a forgetful caller
   * got.
   */
  unitsHeld: number | undefined,
  /**
   * Units held ON A GIVEN DATE — what a coupon that landed earlier in the gap
   * actually paid on. `unitsHeld` above answers for the DRAFTED date only, and
   * `couponsInGap` needs the other question: a position that grew since a coupon
   * would otherwise subtract the new size from an old payment.
   *
   * `undefined` when the ledger cannot say. THAT IS NOT "nothing to subtract":
   * it reaches `couponPerPayment`, which falls through to `inzhur.units` and
   * then to the legacy `couponAmount` — so on the seed's two legacy bonds every
   * gap date resolves to the full unscaled amount whatever this returns. An
   * earlier version of this doc claimed the opposite and would have sent a
   * reader looking for an inert path that does not exist.
   *
   * WHY THIS IS A DIFFERENT QUESTION FROM `unitsHeld` ABOVE, and not an
   * inconsistency: `dailyAccrual` climbs toward the NEXT coupon, whose size is
   * the holding as it stands on the drafted date; the gap drops coupons ALREADY
   * PAID, each on the holding of its own date. Forward and backward, two bases,
   * both correct. What they must still agree on is whether the asset has a
   * coupon figure at all — `couponsInGap` asks that once, at its own guard.
   */
  unitsAt: (couponDate: string) => number | undefined,
): number | null {
  if (asset.yieldType !== 'fixed_coupon') return null;
  // A CLOSED POSITION ACCRUES NOTHING, asked before the estimate for the reason
  // `couponProjection` gives at its own guard: `couponPerPayment` returns
  // `undefined` both for "no stated figure" and for "the position is closed",
  // and only the first may fall through to `dailyAccrual`'s `expectedPct ×
  // invested / 365` fallback. `investedByAsset` sums `buy`/`reinvest` and is
  // never reduced by a `sell`, so `invested` stays positive forever — a sold-out
  // bond went on growing a ghost quote at ~₴7/day on a holding that is gone.
  if (unitsHeld !== undefined && unitsHeld <= 0) return null;
  const last = lastQuoteBefore(snapshots, asset.id, selectedDate);
  if (last === undefined) return null; // never quoted → nothing to carry forward
  // ONE BINDING FOR THE NEXT COUPON, used by the daily rate and handed to the
  // gap as its starting point — see `couponsInGap`'s `perCouponAt` doc for what
  // happened when the two disagreed about WHICH coupon.
  const perCoupon = couponPerPayment(asset, unitsHeld);
  return suggestedQuote({
    lastQuote: last.value,
    lastDate: last.date,
    today: selectedDate,
    daily: dailyAccrual(
      perCoupon,
      asset.payoutSchedule,
      { expectedPct: asset.expectedPct, invested },
      feedPeriodDays(asset, feed, selectedDate),
    ),
    // The SAME dates the divisor came from. If the accrual rate and the gap
    // count ever disagreed about WHEN a coupon lands, the ghost would drift by a
    // whole coupon at exactly the boundary the user is looking at.
    //
    // The SIZE is asked per date, and that is deliberate rather than a break of
    // the rule above: `perCoupon` is the NEXT coupon, sized on the drafted date,
    // which is what the daily rate climbs toward; the gap drops coupons already
    // paid, each sized on its own date. Same dates, two holdings, one question
    // each.
    // THE PAIRING GUARD, and it belongs here because this is the only place both
    // figures exist. `dailyAccrual` above falls back to the
    // `expectedPct × invested` estimate whenever `perCoupon` is absent or
    // non-positive; a gap that then subtracted a real past coupon would drop a
    // figure the ghost never climbed toward.
    //
    // IT USED TO LIVE INSIDE `couponsInGap`, asking `perCouponAt(toInclusive)`.
    // That looked equivalent and was not: this caller counts units INCLUSIVE of
    // the drafted date while the resolver counts them as of the day before, so a
    // position closed and re-opened on that date suppressed the whole gap while
    // the accrual climbed normally. Same binding as the daily rate, or no
    // pairing at all.
    couponsInGap:
      perCoupon === undefined || perCoupon <= 0
        ? 0
        : couponsInGap(
            asset,
            (couponDate) => couponPerPayment(asset, unitsAt(couponDate)),
            last.date,
            selectedDate,
            feedSchedule(asset, feed),
          ),
    maturity: asset.maturity,
  });
}

/**
 * S5: the coupon card's prefilled amount. An Inzhur-linked bond prefers the
 * feed's own `paymentSchedule` forecast (per-unit ₴ × units — the feed knows the
 * exact coupon), otherwise `couponPerPayment` — the rate scaled by the units held (D119), or the legacy stated `couponAmount` when there is no rate.
 *
 * `undefined` = nothing to prefill: the field opens empty and the pinned
 * "Enter an amount." message guards the confirm. An `expectedPct` ESTIMATE is
 * deliberately not offered here — it is honest in a projection card, but a
 * transaction amount must never look authoritative when it is a guess.
 */
export function couponPrefill(
  asset: Asset,
  due: DueCoupon,
  feed: ParsedFeed | undefined,
  // ISSUE #31 REACHES HERE TOO, and it is the more expensive half: a coupon is
  // paid per unit held, so a stale count does not merely misprice a display, it
  // prefills the AMOUNT of a transaction the user is about to record. Same
  // record as the fetch — `unitsByAsset` as of the coupon's own date — and the
  // same fallback to the link's stored total when the ledger cannot answer.
  /**
   * Units per asset on the coupon's own date, or an explicit `undefined`.
   *
   * REQUIRED, like `accrualSuggestion`'s and `couponProjection`'s — omitting it
   * silently falls back to `asset.inzhur?.units`, the pre-#31 stale
   * whole-position total, and skips the ledger entirely. That is the failure all
   * three signatures were changed away from: the buggy path must not be the
   * cheap one.
   */
  unitsHeld: Record<string, number> | undefined,
): number | undefined {
  // OWN keys only, the same rule `matchAssets` applies to the same record: an
  // asset id of `toString` passes `assetRowSchema`, and a plain object answers
  // that key with a Function which reaches `couponForecast` as a count.
  const units =
    unitsHeld !== undefined && Object.hasOwn(unitsHeld, asset.id)
      ? unitsHeld[asset.id]
      : asset.inzhur?.units;
  // A KNOWN COUNT OF ZERO OR LESS RETURNS `undefined`, and it must return that
  // rather than fall through.
  //
  // Falling through reaches `due.amount`, which for a pre-D119 bond is its whole
  // stated `couponAmount` — so a sold-out bond prefilled ₴1 240 for a position
  // that no longer exists, in a confirm card the user taps through. That is
  // worse than the ₴0,00 it replaced: 0 was refused at the door and the user SAW
  // a stop, while a plausible figure is a silent wrong `interest_payout`.
  //
  // `undefined` is the card's own documented "nothing to prefill": the field
  // opens empty and the pinned "Enter an amount." guards the confirm.
  if (units !== undefined && units <= 0) return undefined;
  if (units !== undefined && feed !== undefined) {
    const [match] = matchAssets([asset], feed, NO_UNITS).linked;
    const forecast =
      match === undefined
        ? undefined
        : couponForecast(match.quote.paymentSchedule, due.date, units);
    if (forecast !== undefined) return forecast.amount;
  }
  return due.amount;
}
