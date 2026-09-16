// Only the TOTAL is stored as `amount`, whichever way it was typed, so a row
// recorded in one mode is indistinguishable from the same row recorded in the
// other.
//
// TWO ROUNDING RULES, and they differ on purpose. `amount` is money, so KOPIYKAS.
// `unitPrice` takes SIX decimals, deliberately more than the four the feed
// publishes: rounding to the feed’s own precision would assert that the division
// came out to a published price when it did not.
//
// The two are NOT inverses — one mode derives the price from a rounded amount and
// the other derives the amount from the price, so re-deriving either can differ in
// the last kopiyka. That is why BOTH are stored rather than one computed on read.

import { readNumber } from './schemas';
import type { Lang } from './money';

/**
 * What the typed amount becomes when the Σ/1 toggle moves — the toggle changes
 * what the field MEANS, so the digits move with the label. `undefined` means
 * THERE IS NOTHING TO CONVERT TO, and the caller empties the field rather than
 * reinterpreting it: an empty field asks for the value the new label describes.
 *
 * Takes the STRINGS the form holds, because the grammar is part of the question,
 * and the LANGUAGE rather than the grammar, since a boolean is one inverted
 * expression away from a silent thousandfold.
 */
export function convertTypedAmount(
  typed: string,
  quantity: string,
  to: 'total' | 'unit',
  lang: Lang,
): number | undefined {
  if (typed.trim() === '') return undefined;
  // THE SAME READER THE SCHEMA USES: on bare `Number()` this toggle converted `1e3`
  // to 1000 and wrote back a figure the amount field itself refuses.
  const amount = readNumber(typed, lang);
  const count = readNumber(quantity, lang);
  if (amount === undefined || count === undefined || count <= 0) return undefined;
  const next = to === 'unit' ? amount / count : amount * count;
  return Number.isFinite(next) && next > 0 ? next : undefined;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export interface PriceInput {
  amount: number;
  quantity?: number;
  priceMode: 'total' | 'unit';
}

export interface PriceParts {
  amount: number;
  unitPrice?: number;
}

/**
 * `undefined` MEANS THERE IS NO ROW TO RECORD — a discriminator rather than an
 * overloaded field, because handing the typed figure back with no price cannot be
 * told apart from a price that merely underflowed, which IS a recordable row.
 */
export function priceParts(input: PriceInput): PriceParts | undefined {
  const { amount, quantity, priceMode } = input;

  // A DERIVED VALUE THAT ROUNDS TO ZERO IS NOT A VALUE: a zero would reach Dexie
  // unvalidated and then be REFUSED by this app’s own backup parser — a row the app
  // wrote that it cannot read back.
  const positive = (n: number): number | undefined => (n > 0 ? n : undefined);

  if (priceMode === 'unit') {
    // The form refuses `unit` mode without a quantity; the guard is here because this
    // module is pure and another caller must not multiply by undefined.
    if (quantity === undefined) return undefined;
    // THE TOTAL IS THE ROW: if it survives rounding there is a transaction to record,
    // and a price that underflowed is simply absent — what `total` mode does in the
    // mirror situation. Refusing the whole row would tell the user their positive
    // amount was not positive.
    const total = positive(round2(amount * quantity));
    if (total === undefined) return undefined;
    const perUnit = positive(round6(amount));
    return perUnit === undefined ? { amount: total } : { amount: total, unitPrice: perUnit };
  }

  if (quantity === undefined || quantity === 0) return { amount };
  const perUnit = positive(round6(amount / quantity));
  return perUnit === undefined ? { amount } : { amount, unitPrice: perUnit };
}
