import { describe, expect, it } from 'vitest';

import { SEED_ASSETS, SEED_TRANSACTIONS } from '../../lib/seed';
import type { Asset, Transaction } from '../../core/types';
import { mostUnderweightAsset, nextPayoutRows } from './overview';

const TOTAL = 149016.36;
const VALUES = { reit: 68702.1, energy: 60086.09, ovdp8976: 15846.3, ovdp6475: 4374.12 };

describe('mostUnderweightAsset', () => {
  it('picks OVDP …8976 (-6.4pp, the most negative allocation delta) on seed data', () => {
    const r = mostUnderweightAsset(SEED_ASSETS, VALUES, TOTAL);
    expect(r?.asset.id).toBe('ovdp8976');
    expect(r?.deltaPp).toBeCloseTo(-6.365, 2);
    expect(r?.topUp).toBeCloseTo(11429.49, 0); // D5#4
  });

  it('returns undefined when there are no assets', () => {
    expect(mostUnderweightAsset([], {}, 0)).toBeUndefined();
  });

  it('returns undefined when total is 0 (empty DB), even with assets present — avoids a nonsense "top up ₴0.00" hint', () => {
    expect(mostUnderweightAsset(SEED_ASSETS, {}, 0)).toBeUndefined();
  });
});

describe('nextPayoutRows', () => {
  const rows = nextPayoutRows(SEED_ASSETS, SEED_TRANSACTIONS);

  it('excludes assets with payoutSchedule "none" (Energy)', () => {
    expect(rows.some((r) => r.assetId === 'energy')).toBe(false);
  });

  it('bond rows use couponAmount + nextCoupon (UI renders "₴1,240 · 25 Aug")', () => {
    const bond = rows.find((r) => r.assetId === 'ovdp8976');
    expect(bond).toMatchObject({
      kind: 'coupon',
      assetRef: '…8976',
      amount: 1240,
      approx: false,
      date: '2026-08-25',
    });
  });

  it('dividend-bearing assets estimate the latest dividend amount (approx), next date = latest + 1 month', () => {
    const reit = rows.find((r) => r.assetId === 'reit');
    // latest REIT dividend is 700.36 on 10.07 -> next 10.08 (D5#7: the UI's
    // whole-₴ rendering shows "~₴700", not the reference's ~₴715)
    expect(reit).toMatchObject({ kind: 'dividend', assetRef: 'REIT', approx: true, date: '2026-08-10' });
    expect(reit?.amount).toBeCloseTo(700.36, 2);
  });

  it('is sorted soonest-first', () => {
    const dates = rows.map((r) => r.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('a new dividend asset with no accrual yet is skipped (nothing to estimate from)', () => {
    const newAsset: Asset = {
      id: 'new1',
      name: 'New Fund',
      code: 'NF',
      colorKey: 'reit',
      yieldType: 'dividends',
      expectedPct: 10,
      targetPct: 5,
      payoutSchedule: 'monthly',
      firstPurchase: '2026-07-27',
      createdAt: '2026-07-27T10:00:00',
    };
    const withNew = nextPayoutRows([...SEED_ASSETS, newAsset], SEED_TRANSACTIONS);
    expect(withNew.some((r) => r.assetId === 'new1')).toBe(false);
  });

  it('a bond missing couponAmount/nextCoupon is skipped', () => {
    const bareBond: Asset = {
      id: 'bond2',
      name: 'OVDP UA0000000000',
      code: 'GB',
      colorKey: 'energy',
      yieldType: 'fixed_coupon',
      expectedPct: 15,
      targetPct: 5,
      payoutSchedule: 'semiannual',
      firstPurchase: '2026-07-27',
      createdAt: '2026-07-27T10:00:00',
    };
    const txs: Transaction[] = [];
    expect(nextPayoutRows([bareBond], txs)).toEqual([]);
  });
});
