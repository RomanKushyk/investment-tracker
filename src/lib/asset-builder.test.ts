import { describe, expect, it } from 'vitest';

import { buildNewAsset } from './asset-builder';

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
    expect(
      buildNewAsset({ ...values, name: 'inzhur reit' }, '2026-07-27', 0).code,
    ).toBe('IN');
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
