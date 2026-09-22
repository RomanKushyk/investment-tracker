import { createHash } from 'node:crypto';

import type { InzhurQuote } from '@quirenote/core/inzhur/parse';

export interface BondTermsRow {
  ref: string;
  maturity: string | null;
  /** The schedule as JSON text — see `bondTermsRow` on why text, not JSONB. */
  paymentSchedule: string;
  /** Digest over the terms, so a REVISION is findable without diffing JSON across a year. */
  termsSha256: string;
}

/**
 * The archived terms of one bond, or `null` for anything that has none.
 *
 * WHY THE TABLE EXISTS AT ALL, and it is the only reason: delisting after maturity destroys the
 * live copy of a schedule permanently, and `dcf.ts` cannot price a bond without it.
 *
 * TWO REFUSALS, both `null` rather than a row. A fund has no terms. A bond whose schedule is
 * empty is worse: it is indistinguishable from a real zero-coupon instrument, and writing nothing
 * stays recoverable from the raw payload where a false row does not — there is no DELETE grant.
 */
export function bondTermsRow(quote: InzhurQuote): BondTermsRow | null {
  if (quote.kind !== 'bond') return null;
  if (quote.paymentSchedule.length === 0) return null;

  // Serialising what the parser produced keeps its two traps solved in one place: schedule dates
  // land a day early unless read in Kyiv, and amounts are kopecks divided in exactly one place.
  const paymentSchedule = JSON.stringify(quote.paymentSchedule);
  const maturity = quote.maturity ?? null;

  // TEXT holding JSON, not JSONB: a column type is a create-time choice on DSQL and cannot be
  // altered later. A reader wanting JSONB can cast; a table that guessed wrong cannot be migrated.
  // The ref is IN the digest because two bonds can genuinely share a schedule shape, and a digest
  // colliding across instruments would report a revision that never happened.
  const termsSha256 = createHash('sha256')
    .update(`${quote.ref} ${maturity ?? ''} ${paymentSchedule}`)
    .digest('hex');

  return { ref: quote.ref, maturity, paymentSchedule, termsSha256 };
}
