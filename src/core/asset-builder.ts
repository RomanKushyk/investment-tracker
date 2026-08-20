// Pure builder for the Asset created inline from the Transaction panel's
// "New asset details" sub-form. Pinned rules (task 4 plan):
// id = crypto.randomUUID(); code = first 2 letters of the name, uppercased;
// colorKey cycles the 4 tint keys by current asset count; firstPurchase =
// the transaction's own date; createdAt = now (drives listAssets order).
// P2 feat/asset-form adds the AssetForm mappers on top: assetFromForm
// (create) reuses buildNewAsset's derived fields; assetPatchFromForm (edit)
// builds the useUpdateAsset patch.
import { COLOR_KEYS } from './colors';
import type { AssetFormValues } from './schemas';
import type { Asset, PayoutSchedule, YieldType } from './types';

export interface NewAssetValues {
  name: string;
  yieldType: YieldType;
  expectedPct: number;
  targetPct: number;
  payoutSchedule: PayoutSchedule;
}

export function buildNewAsset(
  values: NewAssetValues,
  txDate: string,
  existingAssetCount: number,
): Asset {
  return {
    id: crypto.randomUUID(),
    name: values.name,
    code: values.name.trim().slice(0, 2).toUpperCase(),
    colorKey: COLOR_KEYS[existingAssetCount % COLOR_KEYS.length],
    yieldType: values.yieldType,
    expectedPct: values.expectedPct,
    targetPct: values.targetPct,
    payoutSchedule: values.payoutSchedule,
    firstPurchase: txDate,
    createdAt: new Date().toISOString(),
  };
}

// The fixed-coupon group is visible only while yieldType = fixed_coupon
// (brief S3), so its values apply only then. On any other yield type the
// EDIT patch leaves the four stored fields untouched (the form never showed
// them — it must not silently destroy e.g. REIT's seeded reinvestPolicy),
// and the CREATE asset simply omits them.
function fixedCouponFields(v: AssetFormValues) {
  return v.yieldType === 'fixed_coupon'
    ? {
        maturity: v.maturity,
        couponAmount: v.couponAmount,
        nextCoupon: v.nextCoupon,
        reinvestPolicy: v.reinvestPolicy,
      }
    : undefined;
}

// Create mode (/portfolio "Add asset" and the TransactionPanel
// quick-create): buildNewAsset keeps deriving id/colorKey/createdAt, the
// form values overlay everything they own (incl. the user-editable code).
export function assetFromForm(
  values: AssetFormValues,
  firstPurchase: string,
  existingAssetCount: number,
): Asset {
  const base = buildNewAsset(
    {
      name: values.name,
      yieldType: values.yieldType,
      expectedPct: values.expectedPct,
      targetPct: values.targetPct,
      payoutSchedule: values.payoutSchedule,
    },
    firstPurchase,
    existingAssetCount,
  );
  const bond = fixedCouponFields(values);
  return {
    ...base,
    code: values.code,
    ...(bond ?? {}),
    ...(values.inzhur ? { inzhur: values.inzhur } : {}),
  };
}

// Edit mode → useUpdateAsset patch. Explicit `undefined` values are
// deliberate: Dexie's update() deletes a key set to undefined, so emptying
// a visible optional field (or switching the Inzhur toggle off) clears the
// stored value instead of leaving a stale one.
export function assetPatchFromForm(values: AssetFormValues): Partial<Asset> {
  const bond = fixedCouponFields(values);
  return {
    name: values.name,
    code: values.code,
    yieldType: values.yieldType,
    expectedPct: values.expectedPct,
    targetPct: values.targetPct,
    payoutSchedule: values.payoutSchedule,
    firstPurchase: values.firstPurchase,
    ...(bond ?? {}),
    inzhur: values.inzhur,
  };
}
