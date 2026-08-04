import { describe, expect, it } from 'vitest';

import {
  COUPON_MATCH_WINDOW_DAYS,
  couponProjection,
  couponReminderId,
  couponsInGap,
  dailyAccrual,
  dueCoupons,
  rollNextCoupon,
  suggestedQuote,
} from './accrual';
import type { Asset, Transaction } from './types';

// The demo seed's two bonds (lib/seed.ts) are the fixture basis: …8976 pays
// 1 240,00 semiannually (maturity 25.02.2027), …6475 pays 216,00 (27.05.2027).
function bond(over: Partial<Asset> = {}): Asset {
  return {
    id: 'ovdp8976',
    name: 'OVDP UA4000238976',
    code: 'GB',
    colorKey: 'ovdp8976',
    yieldType: 'fixed_coupon',
    expectedPct: 16.4,
    targetPct: 17,
    payoutSchedule: 'semiannual',
    firstPurchase: '2026-02-05',
    createdAt: '2026-02-05T10:00:00',
    maturity: '2027-02-25',
    couponAmount: 1240,
    nextCoupon: '2026-08-25',
    ...over,
  };
}

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    date: '2026-08-25',
    type: 'interest_payout',
    assetId: 'ovdp8976',
    amount: 1240,
    source: 'accrual',
    ...over,
  };
}

describe('dailyAccrual', () => {
  it('spreads the stated coupon over its period (ACT/365)', () => {
    expect(dailyAccrual(1240, 'semiannual')).toBeCloseTo((1240 * 2) / 365, 10);
    expect(dailyAccrual(216, 'semiannual')).toBeCloseTo(1.1835616, 5); // ₴1,18/day
    expect(dailyAccrual(1240, 'monthly')).toBeCloseTo((1240 * 12) / 365, 10);
    expect(dailyAccrual(1240, 'quarterly')).toBeCloseTo((1240 * 4) / 365, 10);
    expect(dailyAccrual(1240, 'maturity')).toBeCloseTo(1240 / 365, 10);
  });

  it('falls back to expectedPct × invested / 365 without a stated coupon', () => {
    // 16.4 % of 15 390,00 a year — the plan's pinned fallback basis.
    expect(dailyAccrual(undefined, 'semiannual', { expectedPct: 16.4, invested: 15390 })).toBeCloseTo(
      ((16.4 / 100) * 15390) / 365,
      10,
    );
    // The fallback is period-independent: it is an annual yield, not a coupon.
    expect(dailyAccrual(undefined, 'monthly', { expectedPct: 16.4, invested: 15390 })).toBeCloseTo(
      ((16.4 / 100) * 15390) / 365,
      10,
    );
  });

  it('uses the fallback when the schedule pays no coupons', () => {
    expect(dailyAccrual(1240, 'none', { expectedPct: 10, invested: 1000 })).toBeCloseTo(
      (0.1 * 1000) / 365,
      10,
    );
  });

  it('returns 0 when nothing is derivable', () => {
    expect(dailyAccrual(undefined, 'semiannual')).toBe(0);
    expect(dailyAccrual(undefined, 'semiannual', { expectedPct: 0, invested: 15390 })).toBe(0);
    expect(dailyAccrual(undefined, 'semiannual', { expectedPct: 16.4, invested: 0 })).toBe(0);
    expect(dailyAccrual(0, 'semiannual')).toBe(0);
    expect(dailyAccrual(1240, 'none')).toBe(0);
  });
});

