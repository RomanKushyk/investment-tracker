import { describe, expect, it } from 'vitest';

import {
  checkQuote,
  bestValuationDate,
  derivePrice,
  impliedYield,
  PRICE_TOLERANCE_UAH,
  yieldSensitivityUah,
} from './dcf';
import type { InzhurPayment } from './parse';

// UA4000238976, read from the live feed on 2026-08-12: y = 15.55%, quoted
// 1063.97. The schedule is the Kyiv-dated form the parser produces, and the
// 2026-03-25 coupon is deliberately included so the "past flows are excluded"
// rule is exercised by real data rather than a contrived row.
const SCHEDULE: InzhurPayment[] = [
  { date: '2026-03-25', amount: 78.4 },
  { date: '2026-09-23', amount: 78.4 },
  { date: '2027-03-24', amount: 78.4 },
  { date: '2027-03-24', amount: 1000 },
];
const YIELD_PCT = 15.55;
const QUOTED = 1063.97;

function priceOn(onIso: string): number {
  const d = derivePrice(SCHEDULE, YIELD_PCT, onIso);
  if (d.kind !== 'priced') throw new Error(`expected a price on ${onIso}`);
  return d.price;
}

describe('derivePrice', () => {
  // The measurement this whole model rests on.
  it('reproduces the live quote on its own valuation date to under a kopeck', () => {
    expect(Math.abs(priceOn('2026-08-12') - QUOTED)).toBeLessThan(PRICE_TOLERANCE_UAH);
  });

  // A day is worth ~0.42 ₴ here, which is what makes the date identifiable at
  // all. If this ever collapses, the staleness diagnostic is meaningless.
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
  // zero, and reporting zero as a PRICE would manufacture an anomaly (D31).
  it('reports not_applicable rather than a price of zero once nothing is left', () => {
    expect(derivePrice(SCHEDULE, YIELD_PCT, '2027-03-24')).toEqual({
      kind: 'not_applicable',
      reason: 'no_future_flows',
    });
  });

  it('treats an empty schedule as not applicable, not as a free bond', () => {
    expect(derivePrice([], YIELD_PCT, '2026-08-12').kind).toBe('not_applicable');
  });

  it('prices lower as the yield rises', () => {
    const low = derivePrice(SCHEDULE, 10, '2026-08-12');
    const high = derivePrice(SCHEDULE, 20, '2026-08-12');
    if (low.kind !== 'priced' || high.kind !== 'priced') throw new Error('expected prices');
    expect(high.price).toBeLessThan(low.price);
  });

  // The rate arrives from the feed as a percent. Halving the model's units here
  // is how a factor of 100 goes missing, so it is pinned.
  it('takes the yield as a percent, not a fraction', () => {
    const asPercent = derivePrice(SCHEDULE, 15.55, '2026-08-12');
    const asFraction = derivePrice(SCHEDULE, 0.1555, '2026-08-12');
    if (asPercent.kind !== 'priced' || asFraction.kind !== 'priced') throw new Error('priced');
    expect(Math.abs(asPercent.price - QUOTED)).toBeLessThan(PRICE_TOLERANCE_UAH);
    // 0.1555 read as a percent is 0.1555% a year — almost no discounting, so
    // the sum collapses towards the undiscounted 1156.80 and lands ~92 ₴ above
    // the real price. Wrong by an amount no rounding could explain.
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
    const y = impliedYield(p, SCHEDULE, '2026-08-12');
    if (y.kind !== 'solved') throw new Error('expected a solution');
    expect(y.yieldPct).toBeCloseTo(YIELD_PCT, 6);
  });

  // The revision check: a price that no longer fits the published yield.
  it('recovers a revised yield from a price that moved on its own', () => {
    const revised = derivePrice(SCHEDULE, 17.25, '2026-08-12');
    if (revised.kind !== 'priced') throw new Error('expected a price');
    const y = impliedYield(revised.price, SCHEDULE, '2026-08-12');
    if (y.kind !== 'solved') throw new Error('expected a solution');
    expect(y.yieldPct).toBeCloseTo(17.25, 6);
  });

  it('reports not_applicable when nothing is left to discount', () => {
    expect(impliedYield(1000, SCHEDULE, '2027-03-24').kind).toBe('not_applicable');
  });

  // An impossible quote is a finding in itself, and must not be silently
  // clamped to the edge of the search bracket.
  it('reports unbracketed rather than clamping an impossible quote', () => {
    expect(impliedYield(1e9, SCHEDULE, '2026-08-12').kind).toBe('unbracketed');
    expect(impliedYield(1e-9, SCHEDULE, '2026-08-12').kind).toBe('unbracketed');
  });
});

