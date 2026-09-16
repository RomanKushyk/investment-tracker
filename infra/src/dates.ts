// The dating rule, kept out of `capture.ts` so a test for it does not drag in the handler's
// `@aws-sdk/*` imports, which the frontend CI job cannot resolve.
import { addDays, kyivDateIso } from '../../src/core/dates';

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
