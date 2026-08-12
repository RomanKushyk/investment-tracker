// The bond pricing model, PURE — no fetch, no clock, no storage (G1).
//
// The provider's bond price is NOT a market quote. It is a discounted cash flow
// over the published `paymentSchedule` whose only free parameter is the
// published yield:
//
//     P(D) = Σ CFᵢ × (1 + y) ^ (−ACT_days(D, dᵢ) / 365)
//
// Verified independently against the live feed on 2026-08-12 for UA4000238976
// (y = 15.55%, quoted 1063.97):
//
//   | valuation date | derived   | residual |
//   |---|---|---|
//   | 2026-08-10 | 1063.1303 | −0.8397 |
//   | 2026-08-11 | 1063.5513 | −0.4187 |
//   | 2026-08-12 | 1063.9726 | **+0.0026** |
//
// Two things follow, and they are the whole reason this file exists:
//
//   * **The inverse dates a quote.** A day costs ~0.42 ₴ here, so the residual
//     identifies the valuation date sharply. A price alone can never tell you
//     it is stale; this can.
//   * **A silent yield revision becomes visible.** If the provider re-prices
//     without the schedule changing, the stored price stops fitting the stored
//     yield — and nothing else in the payload says so.
//
// NOTHING HERE IS EVER STORED. The premises (schedule, yield) are captured
// forever; the conclusion never is. A stale provider value is recorded as the
// observed fact, and substituting a computed value into it is rejected
// outright — see the data-model spec and D31.
import type { InzhurPayment } from './parse';

/** A cash flow must be strictly in the future to be discounted. Same-day flows
 *  are excluded: the provider's own price behaves that way, and it is what the
 *  0.0026 ₴ fit above depends on. */
function futureFlows(schedule: readonly InzhurPayment[], onIso: string): InzhurPayment[] {
  return schedule.filter((p) => p.date > onIso);
}

