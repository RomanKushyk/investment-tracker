// The dating rule, kept OUT of `capture.ts` on purpose.
//
// It lives here because it is domain logic, not AWS plumbing — and because a
// test for it must not drag in the handler's `@aws-sdk/*` imports. It did, once:
// `dates.test.ts` imported `capture.ts` and the frontend CI job, which installs
// only the root workspace, could not resolve `@aws-sdk/client-backup`. It passed
// locally because `infra/node_modules` exists there. The module boundary is the
// fix, and it is the one that should have been drawn first.
import { kyivDateIso } from '../../src/core/dates';

/**
 * TWO DATES, NOT ONE, and they were one function until 2026-08-18 (D71).
 *
 * `asOfFor` subtracted a day for BOTH sources on the premise that "the feed
 * refreshes ~13:00, so the 01:00 run reads the price settled the previous day".
 * That premise is false for Inzhur and true for NBU, so a single function had to
 * be wrong for one of them — and it was wrong for eight days of Inzhur rows
 * before the DCF inversion caught it. Two names now, because the conflation is
 * invisible when they share one.
 */

/**
 * Inzhur: the Kyiv date the run happens on, with no subtraction at all.
 *
 * The endpoint is LIVE — it serves whatever is current, and what is current at
 * 01:00 Kyiv on day D is the price struck for day D. Measured, not assumed:
 * inverting the DCF over the published coupon schedule dated a 1066.50 quote
 * read on 18 August to **18 August**, at a 0.0035 ₴ residual, and reproduced the
 * same one-day offset on the three days before it (`infra/README.md`, W1).
 */
export function inzhurAsOf(now: Date): string {
  return kyivDateIso(now);
}

/**
 * NBU: the previous Kyiv date — and here the subtraction is CORRECT, because
 * here the value is not a label at all.
 *
 * `nbuFairValueUrl(asOf)` asks for a NAMED date's file. At 01:00 on day D the
 * file for day D does not exist yet (NBU publishes ~09:30), so the latest one
 * that can be fetched is D-1 — and a file for D-1 genuinely holds D-1's fair
 * values. The request parameter and the row's label are the same date by
 * construction, which is why 6 636 NBU rows back to 2016-01-04 were never
 * affected by the Inzhur defect.
 *
 * The subtraction MUST happen on the Kyiv date, not the UTC one — at 01:00 Kyiv
 * the UTC date is already the previous day, so subtracting from the UTC date
 * silently yields D-2.
 */
export function nbuAsOf(now: Date): string {
  const kyiv = kyivDateIso(now); // yyyy-MM-dd, Kyiv wall clock
  // Pinning the Kyiv date to UTC midnight makes the subtraction plain integer
  // day arithmetic — no local-time DST shift can move it, and month/year
  // rollover is handled by the Date implementation rather than by hand.
  const prev = new Date(`${kyiv}T00:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  return prev.toISOString().slice(0, 10);
}