describe('couponsInGap', () => {
  it('finds the scheduled coupon inside the gap', () => {
    expect(couponsInGap(bond(), '2026-08-20', '2026-08-27')).toBe(1240);
  });

  it('excludes the gap start and includes its end', () => {
    // A coupon ON the last-quote date is already priced into that quote.
    expect(couponsInGap(bond(), '2026-08-25', '2026-08-27')).toBe(0);
    expect(couponsInGap(bond(), '2026-08-24', '2026-08-25')).toBe(1240);
  });

  it('is 0 when no coupon date falls in the gap', () => {
    expect(couponsInGap(bond(), '2026-07-25', '2026-08-04')).toBe(0);
  });

  it('finds a gap coupon that sits BEHIND the anchor (nextCoupon already rolled)', () => {
    expect(couponsInGap(bond({ nextCoupon: '2027-02-25' }), '2026-08-20', '2026-08-27')).toBe(1240);
  });

  it('sums every coupon of a long gap', () => {
    expect(couponsInGap(bond(), '2026-01-01', '2026-09-01')).toBe(2480);
  });

  it('treats a maturity-only schedule as its single payment', () => {
    const single = bond({ payoutSchedule: 'maturity', nextCoupon: '2027-02-25' });
    expect(couponsInGap(single, '2027-02-20', '2027-02-27')).toBe(1240);
    expect(couponsInGap(single, '2026-08-20', '2026-08-27')).toBe(0);
  });

  it('is 0 without the attributes it needs', () => {
    expect(couponsInGap(bond({ couponAmount: undefined }), '2026-08-20', '2026-08-27')).toBe(0);
    expect(couponsInGap(bond({ nextCoupon: undefined }), '2026-08-20', '2026-08-27')).toBe(0);
  });
});

describe('suggestedQuote', () => {
  const daily6475 = dailyAccrual(216, 'semiannual');
  const daily8976 = dailyAccrual(1240, 'semiannual');

  it('carries the last quote forward by the daily accrual', () => {
    // The design reference's own S4 row: 4 374,12 + 2 days × 1,18 = 4 376,49
    // (daily-quotes-live.dc.html, ROW 4).
    expect(
      suggestedQuote({
        lastQuote: 4374.12,
        lastDate: '2026-07-25',
        today: '2026-07-27',
        daily: daily6475,
        couponsInGap: 0,
        maturity: '2027-05-27',
      }),
    ).toBe(4376.49);
    // …8976 nine days on from 25.07 = the strip's 15 907,45.
    expect(
      suggestedQuote({
        lastQuote: 15846.3,
        lastDate: '2026-07-25',
        today: '2026-08-03',
        daily: daily8976,
        couponsInGap: 0,
        maturity: '2027-02-25',
      }),
    ).toBe(15907.45);
  });

  it('SUBTRACTS a coupon paid inside the gap (the value drops on payment day)', () => {
    expect(
      suggestedQuote({
        lastQuote: 15846.3,
        lastDate: '2026-08-20',
        today: '2026-08-27',
        daily: daily8976,
        couponsInGap: 1240,
        maturity: '2027-02-25',
      }),
    ).toBe(14653.86);
  });

  it('clamps the accrual at maturity', () => {
    // 20.02 → 10.03 with maturity 25.02: only 5 days accrue.
    expect(
      suggestedQuote({
        lastQuote: 15900,
        lastDate: '2027-02-20',
        today: '2027-03-10',
        daily: daily8976,
        couponsInGap: 0,
        maturity: '2027-02-25',
      }),
    ).toBe(15933.97);
    // Already past maturity when the last quote was taken → nothing accrues.
    expect(
      suggestedQuote({
        lastQuote: 15900,
        lastDate: '2027-02-26',
        today: '2027-03-10',
        daily: daily8976,
        couponsInGap: 0,
        maturity: '2027-02-25',
      }),
    ).toBeNull();
  });

  it('suggests nothing without an accrual basis or a gap to carry forward', () => {
    const base = {
      lastQuote: 15846.3,
      lastDate: '2026-07-25',
      today: '2026-08-03',
      couponsInGap: 0,
    };
    expect(suggestedQuote({ ...base, daily: 0 })).toBeNull(); // no basis
    expect(suggestedQuote({ ...base, today: '2026-07-25', daily: daily8976 })).toBeNull(); // same day
    expect(suggestedQuote({ ...base, today: '2026-07-24', daily: daily8976 })).toBeNull(); // backwards
  });

  it('suggests nothing when the coupon drop would swallow the value', () => {
    expect(
      suggestedQuote({
        lastQuote: 100,
        lastDate: '2026-08-20',
        today: '2026-08-27',
        daily: daily8976,
        couponsInGap: 1240,
      }),
    ).toBeNull();
  });
});

