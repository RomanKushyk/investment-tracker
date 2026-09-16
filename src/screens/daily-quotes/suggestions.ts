// EVERYTHING HERE PROPOSES: the components own the writes, and nothing below reaches
// the store until the user accepts or confirms it.
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

/** One extractor: the divisor, the gap count and the roll have to agree about which
 *  dates exist. Undefined falls a caller back to the month grid. */
export function feedSchedule(asset: Asset, feed: ParsedFeed | undefined): string[] | undefined {
  if (feed === undefined) return undefined;
  const [match] = matchAssets([asset], feed, NO_UNITS).linked;
  if (match === undefined) return undefined;
  const dates = match.quote.paymentSchedule.map((p) => p.date);
  return dates.length > 0 ? dates : undefined;
}

/** What the pricing model says about this row's quote. `undefined` = no check is
 *  POSSIBLE (unlinked, or no published yield), a different state from the verdict's own
 *  `not_applicable`, where the model applies but the schedule is spent. The published
 *  number stays as published: a stale value is the observed fact, never computed. */
export function bondQuoteCheck(
  asset: Asset,
  feed: ParsedFeed | undefined,
  /** The date the PAYLOAD was fetched on — never the picker's, and never "today" on a
   *  cache hit. The first cries "yield revised" on the ordinary act of recording a
   *  missed day; the second blames the provider for the cache's own age. */
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

/** The ghost value for one row. `null` is every case with no ghost to offer: not a
 *  bond, never quoted, no accrual basis, already quoted for this date. Linked rows are
 *  NOT excluded — a filled draft hides the ghost by itself, and a bond whose fetch has
 *  not run still needs the fallback. */
export function accrualSuggestion(
  asset: Asset,
  snapshots: Snapshot[],
  invested: number,
  selectedDate: string,
  /** Only SHARPENS the accrual, with the provider's real period length; without it the
   *  annualised approximation stands rather than the suggestion being withheld. */
  feed: ParsedFeed | undefined,
  /** Units held on `selectedDate`. REQUIRED, not optional: an explicit `undefined` says
   *  the ledger cannot answer, and an omitted argument said it by accident — which
   *  made the buggy path the cheap one. */
  unitsHeld: number | undefined,
  /** Units held ON A GIVEN DATE, and A DIFFERENT QUESTION from `unitsHeld` rather than
   *  an inconsistency: the rate climbs FORWARD to the next coupon, sized on the drafted
   *  date, while the gap drops coupons already paid, each sized BACKWARD on its own.
   *  Required for the same reason. */
  unitsAt: (couponDate: string) => number | undefined,
): number | null {
  if (asset.yieldType !== 'fixed_coupon') return null;
  // A CLOSED POSITION ACCRUES NOTHING, asked BEFORE the estimate: `couponPerPayment`
  // returns `undefined` for both "no figure" and "closed", only the first may reach the
  // fallback, and `invested` is never reduced by a sale.
  if (unitsHeld !== undefined && unitsHeld <= 0) return null;
  const last = lastQuoteBefore(snapshots, asset.id, selectedDate);
  if (last === undefined) return null; // never quoted → nothing to carry forward
  // ONE BINDING FOR THE NEXT COUPON, used by the daily rate and handed to the gap.
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
    // The SAME dates the divisor came from, or the ghost drifts by a whole coupon at
    // the boundary the user is looking at. THE PAIRING GUARD is here because this is
    // the only place both figures exist: the rate falls back to an estimate when
    // `perCoupon` is absent, and a gap subtracting a real coupon would then drop a
    // figure the ghost never climbed toward.
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

/** The coupon card's prefilled amount, preferring the feed's forecast because it knows
 *  the exact coupon. An `expectedPct` ESTIMATE is deliberately not offered: honest in
 *  a projection card, but a transaction amount must not look authoritative. */
export function couponPrefill(
  asset: Asset,
  due: DueCoupon,
  feed: ParsedFeed | undefined,
  /** Units per asset on the coupon's own date. A stale count here does not misprice a
   *  display, it prefills the AMOUNT of a transaction — REQUIRED for that reason, since
   *  omitting it skips the ledger for a stored total. */
  unitsHeld: Record<string, number> | undefined,
): number | undefined {
  // OWN keys only, the same rule `matchAssets` applies: an asset id of `toString`
  // passes the schema, and a plain object answers that key with a Function.
  const units =
    unitsHeld !== undefined && Object.hasOwn(unitsHeld, asset.id)
      ? unitsHeld[asset.id]
      : asset.inzhur?.units;
  // A KNOWN COUNT OF ZERO OR LESS RETURNS `undefined` AND MUST NOT FALL THROUGH, which
  // reaches the whole stated coupon: a sold-out bond then prefills a plausible figure
  // in a card the user taps through. Worse than the zero it replaced, which was
  // refused at the door where the user saw a stop.
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
