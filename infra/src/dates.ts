// The dating rule: for each source, the Kyiv day a run takes as current.
import { addDays, kyivDateIso, kyivTimeHm } from '@quirenote/core/dates';

/**
 * Inzhur: the Kyiv date the run happens on, with no subtraction. The endpoint is LIVE, and what
 * is current at 01:00 Kyiv on day D is the price struck for day D.
 */
export function inzhurAsOf(now: Date): string {
  return kyivDateIso(now);
}

/**
 * NBU: the previous Kyiv date. `nbuFairValueUrl(asOf)` asks for a NAMED date's file, which does
 * not exist until ~09:30, so D-1 is the latest fetchable — and a D-1 file holds D-1's values. The
 * subtraction must happen on the KYIV date: at 01:00 Kyiv the UTC date is already the previous
 * day, so subtracting from the UTC date silently yields D-2.
 */
export function nbuAsOf(now: Date): string {
  return addDays(kyivDateIso(now), -1);
}

/** NBU Board Resolution 148 publishes the official rate "не пізніше 15.30 у день встановлення",
 *  and it takes effect the next working day; the dates between carry the last one forward.
 *  Compared as Kyiv's `HH:mm`, which orders as text. */
export const NBU_RATE_SET_BY = '15:30';

/**
 * The official rate: today, and from `NBU_RATE_SET_BY` in Kyiv tomorrow too, which NBU has set by then.
 * Every date answers, weekends and holidays carrying the last working day's rate forward.
 */
export function rateDatesDue(now: Date): string[] {
  const today = kyivDateIso(now);
  return kyivTimeHm(now) >= NBU_RATE_SET_BY ? [today, addDays(today, 1)] : [today];
}
