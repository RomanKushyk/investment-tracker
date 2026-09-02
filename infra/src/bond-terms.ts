import { createHash } from 'node:crypto';

import type { InzhurQuote } from '../../src/core/inzhur/parse';

/** One `bond_terms` row, minus the `as_of` and the capture metadata the caller
 *  supplies. */
export interface BondTermsRow {
  ref: string;
  maturity: string | null;
  /** The schedule as JSON text — see `bondTermsRow` on why text, not JSONB. */
  paymentSchedule: string;
  /** Digest over the terms themselves, so a REVISION is findable without
   *  diffing JSON across a year of rows. */
  termsSha256: string;
}

/**
 * The archived terms of one bond, or `null` for anything that has none.
 *
 * WHY THIS TABLE EXISTS AT ALL, and it is the only reason: the schedule is
 * reconstructable in principle, but **delisting after maturity destroys the
 * live copy permanently**. `dcf.ts` cannot price a bond without it, and W10/W12
 * will need the schedule of instruments the feed has stopped listing. So it is
 * captured rather than derived, on the same argument that keeps raw payloads.
 *
 * WRITTEN EVERY RUN, keyed by `(as_of, ref)`, which applies the owner's
 * write-every-day ruling to this table rather than inventing a second policy
 * one table over. "Versioned and effective-dated" is then a property of the
 * SERIES, not of a change-detecting writer: consecutive rows carry the terms as
 * they stood on each day, and `termsSha256` makes the day a revision landed a
 * single scan rather than a JSON diff. A change-detecting key was considered
 * and rejected: it needs a read per bond per run, and a schedule that changed
 * and changed back would collide with its own earlier digest.
 *
 * DERIVED FACTS ARE NOT STORED. `ScheduleFacts`, `couponRatePct`,
 * `payoutSchedule` and everything `dcf.ts` computes stay read-time
 * derivations. The premises are captured forever; the conclusion never is.
 *
 * TWO REFUSALS, both returning `null` rather than a row:
 *
 * - **Funds.** They have no terms. `paymentSchedule` is an empty list for them
 *   by construction, and a row saying so would be a fund pretending to be a
 *   zero-coupon bond.
 * - **A bond whose schedule is empty.** Same shape, worse consequence: it is
 *   indistinguishable from a real zero-coupon instrument, and this table is the
 *   ONLY surviving copy after delisting. Writing nothing is recoverable from
 *   the raw payload; writing a false row is not, because the archive has no
 *   DELETE grant.
 */
export function bondTermsRow(quote: InzhurQuote): BondTermsRow | null {
  if (quote.kind !== 'bond') return null;
  if (quote.paymentSchedule.length === 0) return null;

  // The parser already solved the two traps this inherits: schedule dates
  // arrive as instants at Kyiv midnight and must be read in Kyiv or they land a
  // day early and contradict `maturityDate`; amounts are kopecks as strings,
  // divided in exactly one place. Serialising what it produced keeps both
  // solved in one place rather than two.
  const paymentSchedule = JSON.stringify(quote.paymentSchedule);
  const maturity = quote.maturity ?? null;

  // TEXT holding JSON, not JSONB. The type is a create-time choice on DSQL
  // (D100: a type change is one of the two things that cannot be altered
  // later), nothing reads this column yet, and TEXT is the shape the rest of
  // this schema already uses for structured values. A reader wanting JSONB can
  // cast; a table that guessed wrong cannot be migrated.
  //
  // THE REF IS IN THE DIGEST. Two bonds can genuinely share a schedule shape,
  // and a digest that collided across instruments would report a revision that
  // never happened the moment one of them was re-listed.
  const termsSha256 = createHash('sha256')
    .update(`${quote.ref} ${maturity ?? ''} ${paymentSchedule}`)
    .digest('hex');

  return { ref: quote.ref, maturity, paymentSchedule, termsSha256 };
}
