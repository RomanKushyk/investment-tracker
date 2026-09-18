import { describe, expect, it } from 'vitest';

import { storedNumber } from './money';

import {
  amountInputSchema,
  couldNotRead,
  assetFormSchema,
  percentInputSchemaFor,
  transactionSchema,
} from './schemas';
import type { TxType } from './types';

// What the store lets each type carry — the W7 CHECKs this schema mirrors, written
// out rather than read from `isPayout` / `movesPosition` / `targetsAsset`: a test that
// asks the predicates the schema asked cannot fail when one is wrong, because the row
// it builds flips with them. A `Record<TxType, …>` and not a list — a list is short one
// member when a ninth type arrives and nothing notices; this refuses to compile.
const CARRIES: Record<TxType, { asset: boolean; quantity: boolean; withholding: boolean }> = {
  buy: { asset: true, quantity: true, withholding: false },
  sell: { asset: true, quantity: true, withholding: false },
  deposit: { asset: false, quantity: false, withholding: false },
  withdrawal: { asset: false, quantity: false, withholding: false },
  dividend_accrual: { asset: true, quantity: false, withholding: true },
  interest_payout: { asset: true, quantity: false, withholding: true },
  reinvest: { asset: true, quantity: true, withholding: false },
  redemption: { asset: true, quantity: true, withholding: false },
};
const everyType = Object.keys(CARRIES) as TxType[];

describe('the number grammar follows the language (README §8)', () => {
  const uk = amountInputSchema('uk');
  const en = amountInputSchema('en');

  it('reads a lone comma as the decimal in Ukrainian and refuses it in English', () => {
    // English is given the dot alone: a comma that does not group threes leaves the value
    // UNREADABLE rather than guessed at, and the guess is a thousandfold legal number.
    expect(uk.parse('16,5')).toBeCloseTo(16.5, 2);
    expect(en.safeParse('16,5').success).toBe(false);
    expect(uk.parse('68 702,10')).toBeCloseTo(68702.1, 2);
    expect(en.safeParse('68 702,10').success).toBe(false);
    expect(uk.parse('4374,12')).toBeCloseTo(4374.12, 2);
    expect(uk.parse('6,16')).toBeCloseTo(6.16, 2);
    expect(uk.parse('1234,56')).toBeCloseTo(1234.56, 2);
  });

  it('parses plain dot decimals in both languages', () => {
    expect(uk.parse('4374.12')).toBeCloseTo(4374.12, 2);
    expect(en.parse('4374.12')).toBeCloseTo(4374.12, 2);
  });

  it('parses the English convention the English placeholder shows', () => {
    // The field offers `10,000.00` in English, and the form used to reject its own example.
    expect(en.parse('10,000.00')).toBeCloseTo(10000, 2);
    expect(en.parse('1,240.00')).toBeCloseTo(1240, 2);
    expect(en.parse('1,000,000.50')).toBeCloseTo(1000000.5, 2);
  });

  it('reads a comma-grouped INTEGER as grouping in English, as a fraction in Ukrainian', () => {
    // The form prefills a count with `f.units(6164)` = "6,164", so reading that comma as a
    // decimal point stored 6.164 for an asset the user had only opened and saved.
    expect(en.parse('6,164')).toBe(6164);
    expect(en.parse('1,000,000')).toBe(1000000);
    // And the same text from a Ukrainian typist is the fraction they wrote.
    expect(uk.parse('6,164')).toBeCloseTo(6.164, 6);
    expect(uk.parse('0,125')).toBeCloseTo(0.125, 6);
  });

  it('refuses a SECOND comma under Ukrainian rather than dropping one silently', () => {
    // No lone comma is left to be the decimal and «1,000,000» is English writing, so it is
    // unreadable here rather than one of the three numbers a first-match replace produces.
    expect(uk.safeParse('1,000,000').success).toBe(false);
    expect(uk.safeParse('1,234,567.89').success).toBe(true); // both marks — rule 1 still settles it
    expect(en.parse('1,000,000')).toBe(1000000);
  });

  it('pins the Ukrainian cost of that rule: «10,000» is ten', () => {
    // Accepted, not overlooked: a lone comma is ALWAYS the decimal in Ukrainian, and
    // deciding by digit count instead is the 1000x the language rule exists to remove.
    expect(uk.parse('10,000')).toBe(10);
    expect(en.parse('10,000')).toBe(10000);
  });

  it('reads the LAST mark as the decimal in both, whichever it is', () => {
    // Positional, not a locale switch, so a pasted value lands on the right number in
    // either language instead of on NaN.
    for (const schema of [uk, en]) {
      expect(schema.parse('1.234,56')).toBeCloseTo(1234.56, 2);
      expect(schema.parse('1,234.56')).toBeCloseTo(1234.56, 2);
    }
  });

  it('rejects empty, zero, negative and garbage input in both', () => {
    for (const schema of [uk, en]) {
      expect(schema.safeParse('').success).toBe(false);
      expect(schema.safeParse('0').success).toBe(false);
      expect(schema.safeParse('-5').success).toBe(false);
      expect(schema.safeParse('abc').success).toBe(false);
    }
  });

  // The letters were the rejection, not the NBSP — `\s` already strips that.
  it('drops a currency token beside the number — the shape a bank page pastes', () => {
    expect(uk.parse('4 214,24 грн. ')).toBe(4214.24);
    expect(uk.parse('1 234,56 грн')).toBe(1234.56);
    expect(uk.parse('1234.56 UAH')).toBe(1234.56);
    expect(uk.parse('4214,24 ГРН')).toBe(4214.24);
    // Both marks present, so this one reads the same either way (rule 1).
    expect(en.parse('₴68,629.36')).toBe(68629.36);
    expect(uk.parse('₴68,629.36')).toBe(68629.36);
  });

  it('still refuses letters that are not a currency token, and a token with no number', () => {
    for (const schema of [uk, en]) {
      expect(schema.safeParse('12abc').success).toBe(false);
      expect(schema.safeParse('12 грн abc').success).toBe(false);
      expect(schema.safeParse('грн').success).toBe(false);
      expect(schema.safeParse('₴').success).toBe(false);
    }
    // A token alone must stay NaN, not become `''` → 0: a field whose floor is 0 would
    // otherwise accept `$` as a value.
    expect(percentInputSchemaFor('uk').safeParse('$').success).toBe(false);
    expect(percentInputSchemaFor('en').safeParse('грн.').success).toBe(false);
  });
});

