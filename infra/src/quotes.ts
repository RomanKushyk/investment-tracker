// Kept out of `capture.ts` so a test for it does not drag in the handler's `@aws-sdk/*` imports.
import { checkQuote } from '../../src/core/inzhur/dcf';
import type { parseAssetsFeed } from '../../src/core/inzhur/parse';

/** `unexplained` carries refs, the rest counts: a count is a graph, a ref is a thing to look at. */
export interface QuoteTally {
  consistent: number;
  stale: number;
  revised: number;
  insensitive: number;
  unexplained: string[];
  maxStaleDays: number;
}

/**
 * The DCF verdict for every live bond in a payload. Server-side, because a provider that quietly
 * stopped re-pricing was invisible on any day nobody opened the app. Nothing is stored: the
 * verdict is a conclusion and every premise stays in `payload_gzip`, so any day is recomputable.
 * `not_applicable` is uncounted — for a completed bond whose schedule is entirely past, the model
 * is undefined rather than wrong, and the data is never filtered on `status` to find them.
 */
export function tallyQuotes(feed: ReturnType<typeof parseAssetsFeed>, asOf: string): QuoteTally {
  const t: QuoteTally = {
    consistent: 0,
    stale: 0,
    revised: 0,
    insensitive: 0,
    unexplained: [],
    maxStaleDays: 0,
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
