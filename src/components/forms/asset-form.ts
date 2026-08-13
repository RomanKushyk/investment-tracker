// Non-component companions of AssetForm.tsx — split out (button-variants.ts
// rationale) so the .tsx file only exports components for react-refresh.
// English copy lives HERE, in the component layer (structured returns, D8):
// core/schemas emits paths, this map owns the pinned S3 message vocabulary.
import { todayIso } from '../../core/dates';
import type { InzhurQuote } from '../../core/inzhur/parse';
import type { Format } from '../../core/money';
import type { AssetFormInput } from '../../core/schemas';
import type { Asset, PayoutSchedule } from '../../core/types';
import type { SelectOption } from '../ui/Select';
import { SCHEDULE_LABEL } from '../ui/schedule-labels';

export const YIELD_TYPE_OPTIONS = [
  { value: 'fixed_coupon', label: 'Fixed coupon' },
  { value: 'dividends', label: 'Dividends' },
  { value: 'capitalization', label: 'Capitalization' },
  { value: 'div_cap', label: 'Dividends + capitalization' },
];

// The 4 create options; edit mode of an asset ALREADY holding the seed-only
// 'none' additionally shows "None (price only)" (brief S3 — create never
// offers it, and neither does editing a non-'none' asset).
const CREATE_SCHEDULES: PayoutSchedule[] = ['maturity', 'monthly', 'quarterly', 'semiannual'];

export function scheduleOptions(allowNone: boolean) {
  const values: PayoutSchedule[] = allowNone ? [...CREATE_SCHEDULES, 'none'] : CREATE_SCHEDULES;
  return values.map((value) => ({ value, label: SCHEDULE_LABEL[value] }));
}

// Pinned per-field error vocabulary (asset-form.dc.html "Message vocabulary").
export const ASSET_FIELD_MESSAGE = {
  name: 'Name is required.',
  code: 'Code is 1–2 letters.',
  expectedPct: 'Enter a percentage.',
  targetPct: 'Enter a percentage.',
  couponAmount: 'Enter an amount.',
  firstPurchase: 'Pick a date.',
  maturity: 'Pick a date.',
  nextCoupon: 'Pick a date.',
  refFund: 'Enter the fund slug.',
  refBond: 'Enter the bond ISIN.',
  units: 'Enter the number of units.',
  summary: 'Check the highlighted fields and try again.',
} as const;

// ── S7: the Inzhur ref field's live picker (automation.dc.html S7). Copy is
// the brief's, verbatim; the option rows are derived below.
export const INZHUR_PICKER_COPY = {
  placeholder: 'Pick from Inzhur…',
  loading: 'Loading Inzhur assets…',
  failed: "Couldn't load the list — enter it manually.",
  empty: 'Nothing of this kind in the feed — enter it manually.',
  toManual: 'Enter manually',
  toPicker: 'Pick from the list',
  demo: 'Live list is disabled in demo — enter the slug or ISIN manually.',
  helper:
    'Linked assets are valued as units × the fetched sell price — use Fetch quotes on Daily quotes.',
  pickerLabel: { fund: 'Fund', bond: 'Bond' },
  manualLabel: { fund: 'Fund slug', bond: 'Bond ISIN' },
} as const;

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
            ...(entry.maturity === undefined ? {} : { hint: `matures ${f.date(entry.maturity)}` }),
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
