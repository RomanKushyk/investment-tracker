import { describe, expect, it } from 'vitest';

import type { Asset } from '@quirenote/core/types';
import { en, uk } from '../../i18n/messages';
import { MONO_ADVANCE } from './anatomy';
import type { SeasonalityChartPoint } from './SeasonalityBars';
import {
  clampLabelX,
  expectedOnlyLabel,
  seasonalityDayPoints,
  seasonalityMonthPoints,
  seasonalitySeriesNames,
} from './seasonality-labels';

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
    // draws both lines there, so drawing here would state the expectation twice.
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

// `charts.md` § Signed › Identity, as wave 25 answers it (`open-values-charts-type.md` § Signed):
// a day bar names its asset after its value, a month bar prints its total alone, and an expected
// amount keeps its «*». Whole numbers with no ₴, as the signed render prints them.
const whole = (n: number) => String(Math.round(n));
const REIT = { id: 'reit', name: 'Inzhur REIT', yieldType: 'dividend' } as unknown as Asset;
const BOND = { id: 'b6475', name: 'OVDP UA4000236475', yieldType: 'fixed_coupon' } as Asset;
const BOND2 = { id: 'b8976', name: 'OVDP UA4000238976', yieldType: 'fixed_coupon' } as Asset;
const ASSETS = [REIT, BOND, BOND2];
type Paid = [assetId: string, amount: number][];
const amounts = (paid: Paid) => paid.map(([assetId, amount]) => ({ assetId, amount }));
const total = (paid: Paid) => paid.reduce((s, [, a]) => s + a, 0);
// A day row as the core serves it: the totals are the per-asset amounts summed.
const row = (day: number, paid: Paid = [], due?: Paid) => ({
  day,
  actual: total(paid),
  expected: due && total(due),
  actualByAsset: amounts(paid),
  expectedByAsset: amounts(due ?? []),
});
const countUk = uk.importing.count.assets;
const countEn = en.importing.count.assets;

describe('seasonalityDayPoints', () => {
  const points = seasonalityDayPoints(
    [
      row(3, [['b6475', 216]], [['b6475', 216]]),
      row(4),
      row(10, [['reit', 3641.44]]),
      row(25, [], [['b6475', 1240]]),
    ],
    ASSETS,
    whole,
    countUk,
  );

  it('names a fund by its short name and a bond by its abbreviation, after the value', () => {
    expect(points.find((p) => p.day === 10)?.actualLabel).toBe('3641 · REIT');
    expect(points.find((p) => p.day === 3)?.actualLabel).toBe('216 · OVDP …6475');
  });

  it('marks a paired expected amount with «*» alone, and labels no day that received nothing', () => {
    expect(points.find((p) => p.day === 3)?.expectedLabel).toBe('216*');
    expect(points.find((p) => p.day === 4)).toMatchObject({
      actualLabel: undefined,
      expectedLabel: undefined,
    });
  });

  it('names the asset of an expected-only bar after its «*»', () => {
    expect(points.find((p) => p.day === 25)).toMatchObject({
      actualLabel: undefined,
      expectedLabel: '1240* · OVDP …6475',
    });
  });

  it('carries no asset colour', () => {
    for (const p of points) expect(Object.keys(p).some((k) => /color/i.test(k))).toBe(false);
  });

  it('prints the value alone when its one asset is not among the assets', () => {
    const [p] = seasonalityDayPoints([row(5, [['gone', 100]])], [REIT], whole, countUk);
    expect(p?.actualLabel).toBe('100');
  });
});

// Wave 27, step 1 B and step 2 B: a day several assets share prints the whole total and a count.
describe('seasonalityDayPoints on a day several assets share', () => {
  const days = [
    row(10, [
      ['reit', 1853.04],
      ['b6475', 900],
    ]),
    row(
      25,
      [],
      [
        ['b8976', 1240],
        ['b6475', 216],
      ],
    ),
    row(
      3,
      [
        ['b6475', 216],
        ['reit', 100],
      ],
      [
        ['b6475', 216],
        ['b8976', 50],
      ],
    ),
  ];

  it('counts the payers in Ukrainian', () => {
    const points = seasonalityDayPoints(days, ASSETS, whole, countUk);
    expect(points.find((p) => p.day === 10)?.actualLabel).toBe('2753 · 2 активи');
    expect(points.find((p) => p.day === 25)?.expectedLabel).toBe('1456* · 2 активи');
  });

  it('counts the payers in English', () => {
    const points = seasonalityDayPoints(days, ASSETS, whole, countEn);
    expect(points.find((p) => p.day === 10)?.actualLabel).toBe('2753 · 2 assets');
    expect(points.find((p) => p.day === 25)?.expectedLabel).toBe('1456* · 2 assets');
  });

  it('keeps a paired expected line at «*» alone', () => {
    const points = seasonalityDayPoints(days, ASSETS, whole, countUk);
    expect(points.find((p) => p.day === 3)).toMatchObject({
      actualLabel: '316 · 2 активи',
      expectedLabel: '266*',
    });
  });

  it('hands the tooltip each series’ assets, named as the bar names them', () => {
    const points = seasonalityDayPoints(days, ASSETS, whole, countUk);
    expect(points.find((p) => p.day === 10)?.actualParts).toEqual([
      { name: 'REIT', value: 1853.04 },
      { name: 'OVDP …6475', value: 900 },
    ]);
    expect(points.find((p) => p.day === 25)?.expectedParts).toEqual([
      { name: 'OVDP …8976', value: 1240 },
      { name: 'OVDP …6475', value: 216 },
    ]);
  });
});

describe('seasonalityMonthPoints', () => {
  const month = (m: number, paid: Paid = [], due?: Paid) => ({
    month: m,
    actual: total(paid),
    expected: due && total(due),
    actualByAsset: amounts(paid),
    expectedByAsset: amounts(due ?? []),
  });

  it('prints a month’s total alone, with its expected amount on its own label', () => {
    const points = seasonalityMonthPoints(
      [
        month(1),
        month(
          2,
          [
            ['reit', 524.2],
            ['b8976', 1240],
          ],
          [['b8976', 1240]],
        ),
        month(8, [], [['b8976', 1240]]),
      ],
      ASSETS,
      whole,
    );
    expect(points.map((p) => [p.day, p.actualLabel, p.expectedLabel])).toEqual([
      [1, undefined, undefined],
      [2, '1764', '1240*'],
      [8, undefined, '1240*'],
    ]);
  });

  it('hands the tooltip each series’ assets', () => {
    const [p] = seasonalityMonthPoints(
      [
        month(
          2,
          [
            ['b8976', 1240],
            ['reit', 524.2],
          ],
          [['b8976', 1240]],
        ),
      ],
      ASSETS,
      whole,
    );
    expect(p?.actualParts).toEqual([
      { name: 'OVDP …8976', value: 1240 },
      { name: 'REIT', value: 524.2 },
    ]);
    expect(p?.expectedParts).toEqual([{ name: 'OVDP …8976', value: 1240 }]);
  });
});

describe('clampLabelX at 360', () => {
  // The longest day label on seed, at the label's 11 px, against the 360 card's plot.
  const label = '1 184 · OVDP …8976';
  const plot = { x: 0, width: 280 };
  const half = (label.length * 11 * MONO_ADVANCE) / 2;

  it('keeps the label inside the plot at either edge', () => {
    for (const centre of [2, 140, 278]) {
      const x = clampLabelX(centre, label, 11, plot);
      expect(x - half).toBeGreaterThanOrEqual(plot.x);
      expect(x + half).toBeLessThanOrEqual(plot.x + plot.width);
    }
  });
});
