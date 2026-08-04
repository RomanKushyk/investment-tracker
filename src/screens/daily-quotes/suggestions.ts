// Per-screen pure glue for the fixed-yield suggestions (S4 ghost quotes, S5
// coupon card) — imports core only, returns numbers/tokens, no English (G1/D8).
//
// G5: everything here PROPOSES. The ghost value never enters the draft store
// until the user accepts it, and the coupon prefill is a form default the user
// confirms — both paths run through the components, which own the writes.
import {
  couponsInGap,
  dailyAccrual,
  suggestedQuote,
  type DueCoupon,
} from '../../core/accrual';
import { couponForecast, matchAssets, type ParsedFeed } from '../../core/inzhur/parse';
import type { Asset, Snapshot } from '../../core/types';
import { lastQuoteBefore } from './quotes';

/**
 * S4: the ghost value for one row — the asset's last quote carried forward by
 * its coupon accrual. `null` = no ghost (not a bond, never quoted, no accrual
 * basis, already quoted for this date).
 *
 * Inzhur-linked rows are NOT excluded here: a successful fetch fills a real
 * draft, and a filled draft hides the ghost by itself (S4 precedence) — while a
 * linked bond whose fetch has not run yet still deserves the fallback.
 */
export function accrualSuggestion(
  asset: Asset,
  snapshots: Snapshot[],
  invested: number,
  selectedDate: string,
): number | null {
  if (asset.yieldType !== 'fixed_coupon') return null;
  const last = lastQuoteBefore(snapshots, asset.id, selectedDate);
  if (last === undefined) return null; // never quoted → nothing to carry forward
  return suggestedQuote({
    lastQuote: last.value,
    lastDate: last.date,
    today: selectedDate,
    daily: dailyAccrual(asset.couponAmount, asset.payoutSchedule, {
      expectedPct: asset.expectedPct,
      invested,
    }),
    couponsInGap: couponsInGap(asset, last.date, selectedDate),
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
): number | undefined {
  const units = asset.inzhur?.units;
  if (units !== undefined && feed !== undefined) {
    const [match] = matchAssets([asset], feed).linked;
    const forecast =
      match === undefined ? undefined : couponForecast(match.quote.paymentSchedule, due.date, units);
    if (forecast !== undefined) return forecast.amount;
  }
  return due.amount;
}