describe('dueCoupons', () => {
  it('offers a coupon whose date has arrived', () => {
    expect(dueCoupons([bond()], [], '2026-08-25')).toEqual([
      { assetId: 'ovdp8976', date: '2026-08-25', overdueDays: 0, amount: 1240 },
    ]);
    expect(dueCoupons([bond()], [], '2026-09-04')).toEqual([
      { assetId: 'ovdp8976', date: '2026-08-25', overdueDays: 10, amount: 1240 },
    ]);
  });

  it('offers nothing before the date', () => {
    expect(dueCoupons([bond()], [], '2026-08-24')).toEqual([]);
  });

  it('dedupes against a manually recorded interest_payout in the window', () => {
    // Recorded on the day, and two days late — both are THIS coupon.
    expect(dueCoupons([bond()], [tx()], '2026-09-04')).toEqual([]);
    expect(dueCoupons([bond()], [tx({ date: '2026-08-27' })], '2026-09-04')).toEqual([]);
    expect(dueCoupons([bond()], [tx({ date: '2026-08-18' })], '2026-09-04')).toEqual([]);
  });

  it('still offers when the recorded payout is outside the window', () => {
    // The February coupon of the same bond must not silence the August one.
    expect(dueCoupons([bond()], [tx({ date: '2026-02-25' })], '2026-09-04')).toHaveLength(1);
    expect(dueCoupons([bond()], [tx({ date: '2026-08-17' })], '2026-09-04')).toHaveLength(1);
    expect(COUPON_MATCH_WINDOW_DAYS).toBe(7);
  });

  it('ignores payouts of other assets and other types', () => {
    expect(dueCoupons([bond()], [tx({ assetId: 'ovdp6475' })], '2026-09-04')).toHaveLength(1);
    expect(dueCoupons([bond()], [tx({ type: 'dividend_accrual' })], '2026-09-04')).toHaveLength(1);
  });

  it('takes a custom match window', () => {
    expect(dueCoupons([bond()], [tx({ date: '2026-09-01' })], '2026-09-04', 30)).toEqual([]);
  });

  it('skips assets that are not fixed-coupon and assets with no next coupon', () => {
    expect(dueCoupons([bond({ yieldType: 'dividends' })], [], '2026-09-04')).toEqual([]);
    expect(dueCoupons([bond({ nextCoupon: undefined })], [], '2026-09-04')).toEqual([]);
  });

  it('reports the stated amount as undefined when the asset has none', () => {
    expect(dueCoupons([bond({ couponAmount: undefined })], [], '2026-08-25')[0].amount).toBeUndefined();
  });

  it('sorts by date, oldest first', () => {
    const other = bond({ id: 'ovdp6475', nextCoupon: '2026-07-25', couponAmount: 216 });
    expect(dueCoupons([bond(), other], [], '2026-09-04').map((d) => d.assetId)).toEqual([
      'ovdp6475',
      'ovdp8976',
    ]);
  });
});

