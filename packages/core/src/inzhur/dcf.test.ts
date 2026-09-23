import { describe, expect, it } from 'vitest';

import {
  checkQuote,
  bestValuationDate,
  derivePrice,
  impliedYield,
  PRICE_TOLERANCE_UAH,
  yieldSensitivityUah,
} from './dcf';
import { parseAssetsFeed, type InzhurPayment } from './parse';
import fixture0923 from './__fixtures__/assets-2026-09-23.json';

// UA4000238976, read from the live feed on 2026-08-12: y = 15.55%, quoted 1063.97.
// The schedule is the Kyiv-dated form the parser produces, and the 2026-03-25
// coupon is deliberately included so the "past flows are excluded" rule is
// exercised by real data rather than a contrived row.
const SCHEDULE: InzhurPayment[] = [
  { date: '2026-03-25', amount: 78.4 },
  { date: '2026-09-23', amount: 78.4 },
  { date: '2027-03-24', amount: 78.4 },
  { date: '2027-03-24', amount: 1000 },
];
const YIELD_PCT = 15.55;
const QUOTED = 1063.97;

function priceOn(onIso: string): number {
  const d = derivePrice(SCHEDULE, YIELD_PCT, onIso, 'published');
  if (d.kind !== 'priced') throw new Error(`expected a price on ${onIso}`);
  return d.price;
}

describe('derivePrice', () => {
  it('reproduces the live quote on its own valuation date to under a kopeck', () => {
    expect(Math.abs(priceOn('2026-08-12') - QUOTED)).toBeLessThan(PRICE_TOLERANCE_UAH);
  });

  // The valuation date is identifiable only while a day of carry clears the floor
  // asserted below; if that step ever collapses, the staleness diagnostic is
  // meaningless.
  it('moves enough per day that the valuation date is identifiable', () => {
    const step = priceOn('2026-08-12') - priceOn('2026-08-11');
    expect(step).toBeGreaterThan(0.3);
    expect(step).toBeLessThan(0.6);
  });

  it('discounts only flows strictly in the future', () => {
    // On the coupon date itself the 2026-09-23 flow is already excluded.
    const onPayday = priceOn('2026-09-23');
    const dayBefore = priceOn('2026-09-22');
    expect(dayBefore - onPayday).toBeGreaterThan(70); // the 78.40 coupon drops out
  });

  // A matured bond's schedule lies entirely in the past. The sum is legitimately
  // zero, and reporting zero as a PRICE would manufacture an anomaly.
  it('reports not_applicable rather than a price of zero once nothing is left', () => {
    expect(derivePrice(SCHEDULE, YIELD_PCT, '2027-03-24', 'published')).toEqual({
      kind: 'not_applicable',
      reason: 'no_future_flows',
    });
  });

  it('treats an empty schedule as not applicable, not as a free bond', () => {
    expect(derivePrice([], YIELD_PCT, '2026-08-12', 'published').kind).toBe('not_applicable');
  });

  it('prices lower as the yield rises', () => {
    const low = derivePrice(SCHEDULE, 10, '2026-08-12', 'published');
    const high = derivePrice(SCHEDULE, 20, '2026-08-12', 'published');
    if (low.kind !== 'priced' || high.kind !== 'priced') throw new Error('expected prices');
    expect(high.price).toBeLessThan(low.price);
  });

  // The rate arrives from the feed as a percent. Halving the model’s units here is
  // how a factor of 100 goes missing, so it is pinned.
  it('takes the yield as a percent, not a fraction', () => {
    const asPercent = derivePrice(SCHEDULE, 15.55, '2026-08-12', 'published');
    const asFraction = derivePrice(SCHEDULE, 0.1555, '2026-08-12', 'published');
    if (asPercent.kind !== 'priced' || asFraction.kind !== 'priced') throw new Error('priced');
    expect(Math.abs(asPercent.price - QUOTED)).toBeLessThan(PRICE_TOLERANCE_UAH);
    // 0.1555 read as a percent is almost no discounting, so the sum collapses towards
    // the undiscounted total — wrong by an amount no rounding could explain.
    const undiscounted = SCHEDULE.filter((p) => p.date > '2026-08-12').reduce(
      (s, p) => s + p.amount,
      0,
    );
    expect(undiscounted - asFraction.price).toBeLessThan(2);
    expect(asFraction.price - QUOTED).toBeGreaterThan(50);
  });
});

