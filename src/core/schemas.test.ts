import { describe, expect, it } from 'vitest';

import {
  amountInputSchema,
  assetFormSchema,
  percentInputSchemaFor,
  quoteInputSchema,
  transactionSchema,
} from './schemas';

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

  // Issue #1's bytes: `4`, U+00A0, `214,24`, a space, `грн.`, a space. The
  // letters were the rejection, not the NBSP — `\s` already strips that.
  it('drops a currency token beside the number — the shape a bank page pastes', () => {
    expect(quoteInputSchema.parse('4 214,24 грн. ')).toBe(4214.24);
    expect(quoteInputSchema.parse('1 234,56 грн')).toBe(1234.56);
    expect(quoteInputSchema.parse('1234.56 UAH')).toBe(1234.56);
    expect(quoteInputSchema.parse('₴68,629.36')).toBe(68629.36);
    expect(quoteInputSchema.parse('4214,24 ГРН')).toBe(4214.24);
  });

  it('still refuses letters that are not a currency token, and a token with no number', () => {
    expect(quoteInputSchema.safeParse('12abc').success).toBe(false);
    expect(quoteInputSchema.safeParse('12 грн abc').success).toBe(false);
    expect(quoteInputSchema.safeParse('грн').success).toBe(false);
    expect(quoteInputSchema.safeParse('₴').success).toBe(false);
    // A token alone must stay NaN, not become `''` → 0: a field whose floor is 0
    // (a target share) would otherwise accept `$` as a value.
    expect(percentInputSchemaFor('uk').safeParse('$').success).toBe(false);
    expect(percentInputSchemaFor('en').safeParse('грн.').success).toBe(false);
    expect(amountInputSchema('uk').safeParse('₴').success).toBe(false);
  });
});

