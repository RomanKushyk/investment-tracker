// A scheduled deletion's dates, one rule for the page that promises the date and the API that
// stores it (#572): Civil Code arts. 253 and 255, with no roll past a weekend or holiday.
import { addDays, kyivDateIso } from './dates';

/** The days a scheduled deletion waits, counting the Kyiv day after the press as the first. */
export const DELETION_WINDOW_DAYS = 30;

/** The last Kyiv day the deletion can be cancelled; it runs as that day ends. */
export function deletionLastDay(pressedAt: Date): string {
  return addDays(kyivDateIso(pressedAt), DELETION_WINDOW_DAYS);
}

/** Whether `lastDay` has not yet ended in Kyiv at `now`. */
export function deletionWindowOpen(lastDay: string, now: Date): boolean {
  return kyivDateIso(now) <= lastDay;
}
