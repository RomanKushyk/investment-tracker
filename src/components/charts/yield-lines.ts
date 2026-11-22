// What /yield's panels, «Разом» and its card read off the curve, in one place so the three agree.
import type { PeriodOption } from '@quirenote/core/period';
import type { Asset } from '@quirenote/core/types';
import type { YieldSeriesPoint } from '@quirenote/core/view/yield';
import type { Dict } from '../../i18n/messages';
import { bondAbbrev } from '../../screens/daily-quotes/quotes';
import { yieldAxis } from './yield-axis';

/** A bond by its short code, as a panel title and a «Разом» tooltip row name it. */
export const nameOf = (a: Asset) => (a.yieldType === 'fixed_coupon' ? bondAbbrev(a) : a.name);

// Wave 14's order (`yield-series-shapes.md` § Signed), after Highcharts and Vega.
export const SHAPES = [
  'circle',
  'square',
  'triangle',
  'diamond',
  'triangle-down',
  'cross',
] as const;
export type Shape = (typeof SHAPES)[number];

/** A shape per asset by its order (`createdAt`, then id), never by its colour slot, so two assets
 *  on one slot still differ, and a shape does not move with the period. */
export function shapeByAsset(assets: Asset[]): Map<string, Shape> {
  // Code points, as core orders the assets it serves.
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const order = [...assets].sort(
    (a, b) => compare(a.createdAt, b.createdAt) || compare(a.id, b.id),
  );
  return new Map(order.map((a, i) => [a.id, SHAPES[i % SHAPES.length]]));
}

/** Every shape fills the same `size` box centred on (cx, cy): the signed size read as a box, as
 *  Highcharts and Vega size their markers. */
export function glyphPath(shape: Shape, size: number, cx = 0, cy = 0): string {
  const h = size / 2;
  const p = (pts: [number, number][]) =>
    `M${pts.map(([x, y]) => `${cx + x},${cy + y}`).join('L')}Z`;
  switch (shape) {
    case 'circle':
      return `M${cx - h},${cy}A${h} ${h} 0 1 0 ${cx + h},${cy}A${h} ${h} 0 1 0 ${cx - h},${cy}Z`;
    case 'square':
      return p([
        [-h, -h],
        [h, -h],
        [h, h],
        [-h, h],
      ]);
    case 'triangle':
      return p([
        [0, -h],
        [h, h],
        [-h, h],
      ]);
    case 'diamond':
      return p([
        [0, -h],
        [h, 0],
        [0, h],
        [-h, 0],
      ]);
    case 'triangle-down':
      return p([
        [-h, -h],
        [h, -h],
        [0, h],
      ]);
    case 'cross': {
      // Arms a third of the box thick, as d3's cross.
      const a = size / 6;
      return p([
        [-a, -h],
        [a, -h],
        [a, -a],
        [h, -a],
        [h, a],
        [a, a],
        [a, h],
        [-a, h],
        [-a, a],
        [-h, a],
        [-h, -a],
        [-a, -a],
      ]);
    }
  }
}

/** Each line ends on its OWN last point: an asset bought later has a shorter series, so the
 *  chart's last index is not that line's. */
export function lastDefinedIndex(data: YieldSeriesPoint[], assetId: string): number {
  let idx = -1;
  data.forEach((p, i) => {
    if (typeof p[assetId] === 'number') idx = i;
  });
  return idx;
}

/** The assets with a line in the window: a point carries them. A lone point is drawn as its end
 *  mark, as a chart shows a single value (#338). */
export function withLine(data: YieldSeriesPoint[], assets: Asset[]): Asset[] {
  return assets.filter((a) => lastDefinedIndex(data, a.id) >= 0);
}

/** One y domain for every panel and for «Разом», over every drawn value. */
export function sharedAxis(data: YieldSeriesPoint[], assets: Asset[]) {
  let lo = 0;
  let hi = 0;
  for (const p of data)
    for (const a of assets) {
      const v = p[a.id];
      if (typeof v === 'number') {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  return yieldAxis(lo, hi);
}

/** #338's ruling: «Від початку» is the longest period, so there it names no way out. */
export function noLineMessage(period: PeriodOption, t: Dict['analytics']['yield']): string {
  return period === 'all' ? t.noLine : t.noLineLonger;
}
