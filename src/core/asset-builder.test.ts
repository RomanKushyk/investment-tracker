import { describe, expect, it } from 'vitest';

import { assetFromForm, assetPatchFromForm, buildNewAsset } from './asset-builder';
import type { AssetFormValues } from './schemas';
import type { Asset } from './types';

const values = {
  name: 'OVDP UA4000241234',
  yieldType: 'fixed_coupon' as const,
  expectedPct: 16.5,
  targetPct: 10,
  payoutSchedule: 'maturity' as const,
};

describe('buildNewAsset (task 4 pinned rules)', () => {
  it('derives code from the first 2 letters of the name, uppercased', () => {
    expect(buildNewAsset(values, '2026-07-27', 0).code).toBe('OV');
    expect(buildNewAsset({ ...values, name: 'inzhur reit' }, '2026-07-27', 0).code).toBe('IN');
  });

  it('cycles colorKey through the pinned 4-key sequence by existing asset count', () => {
    expect(buildNewAsset(values, '2026-07-27', 0).colorKey).toBe('reit');
    expect(buildNewAsset(values, '2026-07-27', 1).colorKey).toBe('energy');
    expect(buildNewAsset(values, '2026-07-27', 2).colorKey).toBe('ovdp8976');
    expect(buildNewAsset(values, '2026-07-27', 3).colorKey).toBe('ovdp6475');
    expect(buildNewAsset(values, '2026-07-27', 4).colorKey).toBe('reit'); // wraps at 4
    expect(buildNewAsset(values, '2026-07-27', 5).colorKey).toBe('energy');
  });

  it('sets firstPurchase to the transaction date and stamps a fresh createdAt', () => {
    const before = new Date().toISOString();
    const asset = buildNewAsset(values, '2026-06-15', 0);
    const after = new Date().toISOString();
    expect(asset.firstPurchase).toBe('2026-06-15');
    expect(asset.createdAt >= before && asset.createdAt <= after).toBe(true);
  });

  it('generates a unique id and passes through the sub-form attributes', () => {
    const a = buildNewAsset(values, '2026-07-27', 0);
    const b = buildNewAsset(values, '2026-07-27', 0);
    expect(a.id).not.toBe(b.id);
    expect(a.id.length).toBeGreaterThan(0);
    expect(a.yieldType).toBe('fixed_coupon');
    expect(a.expectedPct).toBe(16.5);
    expect(a.targetPct).toBe(10);
    expect(a.payoutSchedule).toBe('maturity');
    expect(a.name).toBe('OVDP UA4000241234');
  });
});

// Parsed AssetForm output (post-zod: numbers are numbers, empty optionals are
// undefined) — the P2 AssetForm mappers build on buildNewAsset's pinned rules.
const formValues: AssetFormValues = {
  name: 'OVDP UA4000241234',
  code: 'GB',
  yieldType: 'fixed_coupon',
  expectedPct: 16.5,
  targetPct: 10,
  payoutSchedule: 'semiannual',
  firstPurchase: '2026-08-01',
  maturity: '2027-02-25',
  couponRatePct: 15.68,
  nextCoupon: '2026-08-25',
  inzhur: { kind: 'bond', ref: 'UA4000238976' },
};

describe('assetFromForm (P2 create mode)', () => {
  it('keeps buildNewAsset-derived fields and overlays the form-owned ones', () => {
    const a = assetFromForm(formValues, '2026-08-01', 4);
    expect(a.id.length).toBeGreaterThan(0);
    expect(a.colorKey).toBe('reit'); // cycle wraps at 4
    expect(a.createdAt.length).toBeGreaterThan(0);
    expect(a.firstPurchase).toBe('2026-08-01');
    expect(a.code).toBe('GB'); // the edited code wins over the name-derived 'OV'
    expect(a.maturity).toBe('2027-02-25');
    expect(a.couponRatePct).toBe(15.68);
    expect(a.nextCoupon).toBe('2026-08-25');
    expect(a.inzhur).toEqual({ kind: 'bond', ref: 'UA4000238976' });
  });

  it('omits the fixed-coupon group for non-bond yield types and inzhur when unlinked', () => {
    const a = assetFromForm(
      {
        ...formValues,
        yieldType: 'dividends',
        payoutSchedule: 'monthly',
        inzhur: undefined,
      },
      '2026-08-01',
      0,
    );
    expect(a.maturity).toBeUndefined();
    expect(a.couponAmount).toBeUndefined();
    expect(a.nextCoupon).toBeUndefined();
    expect('inzhur' in a).toBe(false);
  });
});

