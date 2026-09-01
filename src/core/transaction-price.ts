// ISSUE #31 — what the transaction form's amount field means, resolved once.
//
// The panel offers a toggle: the number typed is either the TOTAL ₴ the
// transaction moved, or the price of ONE unit. Only the total is stored as
// `amount`, whichever way it was typed, so a row recorded in one mode is
// indistinguishable from the same row recorded in the other. `unitPrice` is kept
// beside it — W7 stores all three columns (`amount`, `quantity`, `unit_price`)
// and enforces no arithmetic between them.
//
// TWO ROUNDING RULES, and they differ on purpose:
//
//   `amount`    money, so kopiykas — it is a ₴ figure the app displays and sums
//               into capital, and D13's "round at display only" governs
//               derivations over stored data, not the act of recording one.
//   `unitPrice` SIX decimals, which is deliberately more than the four the
//               Inzhur feed publishes (11.1389, 6675.8848). Rounding a derived
//               price to the feed's own precision would quietly assert that the
//               division came out to a published price when it did not; six
//               keeps the extra digits that say otherwise while still cutting
//               binary-float noise (64 628.62 ÷ 5 800 is not representable).
//
// The two are NOT inverses, and nothing here pretends they are: in `total` mode
// the price is derived from a rounded amount, in `unit` mode the amount is
// derived from the price. Re-deriving one from the other can differ in the last
// kopiyka, which is why both are stored rather than one computed on read.

import { normalizeNumberInput } from './schemas';

/**
 * WHAT THE TYPED AMOUNT BECOMES WHEN THE Σ/1 TOGGLE MOVES.
 *
 * The toggle changes what the field MEANS, so the digits have to move with the
 * label: measured, «55 694,50» typed as a total and then flipped to per-unit
 * submitted ₴278 472 500. Converting is also the honest reading of the gesture
 * — asked for the per-unit price of what was typed, the field shows it.
 *
 * `undefined` means THERE IS NOTHING TO CONVERT TO, and the caller empties the
 * field rather than reinterpreting what is in it: no count to divide by, an
 * unparseable amount, or a product that is not a positive number. An empty
 * field asks for the value the new label describes; a stale one lies about it.
 *
 * Takes the strings the form holds, not numbers, because the grammar is part of
 * the question — `43,478` is two different counts in the two languages (D87).
 */
export function convertTypedAmount(
  typed: string,
  quantity: string,
  to: 'total' | 'unit',
  groupsWithComma: boolean,
): number | undefined {
  if (typed.trim() === '') return undefined;
  const amount = Number(normalizeNumberInput(typed, groupsWithComma));
  const count = Number(normalizeNumberInput(quantity, groupsWithComma));
  if (!Number.isFinite(amount) || !Number.isFinite(count) || count <= 0) return undefined;
  const next = to === 'unit' ? amount / count : amount * count;
  return Number.isFinite(next) && next > 0 ? next : undefined;
}

/** Money: whole kopiykas. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A per-unit price: six decimals — see the header. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export interface PriceInput {
  /** The number in the amount field — a total or a per-unit price. */
  amount: number;
  /** Units, when the row carries them. */
  quantity?: number;
  /** Which of the two `amount` is. */
  priceMode: 'total' | 'unit';
}

export interface PriceParts {
  /** ALWAYS the total ₴ the transaction moved, whichever way it was typed. */
  amount: number;
  /** Absent whenever there is no quantity to divide by, or it rounds away. */
  unitPrice?: number;
}

/**
 * The `amount` to store and the `unitPrice` that goes with it.
 *
 * `undefined` MEANS THERE IS NO ROW TO RECORD — only reachable in `unit` mode,
 * where the total is derived and can round away or have no count to derive
 * from. It is a discriminator rather than an overloaded field: the first cut
 * signalled failure by handing the TYPED figure back as `amount` with no price,
 * so the caller had to infer failure from a missing `unitPrice` — and could not
 * tell that from a price that merely underflowed, which is a recordable row.
 * The two got the same refusal, and it named the wrong field.
 *
 * `unitPrice` is `undefined` whenever there is no quantity to divide by — a
 * payout, a tax, a deposit, or a purchase whose units the user did not record.
 * It is never invented from a total alone.
 */
export function priceParts(input: PriceInput): PriceParts | undefined {
  const { amount, quantity, priceMode } = input;

  // A DERIVED VALUE THAT ROUNDS TO ZERO IS NOT A VALUE.
  //
  // Before the toggle, `amount` WAS the validated field, so `> 0` was guaranteed
  // by the form's schema. Deriving it broke that: a quantity of 0,0001 at
  // ₴11.1389 rounds to ₴0.00, and `round6` collapses symmetrically on a large
  // quantity. Either would reach Dexie unvalidated and then be REFUSED by this
  // app's own backup parser, which declares `amount: z.number().positive()` — a
  // row the app wrote that it cannot read back. A zero amount also feeds
  // `netDeposits`, which is the reason that check exists at all.
  const positive = (n: number): number | undefined => (n > 0 ? n : undefined);

  if (priceMode === 'unit') {
    // The form refuses `unit` mode without a quantity, so this branch has one;
    // the guard is here because this module is pure and a caller other than the
    // panel must not be able to multiply by undefined.
    if (quantity === undefined) return undefined;
    // THE TOTAL IS THE ROW. If it survives rounding there is a transaction to
    // record, and a price that underflowed is simply absent — exactly what
    // `total` mode does in the mirror situation, and what every row written
    // before #31 already looks like. Refusing the whole row because the price
    // could not be represented threw away a perfectly good ₴10 and told the
    // user their positive amount was not positive.
    const total = positive(round2(amount * quantity));
    if (total === undefined) return undefined;
    const perUnit = positive(round6(amount));
    return perUnit === undefined ? { amount: total } : { amount: total, unitPrice: perUnit };
  }

  if (quantity === undefined || quantity === 0) return { amount };
  const perUnit = positive(round6(amount / quantity));
  return perUnit === undefined ? { amount } : { amount, unitPrice: perUnit };
}