describe('rollNextCoupon', () => {
  it('advances by the payout schedule', () => {
    expect(rollNextCoupon(bond())).toEqual({ kind: 'rolled', nextCoupon: '2027-02-25' });
    expect(rollNextCoupon(bond({ payoutSchedule: 'monthly' }))).toEqual({
      kind: 'rolled',
      nextCoupon: '2026-09-25',
    });
    expect(rollNextCoupon(bond({ payoutSchedule: 'quarterly' }))).toEqual({
      kind: 'rolled',
      nextCoupon: '2026-11-25',
    });
  });

  it('clamps a roll that would overshoot maturity onto the maturity date', () => {
    expect(rollNextCoupon(bond({ nextCoupon: '2026-11-25' }))).toEqual({
      kind: 'rolled',
      nextCoupon: '2027-02-25',
    });
  });

  it('flags maturity instead of moving past it', () => {
    expect(rollNextCoupon(bond({ nextCoupon: '2027-02-25' }))).toEqual({ kind: 'matured' });
    expect(rollNextCoupon(bond({ nextCoupon: '2027-03-25' }))).toEqual({ kind: 'matured' });
  });

  it('rolls a maturity-only schedule to its single payment, then flags', () => {
    expect(rollNextCoupon(bond({ payoutSchedule: 'maturity', nextCoupon: '2026-08-25' }))).toEqual({
      kind: 'rolled',
      nextCoupon: '2027-02-25',
    });
    expect(
      rollNextCoupon(bond({ payoutSchedule: 'maturity', nextCoupon: '2027-02-25' })),
    ).toEqual({ kind: 'matured' });
    expect(
      rollNextCoupon(bond({ payoutSchedule: 'maturity', nextCoupon: '2026-08-25', maturity: undefined })),
    ).toEqual({ kind: 'matured' });
  });

  it('keeps rolling a bond with no maturity date on record', () => {
    expect(rollNextCoupon(bond({ maturity: undefined }))).toEqual({
      kind: 'rolled',
      nextCoupon: '2027-02-25',
    });
  });

  it('has nothing to roll without a next coupon', () => {
    expect(rollNextCoupon(bond({ nextCoupon: undefined }))).toBeUndefined();
  });
});

describe('couponProjection', () => {
  it('uses the stated attributes when the asset carries them (the seed case)', () => {
    expect(couponProjection(bond(), 15390)).toEqual({
      amount: 1240,
      date: '2026-08-25',
      estimated: false,
    });
    // Invested capital is irrelevant to a stated coupon.
    expect(couponProjection(bond(), 0)?.amount).toBe(1240);
  });

  it('estimates the amount from expectedPct × invested when no coupon is stated', () => {
    const user = bond({ couponAmount: undefined });
    // 16.4 % of 15 390,00, half-yearly = 1 261,98 — close to the real 1 240,00.
    expect(couponProjection(user, 15390)).toEqual({
      amount: 1261.98,
      date: '2026-08-25',
      estimated: true,
    });
    expect(couponProjection(bond({ couponAmount: undefined, payoutSchedule: 'monthly' }), 15390)).toEqual(
      { amount: 210.33, date: '2026-08-25', estimated: true },
    );
  });

  it('falls back to the maturity date when no next coupon is stated', () => {
    expect(couponProjection(bond({ nextCoupon: undefined }), 15390)).toEqual({
      amount: 1240,
      date: '2027-02-25',
      estimated: false,
    });
  });

  it('never invents a date or an amount', () => {
    expect(couponProjection(bond({ nextCoupon: undefined, maturity: undefined }), 15390)).toBeUndefined();
    expect(couponProjection(bond({ couponAmount: undefined }), 0)).toBeUndefined();
    expect(couponProjection(bond({ couponAmount: undefined, expectedPct: 0 }), 15390)).toBeUndefined();
    expect(
      couponProjection(bond({ couponAmount: undefined, payoutSchedule: 'none' }), 15390),
    ).toBeUndefined();
    expect(couponProjection(bond({ yieldType: 'div_cap' }), 15390)).toBeUndefined();
  });
});

describe('couponReminderId', () => {
  it('is the derived id both the S5 skip and the S6 reminders use', () => {
    expect(couponReminderId('ovdp8976', '2026-08-25')).toBe('coupon:ovdp8976:2026-08-25');
  });
});