describe('transactionSchema', () => {
  const base = {
    date: '2026-07-27',
    type: 'buy',
    assetId: 'reit',
    amount: '1 000,00',
    // REQUIRED on a position-moving row since D124 — a `buy` without one no
    // longer parses, which is what the four rules below are about.
    quantity: '10',
    source: 'own',
  };

  it('accepts a transaction on an existing asset and coerces the amount', () => {
    const parsed = transactionSchema('en').parse(base);
    expect(parsed.amount).toBe(1000);
  });

  it("accepts the quick-create sentinel assetId 'new' (the panel validates its AssetForm instance separately)", () => {
    expect(transactionSchema('en').safeParse({ ...base, assetId: 'new' }).success).toBe(true);
  });

  it('rejects unknown types, and an empty assetId on a type that targets an asset', () => {
    expect(transactionSchema('en').safeParse({ ...base, type: 'gift' }).success).toBe(false);
    expect(transactionSchema('en').safeParse({ ...base, assetId: '' }).success).toBe(false);
  });

  it("accepts the P1 domain types 'withdrawal' and 'redemption'", () => {
    expect(
      // `quantity: ''` — a withdrawal moves no position, so it must NOT carry
      // one; `assetId: ''` — it targets no asset, so it must not name one (D129).
      transactionSchema('en').safeParse({ ...base, type: 'withdrawal', assetId: '', quantity: '' })
        .success,
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
    couponRatePct: '',
    nextCoupon: '',
  };

  it('parses a plain dividends asset; empty optionals become undefined; code uppercases', () => {
    const parsed = assetFormSchema('create', 'en').parse(base);
    expect(parsed.code).toBe('CI');
    expect(parsed.expectedPct).toBe(12);
    expect(parsed.targetPct).toBe(5);
    expect(parsed.maturity).toBeUndefined();
    expect(parsed.couponRatePct).toBeUndefined();
    expect(parsed.nextCoupon).toBeUndefined();
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
      couponRatePct: '15,68',
      nextCoupon: '2026-08-25',
    });
    expect(parsed.maturity).toBe('2027-02-25');
    expect(parsed.couponRatePct).toBeCloseTo(15.68, 4);
    expect(parsed.nextCoupon).toBe('2026-08-25');
    expect(parsed.expectedPct).toBeCloseTo(16.5, 2);
  });

  it('reads a Ukrainian comma as a DECIMAL point, in every percent field', () => {
    // THE BUG THIS PINS IS OLDER THAN THE BRANCH: `dev` binds `expectedPct` to
    // `quoteInputSchema` = `positiveNumberInput(true)`, so it stores 16400 too.
    // Dropping the schema's `lang` argument did not cause it — the argument fed
    // `inzhur.units` and never these fields — but the claim used to justify the
    // drop was measured wrong: that every percent field would refuse an
    // out-of-range result. Two of the three do, because they are
    // bounded at 100. `expectedPct` is `positiveNumberInput` with NO max, so
    // «16,400» — 16.4 % as a Ukrainian writes it — stored 16400 and drove
    // `dailyAccrual`'s fallback, `couponProjection`'s estimate and `/yield`'s
    // «проти очікуваної» with it. A lone comma read the wrong way is a
    // thousandfold, not an error (D87).
    const uk = { ...base, expectedPct: '16,400', targetPct: '10,500' };
    const parsedUk = assetFormSchema('create', 'uk').parse(uk);
    expect(parsedUk.expectedPct).toBeCloseTo(16.4, 4);
    expect(parsedUk.targetPct).toBeCloseTo(10.5, 4);
    // The same text under the English grammar means thousands — and the bounded
    // field refuses it while the unbounded one cannot, which is exactly why the
    // language has to reach the schema rather than being caught downstream.
    expect(
      assetFormSchema('create', 'en').parse({ ...base, expectedPct: '16,400' }).expectedPct,
    ).toBe(16400);
    expect(
      assetFormSchema('create', 'en').safeParse({ ...base, targetPct: '10,500' }).success,
    ).toBe(false);
    // A three-decimal coupon rate now parses instead of being refused for a
    // reason the user could not have guessed.
    const bond = { ...base, yieldType: 'fixed_coupon', payoutSchedule: 'semiannual' };
    expect(
      assetFormSchema('create', 'uk').parse({ ...bond, couponRatePct: '15,680' }).couponRatePct,
    ).toBeCloseTo(15.68, 4);
  });

  it('refuses a coupon rate of 0, a negative and one over 100 (D119)', () => {
    // THE DOOR THE USER ACTUALLY TYPES THROUGH, and it was the one door without
    // these cases: `core/backup/json.ts` and `asset_coupon_rate_pct_ck` both pin
    // the same three, so widening this schema — say by "simplifying" it back to
    // `percentInputSchemaFor(lang).optional()`, which admits 0 — would leave the whole
    // suite green while the backup and the DDL kept refusing what the form stores.
    //
    // 0 is the one worth naming: it is not a smaller rate but an INERT one.
    // `couponPerPayment` gates on `rate > 0`, so a stored 0 falls back to the
    // legacy `couponAmount` and no screen can say which figure it is showing.
    const bond = { ...base, yieldType: 'fixed_coupon', payoutSchedule: 'semiannual' };
    for (const bad of ['0', '0,00', '-5', '-0,01', '100,01', '250']) {
      expect(
        assetFormSchema('create', 'en').safeParse({ ...bond, couponRatePct: bad }).success,
      ).toBe(false);
    }
    // The bounds themselves are inclusive at the top and exclusive at the bottom.
    for (const ok of ['0,01', '18,50', '100']) {
      expect(
        assetFormSchema('create', 'en').safeParse({ ...bond, couponRatePct: ok }).success,
      ).toBe(true);
    }
  });

  it('parses the Inzhur group — fund slug and bond ISIN variants', () => {
    // NO UNITS since D117: the group says where to look the instrument up, and
    // nothing else. Counts are `Σ transaction.quantity` (D112).
    const fund = assetFormSchema('create', 'en').parse({
      ...base,
      inzhur: { kind: 'fund', ref: 'inzhur-reit' },
    });
    expect(fund.inzhur).toEqual({ kind: 'fund', ref: 'inzhur-reit' });

    const bond = assetFormSchema('edit', 'en').parse({
      ...base,
      yieldType: 'fixed_coupon',
      inzhur: { kind: 'bond', ref: 'UA4000238976' },
    });
    expect(bond.inzhur).toEqual({ kind: 'bond', ref: 'UA4000238976' });
  });

  it('rejects a missing ref when linked', () => {
    expect(
      assetFormSchema('create', 'en').safeParse({ ...base, inzhur: { kind: 'fund', ref: '' } })
        .success,
    ).toBe(false);
    expect(
      assetFormSchema('create', 'en').safeParse({ ...base, inzhur: { kind: 'fund', ref: '   ' } })
        .success,
    ).toBe(false);
  });

  it('DROPS a units key the caller still sends (D117)', () => {
    // A stale backup, or a caller written against the old shape. `z.object` is
    // not strict, so the key is ignored rather than rejected — and the parsed
    // value must not carry it through, or the count would ride back into the
    // store on the next save without any field ever showing it.
    const parsed = assetFormSchema('create', 'en').parse({
      ...base,
      inzhur: { kind: 'fund', ref: 'inzhur-reit', units: '6 164' },
    });
    expect(parsed.inzhur).toEqual({ kind: 'fund', ref: 'inzhur-reit' });
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
    // A `reinvest` moves a position, so D124 requires this — every case below
    // overrides it with the shape under test.
    quantity: '1',
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

describe('the transaction refinements #31 adds, and D124 completes', () => {
  const base = {
    date: '2026-08-12',
    type: 'buy' as const,
    assetId: 'reit',
    amount: '1 000,00',
    quantity: '10',
    source: 'own' as const,
  };

  it('refuses per-unit mode with no quantity — there is no total to record', () => {
    const bad = transactionSchema('uk').safeParse({ ...base, priceMode: 'unit', quantity: '' });
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

  it('REFUSES a position-moving row that lacks one (D124)', () => {
    // REVERSED by the owner's ruling. It used to accept these, on the ground
    // that every pre-#31 row lacks a count — but that is a fact about rows
    // already STORED, and this schema only sees a row being typed now. D119 made
    // every coupon figure `rate × units`, so a `buy` in the default `total` mode
    // with the field blank produced a bond whose coupon reads «—» everywhere,
    // silently.
    for (const type of ['buy', 'sell', 'reinvest', 'redemption']) {
      const bad = transactionSchema('uk').safeParse({ ...base, type, quantity: '' });
      expect(bad.success, type).toBe(false);
      if (bad.success) continue;
      expect(bad.error.issues.map((i) => i.path.join('.'))).toContain('quantity');
      expect(
        transactionSchema('uk').safeParse({ ...base, type, quantity: '10' }).success,
        type,
      ).toBe(true);
    }
  });

  it('defaults priceMode to total', () => {
    expect(transactionSchema('uk').parse(base).priceMode).toBe('total');
  });
});

describe('D129 — the asset is required only on the types that target one', () => {
  const base = {
    date: '2026-09-02',
    type: 'deposit' as const,
    assetId: '',
    amount: '1 000,00',
    quantity: '',
    source: 'own' as const,
  };

  it('accepts a portfolio-level row with NO asset — the shape the seed writes', () => {
    // `lib/seed.ts` records its three deposits as `assetId: ''`, `types.ts`
    // documents that as the portfolio-level shape and `backup/json.ts` skips
    // the referential check for it. The form's schema was the one door that
    // refused it, so a deposit could not be recorded without naming an asset it
    // has nothing to do with — and with no assets yet, could not be recorded at
    // all, which is the first transaction anyone makes.
    for (const type of ['deposit', 'withdrawal'] as const) {
      expect(transactionSchema('uk').safeParse({ ...base, type }).success, type).toBe(true);
      expect(transactionSchema('uk').parse({ ...base, type }).assetId).toBe('');
    }
  });

  it('BLANKS an asset on a portfolio-level row rather than refusing it', () => {
    // The converse, and it is what makes the panel's hiding load-bearing rather
    // than cosmetic: the hidden picker still holds the last pick, and without
    // this the row would be stored against an asset nobody chose. `derive.ts`
    // calls that assetId noise and steps around it; this is the door where the
    // noise stops being written.
    //
    // NORMALIZED, not rejected, and the asymmetry with the quantity rule above
    // is deliberate — a refusal has to be shown, and this control is not on
    // screen for these types. The schema's own comment carries the rest.
    for (const type of ['deposit', 'withdrawal'] as const) {
      const parsed = transactionSchema('uk').safeParse({ ...base, type, assetId: 'reit' });
      expect(parsed.success, type).toBe(true);
      if (!parsed.success) continue;
      expect(parsed.data.assetId, type).toBe('');
    }
    // The quick-create sentinel is blanked with everything else: a row that
    // targets no asset cannot bring one into existence either.
    expect(transactionSchema('uk').parse({ ...base, assetId: 'new' }).assetId).toBe('');
  });

  it('still requires one on every type that DOES target an asset', () => {
    for (const type of ['buy', 'sell', 'reinvest', 'redemption'] as const) {
      const bad = transactionSchema('uk').safeParse({ ...base, type, quantity: '10' });
      expect(bad.success, type).toBe(false);
      if (bad.success) continue;
      expect(bad.error.issues.map((i) => i.path.join('.'))).toContain('assetId');
    }
    for (const type of ['dividend_accrual', 'interest_payout', 'tax'] as const) {
      expect(transactionSchema('uk').safeParse({ ...base, type }).success, type).toBe(false);
    }
  });

  it('keeps the quick-create sentinel intact on the types that target an asset', () => {
    expect(
      transactionSchema('uk').parse({ ...base, type: 'buy', assetId: 'new', quantity: '10' })
        .assetId,
    ).toBe('new');
  });
});
