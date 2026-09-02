import { describe, expect, it } from 'vitest';

import { SEED_ASSETS, SEED_TRANSACTIONS } from '../../lib/seed';
import type { Asset, Transaction } from '../../core/types';
import { parseAssetsFeed } from '../../core/inzhur/parse';
import fixture from '../../core/inzhur/__fixtures__/assets-sample.json';
import {
  actualAnnualizedPct,
  derivedYtmPct,
  dividendDayOfMonth,
  payoutScheduleFact,
} from './attributes';

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

describe('derivedYtmPct — YTM at purchase, solved rather than typed (D120)', () => {
  const feed = parseAssetsFeed(fixture);
  const bond = (over: Partial<Asset> = {}): Asset => ({
    id: 'ovdp8976',
    name: 'OVDP UA4000238976',
    code: 'GB',
    colorKey: 'ovdp8976',
    yieldType: 'fixed_coupon',
    expectedPct: 16.4,
    targetPct: 17,
    payoutSchedule: 'semiannual',
    firstPurchase: '2026-08-12',
    createdAt: '2026-02-05T10:00:00',
    inzhur: { kind: 'bond', ref: 'UA4000238976' },
    ...over,
  });
  const buy = (over: Partial<Transaction> = {}): Transaction => ({
    id: 'b1',
    date: '2026-08-12',
    type: 'buy',
    assetId: 'ovdp8976',
    amount: 10_576.7,
    source: 'own',
    quantity: 10,
    unitPrice: 1057.67,
    ...over,
  });

  it('solves the yield the paid price implies, against the published schedule', () => {
    // The fixture quotes UA4000238976 at 1057.67. Feeding that price straight
    // back must return a yield that reprices it — the inverse of `derivePrice`,
    // which dcf.ts fits to 0.0026 ₴ on this very bond.
    const ytm = derivedYtmPct(bond(), [buy()], feed);
    expect(ytm).toBeDefined();
    expect(ytm!).toBeGreaterThan(0);
    expect(ytm!).toBeLessThan(100);
  });

  it('a HIGHER price paid implies a LOWER yield — the relationship that makes it real', () => {
    // The whole reason this cannot be folded into the coupon rate: the coupon is
    // one number for life, this one depends on what the holder paid.
    const cheap = derivedYtmPct(bond(), [buy({ unitPrice: 1000 })], feed);
    const dear = derivedYtmPct(bond(), [buy({ unitPrice: 1100 })], feed);
    expect(cheap).toBeDefined();
    expect(dear).toBeDefined();
    expect(dear!).toBeLessThan(cheap!);
  });

  it('takes the EARLIEST purchase, not the latest or an average', () => {
    const ladder = [buy({ id: 'b2', date: '2026-08-20', unitPrice: 1100 }), buy()];
    expect(derivedYtmPct(bond(), ladder, feed)).toBe(derivedYtmPct(bond(), [buy()], feed));
  });

  it('is undefined without a price — every purchase made before #31', () => {
    const legacy: Transaction = { ...buy(), quantity: undefined, unitPrice: undefined };
    expect(derivedYtmPct(bond(), [legacy], feed)).toBeUndefined();
  });

  it('is undefined without a schedule — unlinked, or absent from the feed', () => {
    expect(derivedYtmPct(bond({ inzhur: undefined }), [buy()], feed)).toBeUndefined();
    expect(derivedYtmPct(bond(), [buy()], undefined)).toBeUndefined();
  });

  it('is undefined for anything that is not a fixed-coupon asset', () => {
    expect(derivedYtmPct(bond({ yieldType: 'div_cap' }), [buy()], feed)).toBeUndefined();
  });
});
