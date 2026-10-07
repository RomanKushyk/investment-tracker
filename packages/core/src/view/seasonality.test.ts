import { describe, expect, it } from 'vitest';

import { SEED_ASSETS, SEED_TRANSACTIONS } from '../seed';
import type { Asset, Transaction } from '../types';
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
  seasonalityView,
} from './seasonality';
import { scheduledCouponMonths } from '../accrual';
import { buildSeedSnapshots } from '../seed';
import { resolveWindow } from '../period';
import type { PeriodOption } from '../period';
import { portfolioStart, transactionsFrom } from '../derive';
import { latestSnapshotDate } from '../dates';
import { OFF_LIST_DATES, OFF_LIST_INPUT, PUBLISHED_INPUT } from './test-ledgers';

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

// A user-created fixed-coupon asset used to be skipped whenever either attribute was blank.
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
      SEED_TRANSACTIONS,
    )!;
    expect(info.day).toBe(25);
    expect(info.months).toEqual([2, 8]);
  });

  it('…6475: historical June, day 3', () => {
    const info = bondCouponInfo(
      SEED_ASSETS.find((a) => a.id === 'ovdp6475')!,
      SEED_TRANSACTIONS,
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
        SEED_TRANSACTIONS,
      ),
    ).toBeUndefined();
  });
});

// The card forecasts the walk's occurrence, not the stored pointer, over the whole ledger: the
// paid months are the window's, the coupon still owed is not. *Metric families and windows*
describe('bondCouponInfo — the forecast is the occurrence the ledger is owed', () => {
  const b8976 = SEED_ASSETS.find((a) => a.id === 'ovdp8976')!;
  // …8976's 15 units sold on 01.07 and 5 bought back on 01.09: none were held at the end of 24.08.
  const boughtBack: Transaction[] = [
    ...SEED_TRANSACTIONS,
    {
      id: 's2',
      date: '2026-07-01',
      type: 'sell',
      assetId: 'ovdp8976',
      amount: 15800,
      quantity: 15,
    },
    { id: 'b9', date: '2026-09-01', type: 'buy', assetId: 'ovdp8976', amount: 5300, quantity: 5 },
  ];
  const view = (period: PeriodOption) =>
    seasonalityView({
      assets: SEED_ASSETS,
      snapshots: buildSeedSnapshots(),
      transactions: boughtBack,
      period,
    });

  it('names February alone after a buy-back on 01.09, as the expected months do', () => {
    const info = bondCouponInfo(b8976, boughtBack, boughtBack)!;
    expect(info.months).toEqual([2]);
    expect(info.day).toBe(25);
    expect(scheduledCouponMonths(b8976, boughtBack)).toEqual([2]);
    const all = view('all');
    expect(all.bigBond?.id).toBe('ovdp8976');
    expect(all.bigBondInfo?.months).toEqual([2]);
  });

  it('reads the coupon owed over the whole ledger under a window that drops the purchase', () => {
    // Under 3 months the window opens after the 05.02 purchase and the 25.02 coupon, so only the
    // sale and the buy-back are inside it.
    const q = view('3m');
    expect(q.bigBondInfo?.historicalMonths).toEqual([]);
    expect(q.bigBondInfo?.months).toEqual([2]);
    expect(q.bigBondInfo?.day).toBe(25);
  });

  it('names no bond with nothing paid in the window and nothing still owed', () => {
    // …8976's final coupon confirmed, so the pointer stays on it and the walk owes nothing; under
    // 1 month to 10.04.2027 the window holds none of its payouts.
    const assets = SEED_ASSETS.map((a) =>
      a.id === 'ovdp8976' ? { ...a, nextCoupon: '2027-02-25' } : a,
    );
    const paid = (id: string, date: string): Transaction => ({
      id,
      date,
      type: 'interest_payout',
      assetId: 'ovdp8976',
      amount: 1240,
    });
    const at = (period: PeriodOption) =>
      seasonalityView({
        assets,
        snapshots: [...buildSeedSnapshots(), { date: '2027-04-10', quotes: {} }],
        transactions: [...SEED_TRANSACTIONS, paid('p8', '2026-08-25'), paid('p9', '2027-02-25')],
        period,
      });
    const month = at('1m');
    expect(month.bigBond?.id).toBe('ovdp6475');
    expect(month.bigBondInfo?.months).toEqual([12]);
    expect(month.otherBonds).toEqual([]);
    expect(at('all').bigBond?.id).toBe('ovdp8976');
  });

  it('names the day of a payment it names, not the short final coupon still owed', () => {
    // …6475's 03.12 coupon recorded: the walk owes the 27.05.2027 maturity, while the card names
    // June, which it paid on the 3rd.
    const view = seasonalityView({
      assets: SEED_ASSETS,
      snapshots: [...buildSeedSnapshots(), { date: '2026-12-10', quotes: {} }],
      transactions: [
        ...SEED_TRANSACTIONS,
        { id: 'p9', date: '2026-12-03', type: 'interest_payout', assetId: 'ovdp6475', amount: 216 },
      ],
      period: 'all',
    });
    const b6475 = view.otherBonds.find((o) => o.asset.id === 'ovdp6475');
    expect(b6475?.month).toBe(6);
    expect(b6475?.info?.day).toBe(3);
  });

  it('names the month of the first payout, whose day it names, across a year boundary', () => {
    // Paid on 26.08.2025 and 12.02.2026 before the seed's 03.06: February is the lowest month
    // number, but August is the first it paid in.
    const view = seasonalityView({
      assets: SEED_ASSETS,
      snapshots: buildSeedSnapshots(),
      transactions: [
        ...SEED_TRANSACTIONS,
        {
          id: 'x1',
          date: '2025-07-01',
          type: 'buy',
          assetId: 'ovdp6475',
          amount: 1000,
          quantity: 1,
        },
        { id: 'x2', date: '2025-08-26', type: 'interest_payout', assetId: 'ovdp6475', amount: 54 },
        { id: 'x3', date: '2026-02-12', type: 'interest_payout', assetId: 'ovdp6475', amount: 54 },
      ],
      period: 'all',
    });
    const b6475 = view.otherBonds.find((o) => o.asset.id === 'ovdp6475');
    expect(b6475?.month).toBe(8);
    expect(b6475?.info?.day).toBe(26);
  });
});

