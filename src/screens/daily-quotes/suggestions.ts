// Per-screen pure glue for the fixed-yield suggestions (S4 ghost quotes, S5
// coupon card) — imports core only, returns numbers/tokens, no English (G1/D8).
//
// G5: everything here PROPOSES. The ghost value never enters the draft store
// until the user accepts it, and the coupon prefill is a form default the user
// confirms — both paths run through the components, which own the writes.
import {
  couponPeriodDays,
  couponsInGap,
  dailyAccrual,
  suggestedQuote,
  type DueCoupon,
} from '../../core/accrual';
import { checkQuote, type QuoteVerdict } from '../../core/inzhur/dcf';
import { couponForecast, matchAssets, type ParsedFeed } from '../../core/inzhur/parse';
import type { Asset, Snapshot } from '../../core/types';

import { lastQuoteBefore } from './quotes';

/**
 * These three call sites read `match.quote` ONLY — the schedule and the yield —
 * never `.value` or `.units`, so they have no count to supply and none to use.
 *
 * The argument is REQUIRED rather than optional on purpose: while it defaulted,
 * omitting it silently restored the #31 behaviour (the stale hand-typed total,
 * stamped `unitsFrom: 'link'` that nobody reads), so the buggy path was the one
 * a forgetful caller got for free. Passing this explicitly is the seam saying
 * "no count needed here", and a new caller that does need one now gets a type
 * error instead of a wrong number.
 */
// `Object.create(null)`, matching `derive.ts`'s own map: an empty object that
// answers `toString` is not empty, and this one is handed straight to
// `matchAssets` as a units record.
const NO_UNITS: Record<string, number> = Object.create(null) as Record<string, number>;

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
  feed?: ParsedFeed,
): number | null {
  if (asset.yieldType !== 'fixed_coupon') return null;
  const last = lastQuoteBefore(snapshots, asset.id, selectedDate);
  if (last === undefined) return null; // never quoted → nothing to carry forward
  return suggestedQuote({
    lastQuote: last.value,
    lastDate: last.date,
    today: selectedDate,
    daily: dailyAccrual(
      asset.couponAmount,
      asset.payoutSchedule,
      { expectedPct: asset.expectedPct, invested },
      feedPeriodDays(asset, feed, selectedDate),
    ),
    // The SAME dates the divisor came from. If the accrual rate and the gap
    // count ever disagreed about when a coupon lands, the ghost would drift by
    // a whole coupon at exactly the boundary the user is looking at.
    couponsInGap: couponsInGap(asset, last.date, selectedDate, feedSchedule(asset, feed)),
    maturity: asset.maturity,
  });
}

/**
 * S5: the coupon card's prefilled amount. An Inzhur-linked bond prefers the
 * feed's own `paymentSchedule` forecast (per-unit ₴ × units — the feed knows the
 * exact coupon), otherwise the asset's stated `couponAmount`.
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
  unitsHeld?: Record<string, number>,
): number | undefined {
  // OWN keys only, the same rule `matchAssets` applies to the same record.
  const units =
    unitsHeld !== undefined && Object.hasOwn(unitsHeld, asset.id)
      ? unitsHeld[asset.id]
      : asset.inzhur?.units;
  // A KNOWN COUNT OF ZERO OR LESS RETURNS `undefined`, and it must return that
  // rather than fall through.
  //
  // Falling through reaches `due.amount` — the asset's full stated
  // `couponAmount` — so a sold-out bond prefilled ₴1 240 for a position that no
  // longer exists, in a confirm card the user taps through. That is worse than
  // the ₴0,00 it replaced: 0 was refused by `quoteInputSchema` and the user SAW
  // a stop, while a plausible figure is a silent wrong `interest_payout`.
  //
  // `undefined` is the card's own documented "nothing to prefill": the field
  // opens empty and the pinned "Enter an amount." guards the confirm. Same
  // answer `matchAssets` gives the same count.
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
