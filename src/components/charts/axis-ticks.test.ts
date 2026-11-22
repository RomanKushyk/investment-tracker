// The ticks every date and capital axis share (`charts.md` § Signed › Anatomy, C2; the y steps are
// wave 25's, `open-values-charts-type.md` § Signed).
import { describe, expect, it } from 'vitest';

import { SEED_ASSETS, SEED_TRANSACTIONS, buildSeedSnapshots } from '@quirenote/core/seed';
import { balanceChartData } from '@quirenote/core/view/balances';
import { capitalAxis, dateTicks } from './axis-ticks';

const days = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
  );

describe('dateTicks', () => {
  it('prints seven dates on a plot 500 px wide or more, evenly spaced, the ends included', () => {
    const dates = days(31);
    expect(dateTicks(dates, 500)).toEqual([0, 5, 10, 15, 20, 25, 30].map((i) => dates[i]));
    expect(dateTicks(dates, 1200)).toHaveLength(7);
  });

  it('spaces uneven counts by rounding, never dropping an end', () => {
    const dates = days(173);
    const ticks = dateTicks(dates, 800);
    expect(ticks).toHaveLength(7);
    expect(ticks[0]).toBe(dates[0]);
    expect(ticks.at(-1)).toBe(dates[172]);
    const at = ticks.map((d) => dates.indexOf(d));
    const gaps = at.slice(1).map((x, i) => x - at[i]);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  });

  it('prints the first, the middle and the last date on a narrower plot', () => {
    const dates = days(31);
    expect(dateTicks(dates, 499)).toEqual([dates[0], dates[15], dates[30]]);
  });

  it('reads a plot not yet measured as narrow', () => {
    expect(dateTicks(days(31), undefined)).toHaveLength(3);
  });

  it('prints every date when there are no more than it would print', () => {
    expect(dateTicks(days(7), 800)).toEqual(days(7));
    expect(dateTicks(days(3), 300)).toEqual(days(3));
    expect(dateTicks(days(2), 300)).toEqual(days(2));
    expect(dateTicks([], 800)).toEqual([]);
  });
});

/** Intervals a step needs to span the domain, from the multiple at or under its low end to the
 *  one at or over its high end. */
const spans = (lo: number, hi: number, step: number) =>
  Math.ceil(hi / step) - Math.floor(lo / step);
const STEPS = [1, 2, 5]
  .flatMap((m) => [1, 2, 3, 4, 5].map((e) => m * 10 ** e))
  .sort((a, b) => a - b);

describe('capitalAxis', () => {
  it('keeps the cropped domain, the data min − 5 000 to the max + 2 000', () => {
    expect(capitalAxis([123_000, 149_000]).domain).toEqual([118_000, 151_000]);
  });

  it("steps the seed's capital by 10 000, a gridline on every multiple inside the domain", () => {
    const totals = balanceChartData(buildSeedSnapshots(), SEED_ASSETS, SEED_TRANSACTIONS).map(
      (p) => p.total,
    );
    const axis = capitalAxis(totals);
    expect(axis.step).toBe(10_000);
    expect(axis.ticks).toEqual([120_000, 130_000, 140_000, 150_000]);
  });

  it.each([
    ['the narrowest domain', [50_000]],
    ['exactly five 2 000 steps', [0 + 5_000, 10_000 - 2_000]],
    ['one over five 2 000 steps', [0 + 5_000, 10_001 - 2_000]],
    ['exactly five 10 000 steps', [100_000 + 5_000, 150_000 - 2_000]],
    ['one over five 10 000 steps', [99_999 + 5_000, 150_000 - 2_000]],
    ['a wide spread', [12_345, 987_654]],
  ])('takes the smallest 1-2-5 step in at most five intervals: %s', (_, values) => {
    const { domain, step, ticks } = capitalAxis(values);
    const [lo, hi] = domain;
    expect(STEPS).toContain(step);
    expect(spans(lo, hi, step)).toBeLessThanOrEqual(5);
    expect(spans(lo, hi, STEPS[STEPS.indexOf(step) - 1])).toBeGreaterThan(5);
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(t % step).toBe(0);
      expect(t).toBeGreaterThanOrEqual(lo);
      expect(t).toBeLessThanOrEqual(hi);
    }
    expect(ticks[0] - step).toBeLessThan(lo);
    expect(ticks.at(-1)! + step).toBeGreaterThan(hi);
  });

  it('steps exactly five 2 000 intervals by 2 000, and one more by 5 000', () => {
    expect(capitalAxis([5_000, 8_000]).step).toBe(2_000);
    expect(capitalAxis([5_000, 8_001]).step).toBe(5_000);
  });
});
