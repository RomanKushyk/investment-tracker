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
  seasonalityDaysIn,
  seasonalityMonths,
  seasonalityMonthsIn,
} from './seasonality';
import { buildSeedSnapshots } from '../../lib/seed';
import { resolveWindow } from '../../core/period';
import type { PeriodOption } from '../../core/period';
import { portfolioStart, transactionsFrom } from '../../core/derive';
import { latestSnapshotDate } from '../../core/dates';

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
    expect(
      dominantExpectedAssetOnDay([...SEED_ASSETS, userBond], [...SEED_TRANSACTIONS, buy], 15),
    ).toBe('bond2');
  });

  it('leaves the seed bars untouched (additive-only, D5)', () => {
    expect(days.find((d) => d.day === 25)!.expected).toBeCloseTo(1240, 2);
    expect(days.find((d) => d.day === 3)!.expected).toBeCloseTo(216, 2);
    expect(days.find((d) => d.day === 10)!.actual).toBeCloseTo(3641.44, 2);
  });
});

describe('bondCouponInfo', () => {
  it('…8976: historical Feb + upcoming Aug, day 25', () => {
    const info = bondCouponInfo(
      SEED_ASSETS.find((a) => a.id === 'ovdp8976')!,
      SEED_TRANSACTIONS,
    )!;
    expect(info.day).toBe(25);
    expect(info.months).toEqual([2, 8]);
  });

  it('…6475: historical June, day 3', () => {
    const info = bondCouponInfo(
      SEED_ASSETS.find((a) => a.id === 'ovdp6475')!,
      SEED_TRANSACTIONS,
    )!;
    expect(info.day).toBe(3);
    expect(info.historicalMonths).toEqual([6]);
  });

  it('non-bond assets return undefined', () => {
    expect(
      bondCouponInfo(
        SEED_ASSETS.find((a) => a.id === 'reit')!,
        SEED_TRANSACTIONS,
      ),
    ).toBeUndefined();
  });
});

describe('seasonalityMonths (A41) — the month axis, and D-5 in it', () => {
  it('buckets actual income by month of year', () => {
    const m = seasonalityMonths(SEED_TRANSACTIONS, SEED_ASSETS);
    expect(m).toHaveLength(12);
    expect(m.find((x) => x.month === 2)!.actual).toBeCloseTo(1763.7, 1);
    expect(m.find((x) => x.month === 7)!.actual).toBeCloseTo(700.36, 1);
  });

  it('expects a coupon in EVERY month a bond is scheduled for, not just the next one', () => {
    // D-5. …8976 pays in August and again at its February maturity, so both
    // months carry an expectation — and February carries BOTH, because it also
    // has the 2026 coupon already received. The design sheet drew only August;
    // the schedule says otherwise, and the schedule is the thing being asked.
    const m = seasonalityMonths(SEED_TRANSACTIONS, SEED_ASSETS);
    expect(m.find((x) => x.month === 8)!.expected).toBe(1240);
    expect(m.find((x) => x.month === 2)!.expected).toBe(1240);
    expect(m.find((x) => x.month === 2)!.actual).toBeGreaterThan(0);
    expect(m.find((x) => x.month === 12)!.expected).toBe(216);
    // …6475's FINAL coupon (review F1): 03.12.2026 + 6m overshoots the
    // 27.05.2027 maturity, so `rollNextCoupon` clamps to maturity and травень
    // carries the last 216,00. The first cut broke out of the walk instead and
    // this month was missing from the screen.
    expect(m.find((x) => x.month === 5)!.expected).toBe(216);
    expect(m.find((x) => x.month === 5)!.actual).toBeCloseTo(472.13, 2);
  });

  it('leaves a month with neither actual nor expected empty', () => {
    const m = seasonalityMonths(SEED_TRANSACTIONS, SEED_ASSETS);
    const october = m.find((x) => x.month === 10)!;
    expect(october.actual).toBe(0);
    expect(october.expected).toBeUndefined();
  });
});

