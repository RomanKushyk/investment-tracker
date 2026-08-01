import { describe, expect, it } from 'vitest';

import { assetFormSchema, quoteInputSchema, transactionSchema } from './schemas';

describe('quoteInputSchema (README §8: inputs accept table format)', () => {
  it('parses comma decimals with NBSP or space thousands', () => {
    expect(quoteInputSchema.parse('68 702,10')).toBeCloseTo(68702.1, 2);
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
  });

  it("accepts the quick-create sentinel assetId 'new' (the panel validates its AssetForm instance separately)", () => {
    expect(transactionSchema.safeParse({ ...base, assetId: 'new' }).success).toBe(true);
  });

  it('rejects unknown types and an empty assetId', () => {
    expect(transactionSchema.safeParse({ ...base, type: 'gift' }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...base, assetId: '' }).success).toBe(false);
  });

  it("accepts the P1 domain types 'withdrawal' and 'redemption'", () => {
    expect(transactionSchema.safeParse({ ...base, type: 'withdrawal', assetId: 'x' }).success).toBe(
      true,
    );
    expect(transactionSchema.safeParse({ ...base, type: 'redemption' }).success).toBe(true);
  });
});

describe('assetFormSchema (P2 feat/asset-form, brief S3)', () => {
  const base = {
    name: 'City Garden REIT',
    code: 'ci',
    yieldType: 'dividends',
    expectedPct: '12',
    targetPct: '5',
    payoutSchedule: 'quarterly',
    firstPurchase: '2026-08-01',
    maturity: '',
    couponAmount: '',
    nextCoupon: '',
    reinvestPolicy: '',
  };

  it('parses a plain dividends asset; empty optionals become undefined; code uppercases', () => {
    const parsed = assetFormSchema('create').parse(base);
    expect(parsed.code).toBe('CI');
    expect(parsed.expectedPct).toBe(12);
    expect(parsed.targetPct).toBe(5);
    expect(parsed.maturity).toBeUndefined();
    expect(parsed.couponAmount).toBeUndefined();
    expect(parsed.nextCoupon).toBeUndefined();
    expect(parsed.reinvestPolicy).toBeUndefined();
    expect(parsed.inzhur).toBeUndefined();
  });

  it('parses a bond with the full fixed-coupon group (table-format amounts)', () => {
    const parsed = assetFormSchema('create').parse({
      ...base,
      name: 'OVDP UA4000241234',
      code: 'GB',
      yieldType: 'fixed_coupon',
      expectedPct: '16,5',
      payoutSchedule: 'semiannual',
      maturity: '2027-02-25',
      couponAmount: '1 240,00',
      nextCoupon: '2026-08-25',
      reinvestPolicy: 'Auto (dividends)',
    });
    expect(parsed.maturity).toBe('2027-02-25');
    expect(parsed.couponAmount).toBe(1240);
    expect(parsed.nextCoupon).toBe('2026-08-25');
    expect(parsed.reinvestPolicy).toBe('Auto (dividends)');
    expect(parsed.expectedPct).toBeCloseTo(16.5, 2);
  });

  it('parses the Inzhur group — fund slug and bond ISIN variants, units table-format', () => {
    const fund = assetFormSchema('create').parse({
      ...base,
      inzhur: { kind: 'fund', ref: 'inzhur-reit', units: '6 164' },
    });
    expect(fund.inzhur).toEqual({ kind: 'fund', ref: 'inzhur-reit', units: 6164 });

    const bond = assetFormSchema('edit').parse({
      ...base,
      yieldType: 'fixed_coupon',
      inzhur: { kind: 'bond', ref: 'UA4000238976', units: '15' },
    });
    expect(bond.inzhur).toEqual({ kind: 'bond', ref: 'UA4000238976', units: 15 });
  });

  it('rejects a missing ref and non-positive units when linked', () => {
    expect(
      assetFormSchema('create').safeParse({
        ...base,
        inzhur: { kind: 'fund', ref: '', units: '10' },
      }).success,
    ).toBe(false);
    expect(
      assetFormSchema('create').safeParse({
        ...base,
        inzhur: { kind: 'bond', ref: 'UA4000238976', units: '0' },
      }).success,
    ).toBe(false);
    expect(
      assetFormSchema('create').safeParse({
        ...base,
        inzhur: { kind: 'bond', ref: 'UA4000238976', units: '-3' },
      }).success,
    ).toBe(false);
  });

  it("allows the seed-only 'none' schedule in edit mode ONLY", () => {
    const asNone = { ...base, payoutSchedule: 'none' };
    expect(assetFormSchema('edit').safeParse(asNone).success).toBe(true);
    const created = assetFormSchema('create').safeParse(asNone);
    expect(created.success).toBe(false);
    if (!created.success) {
      expect(created.error.issues[0].path).toEqual(['payoutSchedule']);
    }
  });

  it('rejects a 3-letter or digit code and an empty name', () => {
    expect(assetFormSchema('create').safeParse({ ...base, code: 'KUB' }).success).toBe(false);
    expect(assetFormSchema('create').safeParse({ ...base, code: '42' }).success).toBe(false);
    expect(assetFormSchema('create').safeParse({ ...base, code: '' }).success).toBe(false);
    expect(assetFormSchema('create').safeParse({ ...base, name: '  ' }).success).toBe(false);
  });

  it('allows targetPct 0 but rejects >100 and non-numeric percentages', () => {
    expect(assetFormSchema('create').parse({ ...base, targetPct: '0' }).targetPct).toBe(0);
    expect(assetFormSchema('create').safeParse({ ...base, targetPct: '101' }).success).toBe(false);
    expect(assetFormSchema('create').safeParse({ ...base, expectedPct: 'abc' }).success).toBe(
      false,
    );
  });

  it('rejects a malformed optional date but accepts its absence', () => {
    expect(
      assetFormSchema('create').safeParse({ ...base, maturity: '25.02.2027' }).success,
    ).toBe(false);
    expect(assetFormSchema('create').safeParse({ ...base, maturity: '' }).success).toBe(true);
  });
});
