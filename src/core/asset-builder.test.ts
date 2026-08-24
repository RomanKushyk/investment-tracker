import { describe, expect, it } from 'vitest';

import { assetFromForm, assetPatchFromForm, buildNewAsset } from './asset-builder';
import type { AssetFormValues } from './schemas';

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
  couponAmount: 1240,
  nextCoupon: '2026-08-25',
  reinvestPolicy: undefined,
  inzhur: { kind: 'bond', ref: 'UA4000238976', units: 15 },
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
    expect(a.couponAmount).toBe(1240);
    expect(a.nextCoupon).toBe('2026-08-25');
    expect(a.inzhur).toEqual({ kind: 'bond', ref: 'UA4000238976', units: 15 });
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
    const patch = assetPatchFromForm(formValues);
    expect(patch).toEqual({
      name: 'OVDP UA4000241234',
      code: 'GB',
      yieldType: 'fixed_coupon',
      expectedPct: 16.5,
      targetPct: 10,
      payoutSchedule: 'semiannual',
      firstPurchase: '2026-08-01',
      maturity: '2027-02-25',
      couponAmount: 1240,
      nextCoupon: '2026-08-25',
      reinvestPolicy: undefined, // emptied visible field → Dexie deletes the key
      inzhur: { kind: 'bond', ref: 'UA4000238976', units: 15 },
    });
    // toEqual ignores undefined-valued keys — assert the clearing key exists.
    expect('reinvestPolicy' in patch).toBe(true);
  });

  it('never touches the stored fixed-coupon fields when the group was hidden (non-bond)', () => {
    const patch = assetPatchFromForm({
      ...formValues,
      yieldType: 'dividends',
      payoutSchedule: 'monthly',
    });
    expect('maturity' in patch).toBe(false);
    expect('couponAmount' in patch).toBe(false);
    expect('nextCoupon' in patch).toBe(false);
    expect('reinvestPolicy' in patch).toBe(false); // REIT's seeded policy survives edits
  });

  it('clears the inzhur link when the toggle is off (explicit undefined in the patch)', () => {
    const patch = assetPatchFromForm({ ...formValues, inzhur: undefined });
    expect('inzhur' in patch).toBe(true);
    expect(patch.inzhur).toBeUndefined();
  });
});
