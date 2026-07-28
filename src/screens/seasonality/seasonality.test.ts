import { describe, expect, it } from 'vitest';

import { SEED_ASSETS, SEED_TRANSACTIONS } from '../../lib/seed';
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
    expect(dominantExpectedAssetOnDay(SEED_ASSETS, 3)).toBe('ovdp6475');
  });

  it('day 25 expected coupon is attributed to …8976 (nextCoupon 2026-08-25)', () => {
    expect(dominantExpectedAssetOnDay(SEED_ASSETS, 25)).toBe('ovdp8976');
  });

  it('a day with no upcoming coupon has no attribution', () => {
    expect(dominantExpectedAssetOnDay(SEED_ASSETS, 10)).toBeUndefined();
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
