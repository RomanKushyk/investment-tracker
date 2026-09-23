// `diagnose`'s gap reconciliation: each observation group's distinct days against the capture
// days of its source. Its own module so PGlite can run it; `capture.ts` cannot load in a test.
import type { SqlClient } from './migrate';

/** The one capture error a source's observer derives past, as `NEWEST_CAPTURE_PER_DATE`'s `$4`. */
export interface ReadPast {
  source: string;
  errorLike: string;
}

/** The days the observers read, from the source's first — or the ref's first known day, if later,
 *  `listed_from` (`migrations/002_price_observation.sql`) or an earlier row — to the last row. */
const RECONCILE = `
  WITH usable AS (
    SELECT DISTINCT source, as_of
      FROM price_capture
     WHERE ok = true OR (source = $1 AND error LIKE $2)),
  captured AS (
    SELECT source, min(as_of) AS since FROM usable GROUP BY source),
  counted AS (
    SELECT o.instrument_ref, o.basis, o.source, c.since, i.listed_from,
           count(*) AS n,
           sum(CASE WHEN c.since IS NULL OR o.as_of < c.since THEN 1 ELSE 0 END) AS before_capture,
           min(o.as_of) AS earliest,
           count(DISTINCT CASE WHEN o.as_of >= c.since THEN o.as_of END) AS dates,
           min(CASE WHEN o.as_of >= c.since THEN o.as_of END) AS first,
           max(CASE WHEN o.as_of >= c.since THEN o.as_of END) AS last
      FROM price_observation o
      LEFT JOIN captured c ON c.source = o.source
      LEFT JOIN instrument i ON i.ref = o.instrument_ref
     GROUP BY o.instrument_ref, o.basis, o.source, c.since, i.listed_from),
  grouped AS (
    -- A row proves the ref existed that day, so it outranks a listed_from written after it.
    SELECT k.*, greatest(k.since, least(k.listed_from, k.first)) AS measured_from
      FROM counted k)
  SELECT g.instrument_ref, g.basis, g.source,
         g.n::text AS n,
         g.before_capture::text AS before_capture,
         to_char(g.earliest, 'YYYY-MM-DD') AS earliest_as_of,
         g.dates::text AS dates,
         CASE WHEN g.dates > 0 THEN to_char(g.measured_from, 'YYYY-MM-DD') END AS measured_from,
         to_char(g.first, 'YYYY-MM-DD') AS first_as_of,
         to_char(g.last, 'YYYY-MM-DD') AS last_as_of,
         CASE WHEN g.dates > 0 THEN (
           SELECT count(*) FROM usable u
            WHERE u.source = g.source AND u.as_of BETWEEN g.measured_from AND g.last)::text
         END AS published_days
    FROM grouped g
   ORDER BY g.instrument_ref, g.basis, g.source`;

export async function reconcileObservations(client: SqlClient, readPast: ReadPast) {
  // Rows before the source's first usable day are `before_capture` and measure nothing: the
  // fund-history import writes them with no capture behind them.
  const { rows } = await client.query<{
    instrument_ref: string;
    basis: string;
    source: string;
    n: string;
    before_capture: string;
    earliest_as_of: string;
    dates: string;
    measured_from: string | null;
    first_as_of: string | null;
    last_as_of: string | null;
    published_days: string | null;
  }>(RECONCILE, [readPast.source, readPast.errorLike]);

  return rows.map(({ published_days, ...o }) => ({
    ...o,
    // NULL WHEN NOTHING WAS MEASURED, as is `measured_from`: zero is what a reconciled group reads.
    publishedDays: published_days,
    // ONE row per published day PER BASIS, hence the GROUP BY per (ref, basis, source). A `nav`
    // day published as zero stores no row, so it reads as a gap of one — and is one.
    gaps: published_days === null ? null : Number(published_days) - Number(o.dates),
  }));
}
