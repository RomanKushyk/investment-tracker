// Pure builders for the Asset the forms create and patch.
import { COLOR_KEYS } from './colors';
import { sameInstrument } from './inzhur/ref';
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

// The fixed-coupon group is visible only while `yieldType` is `fixed_coupon`, so
// its values apply only then: on any other type the EDIT patch leaves the stored
// fields untouched, because the form never showed them and must not destroy them.
function fixedCouponFields(v: AssetFormValues) {
  return v.yieldType === 'fixed_coupon'
    ? {
        maturity: v.maturity,
        couponRatePct: v.couponRatePct,
        // `couponAmount` IS NOT TOUCHED. Clearing it whenever a rate is given looks
        // right and is not: `couponPerPayment` prefers the rate WHENEVER IT CAN
        // ANSWER, and fails only when the count is unknown — exactly when
        // `rate × units` has no value either. The legacy amount never shadows a
        // usable rate; it fills the hole the rate cannot.
        nextCoupon: v.nextCoupon,
      }
    : undefined;
}

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

// Edit mode. Explicit `undefined` values are deliberate: Dexie’s `update()`
// DELETES a key set to undefined, so emptying a visible optional field clears the
// stored value instead of leaving a stale one — and a field the form never showed
// must be omitted rather than passed through.
export function assetPatchFromForm(
  values: AssetFormValues,
  /**
   * REQUIRED rather than optional: `inzhur` is patched WHOLESALE, so omitting this
   * drops the asset’s legacy unit count, which is unrecoverable. While it
   * defaulted, the data-losing path was the one a forgetful caller got for free.
   */
  existing: Asset | undefined,
): Partial<Asset> {
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
    // The legacy count is carried across, ONLY WHILE THE LINK ITSELF IS UNCHANGED:
    // a count was counted for one instrument, so re-pointing the link and carrying
    // the number over would value the new holding at the old one’s size.
    inzhur: withLegacyUnits(values.inzhur, existing),
  };
}

function withLegacyUnits(
  next: AssetFormValues['inzhur'],
  existing: Asset | undefined,
): Asset['inzhur'] {
  if (next === undefined) return undefined;
  // ONE lookup, one answer — calling it in both arms of a ternary invites the two
  // to drift the next time the carry rule changes.
  const units = legacyUnitsOf(existing, next);
  return units === undefined ? next : { ...next, units };
}

function legacyUnitsOf(
  existing: Asset | undefined,
  next: { kind: 'fund' | 'bond'; ref: string },
): number | undefined {
  const link = existing?.inzhur;
  if (link === undefined || link.units === undefined) return undefined;
  // THE REF ALONE, not kind+ref: the only control that can repair a `dev`-era kind
  // mismatch is re-picking the same instrument, which writes the derived kind — so
  // comparing the kind read that repair as a re-point and deleted the count.
  return sameInstrument(link.ref, next.ref) ? link.units : undefined;
}
