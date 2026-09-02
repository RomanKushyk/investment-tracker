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
  rollNextCoupon,
  rollbackNextCoupon,
  suggestedQuote,
  scheduledCouponMonths,
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
    // The schedule branch is covered above; this is the half that derives its
    // dates by arithmetic, and a regression that passed `anchor` — or
    // `fromExclusive` — to the resolver would return the same constant every
    // other grid test asserts and sail through the suite. Only a resolver that
    // VARIES by date can catch it.
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
    );
    // ONLY the counted dates reach the resolver — no probe of its own. The
    // pairing guard moved to `accrualSuggestion`, which is the only place that
    // holds both this figure and the one `dailyAccrual` was built from; asking
    // here read the ledger on a shifted date and answered a different question.
    // The quarterly grid back from 25.08: 25.02 and 25.05 fall in the window
    // alongside the anchor itself, each with its OWN date.
    expect(seen).toEqual(['2026-02-25', '2026-05-25', '2026-08-25']);
  });

  it('sizes EACH coupon on its own date, not all of them on the drafted one', () => {
    // THE DEFECT THIS CLOSES arrived with D119: the caller derives one figure
    // from the units held on the DRAFTED date, and this function multiplied it
    // by every coupon in the gap — coupons the position was a different size
    // for. Hold 10 units through a coupon, double the position days later, draft
    // after that, and the gap subtracted 20 units' worth of a payment that paid
    // on 10.
    const b = bond({ nextCoupon: '2026-08-25', payoutSchedule: 'semiannual' });
    const schedule = ['2026-02-25', '2026-08-25'];
    // 78,40 per unit per coupon: 10 units on 25.02, 20 on 25.08.
    const perDate = (d: string) => (d === '2026-02-25' ? 784 : 1568);
    expect(couponsInGap(b, perDate, '2026-01-01', '2026-12-31', schedule)).toBe(784 + 1568);
    // A single figure would have answered 1568 × 2 — the number the old
    // signature could not avoid.
    expect(couponsInGap(b, () => 1568, '2026-01-01', '2026-12-31', schedule)).toBe(3136);
    // A date the ledger cannot count contributes nothing rather than NaN — and
    // this now exercises the `?? 0` fallback itself, since nothing short-circuits
    // ahead of the reduce any more.
    expect(couponsInGap(b, () => undefined, '2026-01-01', '2026-12-31', schedule)).toBe(0);
    // THE ORDINARY MIXED CASE, which had no coverage while a guard swallowed it:
    // a bond bought AFTER the February coupon answers for August and not for
    // February, so exactly one of the two is subtracted.
    expect(
      couponsInGap(
        b,
        (d) => (d === '2026-02-25' ? undefined : 1568),
        '2026-01-01',
        '2026-12-31',
        schedule,
      ),
    ).toBe(1568);
  });

  it('finds the scheduled coupon inside the gap', () => {
    expect(couponsInGap(bond(), () => 1240, '2026-08-20', '2026-08-27')).toBe(1240);
  });

  it('excludes the gap start and includes its end', () => {
    // A coupon ON the last-quote date is already priced into that quote.
    expect(couponsInGap(bond(), () => 1240, '2026-08-25', '2026-08-27')).toBe(0);
    expect(couponsInGap(bond(), () => 1240, '2026-08-24', '2026-08-25')).toBe(1240);
  });

  it('is 0 when no coupon date falls in the gap', () => {
    expect(couponsInGap(bond(), () => 1240, '2026-07-25', '2026-08-04')).toBe(0);
  });

  it('finds a gap coupon that sits BEHIND the anchor (nextCoupon already rolled)', () => {
    expect(
      couponsInGap(bond({ nextCoupon: '2027-02-25' }), () => 1240, '2026-08-20', '2026-08-27'),
    ).toBe(1240);
  });

  it('sums every coupon of a long gap', () => {
    expect(couponsInGap(bond(), () => 1240, '2026-01-01', '2026-09-01')).toBe(2480);
  });

  it('treats a maturity-only schedule as its single payment', () => {
    const single = bond({ payoutSchedule: 'maturity', nextCoupon: '2027-02-25' });
    expect(couponsInGap(single, () => 1240, '2027-02-20', '2027-02-27')).toBe(1240);
    expect(couponsInGap(single, () => 1240, '2026-08-20', '2026-08-27')).toBe(0);
  });

  it('is 0 without the attributes it needs', () => {
    expect(
      couponsInGap(bond({ couponAmount: undefined }), () => undefined, '2026-08-20', '2026-08-27'),
    ).toBe(0);
    expect(
      couponsInGap(bond({ nextCoupon: undefined }), () => 1240, '2026-08-20', '2026-08-27'),
    ).toBe(0);
  });

  // Regression: the grid used to be rebuilt by stepping BACK with addMonths and
  // then forward again, which is not an inverse once the month-end clamp fires
  // (2026-08-31 −1m → 07-31 −1m → 06-30, then +1m → 07-30 ≠ 07-31). A month-end
  // anchor therefore drifted onto dates the asset never pays on and counted a
  // phantom coupon — money the S4 ghost subtracts.
  describe('a month-end anchor stays on the asset own grid (clamp regression)', () => {
    const eom = (over: Partial<Asset> = {}) => bond({ nextCoupon: '2026-08-31', ...over });

    it('counts the real monthly dates, not the drifted ones', () => {
      // Real grid around the gap: 06-30, 07-31 (08-31 is past `to`).
      expect(
        couponsInGap(eom({ payoutSchedule: 'monthly' }), () => 1240, '2026-06-15', '2026-08-30'),
      ).toBe(2 * 1240);
    });

    it('counts the real quarterly date', () => {
      // Real grid: 2026-02-28, 05-31, 08-31 → only 05-31 is inside the gap.
      expect(
        couponsInGap(eom({ payoutSchedule: 'quarterly' }), () => 1240, '2026-04-01', '2026-08-30'),
      ).toBe(1240);
    });

    it('counts the real semiannual date', () => {
      // Real grid: 2026-02-28, 08-31 → only 02-28 is inside the gap.
      expect(couponsInGap(eom(), () => 1240, '2025-12-01', '2026-08-30')).toBe(1240);
    });

    it('keeps the anchor itself on the grid it reconstructs', () => {
      expect(
        couponsInGap(eom({ payoutSchedule: 'monthly' }), () => 1240, '2026-08-30', '2026-08-31'),
      ).toBe(1240);
    });
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
    expect(
      dueCoupons([bond()], [tx({ date: '2026-09-01' })], '2026-09-04', { windowDays: 30 }),
    ).toEqual([]);
  });

  // Regression: `nextCoupon` only ever moves through the S5 confirm, so a coupon
  // recorded in the Transaction panel used to freeze the pointer AND silence the
  // card for good. The walk hands the floor to the next occurrence instead.
  it('advances to the next occurrence when the pointer sits on a settled one', () => {
    const recorded = [tx()]; // the 25.08 coupon, entered by hand
    // Nothing is due yet — the February coupon is still ahead.
    expect(dueCoupons([bond()], recorded, '2026-09-04')).toEqual([]);
    // …and once IT arrives, the card offers it, pointer untouched.
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
      nextCoupon: '2027-02-25',
    });
  });

  it('has nothing to roll without a next coupon', () => {
    expect(rollNextCoupon(bond({ nextCoupon: undefined }))).toBeUndefined();
  });

  it('rolls off an explicit occurrence date when the pointer lags behind it', () => {
    // The confirm records the occurrence the CARD offered (2027-02-25 here) while
    // the stored pointer still sits on a settled 2026-08-25.
    expect(rollNextCoupon(bond(), '2026-02-25')).toEqual({
      kind: 'rolled',
      nextCoupon: '2026-08-25',
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
    expect(couponProjection(bond(), 15390, undefined)).toEqual({
      amount: 1240,
      date: '2026-08-25',
      estimated: false,
    });
    // Invested capital is irrelevant to a stated coupon.
    expect(couponProjection(bond(), 0, undefined)?.amount).toBe(1240);
  });

  it('estimates the amount from expectedPct × invested when no coupon is stated', () => {
    const user = bond({ couponAmount: undefined });
    // 16.4 % of 15 390,00, half-yearly = 1 261,98 — close to the real 1 240,00.
    expect(couponProjection(user, 15390, undefined)).toEqual({
      amount: 1261.98,
      date: '2026-08-25',
      estimated: true,
    });
    expect(
      couponProjection(
        bond({ couponAmount: undefined, payoutSchedule: 'monthly' }),
        15390,
        undefined,
      ),
    ).toEqual({ amount: 210.33, date: '2026-08-25', estimated: true });
  });

  it('falls back to the maturity date when no next coupon is stated', () => {
    expect(couponProjection(bond({ nextCoupon: undefined }), 15390, undefined)).toEqual({
      amount: 1240,
      date: '2027-02-25',
      estimated: false,
    });
  });

  it('never invents a date or an amount', () => {
    expect(
      couponProjection(bond({ nextCoupon: undefined, maturity: undefined }), 15390, undefined),
    ).toBeUndefined();
    expect(couponProjection(bond({ couponAmount: undefined }), 0, undefined)).toBeUndefined();
    expect(
      couponProjection(bond({ couponAmount: undefined, expectedPct: 0 }), 15390, undefined),
    ).toBeUndefined();
    expect(
      couponProjection(bond({ couponAmount: undefined, payoutSchedule: 'none' }), 15390, undefined),
    ).toBeUndefined();
    expect(couponProjection(bond({ yieldType: 'div_cap' }), 15390, undefined)).toBeUndefined();
  });
});

