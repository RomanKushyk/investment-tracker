import { describe, expect, it } from 'vitest';

import {
  COUPON_MATCH_WINDOW_DAYS,
  couponProjection,
  couponReminderId,
  couponsInGap,
  couponPeriodDays,
  couponPerPayment,
  dailyAccrual,
  OVDP_FACE_UAH,
  dueCoupons,
  nextUnsettledCoupon,
  nextUnsettledCouponDate,
  owedCouponDate,
  rollNextCoupon,
  rollbackNextCoupon,
  suggestedQuote,
  scheduledCouponMonths,
  unitsOnRecordDate,
} from './accrual';
import { addDays, addMonths, dayBefore, daysBetween } from './dates';
import { holdsNone, unitsByAsset } from './derive';
import fixture0923 from './inzhur/__fixtures__/assets-2026-09-23.json';
import fixture0924 from './inzhur/__fixtures__/assets-2026-09-24.json';
import fixtureSample from './inzhur/__fixtures__/assets-sample.json';
import { parseAssetsFeed } from './inzhur/parse';
import { OVDP_COUPON_PERIOD_DAYS } from './ovdp';
import { couponOverdueReminderId, maturityReminderId } from './reminders';
import type { Asset, Transaction } from './types';

// The demo seed's two bonds (seed.ts) are the fixture basis: …8976 pays
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
    ...over,
  };
}

