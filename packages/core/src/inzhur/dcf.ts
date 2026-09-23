// The bond pricing model, PURE — no fetch, no clock, no storage.
//
// The provider’s bond price is NOT a market quote but a discounted cash flow over
// the published `paymentSchedule`, on an ACT/365 day count, whose only free
// parameter is the published yield:
//
//     P(D) = Σ CFᵢ × (1 + y) ^ (−ACT_days(D, dᵢ) / 365)     two or more payment dates left
//     P(D) = Σ CFᵢ / (1 + y × ACT_days(D, dᵢ) / 365)         one payment date left
//
// The second is simple interest, the regulator's rule for a yield with no payment
// before the last (docs/reference/OVDP-COUPON-STRUCTURE.md); YTM stays compound.
//
// THE INVERSE DATES A QUOTE, which a price alone can never do, and A SILENT YIELD
// REVISION BECOMES VISIBLE: a re-price with no schedule change leaves the stored
// price no longer fitting the stored yield. NOTHING HERE IS EVER STORED — the
// premises are captured forever, the conclusion never is.
import type { InzhurPayment } from './parse';

/** STRICTLY in the future: same-day flows are excluded because the provider’s own
 *  price behaves that way, and the fit depends on it (*Metric families and windows*). */
function futureFlows(schedule: readonly InzhurPayment[], onIso: string): InzhurPayment[] {
  return schedule.filter((p) => p.date > onIso);
}

