// The completeness rule for an observe run, kept out of `capture.ts` for the reason `dates.ts`
// gives: a test for it must not drag in the handler's `@aws-sdk/*` imports.
import { addDays } from '@quirenote/core/dates';

/** Days one invocation may ask for. Every statement over the archive is bounded by a SQL date
 *  window (*Cloud target*): the plan sorts above the scan and a sort consumes its whole input
 *  before yielding a row, so a SQL `LIMIT` cannot bound what is READ. */
export const OBSERVE_CAP_DAYS = 1000;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `to`, or CAP days past `from` when that is nearer. Both bounds are compared as text before
 *  Postgres sees them, so a spelling it would parse and this file would not is refused by name
 *  rather than failing inside `Date`. */
export function observeWindowEnd(from: string, to: string): string {
  for (const bound of [from, to]) {
    if (!ISO_DAY.test(bound)) throw new Error(`observe bound must be YYYY-MM-DD: ${bound}`);
  }
  const capped = addDays(from, OBSERVE_CAP_DAYS);
  return capped < to ? capped : to;
}

/** Completeness from BOTH bounds, the row limit asked FIRST. The limit BIT when rows were fetched
 *  and not consumed — never merely when the count reached it, which a finished last window also
 *  does — and it stopped the loop at `cursor`, so continuing from the window instead would
 *  silently skip every fetched but unconsumed date between the two. */
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