describe('impliedYield', () => {
  it('round-trips the derived price back to the yield that made it', () => {
    const p = priceOn('2026-08-12');
    const y = impliedYield(p, SCHEDULE, '2026-08-12', 'published');
    if (y.kind !== 'solved') throw new Error('expected a solution');
    expect(y.yieldPct).toBeCloseTo(YIELD_PCT, 6);
  });

  // The revision check: a price that no longer fits the published yield.
  it('recovers a revised yield from a price that moved on its own', () => {
    const revised = derivePrice(SCHEDULE, 17.25, '2026-08-12', 'published');
    if (revised.kind !== 'priced') throw new Error('expected a price');
    const y = impliedYield(revised.price, SCHEDULE, '2026-08-12', 'published');
    if (y.kind !== 'solved') throw new Error('expected a solution');
    expect(y.yieldPct).toBeCloseTo(17.25, 6);
  });

  it('reports not_applicable when nothing is left to discount', () => {
    expect(impliedYield(1000, SCHEDULE, '2027-03-24', 'published').kind).toBe('not_applicable');
  });

  // An impossible quote is a finding in itself, and must not be silently clamped to
  // the edge of the search bracket.
  it('reports unbracketed rather than clamping an impossible quote', () => {
    expect(impliedYield(1e9, SCHEDULE, '2026-08-12', 'published').kind).toBe('unbracketed');
    expect(impliedYield(1e-9, SCHEDULE, '2026-08-12', 'published').kind).toBe('unbracketed');
  });
});

describe('bestValuationDate', () => {
  it('dates a fresh quote to the day it was read', () => {
    const fit = bestValuationDate(QUOTED, SCHEDULE, YIELD_PCT, '2026-08-12');
    expect(fit?.date).toBe('2026-08-12');
    expect(fit?.daysStale).toBe(0);
    expect(Math.abs(fit?.residual ?? 1)).toBeLessThan(PRICE_TOLERANCE_UAH);
  });

  // The diagnostic that matters: the same quote read four days later is not a price
  // change, it is a stale price — and only this can say so.
  it('dates a stale quote to the day it was actually struck', () => {
    const fit = bestValuationDate(QUOTED, SCHEDULE, YIELD_PCT, '2026-08-16');
    expect(fit?.date).toBe('2026-08-12');
    expect(fit?.daysStale).toBe(4);
  });

  it('does not look further back than it is asked to', () => {
    const fit = bestValuationDate(QUOTED, SCHEDULE, YIELD_PCT, '2026-08-20', 3);
    expect(fit?.daysStale).toBe(3); // clamped at the window edge, not 8
  });

  it('returns undefined when the model never applies in the window', () => {
    expect(bestValuationDate(1000, SCHEDULE, YIELD_PCT, '2027-04-30', 5)).toBeUndefined();
  });
});

describe('yieldSensitivityUah', () => {
  // Sensitivity is a property of the bond, not a constant: a bond seven days from
  // maturity barely responds.
  it('is far smaller for a nearly-matured bond than for a long one', () => {
    const short: InzhurPayment[] = [
      { date: '2026-08-19', amount: 78.4 },
      { date: '2026-08-19', amount: 1000 },
    ];
    const long = SCHEDULE;
    const s = yieldSensitivityUah(short, 14.6, '2026-08-12');
    const l = yieldSensitivityUah(long, 15.55, '2026-08-12');
    expect(s).toBeDefined();
    expect(l).toBeDefined();
    expect(s!).toBeLessThan(0.02);
    expect(l!).toBeGreaterThan(0.2);
  });
});

