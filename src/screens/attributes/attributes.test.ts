import { describe, expect, it } from 'vitest';

import { SEED_ASSETS, SEED_TRANSACTIONS } from '../../lib/seed';
import type { Transaction } from '../../lib/types';
import { couponFrequencyLabel, dividendDayOfMonth, payoutScheduleLabel } from './attributes';

describe('dividendDayOfMonth', () => {
  it("finds the LATEST dividend_accrual's day-of-month for the asset (REIT -> 10th)", () => {
    expect(dividendDayOfMonth(SEED_TRANSACTIONS, 'reit')).toBe(10);
  });

  it('returns undefined when the asset has no dividend_accrual history', () => {
    expect(dividendDayOfMonth(SEED_TRANSACTIONS, 'ovdp8976')).toBeUndefined();
    expect(dividendDayOfMonth([], 'reit')).toBeUndefined();
  });

  it('picks the max-dated row, not array order', () => {
    const txs: Transaction[] = [
      { id: 't2', date: '2026-06-10', type: 'dividend_accrual', assetId: 'reit', amount: 1, source: 'accrual' },
      { id: 't1', date: '2026-02-15', type: 'dividend_accrual', assetId: 'reit', amount: 1, source: 'accrual' },
    ];
    expect(dividendDayOfMonth(txs, 'reit')).toBe(10);
  });
});

describe('payoutScheduleLabel', () => {
  it('REIT (monthly, dividends on the 10th) -> "Monthly · ~10th"', () => {
    const reit = SEED_ASSETS.find((a) => a.id === 'reit')!;
    expect(payoutScheduleLabel(reit, SEED_TRANSACTIONS)).toBe('Monthly · ~10th');
  });

  it('Energy (schedule "none") -> "None (price only)", no day suffix', () => {
    const energy = SEED_ASSETS.find((a) => a.id === 'energy')!;
    expect(payoutScheduleLabel(energy, SEED_TRANSACTIONS)).toBe('None (price only)');
  });

  it('falls back to the bare schedule label when there is no accrual history yet', () => {
    const reit = SEED_ASSETS.find((a) => a.id === 'reit')!;
    expect(payoutScheduleLabel(reit, [])).toBe('Monthly');
  });
});

describe('couponFrequencyLabel', () => {
  it('maps payout schedules to the Coupon field frequency word', () => {
    expect(couponFrequencyLabel('semiannual')).toBe('semi-annual');
    expect(couponFrequencyLabel('quarterly')).toBe('quarterly');
    expect(couponFrequencyLabel('monthly')).toBe('monthly');
    expect(couponFrequencyLabel('maturity')).toBe('at maturity');
  });
});
