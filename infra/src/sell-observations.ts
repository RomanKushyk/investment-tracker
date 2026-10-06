// The archive read `GET /view` makes, apart from `capture.ts` so the view function imports the
// read and not the capture handler, its AWS clients and its provider parsers.
import { createHash } from 'node:crypto';

import { addDays } from '@quirenote/core/dates';
import { normalizeRef } from '@quirenote/core/inzhur/ref';

import type { SqlClient } from './migrate';
import { observeWindowEnd } from './observe-window';

export interface SellObservation {
  /** As the archive stores it; a caller matches it to an asset through `normalizeRef`. */
  ref: string;
  asOf: string;
  price: number;
}

/** A bond's payment dates, from its latest `bond_terms` row in the span. */
export interface PaymentDates {
  /** As the archive stores it; a caller matches it to an asset through `normalizeRef`. */
  ref: string;
  dates: string[];
}

type Row = { instrument_ref: string; as_of: string; price: string };
type TermsRow = { ref: string; day: string; payment_schedule: string };

// Two spellings, not `lower(…)`, which bypasses the `(instrument_ref, as_of)` and `(ref, as_of)`
// indexes: refs are stored as served, ISINs upper-case (ISO 6166) and slugs lower-case.
const spellingsOf = (refs: readonly string[]) => [
  ...new Set(refs.map(normalizeRef).flatMap((ref) => [ref, ref.toUpperCase()])),
];

/** The `sell` rows from `inzhur` for `refs` over `from`..`to`, and a digest of exactly those rows:
 *  a capture row's `quotes_sha256` hashes the whole feed, and a replay writes no capture row. */
export async function readSellObservations(
  client: SqlClient,
  refs: readonly string[],
  from: string,
  to: string,
): Promise<{ rows: SellObservation[]; digest: string }> {
  observeWindowEnd(from, to);
  if (from > to) throw new Error(`span starts after it ends: ${from} to ${to}`);
  const spellings = spellingsOf(refs);
  const read: Row[] = [];
  if (spellings.length > 0) {
    // No row limit: the key caps a window at spellings × days, and an unordered `LIMIT` would
    // leave no cursor to resume from.
    for (let start = from; start <= to;) {
      const end = observeWindowEnd(start, to);
      const res = await client.query<Row>(
        `SELECT instrument_ref, to_char(as_of, 'YYYY-MM-DD') AS as_of, price::text AS price
           FROM price_observation
          WHERE instrument_ref = ANY($1::text[]) AND as_of BETWEEN $2 AND $3
            AND basis = 'sell' AND source = 'inzhur'`,
        [spellings, start, end],
      );
      for (const row of res.rows) read.push(row);
      start = addDays(end, 1);
    }
  }
  // Sorted, as `capture.ts`'s `digestOf` is: the rows come back in no promised order.
  const lines = read.map((r) => `${normalizeRef(r.instrument_ref)}:${r.as_of}:${r.price}`).sort();
  return {
    rows: read.map((r) => ({ ref: r.instrument_ref, asOf: r.as_of, price: Number(r.price) })),
    digest: createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex'),
  };
}

/** Each ref's payment dates from its latest `bond_terms` row over `from`..`to`, each date once, and
 *  a digest of exactly what is served. A ref with no row in the span is absent. */
export async function readPaymentDates(
  client: SqlClient,
  refs: readonly string[],
  from: string,
  to: string,
): Promise<{ rows: PaymentDates[]; digest: string }> {
  observeWindowEnd(from, to);
  if (from > to) throw new Error(`span starts after it ends: ${from} to ${to}`);
  const spellings = spellingsOf(refs);
  // ONE ROW PER FOLDED REF, the later day kept, then the lesser text: a ref stored in two
  // spellings would otherwise let arrival order pick the schedule under one digest.
  const latest = new Map<string, TermsRow>();
  if (spellings.length > 0) {
    for (let start = from; start <= to;) {
      const end = observeWindowEnd(start, to);
      // The latest row per spelling, each a backward walk of `(ref, as_of)` that stops at one,
      // whatever the window's length.
      const res = await client.query<TermsRow>(
        `SELECT t.ref, to_char(t.as_of, 'YYYY-MM-DD') AS day, t.payment_schedule
           FROM unnest($1::text[]) AS asked(ref)
          CROSS JOIN LATERAL (
            SELECT ref, as_of, payment_schedule
              FROM bond_terms
             WHERE ref = asked.ref AND as_of BETWEEN $2 AND $3
             ORDER BY as_of DESC
             LIMIT 1) t`,
        [spellings, start, end],
      );
      for (const row of res.rows) {
        const key = normalizeRef(row.ref);
        const kept = latest.get(key);
        if (
          kept === undefined ||
          row.day > kept.day ||
          (row.day === kept.day && row.payment_schedule < kept.payment_schedule)
        )
          latest.set(key, row);
      }
      start = addDays(end, 1);
    }
  }
  // The capture serialises the parser's schedule, sorted by date; the maturity carries both the
  // last coupon and the principal, so its date comes twice.
  const rows = [...latest.values()].map((r) => ({
    ref: r.ref,
    dates: [...new Set((JSON.parse(r.payment_schedule) as { date: string }[]).map((p) => p.date))],
  }));
  const lines = rows.map((r) => `${normalizeRef(r.ref)}:${r.dates.join(',')}`).sort();
  return {
    rows,
    digest: createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex'),
  };
}