describe('transactionSchema', () => {
  const base = {
    date: '2026-07-27',
    type: 'buy',
    assetId: 'reit',
    amount: '1,000.00',
    // REQUIRED on a position-moving row — a `buy` without one no longer parses, which is
    // what the four rules below are about.
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
      // `quantity: ''` — a withdrawal moves no position, so it must NOT carry one;
      // `assetId: ''` — it targets no asset, the portfolio-level shape. *Forms and layout*
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
    const parsed = assetFormSchema('create', 'uk').parse({
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
    // WHY EVERY PERCENT FIELD AND NOT JUST THE BOUNDED ONES: `targetPct` and
    // `couponRatePct` are capped at 100, so a misread «10,500» is refused. `expectedPct`
    // has NO max, so «16,400» stores 16400 and drives `dailyAccrual`’s fallback,
    // `couponProjection`’s estimate and /yield’s «проти очікуваної» with it.
    const uk = { ...base, expectedPct: '16,400', targetPct: '10,500' };
    const parsedUk = assetFormSchema('create', 'uk').parse(uk);
    expect(parsedUk.expectedPct).toBeCloseTo(16.4, 4);
    expect(parsedUk.targetPct).toBeCloseTo(10.5, 4);
    // The same text under the English grammar means thousands — the bounded field refuses
    // it and the unbounded one cannot, which is why the language has to reach the schema.
    expect(
      assetFormSchema('create', 'en').parse({ ...base, expectedPct: '16,400' }).expectedPct,
    ).toBe(16400);
    expect(
      assetFormSchema('create', 'en').safeParse({ ...base, targetPct: '10,500' }).success,
    ).toBe(false);
    // A three-decimal coupon rate parses instead of being refused for a reason the user
    // could not have guessed.
    const bond = { ...base, yieldType: 'fixed_coupon', payoutSchedule: 'semiannual' };
    expect(
      assetFormSchema('create', 'uk').parse({ ...bond, couponRatePct: '15,680' }).couponRatePct,
    ).toBeCloseTo(15.68, 4);
  });

  it('refuses a coupon rate of 0, a negative and one over 100', () => {
    // THE DOOR THE USER ACTUALLY TYPES THROUGH, and it was the one door without these
    // cases: `core/backup/json.ts` and `asset_coupon_rate_pct_ck` both pin the same three,
    // so widening this schema would leave the whole suite green while the backup and the
    // DDL kept refusing what the form stores. 0 is the one worth naming — it is not a
    // smaller rate but an INERT one: `couponPerPayment` gates on `rate > 0`, so a stored 0
    // falls back to the legacy `couponAmount` and no screen can say which figure it shows.
    const bond = { ...base, yieldType: 'fixed_coupon', payoutSchedule: 'semiannual' };
    for (const bad of ['0', '0,00', '-5', '-0,01', '100,01', '250']) {
      expect(
        assetFormSchema('create', 'uk').safeParse({ ...bond, couponRatePct: bad }).success,
      ).toBe(false);
    }
    // The bounds themselves are inclusive at the top and exclusive at the bottom.
    for (const ok of ['0,01', '18,50', '100']) {
      expect(
        assetFormSchema('create', 'uk').safeParse({ ...bond, couponRatePct: ok }).success,
      ).toBe(true);
    }
  });

  it('parses the Inzhur group — fund slug and bond ISIN variants', () => {
    // NO UNITS: the group says where to look the instrument up and nothing else — counts
    // are `Σ transaction.quantity`. *Metric families and windows*
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

  it('DROPS a units key the caller still sends', () => {
    // A stale backup, or a caller written against the old shape. `z.object` is not strict,
    // so the key is ignored rather than rejected — and the parsed value must not carry it
    // through, or the count would ride back into the store without any field showing it.
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
  // THE ONE AMBIGUOUS SHAPE: three decimals, a comma, no dot. #31 makes it reachable —
  // a reinvestment buys a fractional count and the amount field now holds a per-unit
  // price. Every reading is a legal positive number, so nothing downstream refuses it.
  const base = {
    date: '2026-08-12',
    type: 'reinvest' as const,
    assetId: 'reit',
    amount: '484.36',
    // A `reinvest` moves a position, so it needs this — every case below overrides it
    // with the shape under test.
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
    // `f.units(6164)` prefills English as `6,164` and the asset form round-trips through
    // the same normalizer, which is why this rule cannot simply be deleted.
    expect(transactionSchema('en').parse({ ...base, quantity: '6,164' }).quantity).toBe(6164);
  });

  it('protects the per-unit AMOUNT the same way — it is money that reaches the ledger', () => {
    // Read as a grouping, a per-unit price becomes the transaction total a thousandfold up.
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
    // `transactionSchema`, and records an `interest_payout` with the result. On the
    // module-level grouping schema «1,240» was ₴1 240 there and ₴1.24 here, in one ledger.
    for (const lang of ['uk', 'en'] as const) {
      const viaCard = amountInputSchema(lang).parse('1,240');
      const viaPanel = transactionSchema(lang).parse({ ...base, amount: '1,240' }).amount;
      expect(viaCard, `${lang}: the two doors disagree`).toBeCloseTo(viaPanel, 6);
    }
    // The readings really do differ per language, or the assertion above would hold for
    // the wrong reason.
    expect(amountInputSchema('uk').parse('1,240')).toBeCloseTo(1.24, 6);
    expect(amountInputSchema('en').parse('1,240')).toBe(1240);
  });

  it('leaves the unambiguous shapes alone in both languages', () => {
    for (const lang of ['uk', 'en'] as const) {
      // A dot decimal and a both-marks paste read the same either way — a LONE comma is
      // the only shape whose meaning the language has to settle.
      expect(transactionSchema(lang).parse({ ...base, amount: '1240.00' }).amount).toBeCloseTo(
        1240,
        2,
      );
      expect(transactionSchema(lang).parse({ ...base, amount: '1.240,00' }).amount).toBeCloseTo(
        1240,
        2,
      );
      expect(transactionSchema(lang).parse({ ...base, quantity: '43.4785' }).quantity).toBeCloseTo(
        43.4785,
        6,
      );
    }
    // Each language's own writing of the same two figures, under that language.
    expect(transactionSchema('en').parse({ ...base, amount: '10,000.00' }).amount).toBeCloseTo(
      10000,
      2,
    );
    expect(transactionSchema('uk').parse({ ...base, amount: '1 240,00' }).amount).toBeCloseTo(
      1240,
      2,
    );
    expect(transactionSchema('uk').parse({ ...base, quantity: '43,4785' }).quantity).toBeCloseTo(
      43.4785,
      6,
    );
  });
});

describe('the transaction refinements #31 adds, and the count rule completes', () => {
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
    for (const type of everyType) {
      const parsed = transactionSchema('uk').safeParse({
        ...base,
        type,
        assetId: CARRIES[type].asset ? 'reit' : '',
        quantity: '10',
      });
      expect(parsed.success, type).toBe(CARRIES[type].quantity);
    }
  });

  it('REFUSES a position-moving row that lacks one', () => {
    // REVERSED by the owner's ruling. Accepting a blank count was grounded on every
    // pre-#31 row lacking one — a fact about rows already STORED, where this schema only
    // sees a row being typed now. Every coupon figure is `rate × units`, so a `buy` in
    // the default `total` mode with the field blank produced a bond whose coupon reads
    // «—» everywhere, silently.
    for (const type of everyType) {
      const assetId = CARRIES[type].asset ? 'reit' : '';
      const blank = transactionSchema('uk').safeParse({ ...base, type, assetId, quantity: '' });
      // A blank count is refused on exactly the types that take one and ACCEPTED on the
      // rest — both halves asserted, so a wrong row of `CARRIES` fails rather than
      // dropping its case.
      expect(blank.success, type).toBe(!CARRIES[type].quantity);
      if (!blank.success) {
        expect(blank.error.issues.map((i) => i.path.join('.'))).toContain('quantity');
        expect(
          transactionSchema('uk').safeParse({ ...base, type, assetId, quantity: '10' }).success,
          type,
        ).toBe(true);
      }
    }
  });

  it('defaults priceMode to total', () => {
    expect(transactionSchema('uk').parse(base).priceMode).toBe('total');
  });
});

describe('the asset is required only on the types that target one', () => {
  const base = {
    date: '2026-09-02',
    type: 'deposit' as const,
    assetId: '',
    amount: '1 000,00',
    quantity: '',
    source: 'own' as const,
  };

  it('accepts a portfolio-level row with NO asset — the shape the seed writes', () => {
    // `lib/seed.ts` records its three deposits as `assetId: ''`, `types.ts` documents that
    // as the portfolio-level shape and `backup/json.ts` skips the referential check for
    // it. The form's schema was the one door that refused it — and with no assets yet, the
    // first transaction anyone makes could not be recorded at all.
    for (const type of everyType) {
      if (CARRIES[type].asset) continue;
      expect(transactionSchema('uk').safeParse({ ...base, type }).success, type).toBe(true);
      expect(transactionSchema('uk').parse({ ...base, type }).assetId).toBe('');
    }
  });

  it('BLANKS an asset on a portfolio-level row rather than refusing it', () => {
    // The converse, and what makes the panel's hiding load-bearing rather than cosmetic:
    // the hidden picker still holds the last pick, so without this the row would be stored
    // against an asset nobody chose. NORMALIZED rather than rejected, and the asymmetry
    // with the quantity rule above is deliberate — a refusal has to be shown, and this
    // control is not on screen for these types.
    for (const type of everyType) {
      if (CARRIES[type].asset) continue;
      const parsed = transactionSchema('uk').safeParse({ ...base, type, assetId: 'reit' });
      expect(parsed.success, type).toBe(true);
      if (!parsed.success) continue;
      expect(parsed.data.assetId, type).toBe('');
    }
    // The quick-create sentinel is blanked with everything else: a row that targets no
    // asset cannot bring one into existence either.
    expect(transactionSchema('uk').parse({ ...base, assetId: 'new' }).assetId).toBe('');
  });

  it('requires one on every type that DOES target an asset, and on no other', () => {
    // BOTH HALVES against `CARRIES`, over all eight: the two rows that answer `false` are
    // the only cells the loops above cannot defend, because the schema NORMALIZES a
    // portfolio-level assetId rather than refusing it, so a fixture carrying one parses.
    for (const type of everyType) {
      const parsed = transactionSchema('uk').safeParse({
        ...base,
        type,
        quantity: CARRIES[type].quantity ? '10' : '',
      });
      expect(parsed.success, type).toBe(!CARRIES[type].asset);
      if (parsed.success) continue;
      expect(
        parsed.error.issues.map((i) => i.path.join('.')),
        type,
      ).toContain('assetId');
    }
  });

  it('keeps the quick-create sentinel intact on the types that target an asset', () => {
    expect(
      transactionSchema('uk').parse({ ...base, type: 'buy', assetId: 'new', quantity: '10' })
        .assetId,
    ).toBe('new');
  });
});

describe('a value that cannot be READ is a different failure from one that is not positive', () => {
  // Every non-empty failure used to be reported as a sign problem, so a pasted `16,5`
  // under English — positive, and refused only because English has no lone-comma
  // decimal — was answered with "has to be a positive number". The schemas already part
  // the two; nothing had read the difference. *Language, numbers, fonts*
  const unreadable = (r: { success: boolean; error?: { issues: { code: string }[] } }) =>
    !r.success && couldNotRead(r.error?.issues ?? []);

  it('says invalid_type for text this language cannot read', () => {
    for (const text of ['16,5', 'abc', '12abc', '1234,567']) {
      expect(unreadable(amountInputSchema('en').safeParse(text)), `en: ${text}`).toBe(true);
    }
    expect(unreadable(amountInputSchema('uk').safeParse('1,000,000'))).toBe(true);
  });

  it('refuses what only `Number()` would call a number', () => {
    // A spreadsheet cell pasted into an amount: `Number('1.2E+09')` is 1.2 billion, and
    // the schema recorded it while the field showing it refused to canonicalise the same
    // text — two readers of one string.
    for (const text of ['1.2E+09', '1e3', '0x10', '0b101', '0o17', 'Infinity']) {
      expect(amountInputSchema('en').safeParse(text).success, text).toBe(false);
      expect(unreadable(amountInputSchema('en').safeParse(text)), text).toBe(true);
    }
    // And the field's own reader agrees, which is the point of one shape.
    expect(storedNumber('1.2E+09')).toBeUndefined();
  });

  it('says too_small for a number that is merely not positive', () => {
    // POSITIVELY, not just "and not invalid_type": a third code would otherwise leave this
    // green while the UI's last arm quietly became a catch-all again.
    const codes = (text: string) => {
      const parsed = amountInputSchema('en').safeParse(text);
      return parsed.success ? ['ok'] : parsed.error.issues.map((i) => i.code);
    };
    for (const text of ['0', '-5', '-0.01']) {
      expect(codes(text), `en: ${text}`).toEqual(['too_small']);
    }
    // An empty field is `too_small` too — from the string's own `min(1)` — which is why
    // the component keeps splitting that case on the value itself.
    expect(codes('')).toEqual(['too_small']);
  });

  it('carries the same split through the transaction form, per field', () => {
    const base = {
      date: '2026-09-11',
      type: 'buy' as const,
      assetId: 'reit',
      source: 'own' as const,
      quantity: '10',
      amount: '1000.00',
    };
    const codeFor = (row: Record<string, unknown>, field: string) => {
      const parsed = transactionSchema('en').safeParse(row);
      return parsed.success
        ? 'ok'
        : (parsed.error.issues.find((i) => i.path[0] === field)?.code ?? 'none');
    };
    expect(codeFor({ ...base, amount: '16,5' }, 'amount')).toBe('invalid_type');
    expect(codeFor({ ...base, amount: '0' }, 'amount')).toBe('too_small');
    expect(codeFor({ ...base, quantity: '16,5' }, 'quantity')).toBe('invalid_type');
    expect(codeFor({ ...base, quantity: '-5' }, 'quantity')).toBe('too_small');
  });
});

describe('the withholding and the note at the form door', () => {
  const base = {
    date: '2026-03-01',
    type: 'interest_payout' as const,
    assetId: 'a1',
    amount: '100',
    source: 'own' as const,
  };

  it('accepts a withholding below the amount on either payout type', () => {
    for (const type of ['dividend_accrual', 'interest_payout'] as const) {
      const ok = transactionSchema('uk').safeParse({ ...base, type, taxWithheld: '65,44' });
      expect(ok.success, type).toBe(true);
      if (!ok.success) continue;
      expect(ok.data.taxWithheld, type).toBeCloseTo(65.44, 2);
    }
  });

  it('refuses one that reaches its own amount, and one above it', () => {
    // `transaction_tax_bound_ck` is `tax_withheld < amount`, STRICTLY — a withholding
    // that is the whole payout leaves nothing received.
    for (const value of ['100', '120,00']) {
      const bad = transactionSchema('uk').safeParse({ ...base, taxWithheld: value });
      expect(bad.success, value).toBe(false);
      if (bad.success) continue;
      expect(bad.error.issues.map((i) => i.path.join('.'))).toContain('taxWithheld');
    }
  });

  it('refuses one on every type that takes none, and accepts it on the two that do', () => {
    // `transaction_tax_absent_ck`. It REFUSES rather than normalizing, which is
    // `quantity`'s precedent and not `assetId`'s: the panel clears the value on a type
    // change, so the refusal never fires at a control nobody can see. Every type is PARSED
    // and its outcome asserted rather than six selected out of eight — a `continue` turns
    // a wrong row of `CARRIES` from a failing assertion into a missing one.
    for (const type of everyType) {
      const parsed = transactionSchema('uk').safeParse({
        ...base,
        type,
        assetId: CARRIES[type].asset ? 'a1' : '',
        quantity: CARRIES[type].quantity ? '10' : '',
        taxWithheld: '5',
      });
      expect(parsed.success, type).toBe(CARRIES[type].withholding);
      if (parsed.success) continue;
      expect(
        parsed.error.issues.map((i) => i.path.join('.')),
        type,
      ).toContain('taxWithheld');
    }
  });

  it('reads zero and a negative as the sign failure, not as absence', () => {
    for (const value of ['0', '-5']) {
      expect(transactionSchema('uk').safeParse({ ...base, taxWithheld: value }).success).toBe(
        false,
      );
    }
  });

  it('treats an absent, empty and whitespace-only withholding as the same state', () => {
    for (const taxWithheld of [undefined, '', '   ']) {
      const ok = transactionSchema('uk').safeParse({ ...base, taxWithheld });
      expect(ok.success, String(taxWithheld)).toBe(true);
      if (!ok.success) continue;
      expect(ok.data.taxWithheld, String(taxWithheld)).toBeUndefined();
    }
  });

  it('takes a note on every one of the eight types', () => {
    for (const type of everyType) {
      const ok = transactionSchema('uk').safeParse({
        ...base,
        type,
        assetId: CARRIES[type].asset ? 'a1' : '',
        quantity: CARRIES[type].quantity ? '10' : '',
        note: 'Звірено з випискою',
      });
      expect(ok.success, type).toBe(true);
      if (!ok.success) continue;
      expect(ok.data.note, type).toBe('Звірено з випискою');
    }
  });

  it('accepts a note AT the cap and refuses one a single character over', () => {
    const at =
      'Звірено з випискою банку за вересень: виплату затримали на три дні та зарахували разом із наступною.';
    const over =
      'Звірено із випискою банку за вересень: виплату затримали на три дні та зарахували разом із наступною.';
    expect(at).toHaveLength(100);
    expect(over).toHaveLength(101);
    expect(transactionSchema('uk').parse({ ...base, note: at }).note).toBe(at);
    const bad = transactionSchema('uk').safeParse({ ...base, note: over });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    expect(bad.error.issues.map((i) => i.path.join('.'))).toContain('note');
  });

  it('counts the cap in CHARACTERS, the way the store counts it', () => {
    // `String.length` counts UTF-16 units, so a hundred astral characters measure 200
    // there and 100 to `transaction_note_ck`. Counting code points makes the word
    // "characters" true of every door, and keeps the form from refusing a note the store
    // would have taken.
    const astral = '😀'.repeat(100);
    expect(astral.length).toBe(200);
    expect([...astral]).toHaveLength(100);
    expect(transactionSchema('uk').safeParse({ ...base, note: astral }).success).toBe(true);
    expect(transactionSchema('uk').safeParse({ ...base, note: '😀'.repeat(101) }).success).toBe(
      false,
    );
  });

  it('stores an empty note as ABSENT, never as an empty string', () => {
    // `transaction_note_ck` spells "none" as NULL and nothing else, so a blank field must
    // not reach the store as ''. Trimmed, too: a note of spaces is a note nobody typed.
    for (const note of [undefined, '', '   ']) {
      const parsed = transactionSchema('uk').parse({ ...base, note });
      expect(parsed.note, String(note)).toBeUndefined();
      expect('note' in parsed && parsed.note === '', String(note)).toBe(false);
    }
    expect(transactionSchema('uk').parse({ ...base, note: '  Звірено  ' }).note).toBe('Звірено');
  });
});
