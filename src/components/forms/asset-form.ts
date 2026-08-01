// Non-component companions of AssetForm.tsx — split out (button-variants.ts
// rationale) so the .tsx file only exports components for react-refresh.
// English copy lives HERE, in the component layer (structured returns, D8):
// core/schemas emits paths, this map owns the pinned S3 message vocabulary.
import { todayIso } from '../../core/dates';
import type { AssetFormInput } from '../../core/schemas';
import type { Asset, PayoutSchedule } from '../../core/types';
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

// Code auto-derivation while untouched — same rule as core buildNewAsset.
export function deriveCode(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

// Fresh defaultValues per mode. Numbers/dates are the raw string inputs of
// AssetFormInput; edit prefills from the stored asset.
export function assetFormDefaults(asset?: Asset): AssetFormInput {
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
    couponAmount: asset.couponAmount !== undefined ? String(asset.couponAmount) : '',
    nextCoupon: asset.nextCoupon ?? '',
    reinvestPolicy: asset.reinvestPolicy ?? '',
    inzhur: asset.inzhur
      ? { kind: asset.inzhur.kind, ref: asset.inzhur.ref, units: String(asset.inzhur.units) }
      : undefined,
  };
}