describe('bestValuationDate', () => {
  it('dates a fresh quote to the day it was read', () => {
    const fit = bestValuationDate(QUOTED, SCHEDULE, YIELD_PCT, '2026-08-12');
    expect(fit?.date).toBe('2026-08-12');
    expect(fit?.daysStale).toBe(0);
    expect(Math.abs(fit?.residual ?? 1)).toBeLessThan(PRICE_TOLERANCE_UAH);
  });

  // The diagnostic that matters: the same quote read four days later is not a
  // price change, it is a stale price — and only this can say so.
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
  // The measurement the revision check rests on: sensitivity is a property of
  // the bond, not a constant. A bond seven days from maturity barely responds.
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

  // The easy mistake this ordering exists to prevent: a day is worth ~0.42 ₴,
  // far more than most revisions, so an unrefreshed quote must never be
  // reported as a re-priced one.
  it('calls an unrefreshed quote stale, not revised', () => {
    const v = checkQuote(QUOTED, SCHEDULE, YIELD_PCT, '2026-08-16');
    expect(v.state).toBe('stale');
    if (v.state !== 'stale') return;
    expect(v.fit.daysStale).toBe(4);
  });

  it('detects a real revision and reports the implied rate', () => {
    const repriced = derivePrice(SCHEDULE, 17.25, '2026-08-12');
    if (repriced.kind !== 'priced') throw new Error('expected a price');
    const v = checkQuote(repriced.price, SCHEDULE, YIELD_PCT, '2026-08-12');
    expect(v.state).toBe('revised');
    if (v.state !== 'revised') return;
    expect(v.impliedPct).toBeCloseTo(17.25, 4);
    expect(v.publishedPct).toBe(YIELD_PCT);
  });

  // Rounding must never be reported as a revision.
  it('absorbs a rounding-sized difference rather than crying revision', () => {
    const nudged = derivePrice(SCHEDULE, YIELD_PCT + 0.04, '2026-08-12');
    if (nudged.kind !== 'priced') throw new Error('expected a price');
    const v = checkQuote(nudged.price, SCHEDULE, YIELD_PCT, '2026-08-12');
    expect(v.state).not.toBe('revised');
  });

  // THE CONFOUND, pinned deliberately rather than hidden by a tolerance.
  //
  // A day back is worth −0.42 ₴ on this bond and +0.08pp of yield is worth
  // −0.42 ₴ too, so a small revision is indistinguishable from a one-day-stale
  // quote and the date search absorbs it. This test exists so that anyone who
  // later "fixes" the module into claiming otherwise has to delete an explicit
  // statement of why it cannot.
  it('reads a small revision as staleness, because one price cannot tell them apart', () => {
    const nudged = derivePrice(SCHEDULE, YIELD_PCT + 0.08, '2026-08-12');
    if (nudged.kind !== 'priced') throw new Error('expected a price');
    const v = checkQuote(nudged.price, SCHEDULE, YIELD_PCT, '2026-08-12');
    expect(v.state).toBe('stale');
    if (v.state !== 'stale') return;
    expect(v.fit.daysStale).toBe(1); // the yield change, wearing a date's clothes
  });

  // On a bond about to mature the price cannot resolve the yield at all, so a
  // verdict of "confirmed" would be a claim the data cannot carry.
  it('declines to judge the yield when the price is insensitive to it', () => {
    const short: InzhurPayment[] = [
      { date: '2026-08-19', amount: 78.4 },
      { date: '2026-08-19', amount: 1000 },
    ];
    const p = derivePrice(short, 14.6, '2026-08-12');
    if (p.kind !== 'priced') throw new Error('expected a price');
    const v = checkQuote(p.price + 0.5, short, 14.6, '2026-08-12', 0);
    expect(v.state).toBe('inconclusive');
  });

  it('is not applicable once the schedule is spent', () => {
    expect(checkQuote(1000, SCHEDULE, YIELD_PCT, '2027-04-30', 5).state).toBe('not_applicable');
  });
});
