import { describe, expect, it } from 'vitest';

import { SEED_ASSETS, SEED_TRANSACTIONS } from '../../lib/seed';
import type { Asset, Transaction } from '../../core/types';
import {
  anchorAssetGrowth,
  bondCouponInfo,
  dominantAssetOnDay,
  dominantExpectedAssetOnDay,
  incomeAnchorDay,
  quietStretch,
  seasonalityDays,
} from './seasonality';

describe('seasonalityDays', () => {
  const days = seasonalityDays(SEED_TRANSACTIONS, SEED_ASSETS);

  it('has 31 buckets, day 10 = ₴3,641.44 (D5#3, not the reference ₴3,817.44)', () => {
    expect(days).toHaveLength(31);
    const day10 = days.find((d) => d.day === 10)!;
    expect(day10.actual).toBeCloseTo(3641.44, 2);
  });

  it('day 3 = ₴216 (…6475 coupon), day 25 = ₴1,183.50 actual + ₴1,240 expected', () => {
    expect(days.find((d) => d.day === 3)!.actual).toBeCloseTo(216, 2);
    const day25 = days.find((d) => d.day === 25)!;
    expect(day25.actual).toBeCloseTo(1183.5, 2);
    expect(day25.expected).toBeCloseTo(1240, 2);
  });

  it('every other day has zero actual income (seed dividends all fall on day 10)', () => {
    const other = days.filter((d) => ![3, 10, 25].includes(d.day));
    expect(other.every((d) => d.actual === 0)).toBe(true);
  });
});

describe('incomeAnchorDay', () => {
  it('picks day 10, the largest bucket', () => {
    const days = seasonalityDays(SEED_TRANSACTIONS, SEED_ASSETS);
    expect(incomeAnchorDay(days)?.day).toBe(10);
  });
});

describe('dominantAssetOnDay', () => {
  it('day 10 is driven by REIT', () => {
    expect(dominantAssetOnDay(SEED_TRANSACTIONS, 10)).toBe('reit');
  });
});

describe('dominantExpectedAssetOnDay', () => {
  it('day 3 expected coupon is attributed to …6475 (nextCoupon 2026-12-03)', () => {
    expect(dominantExpectedAssetOnDay(SEED_ASSETS, SEED_TRANSACTIONS, 3)).toBe('ovdp6475');
  });

  it('day 25 expected coupon is attributed to …8976 (nextCoupon 2026-08-25)', () => {
    expect(dominantExpectedAssetOnDay(SEED_ASSETS, SEED_TRANSACTIONS, 25)).toBe('ovdp8976');
  });

  it('a day with no upcoming coupon has no attribution', () => {
    expect(dominantExpectedAssetOnDay(SEED_ASSETS, SEED_TRANSACTIONS, 10)).toBeUndefined();
  });
});

describe('anchorAssetGrowth', () => {
  it('REIT dividends grew ₴580.20 (Feb) -> ₴700.36 (Jul)', () => {
    const g = anchorAssetGrowth(SEED_TRANSACTIONS, 'reit');
    expect(g?.first).toBeCloseTo(580.2, 2);
    expect(g?.last).toBeCloseTo(700.36, 2);
  });
});

describe('quietStretch', () => {
  it('finds the trailing zero-income run, days 26-31', () => {
    const days = seasonalityDays(SEED_TRANSACTIONS, SEED_ASSETS);
    expect(quietStretch(days)).toEqual({ from: 26, to: 31 });
  });
});

// The P3 fix (feat/fixed-yield): a user-created fixed-coupon asset used to be
// skipped by the expected bars whenever couponAmount or nextCoupon was blank.
describe('expected bars — user-created fixed-coupon assets (P3 fix)', () => {
  const userBond: Asset = {
    id: 'bond2',
    name: 'OVDP UA0000000000',
    code: 'GB',
    colorKey: 'energy',
    yieldType: 'fixed_coupon',
    expectedPct: 16,
    targetPct: 5,
    payoutSchedule: 'semiannual',
    firstPurchase: '2026-07-27',
    createdAt: '2026-07-27T10:00:00',
    nextCoupon: '2026-09-15',
  };
  const buy: Transaction = {
    id: 'b9',
    date: '2026-07-27',
    type: 'buy',
    assetId: 'bond2',
    amount: 10000,
    source: 'own',
  };
  const days = seasonalityDays([...SEED_TRANSACTIONS, buy], [...SEED_ASSETS, userBond]);

  it('projects the estimated coupon on its day-of-month (16 % of ₴10 000 half-yearly = ₴800)', () => {
    expect(days.find((d) => d.day === 15)!.expected).toBeCloseTo(800, 2);
    expect(dominantExpectedAssetOnDay([...SEED_ASSETS, userBond], [...SEED_TRANSACTIONS, buy], 15)).toBe(
      'bond2',
    );
  });

  it('leaves the seed bars untouched (additive-only, D5)', () => {
    expect(days.find((d) => d.day === 25)!.expected).toBeCloseTo(1240, 2);
    expect(days.find((d) => d.day === 3)!.expected).toBeCloseTo(216, 2);
    expect(days.find((d) => d.day === 10)!.actual).toBeCloseTo(3641.44, 2);
  });
});

describe('bondCouponInfo', () => {
  it('…8976: historical Feb + upcoming Aug, day 25', () => {
    const info = bondCouponInfo(SEED_ASSETS.find((a) => a.id === 'ovdp8976')!, SEED_TRANSACTIONS)!;
    expect(info.day).toBe(25);
    expect(info.months).toEqual([2, 8]);
  });

  it('…6475: historical June, day 3', () => {
    const info = bondCouponInfo(SEED_ASSETS.find((a) => a.id === 'ovdp6475')!, SEED_TRANSACTIONS)!;
    expect(info.day).toBe(3);
    expect(info.historicalMonths).toEqual([6]);
  });

  it('non-bond assets return undefined', () => {
    expect(bondCouponInfo(SEED_ASSETS.find((a) => a.id === 'reit')!, SEED_TRANSACTIONS)).toBeUndefined();
  });
});
