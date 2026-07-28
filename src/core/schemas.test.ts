import { describe, expect, it } from 'vitest';

import { quoteInputSchema, transactionSchema } from './schemas';

describe('quoteInputSchema (README §8: inputs accept table format)', () => {
  it('parses comma decimals with NBSP or space thousands', () => {
    expect(quoteInputSchema.parse('68 702,10')).toBeCloseTo(68702.1, 2);
    expect(quoteInputSchema.parse('68 702,10')).toBeCloseTo(68702.1, 2);
    expect(quoteInputSchema.parse('4374,12')).toBeCloseTo(4374.12, 2);
  });

  it('parses plain dot decimals too', () => {
    expect(quoteInputSchema.parse('4374.12')).toBeCloseTo(4374.12, 2);
  });

  it('rejects empty, zero, negative and garbage input', () => {
    expect(quoteInputSchema.safeParse('').success).toBe(false);
    expect(quoteInputSchema.safeParse('0').success).toBe(false);
    expect(quoteInputSchema.safeParse('-5').success).toBe(false);
    expect(quoteInputSchema.safeParse('abc').success).toBe(false);
  });
});

describe('transactionSchema', () => {
  const base = {
    date: '2026-07-27',
    type: 'buy',
    assetId: 'reit',
    amount: '1 000,00',
    source: 'own',
  };

  it('accepts a transaction on an existing asset and coerces the amount', () => {
    const parsed = transactionSchema.parse(base);
    expect(parsed.amount).toBe(1000);
    expect(parsed.newAsset).toBeUndefined();
  });

  it('requires newAsset details when assetId is "new"', () => {
    expect(transactionSchema.safeParse({ ...base, assetId: 'new' }).success).toBe(false);
  });

  it('accepts assetId "new" with complete newAsset details', () => {
    const parsed = transactionSchema.parse({
      ...base,
      assetId: 'new',
      newAsset: {
        name: 'City Garden REIT',
        yieldType: 'dividends',
        expectedPct: '12',
        targetPct: '5',
        payoutSchedule: 'quarterly',
      },
    });
    expect(parsed.newAsset?.expectedPct).toBe(12);
    expect(parsed.newAsset?.targetPct).toBe(5);
  });

  it('rejects unknown types and the seed-only "none" schedule', () => {
    expect(transactionSchema.safeParse({ ...base, type: 'gift' }).success).toBe(false);
    expect(
      transactionSchema.safeParse({
        ...base,
        assetId: 'new',
        newAsset: {
          name: 'X',
          yieldType: 'capitalization',
          expectedPct: '10',
          targetPct: '5',
          payoutSchedule: 'none',
        },
      }).success,
    ).toBe(false);
  });
});
