import { describe, expect, it } from 'vitest';

import { amountInputSchema, assetFormSchema, quoteInputSchema, transactionSchema } from './schemas';

describe('quoteInputSchema (README §8: inputs accept table format)', () => {
  it('parses comma decimals with NBSP or space thousands', () => {
    expect(quoteInputSchema.parse('68 702,10')).toBeCloseTo(68702.1, 2);
    expect(quoteInputSchema.parse('68 702,10')).toBeCloseTo(68702.1, 2);
    expect(quoteInputSchema.parse('4374,12')).toBeCloseTo(4374.12, 2);
  });

  it('parses plain dot decimals too', () => {
    expect(quoteInputSchema.parse('4374.12')).toBeCloseTo(4374.12, 2);
  });

  it('parses the English convention the English placeholder shows', () => {
    // The field offers `10,000.00` in English. Reading its comma as a decimal
    // point produced `10.000.00` → NaN, so the form rejected its own example.
    expect(quoteInputSchema.parse('10,000.00')).toBeCloseTo(10000, 2);
    expect(quoteInputSchema.parse('1,240.00')).toBeCloseTo(1240, 2);
    expect(quoteInputSchema.parse('1,000,000.50')).toBeCloseTo(1000000.5, 2);
  });

  it('reads a comma-grouped INTEGER as grouping, not as a fraction', () => {
    // The regression this exists for: the English form prefills Units with
    // f.units(6164) = "6,164". Reading that comma as a decimal point stored
    // 6.164 units for an asset the user had only opened and saved.
    expect(quoteInputSchema.parse('6,164')).toBe(6164);
    expect(quoteInputSchema.parse('10,000')).toBe(10000);
    expect(quoteInputSchema.parse('1,000,000')).toBe(1000000);
    // Not every comma groups three digits — these stay decimals.
    expect(quoteInputSchema.parse('16,5')).toBeCloseTo(16.5, 2);
    expect(quoteInputSchema.parse('1240,00')).toBeCloseTo(1240, 2);
    expect(quoteInputSchema.parse('6,16')).toBeCloseTo(6.16, 2);
  });

  it('reads the LAST mark as the decimal, whichever it is', () => {
    // Not a locale switch: the rule is positional, so a grouped-dot entry a
    // pasted value might carry still lands on the right number instead of NaN.
    expect(quoteInputSchema.parse('1.234,56')).toBeCloseTo(1234.56, 2);
    expect(quoteInputSchema.parse('1,234.56')).toBeCloseTo(1234.56, 2);
    // One mark stays a decimal point — the Ukrainian field depends on it.
    expect(quoteInputSchema.parse('1234,56')).toBeCloseTo(1234.56, 2);
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
    const parsed = transactionSchema('en').parse(base);
    expect(parsed.amount).toBe(1000);
  });

  it("accepts the quick-create sentinel assetId 'new' (the panel validates its AssetForm instance separately)", () => {
    expect(transactionSchema('en').safeParse({ ...base, assetId: 'new' }).success).toBe(true);
  });

  it('rejects unknown types and an empty assetId', () => {
    expect(transactionSchema('en').safeParse({ ...base, type: 'gift' }).success).toBe(false);
    expect(transactionSchema('en').safeParse({ ...base, assetId: '' }).success).toBe(false);
  });

  it("accepts the P1 domain types 'withdrawal' and 'redemption'", () => {
    expect(
      transactionSchema('en').safeParse({ ...base, type: 'withdrawal', assetId: 'x' }).success,
    ).toBe(true);
    expect(transactionSchema('en').safeParse({ ...base, type: 'redemption' }).success).toBe(true);
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
    const parsed = assetFormSchema('create', 'en').parse(base);
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
    const parsed = assetFormSchema('create', 'en').parse({
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
    const fund = assetFormSchema('create', 'en').parse({
      ...base,
      inzhur: { kind: 'fund', ref: 'inzhur-reit', units: '6 164' },
    });
    expect(fund.inzhur).toEqual({ kind: 'fund', ref: 'inzhur-reit', units: 6164 });

    const bond = assetFormSchema('edit', 'en').parse({
      ...base,
      yieldType: 'fixed_coupon',
      inzhur: { kind: 'bond', ref: 'UA4000238976', units: '15' },
    });
    expect(bond.inzhur).toEqual({ kind: 'bond', ref: 'UA4000238976', units: 15 });
  });

  it('rejects a missing ref and non-positive units when linked', () => {
    expect(
      assetFormSchema('create', 'en').safeParse({
        ...base,
        inzhur: { kind: 'fund', ref: '', units: '10' },
      }).success,
    ).toBe(false);
    expect(
      assetFormSchema('create', 'en').safeParse({
        ...base,
        inzhur: { kind: 'bond', ref: 'UA4000238976', units: '0' },
      }).success,
    ).toBe(false);
    expect(
      assetFormSchema('create', 'en').safeParse({
        ...base,
        inzhur: { kind: 'bond', ref: 'UA4000238976', units: '-3' },
      }).success,
    ).toBe(false);
  });

  it("allows the seed-only 'none' schedule in edit mode ONLY", () => {
    const asNone = { ...base, payoutSchedule: 'none' };
    expect(assetFormSchema('edit', 'en').safeParse(asNone).success).toBe(true);
    const created = assetFormSchema('create', 'en').safeParse(asNone);
    expect(created.success).toBe(false);
    if (!created.success) {
      expect(created.error.issues[0].path).toEqual(['payoutSchedule']);
    }
  });

  it('rejects a 3-letter or digit code and an empty name', () => {
    expect(assetFormSchema('create', 'en').safeParse({ ...base, code: 'KUB' }).success).toBe(false);
    expect(assetFormSchema('create', 'en').safeParse({ ...base, code: '42' }).success).toBe(false);
    expect(assetFormSchema('create', 'en').safeParse({ ...base, code: '' }).success).toBe(false);
    expect(assetFormSchema('create', 'en').safeParse({ ...base, name: '  ' }).success).toBe(false);
  });

  it('allows targetPct 0 but rejects >100 and non-numeric percentages', () => {
    expect(assetFormSchema('create', 'en').parse({ ...base, targetPct: '0' }).targetPct).toBe(0);
    expect(assetFormSchema('create', 'en').safeParse({ ...base, targetPct: '101' }).success).toBe(
      false,
    );
    expect(assetFormSchema('create', 'en').safeParse({ ...base, expectedPct: 'abc' }).success).toBe(
      false,
    );
  });

  it('rejects a malformed optional date but accepts its absence', () => {
    expect(
      assetFormSchema('create', 'en').safeParse({ ...base, maturity: '25.02.2027' }).success,
    ).toBe(false);
    expect(assetFormSchema('create', 'en').safeParse({ ...base, maturity: '' }).success).toBe(true);
  });
});

describe('the comma is a decimal mark in Ukrainian and a thousands mark in English', () => {
  // THE ONE AMBIGUOUS SHAPE: three decimals, a comma, no dot. Measured —
  // `0,125` → 125, `43,478` → 43478, `11,138` → 11138 under the grouping rule.
  // #31 makes it reachable: a reinvestment buys a fractional count, and the
  // amount field now holds a per-unit price. Every one of those is a legal
  // positive number, so nothing downstream refuses it.
  const base = {
    date: '2026-08-12',
    type: 'reinvest' as const,
    assetId: 'reit',
    amount: '484,36',
    source: 'reinvest_reit' as const,
  };

  it('reads a Ukrainian three-decimal count as a FRACTION, not a thousand', () => {
    const parsed = transactionSchema('uk').parse({ ...base, quantity: '0,125' });
    expect(parsed.quantity).toBeCloseTo(0.125, 6);
    const bigger = transactionSchema('uk').parse({ ...base, quantity: '43,478' });
    expect(bigger.quantity).toBeCloseTo(43.478, 6);
  });

  it('still reads an English grouped count as a thousand', () => {
    // `f.units(6164)` prefills English as `6,164`, and the asset form's Units
    // field round-trips through the same normalizer — so this direction must
    // keep working, and it is why the rule cannot simply be deleted.
    expect(transactionSchema('en').parse({ ...base, quantity: '6,164' }).quantity).toBe(6164);
  });

  it('protects the per-unit AMOUNT the same way — it is money that reaches the ledger', () => {
    // 11,138 ₴ per unit × 5 000 units is ₴55 690. Read as a grouping it is
    // ₴55 690 000, and `priceParts` would store that as the transaction total.
    const uk = transactionSchema('uk').parse({
      ...base,
      amount: '11,138',
      quantity: '5000',
      priceMode: 'unit',
    });
    expect(uk.amount).toBeCloseTo(11.138, 6);
  });

  it('reads the SAME field the same way in the asset form, which holds it too', () => {
    // `matchAssets` treats the ledger's count and `Asset.inzhur.units` as two
    // sources of ONE number (D112, `unitsFrom`). Fixing the transaction panel
    // and leaving `inzhurGroupSchema` on the grouping rule had the two parsing
    // identical Ukrainian text a thousandfold apart — 43.478 units on one
    // screen and 43 478 on the other, both silently accepted.
    const asset = {
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
      inzhur: { kind: 'fund' as const, ref: 'reit', units: '43,478' },
    };
    expect(assetFormSchema('create', 'uk').parse(asset).inzhur?.units).toBeCloseTo(43.478, 6);
    expect(assetFormSchema('create', 'en').parse(asset).inzhur?.units).toBe(43478);
    // And the default is the grouping rule, so every call site that has no
    // language to give — the backup importer, a test — keeps its old reading.
    expect(assetFormSchema('create', 'en').parse(asset).inzhur?.units).toBe(43478);
  });

  it('round-trips what the asset form PREFILLS into the units field', () => {
    // The guarantee that matters to a user: open an asset, change nothing but
    // the name, Save — the unit count must come back as the number that went
    // in. The prefill is `f.units(asset.inzhur.units)` (`asset-form.ts`), which
    // is a formatter with no round-trip check of its own, so the schema is what
    // has to agree with it.
    const asset = (units: string) => ({
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
      inzhur: { kind: 'fund' as const, ref: 'reit', units },
    });
    const back = (lang: 'uk' | 'en', shown: string) =>
      assetFormSchema('edit', lang).parse(asset(shown)).inzhur?.units;

    // `f.units` renders these; the values are the two shapes #31 made reachable
    // — a whole count and a fractional one a reinvestment buys.
    expect(back('uk', '6 164')).toBe(6164); // NBSP — what `f.units` emits
    expect(back('en', '6,164')).toBe(6164);
    expect(back('uk', '43,478')).toBeCloseTo(43.478, 6);
    expect(back('en', '43.478')).toBeCloseTo(43.478, 6);
  });

  it('gives the coupon card the SAME reading as the panel — both write a Transaction', () => {
    // `CouponDueCard` validates its own amount rather than going through
    // `transactionSchema`, and it records an `interest_payout` with the result.
    // On the module-level grouping schema «1,240» was ₴1 240 there and ₴1.24
    // here, in one ledger, feeding one `netDeposits`.
    for (const lang of ['uk', 'en'] as const) {
      const viaCard = amountInputSchema(lang).parse('1,240');
      const viaPanel = transactionSchema(lang).parse({ ...base, amount: '1,240' }).amount;
      expect(viaCard, `${lang}: the two doors disagree`).toBeCloseTo(viaPanel, 6);
    }
    // And the readings really are different per language — otherwise the
    // assertion above would hold for the wrong reason.
    expect(amountInputSchema('uk').parse('1,240')).toBeCloseTo(1.24, 6);
    expect(amountInputSchema('en').parse('1,240')).toBe(1240);
  });

  it('leaves the unambiguous shapes alone in both languages', () => {
    for (const lang of ['uk', 'en'] as const) {
      expect(transactionSchema(lang).parse({ ...base, amount: '1 240,00' }).amount).toBeCloseTo(
        1240,
        2,
      );
      expect(transactionSchema(lang).parse({ ...base, quantity: '43,4785' }).quantity).toBeCloseTo(
        43.4785,
        6,
      );
    }
    expect(transactionSchema('en').parse({ ...base, amount: '10,000.00' }).amount).toBeCloseTo(
      10000,
      2,
    );
  });
});

describe('the transaction refinements #31 adds', () => {
  const base = {
    date: '2026-08-12',
    type: 'buy' as const,
    assetId: 'reit',
    amount: '1 000,00',
    source: 'own' as const,
  };

  it('refuses per-unit mode with no quantity — there is no total to record', () => {
    const bad = transactionSchema('uk').safeParse({ ...base, priceMode: 'unit' });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    expect(bad.error.issues.map((i) => i.path.join('.'))).toContain('quantity');
  });

  it('refuses a quantity on a row that moves no position', () => {
    // W7's `transaction_quantity_absent_ck`, enforced at the form door too.
    for (const type of ['deposit', 'withdrawal', 'dividend_accrual', 'interest_payout', 'tax']) {
      const bad = transactionSchema('uk').safeParse({ ...base, type, quantity: '10' });
      expect(bad.success, type).toBe(false);
    }
  });

  it('ACCEPTS a position-moving row that lacks one — every legacy row is that', () => {
    // ONE WAY ONLY. The converse is deliberately not enforced: requiring a
    // quantity here would make the app unable to record what it used to.
    for (const type of ['buy', 'sell', 'reinvest', 'redemption']) {
      expect(transactionSchema('uk').safeParse({ ...base, type }).success, type).toBe(true);
      expect(
        transactionSchema('uk').safeParse({ ...base, type, quantity: '10' }).success,
        type,
      ).toBe(true);
    }
  });

  it('defaults priceMode to total, so a minimal transaction still parses', () => {
    const parsed = transactionSchema('uk').parse(base);
    expect(parsed.priceMode).toBe('total');
    expect(parsed.quantity).toBeUndefined();
  });
});