describe('A42 — /seasonality under the window: one series moves, the other cannot', () => {
  const snaps = buildSeedSnapshots();
  const at = (period: PeriodOption) =>
    resolveWindow(
      period,
      portfolioStart(SEED_ASSETS, snaps, SEED_TRANSACTIONS),
      latestSnapshotDate(snaps),
    );

  it("reproduces the sheet's measured day-10 figure under 3 місяці", () => {
    // The spine's own cell: `day 10: 3 641,44 → 1 853,04 (тра + чер + лип)`.
    // February, March and April's REIT dividends fall before the 27.04 opening.
    const all = seasonalityDaysIn(SEED_TRANSACTIONS, SEED_ASSETS, at('all'));
    const q = seasonalityDaysIn(SEED_TRANSACTIONS, SEED_ASSETS, at('3m'));
    expect(all.find((d) => d.day === 10)!.actual).toBeCloseTo(3641.44, 2);
    expect(q.find((d) => d.day === 10)!.actual).toBeCloseTo(1853.04, 2);
  });

  it('leaves the expected series identical in every window — a projection has no window', () => {
    const expectedIn = (p: PeriodOption) =>
      seasonalityDaysIn(SEED_TRANSACTIONS, SEED_ASSETS, at(p)).map((d) => d.expected);
    expect(expectedIn('3m')).toEqual(expectedIn('all'));
    expect(expectedIn('1m')).toEqual(expectedIn('all'));
    // …and on the month axis, where D-5 projects a bond onto every month it pays in.
    const m = (p: PeriodOption) =>
      seasonalityMonthsIn(SEED_TRANSACTIONS, SEED_ASSETS, at(p)).map((x) => x.expected);
    expect(m('1m')).toEqual(m('all'));
  });

  it('windows the month axis too — the same bars, bucketed the other way', () => {
    const q = seasonalityMonthsIn(SEED_TRANSACTIONS, SEED_ASSETS, at('3m'));
    // Лютий's 1 763,70 of recorded income is entirely before 27.04.
    expect(q.find((x) => x.month === 2)!.actual).toBe(0);
    // …while its EXPECTED coupon survives, so лютий still draws a bar.
    expect(q.find((x) => x.month === 2)!.expected).toBe(1240);
    expect(q.find((x) => x.month === 7)!.actual).toBeCloseTo(700.36, 2);
  });

  it('reduces exactly to the unwindowed builders at Від початку', () => {
    // The property A27 pinned. `at('all')` and NOT `undefined`: the unwindowed
    // form DELEGATES to the windowed one with `undefined`, so comparing the two
    // asserted `f(x) === f(x)` and could not fail (A42 review). The default
    // screen renders `resolveWindow('all', …)`, which is a real window and a
    // different path through `transactionsFrom` — that is the reduction worth
    // pinning, and it is what `yield.test.ts` compares.
    expect(seasonalityDaysIn(SEED_TRANSACTIONS, SEED_ASSETS, at('all'))).toEqual(
      seasonalityDays(SEED_TRANSACTIONS, SEED_ASSETS),
    );
    expect(seasonalityMonthsIn(SEED_TRANSACTIONS, SEED_ASSETS, at('all'))).toEqual(
      seasonalityMonths(SEED_TRANSACTIONS, SEED_ASSETS),
    );
  });

  it('a window with a single payout shows no growth claim rather than a flat one', () => {
    // `1 місяць` holds exactly one REIT dividend, and the card's copy hardcodes
    // «і зростають» — so the windowed pair rendered «700 ₴ → 700 ₴ і зростають».
    // One point is not a trend, and a falling pair is not growth (A42 review).
    const oneMonth = transactionsFrom(SEED_TRANSACTIONS, at('1m')!.from);
    expect(anchorAssetGrowth(oneMonth, 'reit')).toBeUndefined();
    expect(anchorAssetGrowth(SEED_TRANSACTIONS, 'reit')).toEqual({ first: 580.2, last: 700.36 });
    const falling = [
      {
        id: 'a',
        date: '2026-05-10',
        type: 'dividend_accrual',
        assetId: 'reit',
        amount: 900,
        source: 'accrual',
      },
      {
        id: 'b',
        date: '2026-06-10',
        type: 'dividend_accrual',
        assetId: 'reit',
        amount: 100,
        source: 'accrual',
      },
    ] as Transaction[];
    expect(anchorAssetGrowth(falling, 'reit')).toBeUndefined();
  });
});
