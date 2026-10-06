// The archive read `/view` will make, apart from `capture.ts` so the view function imports the
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

type Row = { instrument_ref: string; as_of: string; price: string };

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
  // Two spellings, not `lower(instrument_ref)`, which bypasses the `(instrument_ref, as_of)`
  // index: refs are stored as served, ISINs upper-case (ISO 6166) and slugs lower-case.
  const spellings = [...new Set(refs.map(normalizeRef).flatMap((ref) => [ref, ref.toUpperCase()]))];
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
