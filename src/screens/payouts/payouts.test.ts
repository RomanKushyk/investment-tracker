import { describe, expect, it } from 'vitest';

import { SEED_TRANSACTIONS } from '../../lib/seed';
import { monthlyPayouts, payoutLogRows } from './payouts';

describe('monthlyPayouts', () => {
  const months = monthlyPayouts(SEED_TRANSACTIONS);

  it('aggregates dividends/coupons per month, six months present, chronological', () => {
    expect(months.map((m) => m.month)).toEqual([
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
  });

  it('Feb combines REIT dividend + …8976 coupon = 1 763,70', () => {
    const feb = months.find((m) => m.month === '2026-02')!;
    expect(feb.dividends).toBeCloseTo(580.2, 2);
    expect(feb.coupons).toBeCloseTo(1183.5, 2);
    expect(feb.total).toBeCloseTo(1763.7, 2);
  });

  it('May reflects the D5#3 adjusted 472,13 dividend, not the reference 648,13', () => {
    const may = months.find((m) => m.month === '2026-05')!;
    expect(may.total).toBeCloseTo(472.13, 2);
  });

  it('June combines REIT dividend + …6475 coupon = 896,55', () => {
    const jun = months.find((m) => m.month === '2026-06')!;
    expect(jun.dividends).toBeCloseTo(680.55, 2);
    expect(jun.coupons).toBeCloseTo(216, 2);
    expect(jun.total).toBeCloseTo(896.55, 2);
  });
});

describe('payoutLogRows', () => {
  const rows = payoutLogRows(SEED_TRANSACTIONS);

  it('newest first, one row per dividend/coupon transaction', () => {
    expect(rows[0].date).toBe('2026-07-10');
    expect(rows).toHaveLength(8);
  });

  it('destination derives "reinvested (₴X,XX)" from a same-date same-asset reinvest tx', () => {
    const jul10 = rows.find((r) => r.date === '2026-07-10')!;
    expect(jul10.destination).toBe('reinvested (₴687,02)');
    const jun10 = rows.find((r) => r.date === '2026-06-10')!;
    expect(jun10.destination).toBe('reinvested (₴484,36)');
    const jun03 = rows.find((r) => r.date === '2026-06-03')!;
    expect(jun03.destination).toBe('reinvested (₴216,00)');
  });

  it('falls back to "account" with no matching reinvest (D5#3: the moved 472,13/10.05 row)', () => {
    const may10 = rows.find((r) => r.date === '2026-05-10')!;
    expect(may10.amount).toBeCloseTo(472.13, 2);
    expect(may10.destination).toBe('account');
  });
});
