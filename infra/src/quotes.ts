// The DCF diagnostic over a captured payload, kept OUT of `capture.ts` for the
// reason `dates.ts` is: a test for it must not drag in the handler's
// `@aws-sdk/*` imports, which the frontend CI job cannot resolve.
import { checkQuote } from '../../src/core/inzhur/dcf';
import type { parseAssetsFeed } from '../../src/core/inzhur/parse';

/**
 * What the DCF says about the quotes in one payload.
 *
 * `unexplained` carries the REFS and the rest carry counts, because the counts
 * are a graph and the refs are the thing someone has to go and look at.
 */
export interface QuoteTally {
  consistent: number;
  stale: number;
  revised: number;
  insensitive: number;
  unexplained: string[];
  maxStaleDays: number;
}

/**
 * Run the DCF diagnostic over every live bond in a payload.
 *
 * WHY THIS RUNS HERE AND NOT ONLY IN THE APP (A6). D31 established that
 * inverting the model over the published coupon schedule measures how stale a
 * quote is — the one thing a price alone can never say. Until now it ran only
 * when someone opened the app, which meant a provider that quietly stopped
 * re-pricing was invisible on any day nobody looked. A20 sharpened the need: it
 * retired the digest-based staleness check on the grounds that per-instrument
 * staleness is this function's job, so this function had better be running.
 *
 * NOTHING IS STORED. The verdict is a conclusion and its premises — the quote,
 * the schedule, the published yield — are all in `payload_gzip` forever, so it
 * can be recomputed for any day at any time. That is the same line D69 drew
 * about the FX rate, and A6's own plan states it outright.
 *
 * `not_applicable` is not counted: `checkQuote` returns it for the seven
 * `status: 'completed'` bonds whose schedules lie entirely in the past, where
 * the model is undefined rather than wrong. No residual threshold is invented
 * to find them and the data is never filtered on `status` (D19, D31).
 */
export function tallyQuotes(feed: ReturnType<typeof parseAssetsFeed>, asOf: string): QuoteTally {
  const t: QuoteTally = {
    consistent: 0, stale: 0, revised: 0, insensitive: 0, unexplained: [], maxStaleDays: 0,
  };
  for (const e of feed.entries) {
    if (e.kind !== 'bond') continue;
    const published = e.returnRates?.sell;
    if (published === undefined) continue;
    const v = checkQuote(e.sellUAH, e.paymentSchedule, published, asOf);
    switch (v.state) {
      case 'consistent':
        t.consistent += 1;
        break;
      case 'stale':
        t.stale += 1;
        t.maxStaleDays = Math.max(t.maxStaleDays, v.fit.daysStale);
        break;
      case 'revised':
        t.revised += 1;
        break;
      case 'inconclusive':
        if (v.reason === 'unexplained') t.unexplained.push(e.ref);
        else t.insensitive += 1;
        break;
      default:
        break;
    }
  }
  return t;
}
