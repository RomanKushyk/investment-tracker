// Which /yield windows have no line at all, and what the card says then (#338, the owner's ruling):
// «За цей період жоден актив не має лінії — оберіть довший період.», and under «Від початку», where
// no longer period exists, the first clause alone. An asset has a line when a point carries it.
import { describe, expect, it } from 'vitest';

import { ledgerUnits } from '@quirenote/core/derive';
import { PERIOD_OPTIONS, resolveWindow } from '@quirenote/core/period';
import { SEED_ASSETS, SEED_TRANSACTIONS, buildSeedSnapshots } from '@quirenote/core/seed';
import type { Transaction } from '@quirenote/core/types';
import { cumulativeYieldSeriesIn } from '@quirenote/core/view/yield';
import { en, uk } from '../../i18n/messages';
import { SHAPES, glyphPath, noLineMessage, shapeByAsset, withLine } from './yield-lines';

const snaps = buildSeedSnapshots();
const START = '2026-02-03';
const LATEST = '2026-07-27';

// #338's sold-out ledger: every seed position sold on 01.07, and no ledger row after that.
const held = ledgerUnits(SEED_TRANSACTIONS, '2026-07-01').units;
const SOLD_OUT: Transaction[] = [
  ...SEED_TRANSACTIONS.filter((t) => t.date <= '2026-07-01'),
  ...SEED_ASSETS.map((a, i) => ({
    id: `sold${i}`,
    date: '2026-07-01',
    type: 'sell' as const,
    assetId: a.id,
    amount: 1000,
    quantity: held[a.id],
  })),
];

describe('withLine', () => {
  it.each(PERIOD_OPTIONS)('on the seed under %s, every asset has a line', (period) => {
    const series = cumulativeYieldSeriesIn(
      snaps,
      SEED_TRANSACTIONS,
      SEED_ASSETS,
      resolveWindow(period, START, LATEST),
    );
    expect(withLine(series, SEED_ASSETS).map((a) => a.id)).toEqual(SEED_ASSETS.map((a) => a.id));
  });

  it('on the sold-out ledger over 10.07–27.07, no asset has one, though the curve has points', () => {
    const series = cumulativeYieldSeriesIn(snaps, SOLD_OUT, SEED_ASSETS, {
      from: '2026-07-10',
      to: LATEST,
      clamped: false,
    });
    expect(series.length).toBeGreaterThan(0);
    expect(withLine(series, SEED_ASSETS)).toEqual([]);
  });

  it('keeps an asset one point carries, and drops one no point carries', () => {
    const series = [
      { date: '2026-07-26', a: 0.4 },
      { date: '2026-07-27', a: 0.5, b: 0 },
    ];
    const assets = ['a', 'b', 'c'].map((id) => ({ ...SEED_ASSETS[0], id }));
    expect(withLine(series, assets).map((a) => a.id)).toEqual(['a', 'b']);
  });
});

describe('noLineMessage', () => {
  it('under «Від початку» reads the first clause alone', () => {
    expect(noLineMessage('all', uk.analytics.yield)).toBe(
      'За цей період жоден актив не має лінії.',
    );
    expect(noLineMessage('all', en.analytics.yield)).toBe('No asset has a line in this period.');
  });

  it.each(PERIOD_OPTIONS.filter((p) => p !== 'all'))('under %s carries the pathway', (period) => {
    expect(noLineMessage(period, uk.analytics.yield)).toBe(
      'За цей період жоден актив не має лінії — оберіть довший період.',
    );
    expect(noLineMessage(period, en.analytics.yield)).toBe(
      'No asset has a line in this period — choose a longer one.',
    );
  });
});

// Wave 14 (`yield-series-shapes.md` § Signed): a shape per asset by its order, never by its colour
// slot, and one glyph drawing in a box of its signed size.
describe('shapeByAsset', () => {
  const asset = (id: string, createdAt: string, colorKey = 'reit') =>
    ({ ...SEED_ASSETS[0], id, createdAt, colorKey }) as (typeof SEED_ASSETS)[number];

  it('follows createdAt through the six shapes, then repeats', () => {
    // Ids run against createdAt, so an order by id would read the shapes backwards.
    const id = (i: number) => `x${7 - i}`;
    const assets = Array.from({ length: 8 }, (_, i) =>
      asset(id(i), `2026-0${i + 1}-01T00:00:00`),
    ).reverse();
    const shapes = shapeByAsset(assets);
    expect(Array.from({ length: 8 }, (_, i) => shapes.get(id(i)))).toEqual([
      'circle',
      'square',
      'triangle',
      'diamond',
      'triangle-down',
      'cross',
      'circle',
      'square',
    ]);
    expect(SHAPES).toEqual(['circle', 'square', 'triangle', 'diamond', 'triangle-down', 'cross']);
  });

  it('breaks a createdAt tie by id, and reads no colour slot', () => {
    const shapes = shapeByAsset([
      asset('b', '2026-01-01T00:00:00', 'reit'),
      asset('a', '2026-01-01T00:00:00', 'reit'),
    ]);
    expect([shapes.get('a'), shapes.get('b')]).toEqual(['circle', 'square']);
  });

  // Core serves assets in this order (`view/serve.ts`, `sortedAssets`): code points, not locale.
  it('breaks the tie by code point, as core orders the assets', () => {
    const shapes = shapeByAsset([
      asset('a', '2026-01-01T00:00:00'),
      asset('B', '2026-01-01T00:00:00'),
    ]);
    expect([shapes.get('B'), shapes.get('a')]).toEqual(['circle', 'square']);
  });
});

/** The extent of every `x,y` pair in a path; arc radii are written without a comma. */
function box(d: string) {
  const pts = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
    cx: (Math.max(...xs) + Math.min(...xs)) / 2,
    cy: (Math.max(...ys) + Math.min(...ys)) / 2,
  };
}

describe('glyphPath', () => {
  it.each(SHAPES.filter((s) => s !== 'circle'))('draws %s to fill its box, centred', (shape) => {
    for (const size of [9, 10, 12]) {
      const b = box(glyphPath(shape, size, 50, 20));
      expect(b.w).toBeCloseTo(size, 9);
      expect(b.h).toBeCloseTo(size, 9);
      expect(b.cx).toBeCloseTo(50, 9);
      expect(b.cy).toBeCloseTo(20, 9);
    }
  });

  it('draws the circle as two arcs of half its size', () => {
    const d = glyphPath('circle', 9, 50, 20);
    expect(d).toMatch(/^M45\.5,20A4\.5 4\.5 0 1 0 54\.5,20A4\.5 4\.5 0 1 0 45\.5,20Z$/);
  });
});