describe('the expected coupons step through the published dates the build carries', () => {
  const view = (input: typeof PUBLISHED_INPUT) => seasonalityView({ ...input, period: 'all' });
  const expectedMonths = (v: ReturnType<typeof view>) =>
    v.months.filter((m) => m.expected !== undefined).map((m) => m.month);
  const expectedDays = (v: ReturnType<typeof view>) =>
    v.days.filter((d) => d.expected !== undefined).map((d) => [d.day, d.expectedAssetId]);
  const withDates = view(PUBLISHED_INPUT);
  const without = view({ ...PUBLISHED_INPUT, paymentDates: undefined });

  it("names the published dates' months", () => {
    expect(expectedMonths(withDates)).toEqual([3, 9]);
    expect(expectedMonths(without)).toEqual([4, 9, 10]);
  });

  it("puts the expected bar on the published date's day", () => {
    expect(expectedDays(withDates)).toEqual([[30, 'pub']]);
    expect(expectedDays(without)).toEqual([[1, 'pub']]);
  });

  it('forecasts the coupon-season card in the published month', () => {
    expect(withDates.bigBondInfo?.months).toEqual([4, 9]);
    expect(without.bigBondInfo?.months).toEqual([4, 10]);
  });

  it('draws the month bars wherever the day bar is, when only the published dates owe a coupon', () => {
    // Payouts entered on the steps, more than the dedupe window after the published date: the
    // step settles every occurrence, the published dates still owe 15.09.
    const input: typeof PUBLISHED_INPUT = {
      ...PUBLISHED_INPUT,
      assets: [{ ...PUBLISHED_INPUT.assets[0], maturity: '2027-03-31' }],
      transactions: [
        ...PUBLISHED_INPUT.transactions,
        { id: 'p2', date: '2026-10-01', type: 'interest_payout', assetId: 'pub', amount: 500 },
        { id: 'p3', date: '2027-03-31', type: 'interest_payout', assetId: 'pub', amount: 500 },
      ],
      paymentDates: new Map([['pub', ['2026-04-02', '2026-09-15', '2027-03-31']]]),
    };
    const v = view(input);
    expect(expectedDays(v)).toEqual([[15, 'pub']]);
    expect(expectedMonths(v)).toEqual([3, 9]);
  });

  describe('start on the published date a stored date a day past it stands for', () => {
    const withDates = view(OFF_LIST_INPUT);
    const without = view({ ...OFF_LIST_INPUT, paymentDates: undefined });

    it("puts the expected bar on the published date's day", () => {
      expect(expectedDays(withDates)).toEqual([[1, 'pub']]);
      expect(expectedDays(without)).toEqual([[2, 'pub']]);
    });

    it('dates the coupon-season card on it when no payout is in the window', () => {
      const [asset] = OFF_LIST_INPUT.assets;
      const info = bondCouponInfo(asset, [], OFF_LIST_INPUT.transactions, OFF_LIST_DATES);
      expect(info).toEqual({ day: 1, months: [12], historicalMonths: [] });
      expect(bondCouponInfo(asset, [], OFF_LIST_INPUT.transactions)?.day).toBe(2);
    });
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
    // …8976 pays in August and again at its February maturity, so both months carry
    // an expectation — and February carries BOTH, because it also has the coupon
    // already received. The design sheet drew only August; the schedule says
    // otherwise, and the schedule is the thing being asked.
    const m = seasonalityMonths(SEED_TRANSACTIONS, SEED_ASSETS);
    expect(m.find((x) => x.month === 8)!.expected).toBe(1240);
    expect(m.find((x) => x.month === 2)!.expected).toBe(1240);
    expect(m.find((x) => x.month === 2)!.actual).toBeGreaterThan(0);
    expect(m.find((x) => x.month === 12)!.expected).toBe(216);
    // …6475's FINAL coupon overshoots the maturity, so `rollNextCoupon` clamps to it
    // and that month carries the last one. Breaking out of the walk instead loses
    // the month from the screen.
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
    // The REIT dividends of the three earlier months fall before the window opens.
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
    const m = (p: PeriodOption) =>
      seasonalityMonthsIn(SEED_TRANSACTIONS, SEED_ASSETS, at(p)).map((x) => x.expected);
    expect(m('1m')).toEqual(m('all'));
  });

  it('windows the month axis too — the same bars, bucketed the other way', () => {
    const q = seasonalityMonthsIn(SEED_TRANSACTIONS, SEED_ASSETS, at('3m'));
    expect(q.find((x) => x.month === 2)!.actual).toBe(0);
    // …while its EXPECTED coupon survives, so the month still draws a bar.
    expect(q.find((x) => x.month === 2)!.expected).toBe(1240);
    expect(q.find((x) => x.month === 7)!.actual).toBeCloseTo(700.36, 2);
  });

  it('reduces exactly to the unwindowed builders at Від початку', () => {
    // `at('all')` and NOT `undefined`: the unwindowed form DELEGATES to the windowed
    // one with `undefined`, so comparing the two asserts `f(x) === f(x)` and cannot
    // fail. The default screen renders a real window, which is a different path
    // through `transactionsFrom`.
    expect(seasonalityDaysIn(SEED_TRANSACTIONS, SEED_ASSETS, at('all'))).toEqual(
      seasonalityDays(SEED_TRANSACTIONS, SEED_ASSETS),
    );
    expect(seasonalityMonthsIn(SEED_TRANSACTIONS, SEED_ASSETS, at('all'))).toEqual(
      seasonalityMonths(SEED_TRANSACTIONS, SEED_ASSETS),
    );
  });

  it('a window with a single payout shows no growth claim rather than a flat one', () => {
    // The narrow window holds exactly one REIT dividend and the card's copy hardcodes
    // «і зростають». One point is not a trend, and a falling pair is not growth.
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
      },
      {
        id: 'b',
        date: '2026-06-10',
        type: 'dividend_accrual',
        assetId: 'reit',
        amount: 100,
      },
    ] as Transaction[];
    expect(anchorAssetGrowth(falling, 'reit')).toBeUndefined();
  });
});
