import { describe, expect, it } from 'vitest';

import { convertTypedAmount, priceParts } from './transaction-price';

describe('priceParts', () => {
  it('stores the typed total unchanged and derives the price from it', () => {
    expect(priceParts({ amount: 55_694.5, quantity: 5_000, priceMode: 'total' })).toEqual({
      amount: 55_694.5,
      unitPrice: 11.1389,
    });
  });

  it('derives the total from a per-unit price, rounded to kopiykas', () => {
    expect(priceParts({ amount: 11.1389, quantity: 5_000, priceMode: 'unit' })).toEqual({
      amount: 55_694.5,
      unitPrice: 11.1389,
    });
  });

  it('rounds the derived total, and only the total', () => {
    // 11.1389 × 4 321 = 48 131.1869 — the amount takes kopiykas, the price is
    // kept exactly as typed rather than back-computed from the rounded total.
    const parts = priceParts({ amount: 11.1389, quantity: 4_321, priceMode: 'unit' });
    const { amount, unitPrice } = parts ?? {};
    expect(amount).toBe(48_131.19);
    expect(unitPrice).toBe(11.1389);
  });

  it('leaves the price absent when there is no quantity to divide by', () => {
    // A payout, a tax, a deposit — or a purchase whose units were not recorded,
    // which is every row entered before #31. A price is never invented from a
    // total alone.
    expect(priceParts({ amount: 700.36, priceMode: 'total' })).toEqual({ amount: 700.36 });
  });

  it('cuts binary-float noise out of a derived price', () => {
    // 64 628.62 ÷ 5 800 = 11.142865517241379... in exact arithmetic and carries
    // a longer tail in binary. Six decimals is the stored precision.
    expect(priceParts({ amount: 64_628.62, quantity: 5_800, priceMode: 'total' })).toEqual({
      amount: 64_628.62,
      unitPrice: 11.142866,
    });
  });

  it('keeps more precision than the feed publishes', () => {
    // The feed's four decimals must not be the rounding target: a price that did
    // NOT come out to a published figure has to stay visibly different from one
    // that did. 1 ÷ 3 is the clearest case.
    expect(priceParts({ amount: 1, quantity: 3, priceMode: 'total' })?.unitPrice).toBe(0.333333);
  });

  it('has no row to record in per-unit mode without a quantity', () => {
    // The form cannot reach this — `transactionSchema` rejects it — but a pure
    // module must not multiply by undefined and hand back NaN.
    expect(priceParts({ amount: 11.1389, priceMode: 'unit' })).toBeUndefined();
  });

  it('records the total even when the PRICE rounds away, and stores no price', () => {
    // `0,0000001` is a legal positive number to the form's schema. `round6`
    // collapses it to 0 — and `json.ts` declares `unitPrice` positive, so
    // storing that zero writes a row this app's own backup parser refuses. The
    // ₴10 product is a perfectly good transaction, so it is recorded with no
    // price, exactly as `total` mode does and as every row recorded before the
    // count existed already is.
    expect(priceParts({ amount: 1e-7, quantity: 100_000_000, priceMode: 'unit' })).toEqual({
      amount: 10,
    });
  });

  it('has no row when the TOTAL itself rounds away', () => {
    // This is the only real failure in per-unit mode, and the only case the
    // caller must refuse: ₴0,001 per unit for 0,001 units is under a kopiyka.
    expect(priceParts({ amount: 0.001, quantity: 0.001, priceMode: 'unit' })).toBeUndefined();
  });

  it('does not divide by zero', () => {
    expect(priceParts({ amount: 500, quantity: 0, priceMode: 'total' })).toEqual({ amount: 500 });
  });
});

describe('convertTypedAmount — the toggle moves the number, not just the label', () => {
  it('turns a total into the price of one unit, and back', () => {
    // The measured defect: «55 694,50» typed as a total, flipped to per-unit,
    // submitted ₴278 472 500 because only the label had changed.
    expect(convertTypedAmount('55 694,50', '5 000', 'unit', false)).toBeCloseTo(11.1389, 6);
    expect(convertTypedAmount('11,1389', '5 000', 'total', false)).toBeCloseTo(55_694.5, 2);
  });

  it('reads the two strings under the language the form parses with', () => {
    // `43,478` is 43.478 units to a Ukrainian typist and 43 478 under the
    // grouping rule (D87), and the amount divides by whichever it is.
    expect(convertTypedAmount('100', '43,478', 'unit', false)).toBeCloseTo(2.3000138, 6);
    expect(convertTypedAmount('100', '43,478', 'unit', true)).toBeCloseTo(0.0023, 6);
  });

  it('has nothing to convert to without a usable count', () => {
    // The caller empties the field on `undefined`. Reinterpreting what is in it
    // is the defect; an empty field asks for the value the new label describes.
    for (const count of ['', '0', '-5', 'abc']) {
      expect(convertTypedAmount('55 694,50', count, 'unit', false)).toBeUndefined();
    }
  });

  it('refuses to convert what it cannot read, and what rounds to nothing', () => {
    expect(convertTypedAmount('', '5 000', 'unit', false)).toBeUndefined();
    expect(convertTypedAmount('abc', '5 000', 'unit', false)).toBeUndefined();
    // A product at or below zero is not an amount this app records.
    expect(convertTypedAmount('0', '5 000', 'total', false)).toBeUndefined();
  });
});
