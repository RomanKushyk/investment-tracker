// Non-component companions of AssetForm.tsx — split out (button-variants.ts
// rationale) so the .tsx file only exports components for react-refresh.
// core/schemas emits paths; the pinned S3 message vocabulary now lives in the
// dictionary (t.asset.message), because the words follow the language.
import { todayIso } from '../../core/dates';
import type { InzhurQuote } from '../../core/inzhur/parse';
import type { Format } from '../../core/money';
import type { Dict } from '../../i18n/messages';
import type { AssetFormInput } from '../../core/schemas';
import type { Asset, PayoutSchedule, YieldType } from '../../core/types';
import type { SelectOption } from '../ui/Select';

// ORDER here, labels in the dictionary — the split every option list in the
// app now uses.
const YIELD_TYPE_ORDER: YieldType[] = ['fixed_coupon', 'dividends', 'capitalization', 'div_cap'];

export function yieldTypeOptions(t: Dict) {
  return YIELD_TYPE_ORDER.map((value) => ({ value, label: t.asset.yieldOption[value] }));
}

// The 4 create options; edit mode of an asset ALREADY holding the seed-only
// 'none' additionally shows "None (price only)" (brief S3 — create never
// offers it, and neither does editing a non-'none' asset).
const CREATE_SCHEDULES: PayoutSchedule[] = ['maturity', 'monthly', 'quarterly', 'semiannual'];

export function scheduleOptions(allowNone: boolean, t: Dict) {
  const values: PayoutSchedule[] = allowNone ? [...CREATE_SCHEDULES, 'none'] : CREATE_SCHEDULES;
  return values.map((value) => ({ value, label: t.asset.schedule[value] }));
}

// Both vocabularies live in the dictionary now (t.asset.message,
// t.asset.picker) — the brief pins the WORDS, and the words follow the
// language like every other string.

/**
 * Option rows for the active kind: funds read "Inzhur REIT · inzhur-reit"
 * (feed title + slug), bonds "UA4000238976 · matures 24.03.2027". The stored
 * value is EXACTLY the string the manual field would hold (slug / ISIN), so
 * schema and patch mappers stay untouched.
 *
 * `currentRef` keeps an already-linked ref selectable even when the feed does
 * not carry it (an offline session, a delisted bond, a hand-typed slug) — the
 * trigger must never fall back to the placeholder over a value that is set.
 */
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
            ...(entry.maturity === undefined ? {} : { hint: t.asset.picker.matures(f.date(entry.maturity)) }),
          },
    );
  const ref = currentRef.trim();
  return ref !== '' && !options.some((o) => o.value === ref)
    ? [...options, { value: ref, label: ref }]
    : options;
}

// Code auto-derivation while untouched — same rule as core buildNewAsset.
export function deriveCode(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

// Fresh defaultValues per mode. Numbers/dates are the raw string inputs of
// AssetFormInput; edit prefills from the stored asset. Amount-family prefills
// use the pinned input format (navigation-map "Number formats"; the design
// edit fragment shows Coupon amount `1 240,00` and Units `15`) — the bound
// formatter's `num` / `units`, which quoteInputSchema parses straight back.
// Percent fields stay
// plain dot-decimal strings (the edit fragment pins `16.4`).
export function assetFormDefaults(f: Format, asset?: Asset): AssetFormInput {
  if (!asset) {
    return {
      name: '',
      code: '',
      yieldType: 'fixed_coupon',
      expectedPct: '',
      targetPct: '',
      payoutSchedule: 'maturity',
      firstPurchase: todayIso(),
      maturity: '',
      couponAmount: '',
      nextCoupon: '',
      reinvestPolicy: '',
      inzhur: undefined,
    };
  }
  return {
    name: asset.name,
    code: asset.code,
    yieldType: asset.yieldType,
    expectedPct: String(asset.expectedPct),
    targetPct: String(asset.targetPct),
    payoutSchedule: asset.payoutSchedule,
    firstPurchase: asset.firstPurchase,
    maturity: asset.maturity ?? '',
    couponAmount: asset.couponAmount !== undefined ? f.num(asset.couponAmount) : '',
    nextCoupon: asset.nextCoupon ?? '',
    reinvestPolicy: asset.reinvestPolicy ?? '',
    inzhur: asset.inzhur
      ? { kind: asset.inzhur.kind, ref: asset.inzhur.ref, units: f.units(asset.inzhur.units) }
      : undefined,
  };
}
