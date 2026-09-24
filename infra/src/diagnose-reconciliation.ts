// `diagnose`'s gap reconciliation: each observation group's distinct days against the capture
// days of its source, and imported history against the calendar. Its own module so PGlite can run
// it; `capture.ts` cannot load in a test.
import { FUND_HISTORY_PARSER_VERSION } from './fund-history';
import type { SqlClient } from './migrate';

/** The capture errors a source's observer derives past, as `NEWEST_CAPTURE_PER_DATE`'s `$4`. */
export interface ReadPast {
  source: string;
  errorsLike: readonly string[];
}

/** At most this many per group, the latest, so an old hole cannot crowd out a repairable one.
 *  `emptyDays` keeps the whole count: a shorter list is a cut one. */
export const EMPTY_DATES_CAP = 100;

/** The days the observers read, from the source's first — or the ref's first known day, if later,
 *  `listed_from` (`migrations/002_price_observation.sql`) or an earlier row — to the last row. */
const RECONCILE = `
  WITH usable AS (
    SELECT DISTINCT source, as_of
      FROM price_capture
     WHERE ok = true OR (source = $1 AND error LIKE ANY ($2::text[]))),
  captured AS (
    SELECT source, min(as_of) AS since FROM usable GROUP BY source),
  counted AS (
    SELECT o.instrument_ref, o.basis, o.source, c.since, i.listed_from,
           count(*) AS n,
           sum(CASE WHEN c.since IS NULL OR o.as_of < c.since THEN 1 ELSE 0 END) AS before_capture,
           min(o.as_of) AS earliest,
           count(DISTINCT CASE WHEN o.as_of >= c.since THEN o.as_of END) AS dates,
           min(CASE WHEN o.as_of >= c.since THEN o.as_of END) AS first,
           max(CASE WHEN o.as_of >= c.since THEN o.as_of END) AS last,
           min(CASE WHEN o.parser_version = $3 AND (c.since IS NULL OR o.as_of < c.since)
                    THEN o.as_of END) AS imported_from,
           max(CASE WHEN o.parser_version = $3 AND (c.since IS NULL OR o.as_of < c.since)
                    THEN o.as_of END) AS imported_last
      FROM price_observation o
      LEFT JOIN captured c ON c.source = o.source
      LEFT JOIN instrument i ON i.ref = o.instrument_ref
     GROUP BY o.instrument_ref, o.basis, o.source, c.since, i.listed_from),
  grouped AS (
    -- A row proves the ref existed that day, so it outranks a listed_from written after it; an
    -- imported row too, so the captured era opens where the imported one ends.
    SELECT k.*, greatest(k.since, least(k.listed_from, k.first, k.imported_from)) AS measured_from,
           -- No capture stands behind an imported row, so every calendar day stands in: the history
           -- file prices every day. It runs to the captured era, else to the last imported row.
           CASE WHEN k.imported_from IS NULL THEN NULL
                WHEN k.dates > 0 THEN k.since - 1
                ELSE k.imported_last END AS imported_to
      FROM counted k),
  expected AS (
    SELECT g.instrument_ref, g.basis, g.source, u.as_of AS d
      FROM grouped g
      JOIN usable u ON u.source = g.source AND u.as_of BETWEEN g.measured_from AND g.last
     WHERE g.dates > 0
    UNION ALL
    -- An integer series, so no timestamp and no session time zone stands between the dates.
    SELECT g.instrument_ref, g.basis, g.source, g.imported_from + s.i
      FROM grouped g
     CROSS JOIN LATERAL generate_series(0, g.imported_to - g.imported_from) AS s(i)
     WHERE g.imported_from IS NOT NULL),
  holes AS (
    SELECT e.instrument_ref, e.basis, e.source,
           array_agg(to_char(e.d, 'YYYY-MM-DD') ORDER BY e.d) AS empty_dates
      FROM expected e
     WHERE NOT EXISTS (
       SELECT 1 FROM price_observation o
        WHERE o.as_of = e.d AND o.instrument_ref = e.instrument_ref
          AND o.basis = e.basis AND o.source = e.source)
     GROUP BY e.instrument_ref, e.basis, e.source)
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
         END AS published_days,
         (g.imported_to - g.imported_from + 1)::text AS imported_days,
         h.empty_dates
    FROM grouped g
    LEFT JOIN holes h
      ON h.instrument_ref = g.instrument_ref AND h.basis = g.basis AND h.source = g.source
   ORDER BY g.instrument_ref, g.basis, g.source`;

export async function reconcileObservations(client: SqlClient, readPast: ReadPast) {
  // Rows before the source's first usable day are `before_capture`. The imported ones among them
  // are measured against the calendar; any other measures nothing.
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
    imported_days: string | null;
    empty_dates: string[] | null;
  }>(RECONCILE, [readPast.source, readPast.errorsLike, FUND_HISTORY_PARSER_VERSION]);

  return rows.map(({ published_days, imported_days, empty_dates, ...o }) => {
    const measured = published_days !== null || imported_days !== null;
    return {
      ...o,
      // NULL WHEN NOTHING WAS MEASURED, as is `measured_from`: zero is what a reconciled group reads.
      publishedDays: published_days,
      // ONE row per published day PER BASIS, hence the GROUP BY per (ref, basis, source). A `nav`
      // day published as zero stores no row, so it reads as a gap of one — and is one.
      gaps: published_days === null ? null : Number(published_days) - Number(o.dates),
      importedDays: imported_days,
      // Counted, where `gaps` nets: a row on a day with no usable capture cannot hide an empty one.
      emptyDays: measured ? (empty_dates ?? []).length : null,
      emptyDates: measured ? (empty_dates ?? []).slice(-EMPTY_DATES_CAP) : null,
    };
  });
}
