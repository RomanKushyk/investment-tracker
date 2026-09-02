// Pure builder for the Asset created inline from the Transaction panel's
// "New asset details" sub-form. Pinned rules (task 4 plan):
// id = crypto.randomUUID(); code = first 2 letters of the name, uppercased;
// colorKey cycles the 4 tint keys by current asset count; firstPurchase =
// the transaction's own date; createdAt = now (drives listAssets order).
// P2 feat/asset-form adds the AssetForm mappers on top: assetFromForm
// (create) reuses buildNewAsset's derived fields; assetPatchFromForm (edit)
// builds the useUpdateAsset patch.
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

// The fixed-coupon group is visible only while yieldType = fixed_coupon
// (brief S3), so its values apply only then. On any other yield type the
// EDIT patch leaves the three stored fields untouched — the form never showed
// them, so it must not destroy them — and the CREATE asset omits them.
//
// `reinvestPolicy` was the fourth until D118 removed the control. The stored
// value now survives for the same reason, one step further: NOTHING writes it.
function fixedCouponFields(v: AssetFormValues) {
  return v.yieldType === 'fixed_coupon'
    ? {
        maturity: v.maturity,
        couponRatePct: v.couponRatePct,
        // `couponAmount` IS NOT TOUCHED, and an earlier cut of this branch got
        // that wrong in a way worth recording. It cleared the legacy figure
        // whenever a rate was given, reasoning that the amount has had no editor
        // since D119 and outranks the rate when the ledger cannot count.
        //
        // The two halves of that never meet. `couponPerPayment` prefers the rate
        // WHENEVER IT CAN ANSWER, and it can only fail to answer when the count
        // is unknown — which is exactly when `rate × units` has no value either.
        // So the legacy amount never shadows a usable rate; it fills the hole the
        // rate cannot. Clearing it turned "the owner supplies more information"
        // into "the bond loses its only coupon figure": «—» on `/attributes`, a
        // silent downgrade to an `expectedPct` estimate on `/overview`, changed
        // `/seasonality` bars and an empty due card — for a pre-#31 bond, which
        // is the only kind that still has the field.
        nextCoupon: v.nextCoupon,
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
export function assetPatchFromForm(
  values: AssetFormValues,
  /**
   * The asset being edited, or an explicit `undefined` when there is none.
   *
   * REQUIRED rather than optional, for the reason `couponProjection` and
   * `accrualSuggestion` give for their own units parameters: `inzhur` is patched
   * WHOLESALE, so omitting this drops the asset's legacy unit count — a figure
   * `w7-migration-translations.md` §4 calls unrecoverable. While it defaulted,
   * the data-losing path was the one a forgetful caller got for free.
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
    // `inzhur` is a WHOLESALE replace, so dropping `units` from the form (D117)
    // turned every edit of a linked asset into a silent deletion of the one unit
    // count it had — the same failure the `fixedCouponFields` comment above
    // exists to prevent, arriving through a different door. The legacy value is
    // carried across instead.
    //
    // ONLY WHILE THE LINK ITSELF IS UNCHANGED. A count was counted for one
    // instrument: re-point the link at another slug or ISIN and carrying the
    // number over would value the new holding at the old one's size. Compared
    // the way `matchAssets` compares refs — trimmed and case-folded — because
    // that is what decides whether the two names mean the same instrument.
    inzhur: withLegacyUnits(values.inzhur, existing),
  };
}

/** The link the patch writes: the form's, plus a legacy count when one carries. */
function withLegacyUnits(
  next: AssetFormValues['inzhur'],
  existing: Asset | undefined,
): Asset['inzhur'] {
  if (next === undefined) return undefined;
  // ONE lookup, one answer. Calling it in both arms of a ternary invites the two
  // to drift the next time the carry rule changes.
  const units = legacyUnitsOf(existing, next);
  return units === undefined ? next : { ...next, units };
}

/** The stored count, but only if this edit leaves the link pointing where it was. */
function legacyUnitsOf(
  existing: Asset | undefined,
  next: { kind: 'fund' | 'bond'; ref: string },
): number | undefined {
  const link = existing?.inzhur;
  if (link === undefined || link.units === undefined) return undefined;
  // THE REF ALONE, not kind+ref. A count was counted for an INSTRUMENT, and the
  // only control that can repair a `dev`-era kind mismatch is re-picking the same
  // instrument — which writes the derived kind alongside. Comparing the kind read
  // that repair as a re-point and deleted the count. `ref.ts` carries the full
  // argument, including why the two namespaces cannot collide.
  return sameInstrument(link.ref, next.ref) ? link.units : undefined;
}