function actDays(fromIso: string, toIso: string): number {
  return (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000;
}

export type DerivedPrice =
  | { kind: 'priced'; price: number }
  /**
   * The model is UNDEFINED here, not wrong: a completed bond’s schedule lies
   * entirely in the past, so the sum is legitimately zero, and reporting that as a
   * price of 0 would manufacture an anomaly out of a matured instrument.
   */
  | { kind: 'not_applicable'; reason: 'no_future_flows' };

/** `published` is the quoted yield: simple while ONE payment date is left, compound
 *  otherwise. `ytm` is compound always, like the NBU's. No default, so neither is the cheap one. */
export type YieldConvention = 'published' | 'ytm';

/**
 * Present value of the remaining schedule at `onIso`. `yieldPct` is the published
 * annual rate as a PERCENT, matching `returnRates.sell` verbatim — converting at
 * the call site is how a factor of 100 goes missing.
 */
export function derivePrice(
  schedule: readonly InzhurPayment[],
  yieldPct: number,
  onIso: string,
  convention: YieldConvention,
): DerivedPrice {
  const flows = futureFlows(schedule, onIso);
  if (flows.length === 0) return { kind: 'not_applicable', reason: 'no_future_flows' };
  const y = yieldPct / 100;
  // Per date priced, so a search walking back past the penultimate coupon prices compound;
  // the final coupon and the principal share a date, which is one payment.
  const simple = convention === 'published' && new Set(flows.map((f) => f.date)).size === 1;
  let price = 0;
  for (const f of flows) {
    const t = actDays(onIso, f.date) / 365;
    price += simple ? f.amount / (1 + y * t) : f.amount * Math.pow(1 + y, -t);
  }
  return { kind: 'priced', price };
}

export type ImpliedYield =
  | { kind: 'solved'; yieldPct: number }
  | { kind: 'not_applicable'; reason: 'no_future_flows' }
  /** The quote lies outside any yield the model can produce — itself a finding, and
   *  not the same as "the yield moved a little". */
  | { kind: 'unbracketed' };

/** Finite, so an impossible quote reports `unbracketed` instead of iterating. */
const YIELD_MIN_PCT = -99;
const YIELD_MAX_PCT = 1000;
const BISECTION_STEPS = 200;

/**
 * BISECTION RATHER THAN NEWTON: present value is strictly DECREASING in the yield
 * for positive cash flows, so a bracket converges and there is no derivative to
 * get wrong. The halvings take it below floating-point resolution, so the loop is
 * bounded by construction rather than by a tolerance that could stall.
 */
export function impliedYield(
  price: number,
  schedule: readonly InzhurPayment[],
  onIso: string,
  convention: YieldConvention,
): ImpliedYield {
  if (futureFlows(schedule, onIso).length === 0) {
    return { kind: 'not_applicable', reason: 'no_future_flows' };
  }
  const at = (pct: number): number => {
    const d = derivePrice(schedule, pct, onIso, convention);
    return d.kind === 'priced' ? d.price : Number.NaN;
  };
  let lo = YIELD_MIN_PCT;
  let hi = YIELD_MAX_PCT;
  // Decreasing in yield: price(lo) is the highest reachable, price(hi) the lowest.
  if (price > at(lo) || price < at(hi)) return { kind: 'unbracketed' };
  for (let i = 0; i < BISECTION_STEPS; i += 1) {
    const mid = (lo + hi) / 2;
    if (at(mid) > price) lo = mid;
    else hi = mid;
  }
  return { kind: 'solved', yieldPct: (lo + hi) / 2 };
}

export interface ValuationDateFit {
  date: string;
  residual: number;
  daysStale: number;
  /** The fit landed on the OLDEST date searched, so the true date may be older
   *  still: a caller that reports a date without checking this states a
   *  stale-by-N figure that is really "at least N". */
  atWindowEdge: boolean;
}

/**
 * EXPECT a residual even at the best date, since the published yield is rounded —
 * a caveat on the residual, not on the date. The noise floor below is what keeps
 * THAT honest: rounding outweighs a day of carry and would drag the argmin back.
 */
export function bestValuationDate(
  quoted: number,
  schedule: readonly InzhurPayment[],
  yieldPct: number,
  onIso: string,
  lookbackDays = 14,
): ValuationDateFit | undefined {
  // A bond with nothing left to pay is MATURED, and that is the answer. Walking
  // backwards would price the days before its final flow almost exactly and report
  // a completed bond as stale — a fact about the calendar dressed as a fault.
  if (derivePrice(schedule, yieldPct, onIso, 'published').kind !== 'priced') return undefined;

  // The noise floor at the read date: any date inside it is equally consistent with
  // the quote, so "which one" is not something the residual can answer.
  const floor = Math.max(PRICE_TOLERANCE_UAH, yieldSensitivityUah(schedule, yieldPct, onIso) ?? 0);

  let best: ValuationDateFit | undefined;
  for (let back = 0; back <= lookbackDays; back += 1) {
    const d = new Date(`${onIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - back);
    const date = d.toISOString().slice(0, 10);
    const derived = derivePrice(schedule, yieldPct, date, 'published');
    if (derived.kind !== 'priced') continue;
    const residual = derived.price - quoted;
    const fit = { date, residual, daysStale: back, atWindowEdge: back === lookbackDays };

    // PREFER THE MOST RECENT EXPLANATION, not the smallest residual: yield rounding
    // outweighs a day of carry on a long bond, so the plain argmin is dragged
    // BACKWARDS by rounding alone, manufacturing staleness out of fresh quotes.
    if (Math.abs(residual) <= floor) return fit;
    if (best === undefined || Math.abs(residual) < Math.abs(best.residual)) best = fit;
  }
  return best;
}

export const PRICE_TOLERANCE_UAH = 0.01;

/**
 * The rounding slack in a published yield, in percentage points — the feed
 * publishes one decimal and sometimes none, so the true rate can sit ±0.05pp from
 * what is printed.
 */
export const YIELD_ROUNDING_PCT = 0.05;

/**
 * The noise floor for the revision check, and NOT a constant — it tracks time to
 * maturity across two orders of magnitude. A fixed threshold is wrong at both
 * ends: crying "revision" over rounding on a long bond, and claiming the yield
 * confirmed on one about to mature, where price cannot resolve yield at all.
 */
export function yieldSensitivityUah(
  schedule: readonly InzhurPayment[],
  yieldPct: number,
  onIso: string,
): number | undefined {
  const base = derivePrice(schedule, yieldPct, onIso, 'published');
  const bumped = derivePrice(schedule, yieldPct + YIELD_ROUNDING_PCT, onIso, 'published');
  if (base.kind !== 'priced' || bumped.kind !== 'priced') return undefined;
  return Math.abs(bumped.price - base.price);
}

export type QuoteVerdict =
  | { state: 'consistent'; fit: ValuationDateFit }
  | { state: 'stale'; fit: ValuationDateFit }
  /**
   * NO DATE in the window explains the quote at the published yield. `impliedPct`
   * is what the yield would have to be for the quote to be right TODAY — an
   * alternative reading, not a claim: the other is a quote staler than the window,
   * and one price cannot choose between them.
   */
  | { state: 'revised'; fit: ValuationDateFit; impliedPct: number; publishedPct: number }
  /**
   * `insensitive` — near maturity the price barely moves with the yield, so the
   * residual cannot decide anything. Benign. `unexplained` — the quote lies
   * outside EVERY yield the model can produce, which is the loudest thing this
   * model can say: a mangled schedule or a corrupt price. Never one rendering.
   */
  | {
      state: 'inconclusive';
      fit: ValuationDateFit;
      reason: 'insensitive' | 'unexplained';
      sensitivityUah: number;
    }
  | { state: 'not_applicable' };

/**
 * ONE PRICE CANNOT SEPARATE DATE FROM YIELD, and this is shaped around that trap:
 * a day of staleness and a small revision move the price alike, so the date
 * search absorbs a revision. The DATE is the reliable output, and `revised` fires
 * only for a revision too large for the window to absorb.
 */
export function checkQuote(
  quoted: number,
  schedule: readonly InzhurPayment[],
  publishedPct: number,
  onIso: string,
  lookbackDays = 14,
): QuoteVerdict {
  const fit = bestValuationDate(quoted, schedule, publishedPct, onIso, lookbackDays);
  if (fit === undefined) return { state: 'not_applicable' };

  const sensitivity = yieldSensitivityUah(schedule, publishedPct, fit.date);
  if (sensitivity === undefined) return { state: 'not_applicable' };

  // Explained within the feed’s own rounding: nothing to report about the rate.
  if (Math.abs(fit.residual) <= Math.max(PRICE_TOLERANCE_UAH, sensitivity)) {
    return fit.daysStale === 0 ? { state: 'consistent', fit } : { state: 'stale', fit };
  }

  // Larger than rounding — but on a nearly-matured bond a kopeck of price cannot
  // pin the yield down, so no verdict is available.
  if (sensitivity < PRICE_TOLERANCE_UAH) {
    return { state: 'inconclusive', fit, reason: 'insensitive', sensitivityUah: sensitivity };
  }

  // Solved at `onIso`, NOT at `fit.date`: the best-fit date was chosen assuming the
  // published yield still held, which this branch has just rejected.
  const implied = impliedYield(quoted, schedule, onIso, 'published');
  return implied.kind === 'solved'
    ? { state: 'revised', fit, impliedPct: implied.yieldPct, publishedPct }
    : // `unbracketed`, and the price IS sensitive enough for that to mean
      // something — so the near-maturity excuse is provably false. This is a
      // mangled schedule or a corrupt price, and it gets its own rendering.
      { state: 'inconclusive', fit, reason: 'unexplained', sensitivityUah: sensitivity };
}
