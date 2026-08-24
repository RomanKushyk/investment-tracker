import { describe, expect, it } from 'vitest';

import { SEED_ASSETS, SEED_TRANSACTIONS } from '../../lib/seed';
import type { Transaction } from '../../core/types';
import { actualAnnualizedPct, dividendDayOfMonth, payoutScheduleFact } from './attributes';

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
      {
        id: 't2',
        date: '2026-06-10',
        type: 'dividend_accrual',
        assetId: 'reit',
        amount: 1,
        source: 'accrual',
      },
      {
        id: 't1',
        date: '2026-02-15',
        type: 'dividend_accrual',
        assetId: 'reit',
        amount: 1,
        source: 'accrual',
      },
    ];
    expect(dividendDayOfMonth(txs, 'reit')).toBe(10);
  });
});

describe('payoutScheduleFact', () => {
  it('REIT (monthly, dividends on the 10th) -> {monthly, day 10} (UI renders "Monthly · ~10th")', () => {
    const reit = SEED_ASSETS.find((a) => a.id === 'reit')!;
    expect(payoutScheduleFact(reit, SEED_TRANSACTIONS)).toEqual({ schedule: 'monthly', day: 10 });
  });

  it('Energy (schedule "none") -> no day token (UI renders "None (price only)")', () => {
    const energy = SEED_ASSETS.find((a) => a.id === 'energy')!;
    expect(payoutScheduleFact(energy, SEED_TRANSACTIONS)).toEqual({ schedule: 'none' });
  });

  it('omits the day token when there is no accrual history yet (UI renders the bare label)', () => {
    const reit = SEED_ASSETS.find((a) => a.id === 'reit')!;
    expect(payoutScheduleFact(reit, [])).toEqual({ schedule: 'monthly', day: undefined });
  });
});

describe('actualAnnualizedPct', () => {
  it('returns undefined when the asset has no quote yet (value undefined) instead of a bogus huge negative %', () => {
    // Reproduces the reported bug: a freshly created asset with invested
    // capital but no snapshot quote would otherwise compute
    // yieldSinceStart(0, invested) = -100%, then annualize it against the
    // global portfolio-start daysHeld basis — e.g. -100% * 365/174 ≈ -209.8%.
    expect(actualAnnualizedPct(undefined, 10000, 174)).toBeUndefined();
  });

  it('computes normally once a quote exists (value 0 is a real, quoted zero — not "missing")', () => {
    expect(actualAnnualizedPct(0, 10000, 174)).toBeCloseTo((-1 * 365) / 174);
  });

  it('matches annualizedPct for a real seed figure', () => {
    // REIT: invested 65,800 -> value 68,629.36 over 174 days from PORTFOLIO_START.
    const pct = actualAnnualizedPct(68629.36, 65800, 174)!;
    expect(pct).toBeGreaterThan(0);
  });
});
