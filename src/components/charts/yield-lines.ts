// What /yield's panels, «Разом» and its card read off the curve, in one place so the three agree.
import type { PeriodOption } from '@quirenote/core/period';
import type { Asset } from '@quirenote/core/types';
import type { YieldSeriesPoint } from '@quirenote/core/view/yield';
import type { Dict } from '../../i18n/messages';
import { yieldAxis } from './yield-axis';

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
