// Non-component companions of AssetForm.tsx, split out so the .tsx file exports only
// components for react-refresh. The message vocabulary is the dictionary's.
import { sameInstrument } from '@quirenote/core/inzhur/ref';
import { todayIso } from '@quirenote/core/dates';
import type { InzhurQuote } from '@quirenote/core/inzhur/parse';
import type { Format } from '@quirenote/core/money';
import type { Dict } from '../../i18n/messages';
import type { AssetFormInput } from '@quirenote/core/schemas';
import type { Asset, PayoutSchedule, YieldType } from '@quirenote/core/types';
import type { SelectOption } from '../ui/Select';

// ORDER here, labels in the dictionary — the split every option list uses.
const YIELD_TYPE_ORDER: YieldType[] = ['fixed_coupon', 'dividends', 'capitalization', 'div_cap'];

export function yieldTypeOptions(t: Dict) {
  return YIELD_TYPE_ORDER.map((value) => ({ value, label: t.asset.yieldOption[value] }));
}

// Create never offers 'none', nor does editing an asset not already holding it.
const CREATE_SCHEDULES: PayoutSchedule[] = ['maturity', 'monthly', 'quarterly', 'semiannual'];

export function scheduleOptions(allowNone: boolean, t: Dict) {
  const values: PayoutSchedule[] = allowNone ? [...CREATE_SCHEDULES, 'none'] : CREATE_SCHEDULES;
  return values.map((value) => ({ value, label: t.asset.schedule[value] }));
}

/** The stored value is EXACTLY the string the manual field would hold, so schema and
 *  patch mappers stay untouched. `currentRef` keeps an already-linked ref selectable
 *  when the feed does not carry it: the trigger must never fall back to the
 *  placeholder over a value that is set. */
export function inzhurRefOptions(
  entries: InzhurQuote[],
  kind: 'fund' | 'bond',
  currentRef: string,
  f: Format,
  t: Dict,
): SelectOption[] {
  const options = entries
    .filter((entry) => entry.kind === kind)
    .map((entry) =>
      kind === 'fund'
        ? {
            value: entry.ref,
            label: entry.title ?? entry.ref,
            ...(entry.title === undefined ? {} : { hint: entry.ref }),
          }
        : {
            value: entry.ref,
            label: entry.ref,
            ...(entry.maturity === undefined
              ? {}
              : { hint: t.asset.picker.matures(f.date(entry.maturity)) }),
          },
    );
  const ref = currentRef.trim();
  // `sameInstrument`, not `===`: a hand-typed ref is legal in any case, so an exact
  // compare shows one bond twice while `matchAssets` treats the two as one.
  return ref !== '' && !options.some((o) => sameInstrument(o.value, ref))
    ? [...options, { value: ref, label: ref }]
    : options;
}

export function deriveCode(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

// EVERY NUMERIC PREFILL GOES THROUGH THE BOUND FORMATTER'S `input` — not `num`, not
// `units`, not `pctPlain`; the block on `expectedPct` below measures why each of the
// other three is wrong here.
//
// THE CALLER OWES ONE LANGUAGE TO BOTH SIDES: `input` verifies its round trip under
// the formatter's own grammar, so a prefill only survives an untouched Save if the
// schema reads it back under that same language. No signature enforces it, and the
// percent fields are where it costs a 1000x.
export function assetFormDefaults(f: Format, asset?: Asset): AssetFormInput {
  if (!asset) {
    return {
      name: '',
      code: '',
      yieldType: 'fixed_coupon',
      expectedPct: '',
      targetPct: '',
      // `semiannual`, not `maturity`, and it PAIRS WITH THE YIELD TYPE ABOVE: the form
      // opens on `fixed_coupon`, where `maturity` means a zero-coupon bond and no bond
      // the provider lists is one (docs/reference/OVDP-COUPON-STRUCTURE.md). It is the
      // divisor in `couponPerPayment`, so the default was wrong where a default is
      // likeliest to survive unread. Switching the yield type does not move it.
      payoutSchedule: 'semiannual',
      firstPurchase: todayIso(),
      maturity: '',
      couponRatePct: '',
      nextCoupon: '',
      inzhur: undefined,
    };
  }
  return {
    name: asset.name,
    code: asset.code,
    yieldType: asset.yieldType,
    // `f.input`, NOT `String` — Contract 0 separates formatting per language with no
    // exceptions, and raw JS renders a Ukrainian 17,5 as "17.5" beside fields that are
    // already localized.
    //
    // `input` and not `num` or `pctPlain`, measured: `num` forces two decimals,
    // `pctPlain` ROUNDS to one (7,25 → "7,3", silently editing the user's own value)
    // and appends a " %" the label already carries. `units` has the right shape but
    // fails its round trip — uk 6,164 parses back as 6164. `input` is `units` that
    // checks. *Language, numbers, fonts*
    expectedPct: f.input(asset.expectedPct),
    targetPct: f.input(asset.targetPct),
    payoutSchedule: asset.payoutSchedule,
    firstPurchase: asset.firstPurchase,
    maturity: asset.maturity ?? '',
    couponRatePct: asset.couponRatePct !== undefined ? f.input(asset.couponRatePct) : '',
    nextCoupon: asset.nextCoupon ?? '',
    // No `units`: a legacy value is deliberately NOT round-tripped through the form,
    // and survives untouched in the store because nothing here writes it back.
    inzhur: asset.inzhur ? { kind: asset.inzhur.kind, ref: asset.inzhur.ref } : undefined,
  };
}