describe('couponReminderId', () => {
  it('is the derived id both the S5 skip and the S6 reminders use', () => {
    expect(couponReminderId('ovdp8976', '2026-08-25')).toBe('coupon:ovdp8976:2026-08-25');
  });
});

describe('dailyAccrual over a real coupon period', () => {
  // The user's UA4000238976: 78.40 per unit every 182 days, verified against the
  // live feed (always a Wednesday, never "six calendar months").
  const schedule = ['2026-03-25', '2026-09-23', '2027-03-24'];

  it('lands exactly on the coupon when the period is known', () => {
    const days = couponPeriodDays(schedule, '2026-05-01');
    expect(days).toBe(182);
    expect(dailyAccrual(78.4, 'semiannual', undefined, days) * days!).toBeCloseTo(78.4, 10);
  });

  it('the annualised approximation does NOT land on the coupon', () => {
    // This is the defect the periodDays argument exists to fix: ₴3,40 short
    // over a 182-day period on a ₴1 240 coupon, and ₴10,19 over on a 184-day one.
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

describe('the published schedule beats the month grid (A1)', () => {
  // UA4000238976 as the feed actually publishes it: every 182 days, always a
  // Wednesday. `addMonths(anchor, 6)` from the same anchor lands on the 25th.
  const REAL = ['2026-03-24', '2026-09-23', '2027-03-24'];
  const linked = () =>
    bond({ nextCoupon: '2026-09-25', couponAmount: 1240, maturity: '2027-03-24' });

  it('counts the coupon on the real date, not the grid date', () => {
    const a = linked();
    // A gap that contains the REAL date but ends before the grid's 25th.
    expect(couponsInGap(a, () => 1240, '2026-09-20', '2026-09-24', REAL)).toBe(1240);
    // Without the schedule the same gap sees nothing — the defect, pinned.
    expect(couponsInGap(a, () => 1240, '2026-09-20', '2026-09-24')).toBe(0);
  });

  it('does not count it twice when the gap spans both dates', () => {
    expect(couponsInGap(linked(), () => 1240, '2026-09-01', '2026-09-30', REAL)).toBe(1240);
  });

  it('counts the maturity date once, though the schedule lists it twice', () => {
    // The final row is coupon AND principal on one date; only one is a coupon.
    const withDuplicate = [...REAL, '2027-03-24'];
    expect(couponsInGap(linked(), () => 1240, '2027-03-01', '2027-03-31', withDuplicate)).toBe(
      1240,
    );
  });

  it('rolls to the published date', () => {
    expect(rollNextCoupon(linked(), '2026-03-24', REAL)).toEqual({
      kind: 'rolled',
      nextCoupon: '2026-09-23',
    });
    // Same call without the schedule drifts to the 24th of the grid month.
    expect(rollNextCoupon(linked(), '2026-03-24')).toEqual({
      kind: 'rolled',
      nextCoupon: '2026-09-24',
    });
  });

  it('still clamps at maturity with a schedule', () => {
    expect(rollNextCoupon(linked(), '2027-03-24', REAL)).toEqual({ kind: 'matured' });
  });

  it('falls back to the grid for an asset with no linked schedule', () => {
    // The non-regression that protects every existing seed-coupled test.
    expect(couponsInGap(linked(), () => 1240, '2026-09-20', '2026-09-26', undefined)).toBe(1240);
    expect(rollNextCoupon(linked(), '2026-03-25', undefined)).toEqual({
      kind: 'rolled',
      nextCoupon: '2026-09-25',
    });
  });
});

describe('scheduledCouponMonths (A41) — D-5, answered forward', () => {
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
    // …8976's shape: August now, February at maturity.
    expect(scheduledCouponMonths(bond(), [])).toEqual([2, 8]);
  });

  it('DOES NOT DEGENERATE once the next coupon is paid — the whole of D-5', () => {
    // The failure both of the sheet's formulations had. A set difference
    // against `bondCouponInfo` returns nothing here; the schedule still names
    // February, because February is still a month this bond pays in.
    expect(scheduledCouponMonths(bond({ nextCoupon: '2027-02-25' }), [])).toEqual([2]);
  });

  it('KEEPS THE FINAL COUPON WHEN THE GRID OVERSHOOTS MATURITY (review F1)', () => {
    // …6475's real shape, and the normal case rather than the edge: 03.12.2026
    // + 6 months is 03.06.2027, which is PAST the 27.05.2027 maturity. Breaking
    // there dropped травень, and `rollNextCoupon` does not break — it CLAMPS to
    // maturity and pays a final, short coupon. Two readings of one schedule is
    // the thing that must never happen, so the walk is delegated to it.
    const b6475 = bond({ maturity: '2027-05-27', nextCoupon: '2026-12-03', couponAmount: 216 });
    expect(rollNextCoupon(b6475, '2026-12-03')).toEqual({
      kind: 'rolled',
      nextCoupon: '2027-05-27',
    });
    expect(scheduledCouponMonths(b6475, [])).toEqual([5, 12]);
  });

  it('KEEPS A COUPON WHOSE DATE HAS PASSED AND WHICH NOBODY CONFIRMED (review F8)', () => {
    // `nextCoupon` only ever moves through the S5 confirm, so the day after a
    // coupon falls due it still points at a date in the past. Gating on today
    // dropped серпень for a coupon the app was still actively reminding about —
    // and the DAY axis kept drawing it, because `couponProjection` takes no
    // date at all. `nextUnsettledCoupon` is what the reminders read, so it is
    // what this reads.
    expect(scheduledCouponMonths(bond(), [])).toContain(8);
  });

  it('goes empty once every scheduled coupon has actually been recorded', () => {
    // The genuine "nothing left to expect". It is settlement that ends the
    // schedule, NOT the calendar: the confirm leaves `nextCoupon` sitting on
    // the final date forever, so a today-based cutoff either kept a phantom
    // February bar or dropped a real one, depending on the day it ran.
    const settled: Transaction[] = [
      tx({ id: 'c1', date: '2026-08-25', assetId: 'b', amount: 1240 }),
      tx({ id: 'c2', date: '2027-02-25', assetId: 'b', amount: 1240 }),
    ];
    expect(scheduledCouponMonths(bond(), settled)).toEqual([]);
  });

  it('answers for a bond with a maturity and NO nextCoupon (F-18)', () => {
    // `couponProjection` falls back to the maturity date and still projects;
    // `bondCouponInfo` does not, which is why the two axes could disagree about
    // one bond. This matches the projection.
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
    // `maturity` is optional, so `rollNextCoupon` never reports 'matured' here
    // and a semiannual payer only ever collects two distinct months — the
    // twelve-months exit can never fire. The step bound is what ends it.
    const endless = bond({ maturity: undefined, payoutSchedule: 'semiannual' });
    expect(scheduledCouponMonths(endless, [])).toEqual([2, 8]);
  });

  it('follows rollNextCoupon for a one-payment schedule rather than inventing a rule', () => {
    // With no period, `rollNextCoupon` says the next payment IS maturity. A
    // pointer set on top of that is a payment too, so both months are named —
    // the walk states what the rest of the app already believes, and does not
    // get a second opinion of its own.
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
  // The confirm's own effect, reproduced: the payout is written on the COUPON's
  // date and the pointer rolls to the next occurrence.
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

  // THE PROPERTY THAT MAKES ROLLING BACK SAFE, and the reason no backward stepper
  // is needed: the pointer may land on an occurrence older than the immediate
  // predecessor, because the forward walk steps over everything still settled.
  it('hands the walk an older occurrence without stranding the newer ones', () => {
    const twoAhead = bond({ nextCoupon: '2027-02-25' });
    const restored = rollbackNextCoupon(twoAhead, payout, [])!;
    const reopened = bond({ nextCoupon: restored });
    // Nothing settles 25.08 any more, so that is what the walk offers.
    expect(nextUnsettledCoupon(reopened, [])).toEqual({ date: '2026-08-25', amount: 1240 });
    // Record it again and the walk returns to where the pointer had been.
    expect(nextUnsettledCoupon(reopened, [payout])).toEqual({ date: '2027-02-25', amount: 1240 });
  });
});

describe('couponPerPayment — the rate is fixed, the amount is not (D119)', () => {
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

  it("falls back to the LINK's legacy total when the ledger cannot count (D117)", () => {
    // The two-source rule `matchAssets` and `couponPrefill` both apply, and this
    // was the one consumer that read only the ledger. A pre-D117 linked bond has
    // `inzhur.units` and no quantities, so reading the ledger alone fell past a
    // rate the asset HAS to the stale whole-position amount — while the coupon
    // card one screen over scaled the feed's per-unit figure by this very count.
    const linked = bond({
      couponRatePct: 15.68,
      couponAmount: 1240,
      inzhur: { kind: 'bond', ref: 'UA4000238976', units: 15 },
    });
    expect(couponPerPayment(linked, undefined)).toBe(1176); // 15,68 % × 1000 × 15 / 2
    // THE LEDGER WINS WHENEVER IT CAN SPEAK — it is the newer truth, and a
    // closed position is something it can say.
    expect(couponPerPayment(linked, 20)).toBe(1568);
    expect(couponPerPayment(linked, 0)).toBeUndefined();
    // Neither source knows → the legacy amount, unscaled. That is D117's third
    // state and the reason the fallback still exists.
    expect(couponPerPayment(bond({ couponRatePct: 15.68, couponAmount: 1240 }), undefined)).toBe(
      1240,
    );
  });

  it('answers nothing for a non-bond, even one carrying a legacy amount', () => {
    // `couponProjection` gates on the yield type and this did not, so a
    // `div_cap` asset one stray `couponAmount` away — the seed's REIT — would
    // report a coupon to any caller that forgot its own filter. Four call sites
    // filter today; the gate belongs here rather than in each of them.
    expect(
      couponPerPayment(bond({ yieldType: 'div_cap', couponAmount: 1240 }), 15),
    ).toBeUndefined();
    expect(
      couponPerPayment(bond({ yieldType: 'dividends', couponRatePct: 15.68 }), 15),
    ).toBeUndefined();
  });

  it('agrees with the provider schedule BY CONSTRUCTION, not by luck', () => {
    // UA4000238976 publishes ₴78.40 per unit per coupon on a ₴1000 nominal, so
    // its rate is 78.40 / 5 = 15.68 % (docs/reference/OVDP-COUPON-STRUCTURE.md).
    // Going back the other way must land exactly on the published figure, or the
    // rate and the feed would be two bases for one coupon.
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
    // Every OVDP measured pays twice a year, but the field admits five schedules
    // and the divisor must follow it — a quarterly bond at the same rate pays
    // half as much per coupon, four times a year.
    expect(couponPerPayment(bond({ couponRatePct: 16, payoutSchedule: 'quarterly' }), 1)).toBe(40);
    expect(couponPerPayment(bond({ couponRatePct: 16, payoutSchedule: 'semiannual' }), 1)).toBe(80);
  });

  it('falls back to the LEGACY stored amount, unscaled', () => {
    // The seed's two bonds are why this path still has to work: they carry a
    // hand-typed whole-position figure and no quantities to scale a rate by.
    const legacy = bond({ couponAmount: 1240 });
    expect(couponPerPayment(legacy, undefined)).toBe(1240);
    expect(couponPerPayment(legacy, 999)).toBe(1240); // unscaled, deliberately
  });

  it('prefers the rate over a legacy amount when both are present', () => {
    expect(couponPerPayment(bond({ couponRatePct: 15.68, couponAmount: 1240 }), 100)).toBe(7840);
  });

  it('a CLOSED position reports nothing, not the stale legacy amount', () => {
    // Units are KNOWN and the holding is gone. Reporting the old whole-position
    // figure would print "₴1 240 twice a year" for a position that no longer
    // exists, and prefill a transaction for a coupon nobody will receive.
    const both = bond({ couponRatePct: 15.68, couponAmount: 1240 });
    expect(couponPerPayment(both, 0)).toBeUndefined();
    expect(couponPerPayment(both, 100)).toBe(7840);
  });

  it('an UNCOUNTABLE ledger keeps the legacy amount — the rate cannot answer', () => {
    // The other half, and collapsing the two broke this one: when the ledger
    // cannot count the asset at all, the rate has nothing to scale, so the
    // legacy figure is the only number the asset has. Suppressing it emptied the
    // coupon out of /attributes, the due card, the ghost accrual and the
    // projection at once — for exactly the pre-#31 bonds the fallback protects.
    const both = bond({ couponRatePct: 15.68, couponAmount: 1240 });
    expect(couponPerPayment(both, undefined)).toBe(1240);
    // With no legacy figure either, there is genuinely nothing to report.
    expect(couponPerPayment(bond({ couponRatePct: 15.68 }), undefined)).toBeUndefined();
  });

  it('cannot answer from a rate alone — units are required', () => {
    // A rate with no holding is not a coupon. Returning 0 would read as "this
    // bond pays nothing", which is a different and wrong claim.
    expect(couponPerPayment(bond({ couponRatePct: 15.68 }), undefined)).toBeUndefined();
    expect(couponPerPayment(bond({ couponRatePct: 15.68 }), 0)).toBeUndefined();
  });

  it('is undefined when the asset states neither', () => {
    expect(couponPerPayment(bond(), 100)).toBeUndefined();
  });
});

describe('a closed position pays no coupon, whichever figure would have answered', () => {
  // The rule used to live INSIDE the rate branch, so a legacy bond — both of the
  // seed's — fell past it and reported its whole stated `couponAmount` for a
  // holding that is gone.
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
    // `undefined` is a different question from 0: the ledger cannot count this
    // asset, and the stated figure is the only one it has.
    expect(couponPerPayment(legacy, undefined)).toBe(1240);
  });

  it('applies the same rule to a rate-bearing bond', () => {
    const rated: Asset = { ...legacy, couponAmount: undefined, couponRatePct: 15.68 };
    expect(couponPerPayment(rated, 0)).toBeUndefined();
    expect(couponPerPayment(rated, 15)).toBeCloseTo(1176, 0);
  });
});