describe('checkQuote', () => {
  it('calls a fresh, fitting quote consistent', () => {
    const v = checkQuote(QUOTED, SCHEDULE, YIELD_PCT, '2026-08-12');
    expect(v.state).toBe('consistent');
  });

  // The easy mistake this ordering exists to prevent: a day of carry is worth far
  // more than most revisions, so an unrefreshed quote must never read as re-priced.
  it('calls an unrefreshed quote stale, not revised', () => {
    const v = checkQuote(QUOTED, SCHEDULE, YIELD_PCT, '2026-08-16');
    expect(v.state).toBe('stale');
    if (v.state !== 'stale') return;
    expect(v.fit.daysStale).toBe(4);
  });

  it('detects a real revision and reports the implied rate', () => {
    const repriced = derivePrice(SCHEDULE, 17.25, '2026-08-12', 'published');
    if (repriced.kind !== 'priced') throw new Error('expected a price');
    const v = checkQuote(repriced.price, SCHEDULE, YIELD_PCT, '2026-08-12');
    expect(v.state).toBe('revised');
    if (v.state !== 'revised') return;
    expect(v.impliedPct).toBeCloseTo(17.25, 4);
    expect(v.publishedPct).toBe(YIELD_PCT);
  });

  // Rounding must never be reported as a revision.
  it('absorbs a rounding-sized difference rather than crying revision', () => {
    const nudged = derivePrice(SCHEDULE, YIELD_PCT + 0.04, '2026-08-12', 'published');
    if (nudged.kind !== 'priced') throw new Error('expected a price');
    const v = checkQuote(nudged.price, SCHEDULE, YIELD_PCT, '2026-08-12');
    expect(v.state).not.toBe('revised');
  });

  // THE CONFOUND, pinned deliberately rather than hidden by a tolerance. On this
  // bond a day of carry and the 0.08pp revision below move the price by the same
  // amount, so the two are indistinguishable from one quote and the date search
  // absorbs it. This test exists so that anyone who later "fixes" the module into
  // claiming otherwise has to delete an explicit statement of why it cannot.
  it('reads a small revision as staleness, because one price cannot tell them apart', () => {
    const nudged = derivePrice(SCHEDULE, YIELD_PCT + 0.08, '2026-08-12', 'published');
    if (nudged.kind !== 'priced') throw new Error('expected a price');
    const v = checkQuote(nudged.price, SCHEDULE, YIELD_PCT, '2026-08-12');
    expect(v.state).toBe('stale');
    if (v.state !== 'stale') return;
    expect(v.fit.daysStale).toBe(1); // the yield change, wearing a date's clothes
  });

  // On a bond about to mature the price cannot resolve the yield at all, so a
  // verdict of "confirmed" would be a claim the data cannot carry. Five days out, not
  // seven: a single payment date prices in simple interest, which is a little more
  // sensitive, and at seven days a rounding step already clears a kopeck.
  it('declines to judge the yield when the price is insensitive to it', () => {
    const short: InzhurPayment[] = [
      { date: '2026-08-19', amount: 78.4 },
      { date: '2026-08-19', amount: 1000 },
    ];
    const p = derivePrice(short, 14.6, '2026-08-14', 'published');
    if (p.kind !== 'priced') throw new Error('expected a price');
    const v = checkQuote(p.price + 0.5, short, 14.6, '2026-08-14', 0);
    expect(v.state).toBe('inconclusive');
  });

  it('is not applicable once the schedule is spent', () => {
    expect(checkQuote(1000, SCHEDULE, YIELD_PCT, '2027-04-30', 5).state).toBe('not_applicable');
  });
});

// --- review regressions ----------------------------------------------------

describe('bestValuationDate — review regressions', () => {
  // Print rounding is worth about two days of carry on a long bond, and the search
  // only ever looked backwards, so a FRESH quote at a rate rounded down was reported
  // stale. Once a date explains the quote within the noise floor, stop there.
  it('does not invent staleness out of the published rate being rounded', () => {
    const long: InzhurPayment[] = [
      { date: '2026-12-02', amount: 83.25 },
      { date: '2027-06-02', amount: 83.25 },
      { date: '2027-12-01', amount: 83.25 },
      { date: '2028-05-31', amount: 83.25 },
      { date: '2028-11-29', amount: 83.25 },
      { date: '2028-11-29', amount: 1000 },
    ];
    // Struck today at a true 15.57%, printed by the feed as 15.55.
    const truth = derivePrice(long, 15.57, '2026-08-12', 'published');
    if (truth.kind !== 'priced') throw new Error('expected a price');
    const fit = bestValuationDate(truth.price, long, 15.55, '2026-08-12');
    expect(fit?.daysStale).toBe(0);
    expect(checkQuote(truth.price, long, 15.55, '2026-08-12').state).toBe('consistent');
  });

  // A matured bond still quotes its last value and still publishes a yield. Walking
  // back past its final flow priced those days almost exactly and reported staleness
  // about an instrument that is simply finished.
  it('reports a matured bond as not applicable instead of walking back past maturity', () => {
    const matured: InzhurPayment[] = [
      { date: '2026-08-09', amount: 78.4 },
      { date: '2026-08-09', amount: 1000 },
    ];
    expect(bestValuationDate(1070, matured, 15, '2026-08-12')).toBeUndefined();
    expect(checkQuote(1070, matured, 15, '2026-08-12').state).toBe('not_applicable');
  });

  it('marks a fit that landed on the oldest date searched', () => {
    const fit = bestValuationDate(QUOTED, SCHEDULE, YIELD_PCT, '2026-08-20', 3);
    expect(fit?.atWindowEdge).toBe(true);
  });
});