describe('assetPatchFromForm (P2 edit mode)', () => {
  it('patches every form-owned field incl. the fixed-coupon group on a bond', () => {
    const patch = assetPatchFromForm(formValues, undefined);
    expect(patch).toEqual({
      name: 'OVDP UA4000241234',
      code: 'GB',
      yieldType: 'fixed_coupon',
      expectedPct: 16.5,
      targetPct: 10,
      payoutSchedule: 'semiannual',
      firstPurchase: '2026-08-01',
      maturity: '2027-02-25',
      couponRatePct: 15.68,
      nextCoupon: '2026-08-25',
      inzhur: { kind: 'bond', ref: 'UA4000238976' },
    });
    // `reinvestPolicy` was a fourth key here until D118 removed the control.
    // It is absent from the patch NOW IN BOTH BRANCHES, which is the whole
    // point: nothing writes the stored value, so nothing can destroy it.
    expect('reinvestPolicy' in patch).toBe(false);
  });

  it('never touches the stored fixed-coupon fields when the group was hidden (non-bond)', () => {
    const patch = assetPatchFromForm(
      {
        ...formValues,
        yieldType: 'dividends',
        payoutSchedule: 'monthly',
      },
      undefined,
    );
    expect('maturity' in patch).toBe(false);
    expect('couponRatePct' in patch).toBe(false);
    expect('nextCoupon' in patch).toBe(false);
    expect('reinvestPolicy' in patch).toBe(false); // REIT's seeded policy survives edits (D118)
  });

  it('clears the inzhur link when the toggle is off (explicit undefined in the patch)', () => {
    const patch = assetPatchFromForm({ ...formValues, inzhur: undefined }, undefined);
    expect('inzhur' in patch).toBe(true);
    expect(patch.inzhur).toBeUndefined();
  });
});

describe('assetPatchFromForm carries a LEGACY inzhur.units across (D117)', () => {
  // `inzhur` is patched wholesale, so dropping the Units field from the form
  // turned every edit of a linked asset into a silent deletion of the one unit
  // count it had — the same failure the `fixedCouponFields` comment guards
  // against for the fixed-coupon group, arriving through a different door.
  const stored = (units: number | undefined): Asset => ({
    id: 'reit',
    name: 'Inzhur REIT',
    code: 'RE',
    colorKey: 'reit',
    yieldType: 'div_cap',
    expectedPct: 14,
    targetPct: 40,
    payoutSchedule: 'monthly',
    firstPurchase: '2026-02-03',
    createdAt: '2026-02-03T10:00:00',
    inzhur: { kind: 'bond', ref: 'UA4000238976', ...(units === undefined ? {} : { units }) },
  });

  it('keeps the stored count when the link still points where it did', () => {
    const patch = assetPatchFromForm(formValues, stored(15));
    expect(patch.inzhur).toEqual({ kind: 'bond', ref: 'UA4000238976', units: 15 });
  });

  it('compares the ref trimmed and case-folded, like matchAssets does', () => {
    const patch = assetPatchFromForm(
      { ...formValues, inzhur: { kind: 'bond', ref: 'UA4000238976' } },
      { ...stored(15), inzhur: { kind: 'bond', ref: '  ua4000238976 ', units: 15 } },
    );
    expect(patch.inzhur?.units).toBe(15);
  });

  it('DROPS it when the link is re-pointed at another instrument', () => {
    // A count was counted for one instrument. Carrying it to another would
    // value the new holding at the old one's size — a bigger version of #31.
    const patch = assetPatchFromForm(
      { ...formValues, inzhur: { kind: 'bond', ref: 'UA4000236475' } },
      stored(15),
    );
    expect(patch.inzhur).toEqual({ kind: 'bond', ref: 'UA4000236475' });
  });

  it('KEEPS it when only the kind changes on the same ref string', () => {
    // REVERSED, and the old assertion pinned a real bug. A count was counted for
    // an INSTRUMENT; the kind is metadata about where to look it up. A `dev`-era
    // asset could store a kind that disagrees with its yield type — the retired
    // segment was a free choice — and the ONLY control that can repair it is
    // re-picking the same instrument, which writes the derived kind alongside the
    // ref. Dropping the count there read a repair as a re-point and deleted the
    // one number the asset had, which is precisely the loss that made
    // mount-clearing unacceptable. The namespaces cannot collide: an ISIN is
    // twelve upper-case alphanumerics, a slug is lower-case kebab.
    const patch = assetPatchFromForm(
      { ...formValues, inzhur: { kind: 'fund', ref: 'UA4000238976' } },
      stored(15),
    );
    expect(patch.inzhur?.units).toBe(15);
  });

  it('adds nothing when there was no stored count, or no existing asset', () => {
    expect(assetPatchFromForm(formValues, stored(undefined)).inzhur).toEqual({
      kind: 'bond',
      ref: 'UA4000238976',
    });
    expect(assetPatchFromForm(formValues, undefined).inzhur).toEqual({
      kind: 'bond',
      ref: 'UA4000238976',
    });
  });

  it('still clears the link outright when the toggle goes off', () => {
    // The legacy count must not resurrect an unlinked asset's link.
    const patch = assetPatchFromForm({ ...formValues, inzhur: undefined }, stored(15));
    expect('inzhur' in patch).toBe(true);
    expect(patch.inzhur).toBeUndefined();
  });
});
