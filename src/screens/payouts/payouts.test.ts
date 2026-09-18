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

  it('destination token derives from a same-date same-asset reinvest tx (UI renders "reinvested (₴X,XX)")', () => {
    const jul10 = rows.find((r) => r.date === '2026-07-10')!;
    expect(jul10.destination).toEqual({ kind: 'reinvested', amount: 687.02 });
    const jun10 = rows.find((r) => r.date === '2026-06-10')!;
    expect(jun10.destination).toEqual({ kind: 'reinvested', amount: 484.36 });
    const jun03 = rows.find((r) => r.date === '2026-06-03')!;
    expect(jun03.destination).toEqual({ kind: 'reinvested', amount: 216 });
  });

  it('falls back to the account token with no matching reinvest (D5#3: the moved 472,13/10.05 row)', () => {
    const may10 = rows.find((r) => r.date === '2026-05-10')!;
    expect(may10.amount).toBeCloseTo(472.13, 2);
    expect(may10.destination).toEqual({ kind: 'account' });
  });

  // THE ROW CARRIES WHAT WAS WITHHELD, because nothing did: the figure was written
  // at the form, stored on the row and derived into three totals with no screen
  // showing it. The projection has to carry it rather than the screen reaching
  // past `payoutLogRows` into the transaction.
  it('carries the withholding through, and the net beside it', () => {
    const jun10 = rows.find((r) => r.date === '2026-06-10')!;
    expect(jun10.amount).toBeCloseTo(680.55, 2);
    expect(jun10.taxWithheld).toBeCloseTo(95.28, 2);
    expect(jun10.net).toBeCloseTo(585.27, 2);
  });

  // ABSENT IS THE ONLY SPELLING OF NONE — not 0, which would key the asset into
  // `taxesPaidByAsset` and make an untaxed payout look reported-on.
  it('leaves the withholding absent where there was none, and nets to the amount', () => {
    const jun03 = rows.find((r) => r.date === '2026-06-03')!;
    expect(jun03.taxWithheld).toBeUndefined();
    expect(jun03.net).toBeCloseTo(jun03.amount, 2);
    // The bond half of this portfolio is permanently in that state, ОВДП coupons being exempt.
    expect(rows.filter((r) => r.taxWithheld === undefined)).toHaveLength(7);
  });

  // The net is DERIVED here rather than in the component, so the screen carries no
  // arithmetic and the figure is pinned by a test.
  it('nets every row from its own two columns', () => {
    for (const r of rows) expect(r.net).toBeCloseTo(r.amount - (r.taxWithheld ?? 0), 2);
  });
});
