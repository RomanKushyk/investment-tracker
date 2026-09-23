import { describe, expect, it } from 'vitest';

import { en, uk } from '../../i18n/messages';
import type { SeasonalityChartPoint } from './SeasonalityBars';
import { expectedOnlyLabel, seasonalitySeriesNames } from './seasonality-labels';

// SIX POINTS, THREE OF THEM CARRYING AN EXPECTATION — a reduction of the month
// axis rather than a copy, the months in between changing nothing about the
// indexing. What matters is the RATIO: recharts draws one rectangle per point
// for `actual`, a number everywhere, and only three for `expected`, so the
// expected series is called with index 0, 1 and 2 while the points it stands
// over are at positions 1, 4 and 5.
const POINTS: SeasonalityChartPoint[] = [
  { day: 1, actual: 0 },
  { day: 2, actual: 1764, expected: 1240, actualLabel: '1 764 ₴', expectedLabel: '1 240 ₴*' },
  { day: 3, actual: 596, actualLabel: '596 ₴' },
  { day: 4, actual: 612, actualLabel: '612 ₴' },
  { day: 8, actual: 0, expected: 1240, expectedLabel: '1 240 ₴*' },
  { day: 12, actual: 0, expected: 216, expectedLabel: '216 ₴*' },
];

describe('expectedOnlyLabel', () => {
  it('labels a bucket that expects income and has received none', () => {
    expect(expectedOnlyLabel(POINTS, 1)).toBe('1 240 ₴*');
    expect(expectedOnlyLabel(POINTS, 2)).toBe('216 ₴*');
  });

  it('declines the bucket whose income label already carries both amounts', () => {
    // Index 0 is the `day: 2` bucket — actual AND expected. `makeIncomeLabel`
    // joins the two into one line there, so drawing here would state the
    // expectation twice.
    expect(expectedOnlyLabel(POINTS, 0)).toBeNull();
  });

  it('indexes the drawn rectangles, not the data behind them', () => {
    // The regression itself: `data[1]` is the `day: 2` bucket, whose actual is
    // non-zero, so reading the data array returned null for every rectangle and
    // the month axis drew no expected-only label at all. Nothing may
    // re-introduce a reading where these two disagree.
    expect(POINTS[1]?.actual).not.toBe(0);
    expect(expectedOnlyLabel(POINTS, 1)).not.toBeNull();
  });

  it('has nothing to say past the last drawn rectangle', () => {
    expect(expectedOnlyLabel(POINTS, 3)).toBeNull();
  });

  it('draws nothing for a series with no expectations at all', () => {
    expect(expectedOnlyLabel([{ day: 1, actual: 500, actualLabel: '500 ₴' }], 0)).toBeNull();
  });
});

// The literals are the contract: recharts prints a series' `dataKey` wherever its
// name is missing. `seasonality-tooltip.test.ts` holds the chart to these names.
describe('seasonalitySeriesNames', () => {
  it('names the two series in Ukrainian', () => {
    expect(seasonalitySeriesNames(uk)).toEqual({ actual: 'Отримано', expected: 'Очікувано' });
  });

  it('names the two series in English', () => {
    expect(seasonalitySeriesNames(en)).toEqual({ actual: 'Received', expected: 'Expected' });
  });
});