describe('dailyAccrual', () => {
  it('spreads the stated coupon over its period (ACT/365)', () => {
    expect(dailyAccrual(1240, 'semiannual')).toBeCloseTo((1240 * 2) / 365, 10);
    expect(dailyAccrual(216, 'semiannual')).toBeCloseTo(1.1835616, 5);
    expect(dailyAccrual(1240, 'monthly')).toBeCloseTo((1240 * 12) / 365, 10);
    expect(dailyAccrual(1240, 'quarterly')).toBeCloseTo((1240 * 4) / 365, 10);
    expect(dailyAccrual(1240, 'maturity')).toBeCloseTo(1240 / 365, 10);
  });

  it('falls back to expectedPct × invested / 365 without a stated coupon', () => {
    expect(
      dailyAccrual(undefined, 'semiannual', { expectedPct: 16.4, invested: 15390 }),
    ).toBeCloseTo(((16.4 / 100) * 15390) / 365, 10);
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
  it('hands the GRID branch each computed date, not the anchor', () => {
    // A regression that passed `anchor` — or `fromExclusive` — to the resolver would
    // return the same constant every other grid test asserts and sail through the
    // suite. Only a resolver that VARIES by date can catch it.
    const b = bond({ nextCoupon: '2026-08-25', payoutSchedule: 'quarterly' });
    const seen: string[] = [];
    couponsInGap(
      b,
      (d) => {
        seen.push(d);
        return 100;
      },
      '2026-01-01',
      '2026-08-31',
      [],
    );
    // ONLY the counted dates reach the resolver — it makes no probe of its own.
    expect(seen).toEqual(['2026-02-25', '2026-05-25', '2026-08-25']);
  });

  it('sizes EACH coupon on its own date, not all of them on the drafted one', () => {
    const b = bond({ nextCoupon: '2026-08-25', payoutSchedule: 'semiannual' });
    const schedule = ['2026-02-25', '2026-08-25'];
    const perDate = (d: string) => (d === '2026-02-25' ? 784 : 1568);
    expect(couponsInGap(b, perDate, '2026-01-01', '2026-12-31', [], schedule)).toBe(784 + 1568);
    // A single figure for every date is the answer the old signature could not avoid.
    expect(couponsInGap(b, () => 1568, '2026-01-01', '2026-12-31', [], schedule)).toBe(3136);
    // A date the ledger cannot count contributes nothing rather than NaN. Nothing
    // short-circuits ahead of the reduce any more, so this exercises the `?? 0` itself.
    expect(couponsInGap(b, () => undefined, '2026-01-01', '2026-12-31', [], schedule)).toBe(0);
    // THE ORDINARY MIXED CASE, uncovered while a guard swallowed it: a bond bought
    // after the February coupon answers for August and not February, so exactly one is subtracted.
    expect(
      couponsInGap(
        b,
        (d) => (d === '2026-02-25' ? undefined : 1568),
        '2026-01-01',
        '2026-12-31',
        [],
        schedule,
      ),
    ).toBe(1568);
  });

  it('finds the scheduled coupon inside the gap', () => {
    expect(couponsInGap(bond(), () => 1240, '2026-08-20', '2026-08-27', [])).toBe(1240);
  });

  it('excludes the gap start and includes its end', () => {
    // A coupon ON the last-quote date is already priced into that quote.
    expect(couponsInGap(bond(), () => 1240, '2026-08-25', '2026-08-27', [])).toBe(0);
    expect(couponsInGap(bond(), () => 1240, '2026-08-24', '2026-08-25', [])).toBe(1240);
  });

  it('is 0 when no coupon date falls in the gap', () => {
    expect(couponsInGap(bond(), () => 1240, '2026-07-25', '2026-08-04', [])).toBe(0);
  });

  it('finds a gap coupon that sits BEHIND the anchor (nextCoupon already rolled)', () => {
    expect(
      couponsInGap(bond({ nextCoupon: '2027-02-25' }), () => 1240, '2026-08-20', '2026-08-27', []),
    ).toBe(1240);
  });

  it('sums every coupon of a long gap', () => {
    expect(couponsInGap(bond(), () => 1240, '2026-01-01', '2026-09-01', [])).toBe(2480);
  });

  it('treats a maturity-only schedule as its single payment', () => {
    const single = bond({ payoutSchedule: 'maturity', nextCoupon: '2027-02-25' });
    expect(couponsInGap(single, () => 1240, '2027-02-20', '2027-02-27', [])).toBe(1240);
    expect(couponsInGap(single, () => 1240, '2026-08-20', '2026-08-27', [])).toBe(0);
  });

  it('is 0 without the attributes it needs', () => {
    expect(
      couponsInGap(
        bond({ couponAmount: undefined }),
        () => undefined,
        '2026-08-20',
        '2026-08-27',
        [],
      ),
    ).toBe(0);
    expect(
      couponsInGap(bond({ nextCoupon: undefined }), () => 1240, '2026-08-20', '2026-08-27', []),
    ).toBe(0);
  });

  // Stepping BACK with addMonths and forward again is not an inverse once the
  // month-end clamp fires, so the grid drifted onto dates the asset never pays on
  // and counted a phantom coupon.
  describe('a month-end anchor stays on the asset own grid (clamp regression)', () => {
    const eom = (over: Partial<Asset> = {}) => bond({ nextCoupon: '2026-08-31', ...over });

    it('counts the real monthly dates, not the drifted ones', () => {
      expect(
        couponsInGap(
          eom({ payoutSchedule: 'monthly' }),
          () => 1240,
          '2026-06-15',
          '2026-08-30',
          [],
        ),
      ).toBe(2 * 1240);
    });

    it('counts the real quarterly date', () => {
      expect(
        couponsInGap(
          eom({ payoutSchedule: 'quarterly' }),
          () => 1240,
          '2026-04-01',
          '2026-08-30',
          [],
        ),
      ).toBe(1240);
    });

    it('counts the real semiannual date', () => {
      expect(couponsInGap(eom(), () => 1240, '2025-12-01', '2026-08-30', [])).toBe(1240);
    });

    it('keeps the anchor itself on the grid it reconstructs', () => {
      expect(
        couponsInGap(
          eom({ payoutSchedule: 'monthly' }),
          () => 1240,
          '2026-08-30',
          '2026-08-31',
          [],
        ),
      ).toBe(1240);
    });
  });
});

describe('suggestedQuote', () => {
  const daily6475 = dailyAccrual(216, 'semiannual');
  const daily8976 = dailyAccrual(1240, 'semiannual');

  it('carries the last quote forward by the daily accrual', () => {
    // Both expected figures are the design reference's own
    // (design/extensions/daily-quotes-live.dc.html).
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
    expect(
      dueCoupons([bond()], [tx({ date: '2026-09-01' })], '2026-09-04', { windowDays: 30 }),
    ).toEqual([]);
  });

  // `nextCoupon` only ever moves through the S5 confirm, so a coupon recorded in the
  // Transaction panel used to freeze the pointer AND silence the card for good.
  it('advances to the next occurrence when the pointer sits on a settled one', () => {
    const recorded = [tx()]; // the 25.08 coupon, entered by hand
    expect(dueCoupons([bond()], recorded, '2026-09-04')).toEqual([]);
    expect(dueCoupons([bond()], recorded, '2027-02-25')).toEqual([
      { assetId: 'ovdp8976', date: '2027-02-25', overdueDays: 0, amount: 1240 },
    ]);
  });

  it('advances past an occurrence the user SKIPPED (brief S5 "skipped" row)', () => {
    const skipped = { dismissed: [couponReminderId('ovdp8976', '2026-08-25')] };
    expect(dueCoupons([bond()], [], '2026-09-04', skipped)).toEqual([]);
    expect(dueCoupons([bond()], [], '2027-02-25', skipped)).toEqual([
      { assetId: 'ovdp8976', date: '2027-02-25', overdueDays: 0, amount: 1240 },
    ]);
  });

  it('stops at maturity — a bond whose last coupon is settled offers nothing', () => {
    const both = [tx(), tx({ id: 't2', date: '2027-02-25' })];
    expect(dueCoupons([bond()], both, '2027-06-01')).toEqual([]);
  });

  it('skips assets that are not fixed-coupon and assets with no next coupon', () => {
    expect(dueCoupons([bond({ yieldType: 'dividends' })], [], '2026-09-04')).toEqual([]);
    expect(dueCoupons([bond({ nextCoupon: undefined })], [], '2026-09-04')).toEqual([]);
  });

  it('reports the stated amount as undefined when the asset has none', () => {
    expect(
      dueCoupons([bond({ couponAmount: undefined })], [], '2026-08-25')[0].amount,
    ).toBeUndefined();
  });

  it('sorts by date, oldest first', () => {
    const other = bond({ id: 'ovdp6475', nextCoupon: '2026-07-25', couponAmount: 216 });
    expect(dueCoupons([bond(), other], [], '2026-09-04').map((d) => d.assetId)).toEqual([
      'ovdp6475',
      'ovdp8976',
    ]);
  });
});

describe('nextUnsettledCoupon', () => {
  it('is the pointer itself while that occurrence is open', () => {
    expect(nextUnsettledCoupon(bond(), [])).toEqual({ date: '2026-08-25', amount: 1240 });
  });

  it('steps over recorded and skipped occurrences, one by one', () => {
    expect(nextUnsettledCoupon(bond(), [tx()])).toEqual({ date: '2027-02-25', amount: 1240 });
    expect(
      nextUnsettledCoupon(bond(), [], { dismissed: [couponReminderId('ovdp8976', '2026-08-25')] }),
    ).toEqual({ date: '2027-02-25', amount: 1240 });
    // Both settled → the grid ends on the maturity coupon, so nothing is open.
    expect(
      nextUnsettledCoupon(bond(), [tx()], {
        dismissed: [couponReminderId('ovdp8976', '2027-02-25')],
      }),
    ).toBeUndefined();
  });

  it('walks a long catch-up without inventing dates past maturity', () => {
    const monthly = bond({ payoutSchedule: 'monthly', nextCoupon: '2026-08-25' });
    expect(nextUnsettledCoupon(monthly, [tx(), tx({ id: 't2', date: '2026-09-25' })])).toEqual({
      date: '2026-10-25',
      amount: 1240,
    });
  });

  it('has nothing to walk without a schedule pointer or the right yield type', () => {
    expect(nextUnsettledCoupon(bond({ nextCoupon: undefined }), [])).toBeUndefined();
    expect(nextUnsettledCoupon(bond({ nextCoupon: '' }), [])).toBeUndefined();
    expect(nextUnsettledCoupon(bond({ yieldType: 'dividends' }), [])).toBeUndefined();
  });

  it('passes an occurrence dated before the day it is asked from, and keeps one on it', () => {
    expect(owedCouponDate(bond(), [], '2026-08-26')).toBe('2027-02-25');
    expect(owedCouponDate(bond(), [], '2026-08-25')).toBe('2026-08-25');
  });
});

// A Skip settles what a payout on its date settles: every occurrence within the dedupe window.
describe('a Skip of a stored date inside the window before the maturity settles the maturity', () => {
  const buy = tx({ id: 'b0', date: '2027-01-10', type: 'buy', amount: 15000, quantity: 15 });
  const skip = (date: string) => ({ dismissed: [couponReminderId('ovdp8976', date)] });

  it('offers nothing after the Skip, as after a payout on the same date', () => {
    const a = bond({ nextCoupon: '2027-02-25', maturity: '2027-03-02' });
    expect(nextUnsettledCouponDate(a, [buy, tx({ date: '2027-02-25' })])).toBeUndefined();
    expect(nextUnsettledCouponDate(a, [buy], skip('2027-02-25'))).toBeUndefined();
    const b = bond({ nextCoupon: '2027-02-20', maturity: '2027-02-25' });
    expect(nextUnsettledCouponDate(b, [buy, tx({ date: '2027-02-20' })])).toBeUndefined();
    expect(nextUnsettledCouponDate(b, [buy], skip('2027-02-20'))).toBeUndefined();
  });

  it('leaves the maturity owed a day past the window, as a payout does', () => {
    const a = bond({ nextCoupon: '2027-02-17', maturity: '2027-02-25' });
    expect(nextUnsettledCouponDate(a, [buy, tx({ date: '2027-02-17' })])).toBe('2027-02-25');
    expect(nextUnsettledCouponDate(a, [buy], skip('2027-02-17'))).toBe('2027-02-25');
  });

  it('settles by a coupon id of the same asset only', () => {
    const a = bond({ nextCoupon: '2027-02-25', maturity: '2027-03-02' });
    const dismissed = [
      couponReminderId('ovdp6475', '2027-02-25'),
      couponReminderId('ovdp8976x', '2027-02-25'),
      couponOverdueReminderId('ovdp8976', '2027-02-25'),
      maturityReminderId('ovdp8976', '2027-03-02'),
    ];
    expect(nextUnsettledCouponDate(a, [buy], { dismissed })).toBe('2027-02-25');
  });
});

// The record date: the NBU depository pays whoever holds the bond at the end of the day before.
describe('the walk passes an occurrence the ledger held none of on its record date', () => {
  const buy = tx({ id: 'b3', date: '2026-02-05', type: 'buy', amount: 15390, quantity: 15 });
  const sale = (date: string) => tx({ id: 's2', date, type: 'sell', amount: 15800, quantity: 15 });
  const buyBack = tx({ id: 'b9', date: '2026-09-01', type: 'buy', amount: 5300, quantity: 5 });

  it('offers no card for a bond sold before its record date, or on it', () => {
    expect(dueCoupons([bond()], [buy, sale('2026-07-01')], '2026-10-02')).toEqual([]);
    expect(dueCoupons([bond()], [buy, sale('2026-08-24')], '2026-10-02')).toEqual([]);
  });

  it('still offers the coupon to a bond sold on its payment day', () => {
    expect(dueCoupons([bond()], [buy, sale('2026-08-25')], '2026-10-02')).toEqual([
      { assetId: 'ovdp8976', date: '2026-08-25', overdueDays: 38, amount: 1240 },
    ]);
  });

  it('walks on to the occurrence owed to units bought back', () => {
    expect(nextUnsettledCouponDate(bond(), [buy, sale('2026-07-01')])).toBeUndefined();
    expect(nextUnsettledCouponDate(bond(), [buy, sale('2026-07-01'), buyBack])).toBe('2027-02-25');
    // Bought back on the payment day itself: not that coupon, but the next one.
    const onTheDay = { ...buyBack, date: '2026-08-25' };
    expect(nextUnsettledCouponDate(bond(), [buy, sale('2026-07-01'), onTheDay])).toBe('2027-02-25');
  });

  it('dates the projection at the occurrence owed, not at the stored pointer', () => {
    const rows = [buy, sale('2026-07-01'), buyBack];
    expect(couponProjection(bond(), 15390, 5, rows)?.date).toBe('2027-02-25');
  });

  it('expects a later month only on units held on its record date', () => {
    // Held through 25.08, sold out on 01.09, 5 bought back on 01.03.2027: 25.02.2027 is not owed.
    const longer = bond({ maturity: '2027-08-25' });
    const rows = [
      buy,
      sale('2026-09-01'),
      tx({ id: 'b9', date: '2027-03-01', type: 'buy', amount: 5300, quantity: 5 }),
    ];
    expect(scheduledCouponMonths(longer, rows)).toEqual([8]);
  });

  it("drops a passed occurrence's month from the schedule", () => {
    expect(scheduledCouponMonths(bond(), [buy, sale('2026-07-01'), buyBack])).toEqual([2]);
    expect(scheduledCouponMonths(bond(), [buy, sale('2026-07-01')])).toEqual([]);
  });

  it('stops at the first occurrence a sold-out bond is not owed once no later row can change it', () => {
    // No maturity ends this walk, so without the stop it runs its whole step budget, reading the
    // sale's date at every step.
    let reads = 0;
    const counted = Object.defineProperty({ ...sale('2026-07-01') }, 'date', {
      enumerable: true,
      get: () => {
        reads += 1;
        return '2026-07-01';
      },
    });
    // A payout far ahead moves no units, so it does not hold the stop off.
    const far = tx({ id: 'p9', date: '2099-01-01' });
    expect(
      nextUnsettledCouponDate(bond({ maturity: undefined }), [buy, counted, far]),
    ).toBeUndefined();
    expect(reads).toBeLessThan(10);
  });

  it('expects a maturity-only payment only on units held on its record date', () => {
    const maturityOnly = bond({ nextCoupon: undefined, maturity: '2026-12-10' });
    const backOn = (date: string) => tx({ id: 'b9', date, type: 'buy', amount: 3000, quantity: 3 });
    const rows = (back: string) => [buy, sale('2026-07-01'), backOn(back)];
    expect(scheduledCouponMonths(maturityOnly, rows('2026-12-10'))).toEqual([]);
    expect(scheduledCouponMonths(maturityOnly, rows('2026-12-01'))).toEqual([12]);
    expect(couponProjection(maturityOnly, 3000, 3, rows('2026-12-10'))).toBeUndefined();
    expect(couponProjection(maturityOnly, 3000, 3, rows('2026-12-01'))?.date).toBe('2026-12-10');
  });

  it('judges a maturity-only payment as the walk judges a coupon', () => {
    const maturityOnly = bond({ nextCoupon: undefined, maturity: '2026-12-10' });
    expect(owedCouponDate(maturityOnly, [buy])).toBe('2026-12-10');
    // Recorded two days early, as a coupon recorded ahead is passed.
    expect(
      owedCouponDate(maturityOnly, [buy, tx({ id: 'p9', date: '2026-12-08' })]),
    ).toBeUndefined();
    const unreadable = bond({ nextCoupon: undefined, maturity: '2026-13-01' });
    expect(owedCouponDate(unreadable, [buy])).toBeUndefined();
  });

  it('reads no occurrence off a date no calendar has, and throws on none', () => {
    // A backup can carry `2026-13-01`, which has no day before it. As a string it sorts before
    // 2027-01-05, so a card would be offered for it.
    const unreadable = bond({ nextCoupon: '2026-13-01' });
    expect(nextUnsettledCouponDate(unreadable, [buy, sale('2026-07-01')])).toBeUndefined();
    expect(dueCoupons([unreadable], [buy], '2027-01-05')).toEqual([]);
    const finalOnly = bond({ nextCoupon: undefined, maturity: '2026-13-01' });
    expect(() => scheduledCouponMonths(finalOnly, [buy])).not.toThrow();
    // Reached by stepping: the roll clamps 25.02.2027 onto it once 25.08 is recorded.
    const steppedOnto = bond({ maturity: '2026-13-01' });
    expect(nextUnsettledCouponDate(steppedOnto, [buy, tx({ id: 'p1' })])).toBeUndefined();
  });

  it('still owes where the ledger cannot count the units', () => {
    const uncounted = [{ ...buy, quantity: undefined }, sale('2026-07-01')];
    expect(dueCoupons([bond()], uncounted, '2026-10-02')).toEqual([
      { assetId: 'ovdp8976', date: '2026-08-25', overdueDays: 38, amount: 1240 },
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
    expect(rollNextCoupon(bond({ payoutSchedule: 'maturity', nextCoupon: '2027-02-25' }))).toEqual({
      kind: 'matured',
    });
    expect(
      rollNextCoupon(
        bond({ payoutSchedule: 'maturity', nextCoupon: '2026-08-25', maturity: undefined }),
      ),
    ).toEqual({ kind: 'matured' });
  });

  it('keeps rolling a bond with no maturity date on record', () => {
    expect(rollNextCoupon(bond({ maturity: undefined }))).toEqual({
      kind: 'rolled',
      nextCoupon: '2027-02-23',
    });
  });

  it('has nothing to roll without a next coupon', () => {
    expect(rollNextCoupon(bond({ nextCoupon: undefined }))).toBeUndefined();
  });

  it('rolls off an explicit occurrence date when the pointer lags behind it', () => {
    // The card offers one occurrence while the stored pointer still sits on a settled one.
    expect(rollNextCoupon(bond(), '2026-02-25')).toEqual({
      kind: 'rolled',
      nextCoupon: '2026-08-26',
    });
    expect(rollNextCoupon(bond(), '2027-02-25')).toEqual({ kind: 'matured' });
    expect(rollNextCoupon(bond({ nextCoupon: undefined }), '2026-08-25')).toEqual({
      kind: 'rolled',
      nextCoupon: '2027-02-25',
    });
  });
});

describe('couponProjection', () => {
  it('uses the stated attributes when the asset carries them (the seed case)', () => {
    expect(couponProjection(bond(), 15390, undefined, [])).toEqual({
      amount: 1240,
      date: '2026-08-25',
      estimated: false,
    });
    // Invested capital is irrelevant to a stated coupon.
    expect(couponProjection(bond(), 0, undefined, [])?.amount).toBe(1240);
  });

  it('estimates the amount from expectedPct × invested when no coupon is stated', () => {
    const user = bond({ couponAmount: undefined });
    expect(couponProjection(user, 15390, undefined, [])).toEqual({
      amount: 1261.98,
      date: '2026-08-25',
      estimated: true,
    });
    expect(
      couponProjection(
        bond({ couponAmount: undefined, payoutSchedule: 'monthly' }),
        15390,
        undefined,
        [],
      ),
    ).toEqual({ amount: 210.33, date: '2026-08-25', estimated: true });
  });

  it('falls back to the maturity date when no next coupon is stated', () => {
    expect(couponProjection(bond({ nextCoupon: undefined }), 15390, undefined, [])).toEqual({
      amount: 1240,
      date: '2027-02-25',
      estimated: false,
    });
    // A legacy row can store an empty pointer, which names no coupon date either.
    expect(couponProjection(bond({ nextCoupon: '' }), 15390, undefined, [])?.date).toBe(
      '2027-02-25',
    );
  });

  it('never invents a date or an amount', () => {
    expect(
      couponProjection(bond({ nextCoupon: undefined, maturity: undefined }), 15390, undefined, []),
    ).toBeUndefined();
    expect(couponProjection(bond({ couponAmount: undefined }), 0, undefined, [])).toBeUndefined();
    expect(
      couponProjection(bond({ couponAmount: undefined, expectedPct: 0 }), 15390, undefined, []),
    ).toBeUndefined();
    expect(
      couponProjection(
        bond({ couponAmount: undefined, payoutSchedule: 'none' }),
        15390,
        undefined,
        [],
      ),
    ).toBeUndefined();
    expect(couponProjection(bond({ yieldType: 'div_cap' }), 15390, undefined, [])).toBeUndefined();
  });

  it('projects nothing for a bond sold out of a fractional holding', () => {
    // 15 + 1.1486 − 16.1486 in binary floating point is not 0.
    const txs = [
      tx({ id: 'b', date: '2026-02-05', type: 'buy', amount: 15390, quantity: 15 }),
      tx({ id: 'r', date: '2026-02-25', type: 'reinvest', amount: 1183.5, quantity: 1.1486 }),
      tx({ id: 's', date: '2026-07-01', type: 'sell', amount: 16900, quantity: 16.1486 }),
    ];
    expect(couponProjection(bond(), 15390, unitsByAsset(txs).ovdp8976, txs)).toBeUndefined();
  });
});

describe('couponReminderId', () => {
  it('is the derived id both the S5 skip and the S6 reminders use', () => {
    expect(couponReminderId('ovdp8976', '2026-08-25')).toBe('coupon:ovdp8976:2026-08-25');
  });
});

describe('dailyAccrual over a real coupon period', () => {
  // UA4000238976 as the live feed publishes it: 78.40 per unit every 182 days,
  // always a Wednesday, never "six calendar months".
  const schedule = ['2026-03-25', '2026-09-23', '2027-03-24'];

  it('lands exactly on the coupon when the period is known', () => {
    const days = couponPeriodDays(schedule, '2026-05-01');
    expect(days).toBe(182);
    expect(dailyAccrual(78.4, 'semiannual', undefined, days) * days!).toBeCloseTo(78.4, 10);
  });

  it('the annualised approximation does NOT land on the coupon', () => {
    // The defect `periodDays` exists to fix: an annualised rate misses the coupon
    // in both directions, short over a 182-day period and over on a 184-day one.
    expect(dailyAccrual(1240, 'semiannual') * 182).toBeCloseTo(1236.6, 1);
    expect(dailyAccrual(1240, 'semiannual') * 184).toBeCloseTo(1250.19, 1);
    expect(dailyAccrual(1240, 'semiannual', undefined, 182) * 182).toBeCloseTo(1240, 10);
  });

  it('keeps the approximation when no period can be derived', () => {
    expect(dailyAccrual(1240, 'semiannual', undefined, undefined)).toBeCloseTo(
      (1240 * 2) / 365,
      10,
    );
    expect(couponPeriodDays(['2026-03-25'], '2026-05-01')).toBeUndefined();
    expect(couponPeriodDays(schedule, '2030-01-01')).toBeUndefined();
  });

  it('brackets on the payment date itself, not the day after', () => {
    expect(couponPeriodDays(schedule, '2026-09-23')).toBe(182);
    expect(couponPeriodDays(schedule, '2026-09-24')).toBe(182);
  });
});

describe('the published schedule beats the grid', () => {
  // The feed's published dates, against the grid this bond carries —
  // `nextCoupon` on the 25th where the feed pays on the 23rd.
  const REAL = ['2026-03-24', '2026-09-23', '2027-03-24'];
  const linked = () =>
    bond({ nextCoupon: '2026-09-25', couponAmount: 1240, maturity: '2027-03-24' });

  it('counts the coupon on the real date, not the grid date', () => {
    const a = linked();
    // A gap that contains the REAL date but ends before the grid’s 25th.
    expect(couponsInGap(a, () => 1240, '2026-09-20', '2026-09-24', [], REAL)).toBe(1240);
    // Without the schedule the same gap sees nothing — the defect, pinned.
    expect(couponsInGap(a, () => 1240, '2026-09-20', '2026-09-24', [])).toBe(0);
  });

  it('does not count it twice when the gap spans both dates', () => {
    expect(couponsInGap(linked(), () => 1240, '2026-09-01', '2026-09-30', [], REAL)).toBe(1240);
  });

  it('counts the maturity date once, though the schedule lists it twice', () => {
    // The final row is coupon AND principal on one date; only one is a coupon.
    const withDuplicate = [...REAL, '2027-03-24'];
    expect(couponsInGap(linked(), () => 1240, '2027-03-01', '2027-03-31', [], withDuplicate)).toBe(
      1240,
    );
  });

  it('rolls to the published date', () => {
    expect(rollNextCoupon(linked(), '2026-03-24', REAL)).toEqual({
      kind: 'rolled',
      nextCoupon: '2026-09-23',
    });
    // Without the schedule the same call steps 182 days, a day short of the published date.
    expect(rollNextCoupon(linked(), '2026-03-24')).toEqual({
      kind: 'rolled',
      nextCoupon: '2026-09-22',
    });
  });

  it('still clamps at maturity with a schedule', () => {
    expect(rollNextCoupon(linked(), '2027-03-24', REAL)).toEqual({ kind: 'matured' });
  });

  it('falls back to the grid for an asset with no linked schedule', () => {
    // The non-regression that protects every existing seed-coupled test.
    expect(couponsInGap(linked(), () => 1240, '2026-09-20', '2026-09-26', [], undefined)).toBe(
      1240,
    );
    expect(rollNextCoupon(linked(), '2026-03-25', undefined)).toEqual({
      kind: 'rolled',
      nextCoupon: '2026-09-23',
    });
  });
});

describe('the gap counts the occurrences the walk steps through', () => {
  const buy = (date: string) => tx({ id: 'b0', date, type: 'buy', amount: 15000, quantity: 15 });
  // The provider drops a bond's older payments: the dates served start a period after the coupon owed.
  const DATES = ['2026-10-14', '2027-04-14'];

  it('bridges to the first date served, so the coupon before it counts', () => {
    const a = bond({ nextCoupon: '2025-10-15', maturity: '2027-04-14' });
    expect(couponsInGap(a, () => 1240, '2026-04-01', '2026-04-30', [], DATES)).toBe(1240);
    expect(couponsInGap(a, () => 1240, '2026-04-01', '2026-04-30', [])).toBe(1240);
  });

  it('steps the period back before the first date served, from a stored date on it', () => {
    const a = bond({ nextCoupon: '2026-10-14', maturity: '2027-04-14' });
    expect(couponsInGap(a, () => 1240, '2026-03-01', '2026-05-31', [], DATES)).toBe(1240);
  });

  // UA4000235782's published dates (`assets-2026-09-24.json`): a 181-day period reaches 01.12.2027,
  // which a confirm without the feed stores as 02.12.
  const DATES_5782 = [
    '2025-12-03',
    '2026-06-03',
    '2026-12-02',
    '2027-06-03',
    '2027-12-01',
    '2028-05-31',
    '2028-11-29',
  ];

  it('counts a published date the step misses once, on its published day', () => {
    for (const nextCoupon of ['2027-12-01', '2027-12-02']) {
      const a = bond({ nextCoupon, maturity: '2028-11-29' });
      expect(couponsInGap(a, () => 1240, '2027-11-01', '2027-12-31', [], DATES_5782)).toBe(1240);
    }
  });

  it('counts a published date behind the start on its published day', () => {
    // 182 days back from 01.12.2027 is 02.06, a day short of the published 03.06.
    const a = bond({ nextCoupon: '2027-12-01', maturity: '2028-11-29' });
    expect(couponsInGap(a, () => 1240, '2027-06-02', '2027-06-03', [], DATES_5782)).toBe(1240);
    expect(couponsInGap(a, () => 1240, '2027-06-01', '2027-06-02', [], DATES_5782)).toBe(0);
  });

  it('counts one final coupon where the maturity is a day past the last published date', () => {
    // The roll lands on the maturity off 29.11.2028, inside the window of the payout that settles both.
    for (const nextCoupon of ['2028-11-29', '2028-11-30']) {
      const a = bond({ nextCoupon, maturity: '2028-11-30' });
      expect(couponsInGap(a, () => 1240, '2028-11-20', '2028-12-10', [], DATES_5782)).toBe(1240);
    }
  });

  it('steps back from a start more than half a period past the last published date', () => {
    // The roll went 14.04.2027, 13.10.2027, 12.04.2028; the 13.10 step is behind the start.
    const a = bond({ nextCoupon: '2028-04-12', maturity: undefined });
    const dates = ['2026-04-14', '2026-10-14', '2027-04-14'];
    expect(couponsInGap(a, () => 1240, '2027-05-01', '2028-04-30', [], dates)).toBe(2 * 1240);
    expect(couponsInGap(a, () => 1240, '2027-05-01', '2028-04-30', [])).toBe(2 * 1240);
  });

  describe('where no walk starts, the published dates stand', () => {
    const dates = ['2026-08-25', '2027-02-25'];

    it('off a stored date no calendar has', () => {
      const a = bond({ nextCoupon: '2026-13-01', maturity: '2027-02-25' });
      expect(couponsInGap(a, () => 1240, '2026-08-01', '2027-03-01', [], dates)).toBe(2 * 1240);
    });

    it('off a start clamped onto a maturity no calendar has, without throwing', () => {
      const a = bond({ nextCoupon: '2026-12-20', maturity: '2026-13-01' });
      const served = ['2027-01-10', '2027-07-10'];
      expect(couponsInGap(a, () => 1240, '2026-12-01', '2027-01-05', [], served)).toBe(0);
      expect(couponsInGap(a, () => 1240, '2027-01-01', '2027-01-15', [], served)).toBe(1240);
      expect(couponsInGap(a, () => 1240, '2025-01-01', '2025-02-01', [], served)).toBe(0);
    });

    it('for a schedule other than semiannual', () => {
      const a = bond({ payoutSchedule: 'monthly', nextCoupon: '2026-01-31', maturity: undefined });
      const served = ['2026-01-31', '2026-02-28'];
      expect(couponsInGap(a, () => 1240, '2026-01-30', '2026-05-31', [], served)).toBe(2 * 1240);
    });
  });

  it('counts every date the walk offers inside the gap once, and no other after the start', () => {
    const bonds = parseAssetsFeed(fixture0924).entries.filter((e) => e.kind === 'bond');
    // Records each occurrence the walk offers, as the confirm would, until it offers none.
    const offered = (a: Asset, dates: string[]): string[] => {
      const rows = [{ ...buy('2020-01-01'), assetId: a.id }];
      const owed: string[] = [];
      for (let i = 0; i < 60; i++) {
        const date = nextUnsettledCouponDate(a, rows, { schedule: dates });
        if (date === undefined) break;
        owed.push(date);
        rows.push(tx({ id: `c${i}`, date, assetId: a.id }));
      }
      return owed;
    };
    let checks = 0;
    let covered = 0;
    const misses: string[] = [];
    for (const b of bonds) {
      const dates = [...new Set(b.paymentSchedule.map((p) => p.date))].sort();
      if (dates.length < 2) continue;
      // On the first date served, a period and a period plus three days behind it, a day past the second.
      const stored = [
        dates[0]!,
        addDays(dates[0]!, -OVDP_COUPON_PERIOD_DAYS),
        addDays(dates[0]!, -OVDP_COUPON_PERIOD_DAYS - 3),
        addDays(dates[1]!, 1),
      ];
      // The feed's maturity, and one inside the dedupe window past the last date served.
      for (const maturity of [b.maturity!, addDays(b.maturity!, 3)]) {
        for (const nextCoupon of stored) {
          const a = bond({ id: b.ref, nextCoupon, maturity });
          const owed = offered(a, dates);
          const start = owed[0];
          if (start === undefined) {
            misses.push(`${b.ref} ${nextCoupon}: no start`);
            continue;
          }
          for (const to of [maturity, owed[1] ?? start]) {
            checks += 1;
            const want = owed.filter((d) => d <= to).length;
            const got = couponsInGap(a, () => 1, dayBefore(start), to, [], dates);
            if (got !== want) misses.push(`${b.ref} ${nextCoupon} to ${to}: ${got}, walk ${want}`);
          }
          // Where the published dates cover the gap, the count is theirs.
          if (nextCoupon === dates[0]) {
            covered += 1;
            const got = couponsInGap(a, () => 1, dates[0]!, maturity, [], dates);
            const want = dates.filter((d) => d > dates[0]! && d <= maturity).length;
            if (got !== want) misses.push(`${b.ref} covered: ${got}, published ${want}`);
          }
        }
      }
    }
    expect(checks).toBe(496);
    expect(covered).toBe(62);
    expect(misses).toEqual([]);
  });
});

describe('a semiannual coupon with no published schedule steps 182 days', () => {
  const buy = (date: string) => tx({ id: 'b0', date, type: 'buy', amount: 10000, quantity: 10 });
  // Records each occurrence the walk owes, as the confirm would, until it owes none.
  const walk = (asset: Asset, ledger: Transaction[]): string[] => {
    const rows = [...ledger];
    const owed: string[] = [];
    for (let i = 0; i < 12; i++) {
      const date = nextUnsettledCouponDate(asset, rows);
      if (date === undefined) break;
      owed.push(date);
      rows.push(tx({ id: `c${i}`, date }));
    }
    return owed;
  };

  it("walks UA4000236475's published dates, on its terms, to the maturity", () => {
    const a = bond({ nextCoupon: '2025-10-01', maturity: '2028-09-27' });
    expect(walk(a, [buy('2025-09-01')])).toEqual([
      '2025-10-01',
      '2026-04-01',
      '2026-09-30',
      '2027-03-31',
      '2027-09-29',
      '2028-03-29',
      '2028-09-27',
    ]);
  });

  describe('from 31.08.2026, every reader names the same dates', () => {
    const a = bond({ nextCoupon: '2026-08-31', maturity: '2028-08-31' });
    const ledger = [buy('2026-07-01')];
    // The 28.08.2028 step falls three days short of the maturity, so it is the maturity.
    const DATES = ['2026-08-31', '2027-03-01', '2027-08-30', '2028-02-28', '2028-08-31'];

    it('the confirm rolls onto them, then matures', () => {
      const rolls = DATES.slice(0, -1).map((from) => rollNextCoupon(a, from));
      expect(rolls).toEqual(DATES.slice(1).map((nextCoupon) => ({ kind: 'rolled', nextCoupon })));
      expect(rollNextCoupon(a, '2028-08-31')).toEqual({ kind: 'matured' });
    });

    it('the walk owes them in turn', () => {
      expect(walk(a, ledger)).toEqual(DATES);
      expect(owedCouponDate(a, ledger, '2027-08-01')).toBe('2027-08-30');
    });

    it("the schedule names the months of a year's coupons", () => {
      expect(scheduledCouponMonths(a, ledger)).toEqual([3, 8]);
    });

    it('the gap counts them, from the stored pointer or a rolled one', () => {
      expect(couponsInGap(a, () => 1240, '2027-02-28', '2027-03-01', [])).toBe(1240);
      expect(couponsInGap(a, () => 1240, '2028-08-28', '2028-08-31', [])).toBe(1240);
      expect(couponsInGap(a, () => 1240, '2028-08-26', '2028-08-28', [])).toBe(0);
      // The maturity counts once, though the step after 28.02.2028 lands on it too.
      expect(couponsInGap(a, () => 1240, '2026-08-30', '2028-12-31', [])).toBe(5 * 1240);
      const rolled = bond({ nextCoupon: '2027-03-01', maturity: '2028-08-31' });
      expect(couponsInGap(rolled, () => 1240, '2027-08-29', '2027-08-30', [])).toBe(1240);
      expect(couponsInGap(rolled, () => 1240, '2026-08-30', '2026-08-31', [])).toBe(1240);
      // Two periods behind the pointer: the 01.03.2027 step back lies after the gap.
      const twice = bond({ nextCoupon: '2027-08-30', maturity: '2028-08-31' });
      expect(couponsInGap(twice, () => 1240, '2026-08-30', '2026-08-31', [])).toBe(1240);
    });
  });

  it('names two months a year, though the 182-day step crosses month ends over the years', () => {
    // Seasonality adds a whole coupon per month named: a longer walk would count four a year.
    const drifting = bond({ nextCoupon: '2026-03-03', maturity: undefined });
    expect(scheduledCouponMonths(drifting, [])).toEqual([3, 9]);
  });

  it('names the final coupon by its own month, where it carries the principal', () => {
    // 23.02.2027 is 15 days short of 10.03, so the final period stays its own.
    expect(scheduledCouponMonths(bond({ maturity: '2027-03-10' }), [])).toEqual([2, 3, 8]);
    const quarterly = bond({
      payoutSchedule: 'quarterly',
      nextCoupon: '2026-01-15',
      maturity: '2026-12-01',
    });
    expect(scheduledCouponMonths(quarterly, [])).toEqual([1, 4, 7, 10, 12]);
  });

  it('keeps a month the position pays in again after a sale and a buy-back', () => {
    const b = bond({ maturity: '2030-08-25' });
    const ledger = [
      tx({ id: 'b1', date: '2026-02-05', type: 'buy', amount: 15000, quantity: 15 }),
      tx({ id: 's1', date: '2026-12-01', type: 'sell', amount: 15000, quantity: 15 }),
      tx({ id: 'b2', date: '2027-03-01', type: 'buy', amount: 5000, quantity: 5 }),
    ];
    // 23.02.2027 is not owed; 22.02.2028 is, and it is February's coupon.
    expect(scheduledCouponMonths(b, ledger)).toEqual([2, 8]);
  });

  it('lets no single payout settle both ends of the final period', () => {
    // A payout settles an occurrence within ±7 days of it, so two no further apart than twice that
    // could both read as paid. 25.08.2026 + 182 is 23.02.2027; each maturity sits `stub` days after.
    const tooClose: string[] = [];
    for (let stub = 1; stub <= 21; stub++) {
      const maturity = addDays('2027-02-23', stub);
      const dates = ['2026-08-25'];
      for (let roll = rollNextCoupon(bond({ maturity })); roll?.kind === 'rolled';) {
        dates.push(roll.nextCoupon);
        roll = rollNextCoupon(bond({ maturity }), roll.nextCoupon);
      }
      const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i]!, d));
      if (gaps.some((g) => g <= 2 * COUPON_MATCH_WINDOW_DAYS)) tooClose.push(`${stub}: ${dates}`);
    }
    expect(tooClose).toEqual([]);
    // The fold is no wider than that: a 15-day final period stays its own.
    expect(walk(bond({ maturity: '2027-03-10' }), [buy('2026-02-05')])).toEqual([
      '2026-08-25',
      '2027-02-23',
      '2027-03-10',
    ]);
  });

  it("folds the seed's 23.02.2027 step into its 25.02.2027 maturity", () => {
    expect(walk(bond(), [buy('2026-02-05')])).toEqual(['2026-08-25', '2027-02-25']);
    expect(couponsInGap(bond(), () => 1240, '2027-02-21', '2027-02-23', [])).toBe(0);
    expect(couponsInGap(bond(), () => 1240, '2027-02-23', '2027-02-25', [])).toBe(1240);
  });

  describe('a stored date inside the dedupe window before the maturity is the final coupon', () => {
    // Sized by date, so a coupon counted on any other day shows in the sum.
    const on = (date: string) => (d: string) => (d === date ? 1240 : 99999);

    it('counts one coupon over a gap spanning both dates, up to the window’s edge', () => {
      expect(
        couponsInGap(
          bond({ nextCoupon: '2027-02-20' }),
          () => 1240,
          '2027-02-10',
          '2027-03-10',
          [],
        ),
      ).toBe(1240);
      expect(
        couponsInGap(
          bond({ nextCoupon: '2027-02-18' }),
          () => 1240,
          '2027-02-10',
          '2027-03-10',
          [],
        ),
      ).toBe(1240);
    });

    it('places it on the maturity, sized on the maturity’s record date', () => {
      const a = bond({ nextCoupon: '2027-02-20' });
      expect(couponsInGap(a, on('2027-02-25'), '2027-02-10', '2027-02-22', [])).toBe(0);
      expect(couponsInGap(a, on('2027-02-25'), '2027-02-22', '2027-02-25', [])).toBe(1240);
    });

    it('counts the coupon before as it is counted once the confirm rolls onto the maturity', () => {
      const before = bond({ nextCoupon: '2027-02-20' });
      // The confirm records the payout on the stored date, then rolls onto the maturity.
      const after = bond({ nextCoupon: '2027-02-25' });
      const confirm = tx({ id: 'c4', date: '2027-02-20' });
      const recorded = [tx({ id: 'p3', date: '2026-08-25' })];
      expect(couponsInGap(before, on('2026-08-25'), '2026-08-24', '2026-08-26', recorded)).toBe(
        1240,
      );
      expect(
        couponsInGap(after, on('2026-08-25'), '2026-08-24', '2026-08-26', [...recorded, confirm]),
      ).toBe(1240);
      // With none recorded, both step a period back from the maturity.
      expect(couponsInGap(before, on('2026-08-27'), '2026-08-26', '2026-08-27', [])).toBe(1240);
      expect(couponsInGap(after, on('2026-08-27'), '2026-08-26', '2026-08-27', [confirm])).toBe(
        1240,
      );
    });

    it('still counts two a day past the window, as the walk offers two', () => {
      const a = bond({ nextCoupon: '2027-02-17' });
      expect(couponsInGap(a, () => 1240, '2027-02-10', '2027-03-10', [])).toBe(2 * 1240);
      expect(walk(a, [buy('2026-02-05')])).toEqual(['2027-02-17', '2027-02-25']);
    });

    it('with the dates, keeps the merged coupon on the published date', () => {
      const a = bond({ nextCoupon: '2027-02-20' });
      const dates = ['2026-08-25', '2027-02-23'];
      expect(couponsInGap(a, on('2027-02-23'), '2027-02-22', '2027-02-23', [], dates)).toBe(1240);
      expect(couponsInGap(a, on('2027-02-23'), '2027-02-23', '2027-02-25', [], dates)).toBe(0);
      // With no published date that near, the stored date stands and the merge keeps it.
      const far = ['2026-08-25'];
      expect(couponsInGap(a, on('2027-02-20'), '2027-02-19', '2027-02-20', [], far)).toBe(1240);
      expect(couponsInGap(a, on('2027-02-20'), '2027-02-20', '2027-02-25', [], far)).toBe(0);
    });

    it('leaves a stored date past the maturity where it stands', () => {
      const a = bond({ nextCoupon: '2027-02-27' });
      expect(couponsInGap(a, on('2027-02-27'), '2027-02-26', '2027-02-27', [])).toBe(1240);
      expect(couponsInGap(a, on('2027-02-27'), '2027-02-24', '2027-02-26', [])).toBe(0);
    });
  });

  describe('a month grid stops at the maturity, where the final coupon is paid', () => {
    // Sized by date, so a coupon counted on any other day shows in the sum.
    const on = (date: string) => (d: string) => (d === date ? 1240 : 99999);
    const monthly = bond({
      payoutSchedule: 'monthly',
      nextCoupon: '2027-01-25',
      maturity: '2027-03-10',
    });

    it('counts the grid dates to the maturity and the final coupon on it, nothing past', () => {
      expect(walk(monthly, [buy('2026-02-05')])).toEqual([
        '2027-01-25',
        '2027-02-25',
        '2027-03-10',
      ]);
      expect(couponsInGap(monthly, () => 1240, '2027-01-20', '2027-03-31', [])).toBe(3 * 1240);
      expect(couponsInGap(monthly, on('2027-03-10'), '2027-02-26', '2027-03-15', [])).toBe(1240);
      expect(couponsInGap(monthly, () => 1240, '2027-03-11', '2027-03-31', [])).toBe(0);
    });

    it('counts a quarterly grid the same way', () => {
      const quarterly = bond({
        payoutSchedule: 'quarterly',
        nextCoupon: '2027-01-25',
        maturity: '2027-05-10',
      });
      expect(walk(quarterly, [buy('2026-02-05')])).toEqual([
        '2027-01-25',
        '2027-04-25',
        '2027-05-10',
      ]);
      expect(couponsInGap(quarterly, () => 1240, '2027-01-20', '2027-06-30', [])).toBe(3 * 1240);
      expect(couponsInGap(quarterly, on('2027-05-10'), '2027-04-26', '2027-06-30', [])).toBe(1240);
    });

    it('takes a grid date inside the dedupe window before the maturity and the maturity as one coupon', () => {
      const a = bond({
        payoutSchedule: 'monthly',
        nextCoupon: '2027-01-25',
        maturity: '2027-03-02',
      });
      expect(walk(a, [buy('2026-02-05')])).toEqual(['2027-01-25', '2027-02-25']);
      expect(couponsInGap(a, () => 1240, '2027-01-20', '2027-03-05', [])).toBe(2 * 1240);
      expect(couponsInGap(a, on('2027-01-25'), '2027-01-20', '2027-02-24', [])).toBe(1240);
      // Counted on the maturity, sized on its record date: a gap ending between the two counts nothing.
      expect(couponsInGap(a, on('2027-03-02'), '2027-02-24', '2027-03-05', [])).toBe(1240);
      expect(couponsInGap(a, () => 1240, '2027-02-24', '2027-03-01', [])).toBe(0);
    });

    it('still counts two a day past the window, as the walk offers two', () => {
      const a = bond({
        payoutSchedule: 'monthly',
        nextCoupon: '2027-02-22',
        maturity: '2027-03-02',
      });
      expect(walk(a, [buy('2026-02-05')])).toEqual(['2027-02-22', '2027-03-02']);
      expect(couponsInGap(a, () => 1240, '2027-02-20', '2027-03-31', [])).toBe(2 * 1240);
    });

    it('folds a grid date at the window’s edge, as a payout on it settles the maturity', () => {
      const a = bond({
        payoutSchedule: 'monthly',
        nextCoupon: '2027-01-23',
        maturity: '2027-03-02',
      });
      expect(walk(a, [buy('2026-02-05')])).toEqual(['2027-01-23', '2027-02-23']);
      expect(couponsInGap(a, () => 1240, '2027-01-20', '2027-03-31', [])).toBe(2 * 1240);
      expect(couponsInGap(a, on('2027-03-02'), '2027-02-22', '2027-03-31', [])).toBe(1240);
    });

    it('counts a stored date on the maturity once, as after the last confirm', () => {
      const a = bond({
        payoutSchedule: 'monthly',
        nextCoupon: '2027-03-10',
        maturity: '2027-03-10',
      });
      expect(walk(a, [buy('2026-02-05')])).toEqual(['2027-03-10']);
      expect(couponsInGap(a, () => 1240, '2027-03-01', '2027-06-30', [])).toBe(1240);
    });

    describe('a stored date past the maturity, which the walk offers alone', () => {
      const a = bond({
        payoutSchedule: 'monthly',
        nextCoupon: '2027-03-15',
        maturity: '2027-03-10',
      });

      it('is not folded onto the maturity, and is counted once with nothing after it', () => {
        expect(walk(a, [buy('2026-02-05')])).toEqual(['2027-03-15']);
        expect(couponsInGap(a, on('2027-03-15'), '2027-03-01', '2027-03-31', [])).toBe(1240);
        expect(couponsInGap(a, on('2027-03-15'), '2027-03-01', '2027-12-31', [])).toBe(1240);
        expect(couponsInGap(a, () => 1240, '2027-03-15', '2027-12-31', [])).toBe(0);
      });

      it('on a quarterly grid too', () => {
        const q = { ...a, payoutSchedule: 'quarterly' as const };
        expect(walk(q, [buy('2026-02-05')])).toEqual(['2027-03-15']);
        expect(couponsInGap(q, on('2027-03-15'), '2027-03-01', '2027-12-31', [])).toBe(1240);
      });

      it('leaves the grid behind it as it is', () => {
        expect(couponsInGap(a, () => 1240, '2027-02-01', '2027-03-31', [])).toBe(2 * 1240);
        expect(couponsInGap(a, on('2027-02-15'), '2027-02-01', '2027-03-14', [])).toBe(1240);
      });

      it('keeps its own day, whatever the ledger records in the period before the maturity', () => {
        const ledger = [tx({ id: 'p1', date: '2027-01-25' }), tx({ id: 'p2', date: '2027-02-25' })];
        const by = (d: string) => ({ '2027-02-15': 1, '2027-03-15': 10 })[d] ?? 1000;
        expect(couponsInGap(a, by, '2027-02-01', '2027-12-31', ledger)).toBe(11);
      });
    });

    it('counts nothing past a maturity no calendar has, as the walk owes nothing on one', () => {
      const a = bond({
        payoutSchedule: 'monthly',
        nextCoupon: '2027-06-25',
        maturity: '2027-13-01',
      });
      // The roll clamps 25.01.2028 onto it, where the walk stops: seven, under the helper's cap.
      expect(walk(a, [buy('2026-02-05')])).toEqual([
        '2027-06-25',
        '2027-07-25',
        '2027-08-25',
        '2027-09-25',
        '2027-10-25',
        '2027-11-25',
        '2027-12-25',
      ]);
      expect(couponsInGap(a, () => 1240, '2027-06-20', '2028-03-31', [])).toBe(7 * 1240);
    });
  });

  describe('after the confirm rolls onto the maturity, the month grid behind it is dated by the payouts recorded before it', () => {
    const paid = (id: string, date: string) => tx({ id, date });
    // Sized by date, so a coupon counted or sized on any other day shows in the sum.
    const sized = (by: Record<string, number>) => (d: string) => by[d] ?? 99999;
    const grid = (
      payoutSchedule: 'monthly' | 'quarterly',
      maturity: string,
      nextCoupon: string = maturity,
    ) => bond({ payoutSchedule, nextCoupon, maturity });

    it('counts nothing between the paid day and the maturity, and the final coupon there, as before', () => {
      const ledger = [paid('p1', '2027-01-25'), paid('p2', '2027-02-25')];
      const before = grid('monthly', '2027-03-02', '2027-02-25');
      // The confirm records the 25.02 payout on its date and rolls onto the maturity.
      expect(rollNextCoupon(before, '2027-02-25')).toEqual({
        kind: 'rolled',
        nextCoupon: '2027-03-02',
      });
      for (const a of [before, grid('monthly', '2027-03-02')]) {
        expect(couponsInGap(a, () => 1240, '2027-01-28', '2027-02-27', ledger)).toBe(0);
        expect(
          couponsInGap(a, sized({ '2027-03-02': 1240 }), '2027-01-26', '2027-03-31', ledger),
        ).toBe(1240);
      }
    });

    it('counts each grid date and the clamped maturity, each sized on its own record date', () => {
      const ledger = [paid('p1', '2027-01-25'), paid('p2', '2027-02-25')];
      expect(walk(grid('monthly', '2027-03-10', '2027-01-25'), [buy('2026-02-05')])).toEqual([
        '2027-01-25',
        '2027-02-25',
        '2027-03-10',
      ]);
      const a = grid('monthly', '2027-03-10');
      const by = sized({ '2027-01-25': 1, '2027-02-25': 10, '2027-03-10': 100 });
      // A payout on the maturity settles the maturity, not the grid date before it.
      for (const rows of [ledger, [...ledger, paid('p3', '2027-03-10')]]) {
        expect(couponsInGap(a, by, '2027-01-20', '2027-03-31', rows)).toBe(111);
        expect(
          couponsInGap(
            grid('monthly', '2027-03-10', '2027-02-25'),
            by,
            '2027-01-20',
            '2027-03-31',
            rows,
          ),
        ).toBe(111);
      }
    });

    it('takes a final coupon entered inside the maturity’s window for the maturity’s, not the grid’s day', () => {
      const ledger = [paid('p1', '2027-01-25'), paid('p2', '2027-02-25')];
      const by = sized({ '2027-01-25': 1, '2027-02-25': 10, '2027-03-10': 100 });
      // Entered by hand five days early, and at the window's edge: the walk takes either for the maturity's.
      for (const early of ['2027-03-05', '2027-03-03']) {
        const rows = [buy('2026-02-05'), ...ledger, paid('p3', early)];
        expect(nextUnsettledCouponDate(grid('monthly', '2027-03-10'), rows)).toBeUndefined();
        for (const a of [
          grid('monthly', '2027-03-10', '2027-02-25'),
          grid('monthly', '2027-03-10'),
        ]) {
          expect(couponsInGap(a, by, '2027-01-20', '2027-03-31', rows)).toBe(111);
          expect(couponsInGap(a, by, '2027-02-20', '2027-02-28', rows)).toBe(10);
        }
      }
      // On a quarterly grid, a period being three months.
      const quarterly = [paid('q1', '2026-10-25'), paid('q2', '2027-01-25')];
      const byQuarter = sized({ '2026-10-25': 1, '2027-01-25': 10, '2027-04-10': 100 });
      for (const early of ['2027-04-05', '2027-04-03']) {
        const rows = [buy('2026-02-05'), ...quarterly, paid('q3', early)];
        expect(nextUnsettledCouponDate(grid('quarterly', '2027-04-10'), rows)).toBeUndefined();
        for (const a of [
          grid('quarterly', '2027-04-10', '2027-01-25'),
          grid('quarterly', '2027-04-10'),
        ]) {
          expect(couponsInGap(a, byQuarter, '2026-10-20', '2027-04-30', rows)).toBe(111);
          expect(couponsInGap(a, byQuarter, '2027-01-20', '2027-01-28', rows)).toBe(10);
        }
      }
    });

    it('takes the period’s bounds and the window’s edge as they are, with the payout before the window more than the window after a period before the one inside it', () => {
      // A maturity on the grid's day, a period after the last grid date, which sits on the read's lower
      // bound; and a final period of 15 days. Each final coupon is entered by hand on the window's edge.
      const cases = [
        { maturity: '2027-03-01', early: '2027-02-22' },
        { maturity: '2027-02-16', early: '2027-02-09' },
      ];
      for (const { maturity, early } of cases) {
        const rows = [buy('2026-02-05'), paid('p1', '2027-01-01'), paid('p2', '2027-02-01')];
        rows.push(paid('p3', early));
        const sizedBy = sized({ '2027-01-01': 1, '2027-02-01': 10, [maturity]: 100 });
        const before = grid('monthly', maturity, '2027-02-01');
        expect(rollNextCoupon(before, '2027-02-01')).toEqual({
          kind: 'rolled',
          nextCoupon: maturity,
        });
        expect(nextUnsettledCouponDate(grid('monthly', maturity), rows)).toBeUndefined();
        for (const a of [before, grid('monthly', maturity)]) {
          expect(couponsInGap(a, sizedBy, '2026-12-20', '2027-03-31', rows)).toBe(111);
        }
      }
    });

    it('takes the coupon before the last grid date, entered late, for that coupon, not the grid’s day', () => {
      // The 01.02 coupon entered by hand a day late, and at the window's edge, which the walk takes for it;
      // the confirm then records 01.03 and rolls onto the 02.03 maturity.
      for (const late of ['2027-02-02', '2027-02-08']) {
        const rows = [buy('2026-02-05'), paid('p1', '2027-01-01'), paid('p2', late)];
        const before = grid('monthly', '2027-03-02', '2027-03-01');
        expect(nextUnsettledCouponDate(grid('monthly', '2027-03-02', '2027-02-01'), rows)).toBe(
          '2027-03-01',
        );
        rows.push(paid('p3', '2027-03-01'));
        expect(rollNextCoupon(before, '2027-03-01')).toEqual({
          kind: 'rolled',
          nextCoupon: '2027-03-02',
        });
        const by = sized({ '2027-01-01': 1, '2027-02-01': 10, '2027-03-02': 100 });
        for (const a of [before, grid('monthly', '2027-03-02')]) {
          expect(couponsInGap(a, by, '2027-01-28', '2027-02-01', rows)).toBe(10);
          expect(couponsInGap(a, by, '2027-02-01', '2027-02-27', rows)).toBe(0);
          expect(couponsInGap(a, by, '2026-12-20', '2027-03-31', rows)).toBe(111);
        }
      }
    });

    it('reads payouts it cannot tell apart as a late entry of the coupon before, not an early final coupon', () => {
      // The same two payouts in the read's range come from a grid on the 7th whose 07.02 coupon was
      // entered on 12.02, and from a grid on the 12th whose final coupon was entered on 07.03.
      const rows = [paid('p2', '2027-02-12'), paid('p3', '2027-03-07')];
      const by = sized({ '2027-02-07': 1, '2027-03-10': 100 });
      expect(
        couponsInGap(grid('monthly', '2027-03-10'), by, '2027-02-01', '2027-03-31', rows),
      ).toBe(101);
      // Eight days after a period before the one inside, past the window the walk takes a late entry
      // within, the payout before the window keeps its own day.
      const past = [paid('p2', '2027-02-13'), paid('p3', '2027-03-05')];
      const byPast = sized({ '2027-02-13': 1, '2027-03-10': 100 });
      expect(
        couponsInGap(grid('monthly', '2027-03-10'), byPast, '2027-02-01', '2027-03-31', past),
      ).toBe(101);
    });

    it('on a quarterly grid too', () => {
      const ledger = [paid('p1', '2027-01-25'), paid('p2', '2027-04-25')];
      const a = grid('quarterly', '2027-05-02');
      expect(couponsInGap(a, () => 1240, '2027-01-28', '2027-04-27', ledger)).toBe(0);
      expect(
        couponsInGap(
          a,
          sized({ '2027-01-25': 1, '2027-05-02': 10 }),
          '2026-12-01',
          '2027-06-30',
          ledger,
        ),
      ).toBe(11);
    });

    it('from the folded payout alone, where the coupon a period before it was not owed', () => {
      const ledger = [buy('2027-01-30'), paid('p2', '2027-02-25')];
      const a = grid('monthly', '2027-03-02');
      const owed = (d: string) =>
        holdsNone(unitsOnRecordDate(ledger, a.id, d)) ? undefined : 1240;
      expect(couponsInGap(a, owed, '2027-01-28', '2027-02-27', ledger)).toBe(0);
      expect(couponsInGap(a, owed, '2027-01-20', '2027-02-27', ledger)).toBe(0);
      expect(couponsInGap(a, owed, '2027-01-20', '2027-03-02', ledger)).toBe(1240);
    });

    it('with no payout recorded, steps back from the maturity, as before', () => {
      const a = grid('monthly', '2027-03-02');
      expect(
        couponsInGap(
          a,
          sized({ '2027-02-02': 1, '2027-03-02': 10 }),
          '2027-01-26',
          '2027-03-31',
          [],
        ),
      ).toBe(11);
    });

    it('dates the grid behind a maturity no calendar has by the payout before it, without throwing', () => {
      const ledger = [paid('p1', '2027-10-05'), paid('p2', '2027-11-05'), paid('p3', '2027-12-05')];
      const before = grid('monthly', '2027-13-01', '2027-12-05');
      expect(rollNextCoupon(before, '2027-12-05')).toEqual({
        kind: 'rolled',
        nextCoupon: '2027-13-01',
      });
      const fifth = (d: string) => (d.endsWith('-05') ? 1 : 1000);
      expect(couponsInGap(before, fifth, '2027-01-01', '2028-03-31', ledger)).toBe(12);
      expect(
        couponsInGap(grid('monthly', '2027-13-01'), fifth, '2027-01-01', '2028-03-31', ledger),
      ).toBe(12);
      expect(() =>
        couponsInGap(grid('monthly', '2027-13-01'), fifth, '2027-01-01', '2028-03-31', []),
      ).not.toThrow();
    });

    it('takes no payout from before a period ahead of the maturity, the earliest the confirm rolls onto it from', () => {
      // A maturity on the 25th grid, and the 25.02 coupon entered by hand three days early.
      const ledger = [paid('p1', '2027-01-25'), paid('p2', '2027-02-22')];
      const by = sized({ '2027-02-25': 1 });
      for (const a of [
        grid('monthly', '2027-03-25', '2027-02-25'),
        grid('monthly', '2027-03-25'),
      ]) {
        expect(couponsInGap(a, by, '2027-02-23', '2027-02-26', ledger)).toBe(1);
      }
    });

    it('counts the same coupons for the same ledger before and after the confirm, over every gap', () => {
      // Sized by a distinct figure per date, so a coupon moved to another day changes the sum.
      const figure = (d: string) => daysBetween('2027-01-01', d) + 1;
      let cases = 0;
      let counting = 0;
      for (const schedule of ['monthly', 'quarterly'] as const) {
        const months = schedule === 'monthly' ? 1 : 3;
        for (let day = 1; day <= 28; day++) {
          const first = `2027-01-${String(day).padStart(2, '0')}`;
          const second = addMonths(first, months);
          // The maturity inside the dedupe window of the last grid date, at its edge, outside it, and three
          // days short of the next grid date.
          const next = daysBetween(second, addMonths(second, months));
          for (const offset of [1, 7, 8, 13, next - 3]) {
            const maturity = addDays(second, offset);
            // Bought before the first record date, and between the two record dates.
            for (const [bought, final] of [
              [addDays(first, -10), false],
              [addDays(first, 1), false],
              [addDays(first, -10), true],
              [addDays(first, 1), true],
            ] as const) {
              const ledger: Transaction[] = [buy(bought)];
              const stored = bond({ payoutSchedule: schedule, nextCoupon: first, maturity });
              // The payouts the confirm records: each grid date the walk offers before the maturity, and
              // in half the cases the final coupon it offers after the roll, on the maturity.
              for (const date of final ? [first, second, maturity] : [first, second]) {
                if (!holdsNone(unitsOnRecordDate(ledger, stored.id, date))) {
                  ledger.push(paid(`c${date}`, date));
                }
              }
              expect(rollNextCoupon(stored, second)).toEqual({
                kind: 'rolled',
                nextCoupon: maturity,
              });
              const sizedOnRecord = (d: string) =>
                holdsNone(unitsOnRecordDate(ledger, stored.id, d)) ? undefined : figure(d);
              const bounds = [
                ...new Set([
                  addDays(first, -1),
                  first,
                  addDays(first, 1),
                  addDays(second, -1),
                  second,
                  addDays(second, 1),
                  addDays(maturity, -1),
                  maturity,
                  addDays(maturity, 1),
                  addDays(maturity, 40),
                  bought,
                ]),
              ].sort();
              for (let i = 0; i < bounds.length; i++) {
                for (let j = i + 1; j < bounds.length; j++) {
                  const gap = (nextCoupon: string) =>
                    couponsInGap(
                      { ...stored, nextCoupon },
                      sizedOnRecord,
                      bounds[i]!,
                      bounds[j]!,
                      ledger,
                    );
                  const before = gap(first);
                  cases += 1;
                  if (before > 0) counting += 1;
                  expect(
                    gap(second),
                    `${schedule} ${first} ${maturity} ${bought} (${bounds[i]}, ${bounds[j]}]`,
                  ).toBe(before);
                  expect(
                    gap(maturity),
                    `${schedule} ${first} ${maturity} ${bought} (${bounds[i]}, ${bounds[j]}]`,
                  ).toBe(before);
                }
              }
            }
          }
        }
      }
      expect(cases).toBe(51968);
      expect(counting).toBe(37184);
    });
  });

  it('leaves a monthly and a quarterly schedule on the month grid', () => {
    const eom = bond({ nextCoupon: '2027-01-31', maturity: '2028-01-31' });
    expect(rollNextCoupon({ ...eom, payoutSchedule: 'monthly' })).toEqual({
      kind: 'rolled',
      nextCoupon: '2027-02-28',
    });
    expect(rollNextCoupon({ ...eom, payoutSchedule: 'quarterly' })).toEqual({
      kind: 'rolled',
      nextCoupon: '2027-04-30',
    });
    expect(
      couponsInGap(
        { ...eom, payoutSchedule: 'monthly' },
        () => 1240,
        '2027-02-27',
        '2027-02-28',
        [],
      ),
    ).toBe(1240);
  });

  it('steps nothing off a date no calendar has, and throws on none', () => {
    const unreadable = bond({ nextCoupon: '2026-13-01' });
    expect(rollNextCoupon(unreadable)).toBeUndefined();
    expect(couponsInGap(unreadable, () => 1240, '2026-08-01', '2027-03-01', [])).toBe(0);
    // Reached by stepping, as the walk reaches it: it sorts between these bounds as a string.
    const steppedOnto = bond({ maturity: '2026-13-01' });
    expect(couponsInGap(steppedOnto, () => 1240, '2026-12-20', '2027-01-05', [])).toBe(0);
  });

  describe('a coupon behind the pointer', () => {
    const paid = (id: string, date: string) => tx({ id, date });
    // Sized by date, so a coupon counted on any other day shows in the sum.
    const on = (date: string) => (d: string) => (d === date ? 1240 : 99999);

    it('sits on the grid behind a pointer on it, whatever day its payout was entered', () => {
      const a = bond({ nextCoupon: '2027-03-01', maturity: '2028-08-31' });
      // Entered by hand three days late, and a stray entry well before it.
      const ledger = [paid('p0', '2026-08-20'), paid('p1', '2026-09-03')];
      expect(couponsInGap(a, on('2026-08-31'), '2026-08-30', '2026-09-01', ledger)).toBe(1240);
      expect(couponsInGap(a, on('2026-08-31'), '2026-09-01', '2026-09-04', ledger)).toBe(0);
    });

    describe('a pointer folded or clamped onto the maturity is the payout recorded for it', () => {
      it('after the confirm folds the seed onto its maturity', () => {
        const confirmed = bond({ nextCoupon: '2027-02-25' });
        const ledger = [
          buy('2026-02-05'),
          paid('p2', '2026-02-25'),
          paid('p0', '2026-08-10'),
          paid('p3', '2026-08-25'),
          // Neither a buy nor another asset's payout is a coupon of this one.
          tx({ id: 'b9', date: '2026-09-05', type: 'buy', amount: 1000, quantity: 1 }),
          tx({ id: 'o1', date: '2026-09-05', assetId: 'other' }),
        ];
        const sized = on('2026-08-25');
        expect(couponsInGap(confirmed, sized, '2026-08-24', '2026-08-26', ledger)).toBe(1240);
        expect(couponsInGap(confirmed, sized, '2026-08-26', '2026-08-28', ledger)).toBe(0);
      });

      it('the coupon just before a final period of 15 days', () => {
        // 25.08.2026 + 182 is 23.02.2027, 15 days short of 10.03.2027: the walk owes both.
        const clamped = bond({ nextCoupon: '2027-03-10', maturity: '2027-03-10' });
        const ledger = [paid('p3', '2026-08-25'), paid('p4', '2027-02-23')];
        expect(couponsInGap(clamped, on('2027-02-23'), '2027-02-22', '2027-02-24', ledger)).toBe(
          1240,
        );
        expect(couponsInGap(clamped, () => 1240, '2026-08-20', '2027-03-10', ledger)).toBe(
          3 * 1240,
        );
      });

      it('across the widest fold, recorded as early as the window allows', () => {
        // 25.08.2026 + 182 is 23.02.2027, 14 days short of 09.03.2027: the coupon sits 196 days back.
        const folded = bond({ nextCoupon: '2027-03-09', maturity: '2027-03-09' });
        for (const p of ['2026-08-25', '2026-08-18']) {
          const gap = (from: string, to: string) =>
            couponsInGap(folded, on(p), from, to, [paid('p3', p)]);
          expect(gap(addDays(p, -1), addDays(p, 1))).toBe(1240);
          // Nothing between it and the maturity: no step lands a coupon of its own there.
          expect(gap(addDays(p, 1), '2027-03-08')).toBe(0);
        }
      });

      it('not a payout that settles the pointer’s own coupon, recorded days early', () => {
        const due = bond({ nextCoupon: '2027-02-25' });
        const ledger = [paid('p4', '2027-02-20')];
        expect(couponsInGap(due, () => 1240, '2027-02-19', '2027-02-21', ledger)).toBe(0);
      });

      it('after the confirm clamps …6475 onto its maturity', () => {
        const clamped = bond({ nextCoupon: '2027-05-27', maturity: '2027-05-27' });
        const ledger = [paid('p6', '2026-06-03'), paid('p7', '2026-12-03')];
        expect(couponsInGap(clamped, on('2026-12-03'), '2026-12-01', '2026-12-04', ledger)).toBe(
          1240,
        );
        expect(couponsInGap(clamped, () => 1240, '2026-11-25', '2026-11-26', ledger)).toBe(0);
      });

      it('never a payout dated on a day no calendar has, which sorts after December', () => {
        const clamped = bond({ nextCoupon: '2027-06-30', maturity: '2027-06-30' });
        const ledger = [paid('p1', '2026-12-20'), paid('px', '2026-13-01')];
        expect(couponsInGap(clamped, on('2026-12-20'), '2026-12-19', '2026-12-21', ledger)).toBe(
          1240,
        );
      });

      it('once, dated by its first entry, though two payouts settle it', () => {
        const confirmed = bond({ nextCoupon: '2027-02-25' });
        const ledger = [paid('p3', '2026-08-25'), paid('p4', '2026-08-27')];
        expect(couponsInGap(confirmed, on('2026-08-25'), '2026-08-20', '2026-08-31', ledger)).toBe(
          1240,
        );
      });
    });
  });

  it('steps onto every date the feed publishes but one, a day off', () => {
    const bonds = parseAssetsFeed(fixture0924).entries.filter((e) => e.kind === 'bond');
    let gaps = 0;
    const misses: string[] = [];
    for (const b of bonds) {
      const dates = [...new Set(b.paymentSchedule.map((p) => p.date))].sort();
      const a = bond({ id: b.ref, nextCoupon: dates[0], maturity: b.maturity });
      // From the first date, as an unlinked bond would: each step off the one before it.
      let from = dates[0]!;
      for (const published of dates.slice(1)) {
        gaps += 1;
        const roll = rollNextCoupon(a, from);
        const stepped = roll?.kind === 'rolled' ? roll.nextCoupon : String(roll?.kind);
        if (stepped !== published) misses.push(`${b.ref} ${published} stepped ${stepped}`);
        from = stepped;
      }
    }
    expect(gaps).toBe(98);
    expect(misses).toEqual(['UA4000235782 2027-06-03 stepped 2027-06-02']);
  });

  it('makes every bond the feed captures serve its last payment on its maturity', () => {
    let bonds = 0;
    const off: string[] = [];
    for (const capture of [fixtureSample, fixture0923, fixture0924]) {
      for (const b of parseAssetsFeed(capture).entries) {
        if (b.kind !== 'bond') continue;
        bonds += 1;
        const last = b.paymentSchedule
          .map((p) => p.date)
          .sort()
          .at(-1);
        if (last !== b.maturity) off.push(`${b.ref} ${last} ${b.maturity}`);
      }
    }
    expect(bonds).toBe(61);
    expect(off).toEqual([]);
  });
});

describe('the walk steps through the published dates it is given', () => {
  const buy = (id: string, date: string) =>
    tx({ id, date, type: 'buy', amount: 15000, quantity: 15 });
  const sell = (id: string, date: string) =>
    tx({ id, date, type: 'sell', amount: 15000, quantity: 15 });

  // UA4000235782's published dates (`assets-2026-09-24.json`): 2027-06-03 to 2027-12-01 is 181
  // days, so a 182-day step reads 2027-12-02 and counts the units at the end of the wrong day.
  describe("on UA4000235782's 181-day period", () => {
    const DATES = [
      '2025-12-03',
      '2026-06-03',
      '2026-12-02',
      '2027-06-03',
      '2027-12-01',
      '2028-05-31',
      '2028-11-29',
    ];
    const a = bond({ nextCoupon: '2027-06-03', maturity: '2028-11-29' });
    const settled = [buy('b0', '2027-01-10'), tx({ id: 'p0', date: '2027-06-03' })];

    it('offers the published date to units held at the end of the day before it', () => {
      const ledger = [...settled, sell('s0', '2027-12-01')];
      expect(nextUnsettledCouponDate(a, ledger, { schedule: DATES })).toBe('2027-12-01');
      // Without the dates the units are counted on 01.12, after the sale.
      expect(nextUnsettledCouponDate(a, ledger)).toBeUndefined();
    });

    it('does not offer the published date to a holder of none who buys on it', () => {
      const ledger = [...settled, sell('s0', '2027-08-01'), buy('b1', '2027-12-01')];
      expect(nextUnsettledCouponDate(a, ledger, { schedule: DATES })).toBe('2028-05-31');
      expect(nextUnsettledCouponDate(a, ledger)).toBe('2027-12-02');
    });

    it("names no month for a published date whose record date's units were sold", () => {
      // 2026-12-02 to 2027-06-03 is 183 days: the step reads 02.06 and counts the units on 01.06.
      const owed = bond({ nextCoupon: '2026-12-02', maturity: '2028-11-29' });
      const ledger = [buy('b0', '2026-06-10'), sell('s0', '2027-06-02')];
      expect(scheduledCouponMonths(owed, ledger, DATES)).toEqual([12]);
      expect(scheduledCouponMonths(owed, ledger)).toEqual([6, 12]);
    });

    it('steps off a stored date a day short of a published one past that occurrence', () => {
      // 02.06 is what a step without the dates stores for the 03.06 coupon: one occurrence.
      const early = bond({ nextCoupon: '2027-06-02', maturity: '2028-11-29' });
      expect(rollNextCoupon(early, '2027-06-02', DATES)).toEqual({
        kind: 'rolled',
        nextCoupon: '2027-12-01',
      });
      expect(scheduledCouponMonths(early, [buy('b0', '2027-01-10')], DATES)).toEqual([6, 11, 12]);
    });
  });

  // The confirm on `/` rolls off the occurrence it recorded, dated by a walk without the dates.
  it('rolls a confirm a day short of a published date past the occurrence it settled', () => {
    const a = bond({ nextCoupon: '2026-09-22', maturity: '2027-03-24' });
    expect(rollNextCoupon(a, '2026-09-22', ['2026-03-24', '2026-09-23', '2027-03-24'])).toEqual({
      kind: 'rolled',
      nextCoupon: '2027-03-24',
    });
  });

  it('rolls off a published date onto the next one, however long the period between', () => {
    // From a date still listed none between can have been dropped, so not even a period of more
    // than one and a half steps is bridged.
    const a = bond({ nextCoupon: '2026-01-07', maturity: '2027-06-02' });
    const dates = ['2026-01-07', '2026-12-02', '2027-06-02'];
    expect(rollNextCoupon(a, '2026-01-07', dates)).toEqual({
      kind: 'rolled',
      nextCoupon: '2026-12-02',
    });
    // A day after its published date is still that occurrence.
    expect(rollNextCoupon(a, '2026-01-08', dates)).toEqual({
      kind: 'rolled',
      nextCoupon: '2026-12-02',
    });
  });

  it('rolls off a paid date the dates served no longer list onto the next one over a long period', () => {
    // The confirm on `/` runs on or after the payment day, when the provider may have dropped it.
    const a = bond({ nextCoupon: '2026-01-07', maturity: '2027-01-15' });
    expect(rollNextCoupon(a, '2026-01-07', ['2026-07-17', '2027-01-15'])).toEqual({
      kind: 'rolled',
      nextCoupon: '2026-07-17',
    });
  });

  it('rolls a schedule with no period onto the next published date', () => {
    const a = bond({
      payoutSchedule: 'maturity',
      nextCoupon: '2026-01-01',
      maturity: '2026-06-01',
    });
    expect(rollNextCoupon(a, '2026-01-01', ['2026-03-01', '2026-06-01'])).toEqual({
      kind: 'rolled',
      nextCoupon: '2026-03-01',
    });
  });

  // The provider drops a bond's older payments, so the dates served can start a period or more
  // after the stored date.
  describe('behind the first date served', () => {
    const DATES = ['2026-10-14', '2027-04-14'];
    const a = bond({ nextCoupon: '2025-10-15', maturity: '2027-04-14' });
    const ledger = [buy('b0', '2025-09-01'), tx({ id: 'p0', date: '2025-10-15' })];

    it('steps the period, so no coupon between is passed over', () => {
      expect(nextUnsettledCouponDate(a, ledger, { schedule: DATES })).toBe('2026-04-15');
    });

    it('lands on the first date served once a step reaches it', () => {
      const paid = [...ledger, tx({ id: 'p1', date: '2026-04-15' })];
      expect(nextUnsettledCouponDate(a, paid, { schedule: DATES })).toBe('2026-10-14');
    });
  });

  // The issue's own case, where the published period is 182 days and the step already agrees.
  describe('on a 182-day period from 26.08.2026', () => {
    const DATES = ['2026-02-25', '2026-08-26', '2027-02-24', '2027-08-25', '2028-01-01'];
    const a = bond({ nextCoupon: '2026-08-26', maturity: '2028-01-01' });
    const settled = [buy('b0', '2026-02-01'), tx({ id: 'p0', date: '2026-08-26' })];

    it('offers 24.02.2027 when the units were held on 23.02', () => {
      const ledger = [...settled, sell('s0', '2027-02-24')];
      expect(nextUnsettledCouponDate(a, ledger, { schedule: DATES })).toBe('2027-02-24');
    });

    it('does not offer 24.02.2027 to a holder of none who buys on it', () => {
      const ledger = [...settled, sell('s0', '2026-10-01'), buy('b1', '2027-02-24')];
      expect(nextUnsettledCouponDate(a, ledger, { schedule: DATES })).toBe('2027-08-25');
    });
  });

  // A period that ends on the 30th, where a 182-day step reads the 1st: the month moves too.
  describe('across a month end', () => {
    const DATES = [
      '2026-04-02',
      '2026-09-30',
      '2027-03-31',
      '2027-09-29',
      '2028-03-29',
      '2028-09-27',
    ];
    const a = bond({ nextCoupon: '2026-04-02', maturity: '2028-09-27' });
    const ledger = [buy('b0', '2026-03-01'), tx({ id: 'p0', date: '2026-04-02' })];

    it('owes the published date', () => {
      expect(owedCouponDate(a, ledger, undefined, DATES)).toBe('2026-09-30');
      expect(owedCouponDate(a, ledger)).toBe('2026-10-01');
    });

    it("names the published dates' months", () => {
      expect(scheduledCouponMonths(a, ledger, DATES)).toEqual([3, 9]);
      expect(scheduledCouponMonths(a, ledger)).toEqual([4, 9, 10]);
    });

    it('dates the projection on the published date', () => {
      expect(couponProjection(a, 15000, 15, ledger, undefined, DATES)?.date).toBe('2026-09-30');
    });
  });
});

// The stored date estimates a payment: an offline confirm's step lands beside a published date, a
// hand edit further. Where the dates are passed, it stands for the nearest within half a period.
describe('the walk starts on the published date the stored one stands for', () => {
  const buy = (id: string, date: string) =>
    tx({ id, date, type: 'buy', amount: 15000, quantity: 15 });
  const sell = (id: string, date: string) =>
    tx({ id, date, type: 'sell', amount: 15000, quantity: 15 });
  // UA4000235782's published dates (`assets-2026-09-24.json`).
  const DATES_5782 = [
    '2025-12-03',
    '2026-06-03',
    '2026-12-02',
    '2027-06-03',
    '2027-12-01',
    '2028-05-31',
    '2028-11-29',
  ];

  // A confirm of 03.06.2027 made without the feed steps 182 days and stores 02.12.2027.
  describe('a day past a published date, after an offline confirm', () => {
    const a = bond({ nextCoupon: '2027-12-02', maturity: '2028-11-29' });
    const ledger = [
      buy('b0', '2027-01-10'),
      tx({ id: 'p0', date: '2027-06-03' }),
      sell('s0', '2027-12-01'),
    ];

    it('offers the published date to the units held at the end of the day before it', () => {
      expect(nextUnsettledCouponDate(a, ledger, { schedule: DATES_5782 })).toBe('2027-12-01');
      // Without the dates the stored date stands, and its record date is after the sale.
      expect(nextUnsettledCouponDate(a, ledger)).toBeUndefined();
    });
  });

  describe('a hand edit 9 days before a published date', () => {
    const DATES = ['2026-03-10', '2026-09-08', '2027-03-09'];
    const a = bond({ nextCoupon: '2026-03-01', maturity: '2027-03-09' });
    const ledger = [buy('b0', '2026-01-10'), tx({ id: 'p0', date: '2026-03-10' })];

    it('passes the payout recorded on the published date and offers the next one', () => {
      expect(nextUnsettledCouponDate(a, ledger, { schedule: DATES })).toBe('2026-09-08');
    });

    it("names the published dates' months", () => {
      expect(scheduledCouponMonths(a, ledger, DATES)).toEqual([3, 9]);
    });
  });

  it('names one month for a stored date 4 days before the final published date', () => {
    const DATES = ['2025-06-04', '2025-12-03', '2026-06-03'];
    const a = bond({ nextCoupon: '2026-05-30', maturity: '2026-06-03' });
    expect(scheduledCouponMonths(a, [buy('b0', '2025-01-10')], DATES)).toEqual([6]);
  });

  it('stands more than half a period from the first date served, so the step bridges from it', () => {
    const a = bond({ nextCoupon: '2025-10-15', maturity: '2027-04-14' });
    const ledger = [buy('b0', '2025-09-01'), tx({ id: 'p0', date: '2025-10-15' })];
    const DATES = ['2026-10-14', '2027-04-14'];
    expect(nextUnsettledCouponDate(a, ledger, { schedule: DATES })).toBe('2026-04-15');
  });

  it('offers the published date a hand edit 10 days past it stands for, with nothing recorded', () => {
    const a = bond({ nextCoupon: '2027-12-11', maturity: '2028-11-29' });
    const ledger = [buy('b0', '2027-01-10')];
    expect(nextUnsettledCouponDate(a, ledger, { schedule: DATES_5782 })).toBe('2027-12-01');
  });

  describe('30 days before the first date served', () => {
    const DATES = ['2026-10-14', '2027-04-14'];
    const a = bond({ nextCoupon: '2026-09-14', maturity: '2027-04-14' });

    it('offers the first date served to the units held at the end of the day before it', () => {
      const ledger = [buy('b0', '2026-01-10'), sell('s0', '2026-11-01')];
      expect(nextUnsettledCouponDate(a, ledger, { schedule: DATES })).toBe('2026-10-14');
      expect(scheduledCouponMonths(a, ledger, DATES)).toEqual([10]);
    });

    it('passes the occurrence a Skip recorded against the stored date', () => {
      const dismissed = [couponReminderId(a.id, '2026-09-14')];
      const ledger = [buy('b0', '2026-01-10')];
      expect(nextUnsettledCouponDate(a, ledger, { schedule: DATES, dismissed })).toBe('2027-04-14');
    });

    it('passes it for a Skip within the window of the stored date, as for a payout there', () => {
      const ledger = [buy('b0', '2026-01-10')];
      const paid = [...ledger, tx({ id: 'p0', date: '2026-09-17' })];
      const dismissed = [couponReminderId(a.id, '2026-09-17')];
      expect(nextUnsettledCouponDate(a, paid, { schedule: DATES })).toBe('2027-04-14');
      expect(nextUnsettledCouponDate(a, ledger, { schedule: DATES, dismissed })).toBe('2027-04-14');
    });
  });

  // A Skip settles the start only where a payout on its date would: not where a published date
  // beside it, owed and paid by no other payout, claims it.
  describe('a published date beside a Skip claims it, as it claims a payout', () => {
    const DATES = ['2027-02-10', '2027-02-27', '2027-08-27'];
    const a = bond({ nextCoupon: '2027-02-18', maturity: '2027-08-27' });
    const ledger = [buy('b0', '2026-01-10')];
    const skip = { schedule: DATES, dismissed: [couponReminderId(a.id, '2027-02-22')] };

    it('leaves the start owed while the published date beside the Skip is owed', () => {
      const paid = [...ledger, tx({ id: 'p0', date: '2027-02-22' })];
      expect(nextUnsettledCouponDate(a, paid, { schedule: DATES })).toBe('2027-02-10');
      expect(nextUnsettledCouponDate(a, ledger, skip)).toBe('2027-02-10');
    });

    it('settles the start once another payout pays the published date beside it', () => {
      const other = [...ledger, tx({ id: 'q0', date: '2027-02-27' })];
      const paid = [...other, tx({ id: 'p0', date: '2027-02-22' })];
      expect(nextUnsettledCouponDate(a, paid, { schedule: DATES })).toBe('2027-08-27');
      expect(nextUnsettledCouponDate(a, other, skip)).toBe('2027-08-27');
    });

    it('passes the published date within the window of the Skip, as a payout there', () => {
      const start = [...ledger, tx({ id: 's0', date: '2027-02-10' })];
      const paid = [...start, tx({ id: 'p0', date: '2027-02-22' })];
      expect(nextUnsettledCouponDate(a, paid, { schedule: DATES })).toBe('2027-08-27');
      expect(nextUnsettledCouponDate(a, start, skip)).toBe('2027-08-27');
    });
  });

  it('takes the earlier published date at an equal distance, whatever their order', () => {
    // 91 days to each, the half of a 182-day period, so both are within reach.
    const DATES = ['2026-07-02', '2026-01-01', '2026-12-31'];
    const a = bond({ nextCoupon: '2026-04-02', maturity: '2026-12-31' });
    const ledger = [buy('b0', '2025-06-01')];
    expect(nextUnsettledCouponDate(a, ledger, { schedule: DATES })).toBe('2026-01-01');
  });

  it('stands a day past half a period from every published date', () => {
    const DATES = ['2025-12-31', '2026-07-03'];
    const a = bond({ nextCoupon: '2026-04-02', maturity: '2027-01-01' });
    expect(nextUnsettledCouponDate(a, [buy('b0', '2025-06-01')], { schedule: DATES })).toBe(
      '2026-04-02',
    );
  });

  it('owes nothing off a stored date no calendar has', () => {
    const a = bond({ nextCoupon: '2026-13-01', maturity: '2027-03-09' });
    const DATES = ['2026-09-08', '2027-03-09'];
    expect(nextUnsettledCouponDate(a, [buy('b0', '2026-01-10')], { schedule: DATES })).toBe(
      undefined,
    );
  });

  it('keeps the stored date of a schedule with no period', () => {
    const a = bond({
      payoutSchedule: 'maturity',
      nextCoupon: '2026-03-01',
      maturity: '2026-09-08',
    });
    const DATES = ['2026-03-10', '2026-09-08'];
    expect(nextUnsettledCouponDate(a, [buy('b0', '2026-01-10')], { schedule: DATES })).toBe(
      '2026-03-01',
    );
  });

  // A payout entered against the stored date records the same payment as one on the published date.
  describe('a payout recorded beside the stored date', () => {
    const ledger = (payout: string) => [buy('b0', '2027-01-10'), tx({ id: 'p1', date: payout })];

    it('settles the published date a hand edit 10 days past it stands for', () => {
      const a = bond({ nextCoupon: '2027-12-11', maturity: '2028-11-29' });
      const walk = nextUnsettledCouponDate(a, ledger('2027-12-11'), { schedule: DATES_5782 });
      expect(walk).toBe('2028-05-31');
    });

    it('settles the published date an offline confirm stored a day past', () => {
      const a = bond({ nextCoupon: '2027-12-02', maturity: '2028-11-29' });
      const walk = nextUnsettledCouponDate(a, ledger('2027-12-09'), { schedule: DATES_5782 });
      expect(walk).toBe('2028-05-31');
    });

    it('leaves the start owed for a payout beside neither date', () => {
      const a = bond({ nextCoupon: '2027-12-11', maturity: '2028-11-29' });
      const walk = nextUnsettledCouponDate(a, ledger('2027-09-01'), { schedule: DATES_5782 });
      expect(walk).toBe('2027-12-01');
    });

    it('leaves the start owed when the payout sits beside another published date', () => {
      // A short final stub: the 22.05 coupon entered three days late is not the maturity's.
      const DATES = ['2025-11-21', '2026-05-22', '2026-06-06'];
      const a = bond({ nextCoupon: '2026-06-01', maturity: '2026-06-06' });
      const paid = [buy('b0', '2025-01-10'), tx({ id: 'p1', date: '2026-05-25' })];
      expect(nextUnsettledCouponDate(a, paid, { schedule: DATES })).toBe('2026-06-06');
      expect(scheduledCouponMonths(a, paid, DATES)).toEqual([6]);
    });

    // The alias gives the payout to one payment: another date claims it while owed and unpaid.
    describe('a late payout for the start beside another published date', () => {
      const DATES = ['2025-11-21', '2026-05-22', '2026-06-06'];
      const a = bond({ nextCoupon: '2026-05-27', maturity: '2026-06-06' });

      it('settles the start when the other date has a payout of its own', () => {
        const paid = [
          buy('b0', '2025-01-10'),
          tx({ id: 'p1', date: '2026-05-31' }),
          tx({ id: 'p2', date: '2026-06-06' }),
        ];
        expect(nextUnsettledCouponDate(a, paid, { schedule: DATES })).toBe(undefined);
        expect(scheduledCouponMonths(a, paid, DATES)).toEqual([]);
      });

      it('settles the start when the other date is not owed', () => {
        const paid = [
          buy('b0', '2025-01-10'),
          tx({ id: 'p1', date: '2026-05-31' }),
          sell('s0', '2026-06-01'),
        ];
        expect(nextUnsettledCouponDate(a, paid, { schedule: DATES })).toBe(undefined);
      });
    });

    // The published date past the maturity is the start, read as the maturity, not another claimant.
    describe('a stored date past the maturity', () => {
      it('is settled by a payout on it', () => {
        const a = bond({ nextCoupon: '2028-11-29', maturity: '2028-11-20' });
        const paid = [buy('b0', '2027-01-10'), tx({ id: 'p1', date: '2028-11-29' })];
        expect(nextUnsettledCouponDate(a, paid, { schedule: DATES_5782 })).toBe(undefined);
      });

      it('is settled by a payout beside it', () => {
        const a = bond({ nextCoupon: '2028-11-29', maturity: '2028-11-27' });
        const paid = [buy('b0', '2027-01-10'), tx({ id: 'p1', date: '2028-12-05' })];
        expect(nextUnsettledCouponDate(a, paid, { schedule: DATES_5782 })).toBe(undefined);
      });
    });
  });

  // The roll never moves past the maturity, and the start is held to the same bound.
  describe('a published date past the maturity', () => {
    const ledger = [buy('b0', '2027-01-10')];

    it('starts no later than a maturity stored two days before it', () => {
      const a = bond({ nextCoupon: '2028-11-27', maturity: '2028-11-27' });
      expect(nextUnsettledCouponDate(a, ledger, { schedule: DATES_5782 })).toBe('2028-11-27');
    });

    it('starts on the maturity when the date stood for lies past it', () => {
      const a = bond({ nextCoupon: '2028-11-20', maturity: '2028-11-27' });
      expect(nextUnsettledCouponDate(a, ledger, { schedule: DATES_5782 })).toBe('2028-11-27');
    });
  });

  it('keeps the maturity as the one occurrence when no coupon date is stored', () => {
    const a = bond({ nextCoupon: undefined, maturity: '2026-12-31' });
    const ledger = [buy('b0', '2026-01-10')];
    expect(owedCouponDate(a, ledger, undefined, ['2026-10-01'])).toBe('2026-12-31');
    expect(scheduledCouponMonths(a, ledger, ['2026-10-01'])).toEqual([12]);
  });

  // The confirm on `/` rolls off the date its card offered, dated by a walk without the dates, so
  // the roll reads it as the walk's start does: one occurrence named by one date.
  describe('the roll steps off the published date the date it steps off stands for', () => {
    it('leaves a confirm of a hand-edited date past the published date it recorded', () => {
      const a = bond({ nextCoupon: '2027-05-14', maturity: '2028-11-29' });
      const roll = rollNextCoupon(a, '2027-05-14', DATES_5782);
      expect(roll).toEqual({ kind: 'rolled', nextCoupon: '2027-12-01' });
      // Without the dates the roll steps the period.
      expect(rollNextCoupon(a, '2027-05-14')).toEqual({ kind: 'rolled', nextCoupon: '2027-11-12' });
      // The payout keeps the offered date, and the walk offers the next payment either way.
      const rolled = bond({
        nextCoupon: roll?.kind === 'rolled' ? roll.nextCoupon : undefined,
        maturity: '2028-11-29',
      });
      const ledger = [buy('b0', '2027-01-10'), tx({ id: 'p0', date: '2027-05-14' })];
      expect(nextUnsettledCouponDate(rolled, ledger, { schedule: DATES_5782 })).toBe('2027-12-01');
      expect(nextUnsettledCouponDate(rolled, ledger)).toBe('2027-12-01');
    });

    it('matures a confirm of a hand-edited date that stands for the maturity', () => {
      const a = bond({ nextCoupon: '2028-11-09', maturity: '2028-11-29' });
      expect(rollNextCoupon(a, '2028-11-09', DATES_5782)).toEqual({ kind: 'matured' });
      // The pointer stays, and the walk given the dates takes the payout for the final coupon.
      const ledger = [buy('b0', '2027-01-10'), tx({ id: 'p0', date: '2028-11-09' })];
      expect(nextUnsettledCouponDate(a, ledger, { schedule: DATES_5782 })).toBe(undefined);
    });

    it('matures, without throwing, onto a maturity no calendar has', () => {
      const a = bond({ nextCoupon: '2026-12-20', maturity: '2026-13-01' });
      expect(rollNextCoupon(a, '2026-12-20', ['2026-06-20', '2027-01-05'])).toEqual({
        kind: 'matured',
      });
    });

    it('steps a quarterly roll off the date as handed, so the walk keeps a date it bridged short of', () => {
      // 28.05 is the step the walk bridged to, 07.12 more than half a period past the 28.02 step.
      const DATES = ['2027-07-12', '2027-10-12', '2028-01-12'];
      const a = bond({
        payoutSchedule: 'quarterly',
        nextCoupon: '2027-02-28',
        maturity: '2028-01-12',
      });
      expect(rollNextCoupon(a, '2027-05-28', DATES)).toEqual({
        kind: 'rolled',
        nextCoupon: '2027-07-12',
      });
      const paid = [
        buy('b0', '2027-01-10'),
        tx({ id: 'p0', date: '2027-02-28' }),
        tx({ id: 'p1', date: '2027-05-28' }),
      ];
      expect(nextUnsettledCouponDate(a, paid, { schedule: DATES })).toBe('2027-07-12');
    });

    it('rolls a confirm a day either side of a published date past it', () => {
      const a = bond({ nextCoupon: '2027-12-02', maturity: '2028-11-29' });
      expect(rollNextCoupon(a, '2027-12-02', DATES_5782)).toEqual({
        kind: 'rolled',
        nextCoupon: '2028-05-31',
      });
      expect(rollNextCoupon(a, '2027-11-30', DATES_5782)).toEqual({
        kind: 'rolled',
        nextCoupon: '2028-05-31',
      });
    });

    it('bridges with the step from a confirm with no published date within half a period', () => {
      const a = bond({ nextCoupon: '2025-10-15', maturity: '2027-04-14' });
      expect(rollNextCoupon(a, '2025-10-15', ['2026-10-14', '2027-04-14'])).toEqual({
        kind: 'rolled',
        nextCoupon: '2026-04-15',
      });
    });
  });
});

describe('scheduledCouponMonths — D-5, answered forward', () => {
  const bond = (over: Partial<Asset> = {}): Asset =>
    ({
      id: 'b',
      name: 'OVDP',
      code: 'GB',
      colorKey: 'bond',
      yieldType: 'fixed_coupon',
      payoutSchedule: 'semiannual',
      expectedPct: 16.4,
      firstPurchase: '2026-02-05',
      maturity: '2027-02-25',
      couponAmount: 1240,
      nextCoupon: '2026-08-25',
      ...over,
    }) as Asset;

  it('names every scheduled month to maturity, not the one the pointer holds', () => {
    expect(scheduledCouponMonths(bond(), [])).toEqual([2, 8]);
  });

  it('DOES NOT DEGENERATE once the next coupon is paid — the whole of D-5', () => {
    // A set difference against `bondCouponInfo` returns nothing here; the schedule
    // still names February, because February is still a month this bond pays in.
    expect(scheduledCouponMonths(bond({ nextCoupon: '2027-02-25' }), [])).toEqual([2]);
  });

  it('KEEPS THE FINAL COUPON WHEN THE GRID OVERSHOOTS MATURITY (review F1)', () => {
    // A grid step past maturity must not end the walk: `rollNextCoupon` does not
    // break there, it CLAMPS to maturity and pays a final, short coupon. Two readings
    // of one schedule is the thing that must never happen, so the walk is delegated to it.
    const b6475 = bond({ maturity: '2027-05-27', nextCoupon: '2026-12-03', couponAmount: 216 });
    expect(rollNextCoupon(b6475, '2026-12-03')).toEqual({
      kind: 'rolled',
      nextCoupon: '2027-05-27',
    });
    expect(scheduledCouponMonths(b6475, [])).toEqual([5, 12]);
  });

  it('KEEPS A COUPON WHOSE DATE HAS PASSED AND WHICH NOBODY CONFIRMED (review F8)', () => {
    // `nextCoupon` only moves through the S5 confirm, so the day after a coupon falls
    // due it still points at a date in the past. Gating on today dropped a month the
    // app was still reminding about; `nextUnsettledCoupon` is what the reminders read.
    expect(scheduledCouponMonths(bond(), [])).toContain(8);
  });

  it('goes empty once every scheduled coupon has actually been recorded', () => {
    // Settlement ends the schedule, NOT the calendar: the confirm leaves `nextCoupon`
    // on the final date forever, so a today-based cutoff answered differently by the day.
    const settled: Transaction[] = [
      tx({ id: 'c1', date: '2026-08-25', assetId: 'b', amount: 1240 }),
      tx({ id: 'c2', date: '2027-02-25', assetId: 'b', amount: 1240 }),
    ];
    expect(scheduledCouponMonths(bond(), settled)).toEqual([]);
  });

  it('answers for a bond with a maturity and NO nextCoupon (F-18)', () => {
    // The maturity is the anchor `couponProjection` and `bondCouponInfo` read too, through
    // `owedCouponDate`, so the axes and the card agree about one bond.
    expect(scheduledCouponMonths(bond({ nextCoupon: undefined }), [])).toEqual([2]);
  });

  it('a monthly payer names twelve months and stops', () => {
    const monthly = bond({
      payoutSchedule: 'monthly',
      nextCoupon: '2026-08-25',
      maturity: '2030-01-01',
    });
    expect(scheduledCouponMonths(monthly, [])).toHaveLength(12);
  });

  it('terminates for a periodic bond with NO maturity date (review F9)', () => {
    // `maturity` is optional, so `rollNextCoupon` never reports 'matured' here and a
    // semiannual payer collects two months — the twelve-month exit cannot fire. The
    // step bound is what ends it.
    const endless = bond({ maturity: undefined, payoutSchedule: 'semiannual' });
    expect(scheduledCouponMonths(endless, [])).toEqual([2, 8]);
  });

  it('follows rollNextCoupon for a one-payment schedule rather than inventing a rule', () => {
    // With no period, `rollNextCoupon` says the next payment IS maturity, and a pointer
    // set on top of that is a payment too. The walk states what the rest of the app
    // already believes rather than getting a second opinion of its own.
    expect(scheduledCouponMonths(bond({ payoutSchedule: 'maturity' }), [])).toEqual([2, 8]);
    expect(
      scheduledCouponMonths(bond({ payoutSchedule: 'maturity', nextCoupon: undefined }), []),
    ).toEqual([2]);
    expect(
      scheduledCouponMonths(bond({ payoutSchedule: 'none', nextCoupon: undefined }), []),
    ).toEqual([2]);
  });
});

describe('rollbackNextCoupon — deleting a confirmed coupon gives its occurrence back', () => {
  // The confirm's own effect: the payout sits on the COUPON's date, pointer already rolled.
  const confirmed = bond({ nextCoupon: '2027-02-25' });
  const payout = tx({ date: '2026-08-25' });

  it('restores the occurrence the deleted payout was settling', () => {
    expect(rollbackNextCoupon(confirmed, payout, [])).toBe('2026-08-25');
  });

  it('leaves the pointer alone when a duplicate still settles that occurrence', () => {
    const duplicate = tx({ id: 't2', date: '2026-08-27' }); // inside the ±7-day window
    expect(rollbackNextCoupon(confirmed, payout, [duplicate])).toBeUndefined();
  });

  it('ignores a payout that never moved the pointer', () => {
    // On or after the pointer: the pointer only ever sits on an OPEN occurrence.
    expect(rollbackNextCoupon(confirmed, tx({ date: '2027-02-25' }), [])).toBeUndefined();
    expect(rollbackNextCoupon(confirmed, tx({ date: '2027-08-25' }), [])).toBeUndefined();
  });

  it('ignores every other kind of row, and every other asset', () => {
    expect(rollbackNextCoupon(confirmed, tx({ type: 'buy' }), [])).toBeUndefined();
    expect(rollbackNextCoupon(confirmed, tx({ type: 'reinvest' }), [])).toBeUndefined();
    expect(rollbackNextCoupon(confirmed, tx({ assetId: 'reit' }), [])).toBeUndefined();
  });

  it('ignores an asset that has no coupon grid at all', () => {
    const fund = bond({ yieldType: 'dividends', nextCoupon: undefined });
    expect(rollbackNextCoupon(fund, payout, [])).toBeUndefined();
  });

  // THE PROPERTY THAT MAKES ROLLING BACK SAFE, and the reason no backward stepper is
  // needed: the pointer may land on an occurrence older than the immediate predecessor,
  // because the forward walk steps over everything still settled.
  it('hands the walk an older occurrence without stranding the newer ones', () => {
    const twoAhead = bond({ nextCoupon: '2027-02-25' });
    const restored = rollbackNextCoupon(twoAhead, payout, [])!;
    const reopened = bond({ nextCoupon: restored });
    expect(nextUnsettledCoupon(reopened, [])).toEqual({ date: '2026-08-25', amount: 1240 });
    expect(nextUnsettledCoupon(reopened, [payout])).toEqual({ date: '2027-02-25', amount: 1240 });
  });
});

describe('couponPerPayment — the rate is fixed, the amount is not', () => {
  const bond = (over: Partial<Asset> = {}): Asset => ({
    id: 'b',
    name: 'OVDP UA4000238976',
    code: 'GB',
    colorKey: 'ovdp8976',
    yieldType: 'fixed_coupon',
    expectedPct: 16.4,
    targetPct: 17,
    payoutSchedule: 'semiannual',
    firstPurchase: '2026-02-05',
    createdAt: '2026-02-05T10:00:00',
    ...over,
  });

  it("falls back to the LINK's legacy total when the ledger cannot count", () => {
    // A linked bond can carry `inzhur.units` and no ledger quantities, so reading the
    // ledger alone fell past a rate the asset HAS to the stale whole-position amount —
    // while the coupon card one screen over scaled the per-unit figure by this very
    // count. Units are the ledger’s, and a coupon derives from its rate.
    // *Metric families and windows*
    const linked = bond({
      couponRatePct: 15.68,
      couponAmount: 1240,
      inzhur: { kind: 'bond', ref: 'UA4000238976', units: 15 },
    });
    expect(couponPerPayment(linked, undefined)).toBe(1176);
    // THE LEDGER WINS WHENEVER IT CAN SPEAK, and a closed position is something it can say.
    expect(couponPerPayment(linked, 20)).toBe(1568);
    expect(couponPerPayment(linked, 0)).toBeUndefined();
    // Neither source knows → the legacy amount, unscaled, which is why the fallback exists.
    expect(couponPerPayment(bond({ couponRatePct: 15.68, couponAmount: 1240 }), undefined)).toBe(
      1240,
    );
  });

  it('answers nothing for a non-bond, even one carrying a legacy amount', () => {
    // A `div_cap` asset one stray `couponAmount` away would report a coupon to any
    // caller that forgot its own filter, so the gate belongs here and not in each of them.
    expect(
      couponPerPayment(bond({ yieldType: 'div_cap', couponAmount: 1240 }), 15),
    ).toBeUndefined();
    expect(
      couponPerPayment(bond({ yieldType: 'dividends', couponRatePct: 15.68 }), 15),
    ).toBeUndefined();
  });

  it('agrees with the provider schedule BY CONSTRUCTION, not by luck', () => {
    // The rate is derived from the published per-unit coupon
    // (docs/reference/OVDP-COUPON-STRUCTURE.md); going back the other way must land on
    // it exactly, or the rate and the feed would be two bases for one coupon.
    expect(couponPerPayment(bond({ couponRatePct: 15.68 }), 1)).toBe(78.4);
    expect(OVDP_FACE_UAH).toBe(1000);
  });

  it('SCALES with the holding — the whole point', () => {
    const b = bond({ couponRatePct: 15.68 });
    expect(couponPerPayment(b, 100)).toBe(7840);
    expect(couponPerPayment(b, 200)).toBe(15680);
    // The defect it replaces: a stored ₴ figure answers the same on both.
    expect(couponPerPayment(b, 200)).not.toBe(couponPerPayment(b, 100));
  });

  it('honours the payout schedule rather than assuming semiannual', () => {
    // Every OVDP measured pays twice a year, but the field admits five schedules and
    // the divisor must follow it.
    expect(couponPerPayment(bond({ couponRatePct: 16, payoutSchedule: 'quarterly' }), 1)).toBe(40);
    expect(couponPerPayment(bond({ couponRatePct: 16, payoutSchedule: 'semiannual' }), 1)).toBe(80);
  });

  it('falls back to the LEGACY stored amount, unscaled', () => {
    // The seed's two bonds are why this path must work: a hand-typed whole-position
    // figure and no quantities to scale a rate by.
    const legacy = bond({ couponAmount: 1240 });
    expect(couponPerPayment(legacy, undefined)).toBe(1240);
    expect(couponPerPayment(legacy, 999)).toBe(1240); // unscaled, deliberately
  });

  it('prefers the rate over a legacy amount when both are present', () => {
    expect(couponPerPayment(bond({ couponRatePct: 15.68, couponAmount: 1240 }), 100)).toBe(7840);
  });

  it('a CLOSED position reports nothing, not the stale legacy amount', () => {
    // Units are KNOWN and the holding is gone: the old whole-position figure would
    // advertise a coupon nobody will receive, and prefill a transaction for it.
    const both = bond({ couponRatePct: 15.68, couponAmount: 1240 });
    expect(couponPerPayment(both, 0)).toBeUndefined();
    expect(couponPerPayment(both, 100)).toBe(7840);
  });

  it('an UNCOUNTABLE ledger keeps the legacy amount — the rate cannot answer', () => {
    // The other half, and collapsing the two broke this one: when the ledger cannot
    // count the asset at all, the rate has nothing to scale and the legacy figure is
    // the only number the asset has. Suppressing it emptied the coupon out of
    // /attributes, the due card, the ghost accrual and the projection at once — for
    // exactly the pre-#31 bonds the fallback protects.
    const both = bond({ couponRatePct: 15.68, couponAmount: 1240 });
    expect(couponPerPayment(both, undefined)).toBe(1240);
    expect(couponPerPayment(bond({ couponRatePct: 15.68 }), undefined)).toBeUndefined();
  });

  it('cannot answer from a rate alone — units are required', () => {
    // Returning 0 would read as "this bond pays nothing", a different and wrong claim.
    expect(couponPerPayment(bond({ couponRatePct: 15.68 }), undefined)).toBeUndefined();
    expect(couponPerPayment(bond({ couponRatePct: 15.68 }), 0)).toBeUndefined();
  });

  it('is undefined when the asset states neither', () => {
    expect(couponPerPayment(bond(), 100)).toBeUndefined();
  });
});

describe('a closed position pays no coupon, whichever figure would have answered', () => {
  // The rule must sit OUTSIDE the rate branch: inside it, a legacy bond fell past and
  // reported its whole stated `couponAmount` for a holding that is gone.
  const legacy: Asset = {
    id: 'ovdp',
    name: 'OVDP UA4000238976',
    code: 'GB',
    colorKey: 'ovdp8976',
    yieldType: 'fixed_coupon',
    expectedPct: 17,
    targetPct: 17,
    payoutSchedule: 'semiannual',
    firstPurchase: '2026-02-05',
    createdAt: '2026-02-05T10:00:00',
    couponAmount: 1240,
  };

  it('returns undefined for a legacy bond whose position is closed', () => {
    expect(couponPerPayment(legacy, 0)).toBeUndefined();
    expect(couponPerPayment(legacy, -5)).toBeUndefined();
  });

  it('still returns the legacy amount when the count is UNKNOWN', () => {
    // `undefined` is a different question from 0 — the ledger cannot count this asset,
    // and the stated figure is the only one it has.
    expect(couponPerPayment(legacy, undefined)).toBe(1240);
  });

  it('applies the same rule to a rate-bearing bond', () => {
    const rated: Asset = { ...legacy, couponAmount: undefined, couponRatePct: 15.68 };
    expect(couponPerPayment(rated, 0)).toBeUndefined();
    expect(couponPerPayment(rated, 15)).toBeCloseTo(1176, 0);
  });
});