function actDays(fromIso: string, toIso: string): number {
  return (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000;
}

export type DerivedPrice =
  | { kind: 'priced'; price: number }
  /**
   * The model is UNDEFINED here, not wrong. A `completed` bond's schedule lies
   * entirely in the past, so the sum is legitimately zero — reporting that as a
   * price of 0 would manufacture an anomaly out of a matured instrument. Seven
   * of the feed's 31 bonds were in this state on 2026-08-11 (D31).
   */
  | { kind: 'not_applicable'; reason: 'no_future_flows' };

/**
 * Present value of the remaining schedule at `onIso`.
 *
 * `yieldPct` is the published annual rate as a PERCENT (15.55), matching
 * `returnRates.sell` verbatim — converting at the call site is how a factor of
 * 100 goes missing.
 */
export function derivePrice(
  schedule: readonly InzhurPayment[],
  yieldPct: number,
  onIso: string,
): DerivedPrice {
  const flows = futureFlows(schedule, onIso);
  if (flows.length === 0) return { kind: 'not_applicable', reason: 'no_future_flows' };
  const y = yieldPct / 100;
  let price = 0;
  for (const f of flows) price += f.amount * Math.pow(1 + y, -actDays(onIso, f.date) / 365);
  return { kind: 'priced', price };
}

export type ImpliedYield =
  | { kind: 'solved'; yieldPct: number }
  | { kind: 'not_applicable'; reason: 'no_future_flows' }
  /** The quote lies outside any yield the model can produce — itself a finding,
   *  and not the same as "the yield moved a little". */
  | { kind: 'unbracketed' };

/** Bounds for the bisection, in percent. Wide enough that a real revision is
 *  never clipped, finite so an impossible quote reports `unbracketed` instead
 *  of iterating forever. */
const YIELD_MIN_PCT = -99;
const YIELD_MAX_PCT = 1000;
const BISECTION_STEPS = 200;

/**
 * The yield that reproduces `price` from the schedule at `onIso`.
 *
 * Bisection rather than Newton: present value is strictly DECREASING in the
 * yield for a schedule of positive cash flows, so a bracket is guaranteed to
 * converge and there is no derivative to get wrong. 200 halvings take the
 * bracket far below floating-point resolution, so the loop is bounded by
 * construction rather than by a tolerance that could stall.
 */
export function impliedYield(
  price: number,
  schedule: readonly InzhurPayment[],
  onIso: string,
): ImpliedYield {
  if (futureFlows(schedule, onIso).length === 0) {
    return { kind: 'not_applicable', reason: 'no_future_flows' };
  }
  const at = (pct: number): number => {
    const d = derivePrice(schedule, pct, onIso);
    return d.kind === 'priced' ? d.price : Number.NaN;
  };
  let lo = YIELD_MIN_PCT;
  let hi = YIELD_MAX_PCT;
  // Decreasing in yield: price(lo) is the highest reachable, price(hi) lowest.
  if (price > at(lo) || price < at(hi)) return { kind: 'unbracketed' };
  for (let i = 0; i < BISECTION_STEPS; i += 1) {
    const mid = (lo + hi) / 2;
    if (at(mid) > price) lo = mid;
    else hi = mid;
  }
  return { kind: 'solved', yieldPct: (lo + hi) / 2 };
}

export interface ValuationDateFit {
  /** The date whose derived price best explains the quote. */
  date: string;
  /** `derived − quoted` at that date, in ₴. */
  residual: number;
  /** Whole days between `date` and the date the quote was read on. 0 = fresh. */
  daysStale: number;
  /**
   * The fit landed on the OLDEST date searched, so the true date may be older
   * still and the residual is a lower bound rather than an answer. A caller
   * that reports a date without checking this will state a stale-by-N figure
   * that is really "at least N".
   */
  atWindowEdge: boolean;
}

/**
 * Search backwards for the valuation date that best explains `quoted`.
 *
 * This is the staleness diagnostic, and it is the one thing a price alone can
 * never provide: on 2026-08-11 it dated seven live bonds to 1–6 days stale.
 *
 * EXPECT residuals around 0.1 ₴ on some bonds even at their best date. The
 * published yield is rounded to two decimals, so the model cannot do better
 * than that rounding — it is a caveat on the residual, never on the date, which
 * stays sharp because a day moves the price by an order of magnitude more.
 */
export function bestValuationDate(
  quoted: number,
  schedule: readonly InzhurPayment[],
  yieldPct: number,
  onIso: string,
  lookbackDays = 14,
): ValuationDateFit | undefined {
  // A bond with nothing left to pay is MATURED, and that is the answer. Walking
  // backwards from here would find the days before its final flow, price those
  // almost exactly, and report a completed bond as "4 days stale" for a
  // fortnight after maturity — a fact about the calendar dressed as a fault.
  if (derivePrice(schedule, yieldPct, onIso).kind !== 'priced') return undefined;

  // The noise floor at the read date. Any date inside it is equally consistent
  // with the quote, so "which one" is not something the residual can answer.
  const floor = Math.max(PRICE_TOLERANCE_UAH, yieldSensitivityUah(schedule, yieldPct, onIso) ?? 0);

  let best: ValuationDateFit | undefined;
  for (let back = 0; back <= lookbackDays; back += 1) {
    const d = new Date(`${onIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - back);
    const date = d.toISOString().slice(0, 10);
    const derived = derivePrice(schedule, yieldPct, date);
    if (derived.kind !== 'priced') continue;
    const residual = derived.price - quoted;
    const fit = { date, residual, daysStale: back, atWindowEdge: back === lookbackDays };

    // PREFER THE MOST RECENT EXPLANATION, not the smallest residual.
    //
    // The published yield is rounded to ~0.05pp, which on a long bond is worth
    // more than two days of carry — so the plain argmin is dragged backwards by
    // rounding alone, and only backwards, because the search never looks
    // forward. That manufactured staleness out of fresh quotes. Once a date
    // explains the quote within the floor, an older date explaining it slightly
    // "better" is noise, and "not stale" is the claim that needs no evidence.
    if (Math.abs(residual) <= floor) return fit;
    if (best === undefined || Math.abs(residual) < Math.abs(best.residual)) best = fit;
  }
  return best;
}

/** A kopeck. Below this the model and the quote agree as far as the feed's own
 *  two-decimal rounding allows. */
export const PRICE_TOLERANCE_UAH = 0.01;

/**
 * The rounding slack in a published yield, in percentage points.
 *
 * The feed publishes rates like `14.6` and `15` — one decimal, sometimes none —
 * so the true rate can sit ±0.05pp from what is printed.
 */
export const YIELD_ROUNDING_PCT = 0.05;

/**
 * How much a `YIELD_ROUNDING_PCT` change moves this bond's price, in ₴.
 *
 * This is the noise floor for the revision check, and it is NOT a constant.
 * Measured across the live feed on 2026-08-12 it spans two orders of magnitude,
 * tracking time to maturity exactly:
 *
 *   | ISIN | matures | ΔP per 0.05pp |
 *   |---|---|---|
 *   | UA4000235378 | 2026-08-19 (7 days) | **0.0090 ₴** |
 *   | UA4000236624 | 2026-10-14 | 0.0795 ₴ |
 *   | UA4000238976 | 2027-03-24 | 0.2658 ₴ |
 *   | UA4000235782 | 2028-11-29 | **0.8842 ₴** |
 *
 * A fixed residual threshold would therefore be wrong at both ends: it would
 * cry "revision" over pure rounding on a long bond, and it would claim the
 * yield is confirmed on a bond about to mature, where the price cannot resolve
 * the yield at all.
 */
export function yieldSensitivityUah(
  schedule: readonly InzhurPayment[],
  yieldPct: number,
  onIso: string,
): number | undefined {
  const base = derivePrice(schedule, yieldPct, onIso);
  const bumped = derivePrice(schedule, yieldPct + YIELD_ROUNDING_PCT, onIso);
  if (base.kind !== 'priced' || bumped.kind !== 'priced') return undefined;
  return Math.abs(bumped.price - base.price);
}

export type QuoteVerdict =
  /** The quote fits the published yield, on the date it is dated to. */
  | { state: 'consistent'; fit: ValuationDateFit }
  /** It fits, but on an EARLIER date — the quote has not been refreshed. */
  | { state: 'stale'; fit: ValuationDateFit }
  /**
   * NO DATE in the search window explains the quote at the published yield.
   *
   * `impliedPct` is what the yield would have to be for the quote to be right
   * TODAY — an alternative reading, not a claim. The other reading is a quote
   * staler than the window, and one price cannot choose between them (see the
   * note on `checkQuote`). The rendering must therefore offer the number
   * without asserting that the provider re-priced.
   */
  | { state: 'revised'; fit: ValuationDateFit; impliedPct: number; publishedPct: number }
  /**
   * No verdict is available, and the reason decides how loud it should be:
   *
   *   * `insensitive` — near maturity the price barely moves with the yield, so
   *     the residual cannot decide anything. Benign.
   *   * `unexplained` — the quote lies outside EVERY yield the model can
   *     produce. That is the loudest thing this model can say: a schedule the
   *     parser mangled, or a corrupt provider price. It must never share a
   *     rendering with the benign case.
   */
  | {
      state: 'inconclusive';
      fit: ValuationDateFit;
      reason: 'insensitive' | 'unexplained';
      sensitivityUah: number;
    }
  /** Matured or completed: the schedule is spent and the model is undefined. */
  | { state: 'not_applicable' };

/**
 * The whole diagnostic for one bond quote: is it fresh, stale, or re-priced?
 *
 * ONE PRICE CANNOT SEPARATE DATE FROM YIELD, and pretending otherwise is the
 * trap this function is shaped around. Measured on UA4000238976: a day back is
 * worth −0.42 ₴, and +0.08pp of yield is worth −0.42 ₴ as well. So a small
 * revision is **indistinguishable** from a quote that is a day stale, and the
 * date search silently absorbs it.
 *
 * What follows, and what this deliberately does NOT claim:
 *
 *   * the DATE is the reliable output. It is what D31 used to date seven live
 *     bonds to 1–6 days stale, and it is reported first;
 *   * `revised` fires only for a revision too large for the lookback window to
 *     absorb. A revision smaller than `lookbackDays × ~0.4 ₴` will read as
 *     staleness instead. That is a limit of one observation, not a bug — the
 *     sharp check needs a KNOWN date, which is what `impliedYield` is for once
 *     the archive supplies `as_of`;
 *   * `inconclusive` is a real answer. Near maturity the price barely responds
 *     to the yield at all, so no verdict is available.
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

  // Explained within the feed's own rounding: nothing to report about the rate.
  if (Math.abs(fit.residual) <= Math.max(PRICE_TOLERANCE_UAH, sensitivity)) {
    return fit.daysStale === 0 ? { state: 'consistent', fit } : { state: 'stale', fit };
  }

  // The residual is larger than rounding — but on a nearly-matured bond a
  // kopeck of price cannot pin the yield down, so no verdict is available.
  if (sensitivity < PRICE_TOLERANCE_UAH) {
    return { state: 'inconclusive', fit, reason: 'insensitive', sensitivityUah: sensitivity };
  }

  // Solved at `onIso`, NOT at `fit.date`. The best-fit date was chosen on the
  // assumption that the published yield still held — an assumption this branch
  // has just rejected, so continuing to use its output would be circular.
  const implied = impliedYield(quoted, schedule, onIso);
  return implied.kind === 'solved'
    ? { state: 'revised', fit, impliedPct: implied.yieldPct, publishedPct }
    : // `unbracketed`, and the price IS sensitive enough for that to mean
      // something — so the near-maturity excuse is provably false. This is a
      // mangled schedule or a corrupt price, and it gets its own rendering.
      { state: 'inconclusive', fit, reason: 'unexplained', sensitivityUah: sensitivity };
}