describe('checkQuote — review regressions', () => {
  // `unbracketed` means no yield at all reproduces the price — a mangled schedule or
  // a corrupt quote. It used to render as the benign "too close to maturity" line,
  // hiding the loudest signal the model has.
  it('separates an unexplainable price from a near-maturity one', () => {
    const v = checkQuote(140, SCHEDULE, YIELD_PCT, '2026-08-12');
    expect(v.state).toBe('inconclusive');
    if (v.state !== 'inconclusive') return;
    expect(v.reason).toBe('unexplained');
  });

  // Five days out, for the reason the test above gives.
  it('still calls a genuinely near-matured bond insensitive', () => {
    const short: InzhurPayment[] = [
      { date: '2026-08-19', amount: 78.4 },
      { date: '2026-08-19', amount: 1000 },
    ];
    const p = derivePrice(short, 14.6, '2026-08-14', 'published');
    if (p.kind !== 'priced') throw new Error('expected a price');
    const v = checkQuote(p.price + 0.5, short, 14.6, '2026-08-14', 0);
    expect(v.state).toBe('inconclusive');
    if (v.state !== 'inconclusive') return;
    expect(v.reason).toBe('insensitive');
  });

  // A revision far too large for the window to absorb must stay loud rather than
  // being downgraded because the search hit its own edge.
  it('keeps a large mismatch loud instead of blaming the search window', () => {
    const repriced = derivePrice(SCHEDULE, 17.25, '2026-08-12', 'published');
    if (repriced.kind !== 'priced') throw new Error('expected a price');
    expect(checkQuote(repriced.price, SCHEDULE, YIELD_PCT, '2026-08-12').state).toBe('revised');
  });
});

// One payment date left is quoted in simple interest (OVDP-COUPON-STRUCTURE.md). Read as
// compound, each such bond reported a revision or a staleness it never had.
describe('checkQuote — one payment date left', () => {
  const ON = '2026-09-23';

  // …8976 on its coupon day: the final coupon and the principal share one date,
  // which is one payment, not two.
  it('calls the quote of a final-period bond consistent', () => {
    const v = checkQuote(1003.82, SCHEDULE, 14.9, ON);
    expect(v.state).toBe('consistent');
    if (v.state !== 'consistent') return;
    expect(v.fit.daysStale).toBe(0);
  });

  it("reads every bond of the day's feed consistent, one payment date left or several", () => {
    const bonds = parseAssetsFeed(fixture0923).entries.filter((e) => e.kind === 'bond');
    const datesLeft = (b: (typeof bonds)[number]) =>
      new Set(b.paymentSchedule.filter((p) => p.date > ON).map((p) => p.date)).size;
    // The witnesses: a fixture that lost its final-period bonds would pass vacuously.
    expect(bonds.filter((b) => datesLeft(b) === 1)).toHaveLength(6);
    expect(bonds.filter((b) => datesLeft(b) >= 2)).toHaveLength(19);
    const verdicts = bonds.map((b) => {
      const published = b.returnRates?.sell;
      if (published === undefined) throw new Error(`${b.ref} publishes no yield`);
      return [b.ref, checkQuote(b.sellUAH, b.paymentSchedule, published, ON).state];
    });
    expect(verdicts).toEqual(bonds.map((b) => [b.ref, 'consistent']));
  });

  // The implied rate is solved on the same footing as the check, so a real
  // revision of a final-period bond reports the rate the provider would print.
  it('reports a real revision of a final-period bond in simple interest', () => {
    const repriced = 1078.4 / (1 + (0.165 * 182) / 365);
    const v = checkQuote(repriced, SCHEDULE, 14.9, ON);
    expect(v.state).toBe('revised');
    if (v.state !== 'revised') return;
    expect(v.impliedPct).toBeCloseTo(16.5, 4);
  });

  // The day before the coupon, two payment dates were still ahead, so that day's
  // quote was compound; an unrefreshed one is dated there, not called revised.
  it('dates a quote left over from before the penultimate coupon as stale', () => {
    const cum = derivePrice(SCHEDULE, 14.9, '2026-09-22', 'published');
    if (cum.kind !== 'priced') throw new Error('expected a price');
    const v = checkQuote(cum.price, SCHEDULE, 14.9, ON);
    expect(v.state).toBe('stale');
    if (v.state !== 'stale') return;
    expect(v.fit.date).toBe('2026-09-22');
    expect(v.fit.daysStale).toBe(1);
  });
});
