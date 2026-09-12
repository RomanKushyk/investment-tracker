// The completeness rule for an observe run, kept OUT of `capture.ts` for the
// reason `dates.ts` gives: a test for it must not drag in the handler's
// `@aws-sdk/*` imports.
import { addDays } from '../../src/core/dates';

/**
 * Days one invocation may ask the archive for. [Cloud target]: any statement
 * over the archive is bounded by a SQL date window, because the plan sorts
 * above the scan and a sort consumes its whole input before it yields a row,
 * so a SQL `LIMIT` cannot bound what is read. A window this wide still plans
 * as an index scan; the open range fell to a full scan.
 */
export const OBSERVE_CAP_DAYS = 1000;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The statement's upper bound: `to`, or CAP days past `from` when that is
 * nearer. Both bounds are compared as text here before Postgres sees them,
 * so a spelling the database would parse and this file would not is refused
 * by name rather than failing inside `Date`.
 */
export function observeWindowEnd(from: string, to: string): string {
  for (const bound of [from, to]) {
    if (!ISO_DAY.test(bound)) throw new Error(`observe bound must be YYYY-MM-DD: ${bound}`);
  }
  const capped = addDays(from, OBSERVE_CAP_DAYS);
  return capped < to ? capped : to;
}

/**
 * Completeness from BOTH bounds, the row limit first.
 *
 * The limit bit when rows were fetched and not consumed — never merely when
 * the count reached it, which a finished last window also does. Both truncate
 * on almost every run, a window holding more dates than the limit consumes,
 * so the order is the whole rule: the limit stopped the loop at `cursor`, and
 * continuing from the window instead would silently skip every fetched but
 * unconsumed date between the two. Only when the limit did not bite does the
 * window answer, and then the next run starts past it, which is what carries
 * a caller across an empty stretch of the archive at a window per invocation
 * rather than a day.
 */
export function observeProgress(p: {
  to: string;
  windowEnd: string;
  fetched: number;
  dates: number;
  cursor: string;
}): { complete: boolean; nextFrom: string | null } {
  if (p.fetched > p.dates) return { complete: false, nextFrom: addDays(p.cursor, 1) };
  if (p.windowEnd < p.to) return { complete: false, nextFrom: addDays(p.windowEnd, 1) };
  return { complete: true, nextFrom: null };
}
