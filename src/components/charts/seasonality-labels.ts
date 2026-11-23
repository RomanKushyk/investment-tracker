import type { Asset } from '@quirenote/core/types';
import type {
  AssetAmount,
  SeasonalityDayRow,
  SeasonalityMonth,
} from '@quirenote/core/view/seasonality';
import type { Dict } from '../../i18n/messages';
import { bondAbbrev, shortLabel } from '../../screens/daily-quotes/quotes';
import { MONO_ADVANCE } from './anatomy';
import type { SeasonalityChartPoint, SeasonalityPart } from './SeasonalityBars';

const expectedLabel = (n: number | undefined, whole: (n: number) => string) =>
  n === undefined ? undefined : `${whole(n)}*`;

const assetName = (asset: Asset) =>
  asset.yieldType === 'fixed_coupon' ? bondAbbrev(asset) : shortLabel(asset);

/** A bucket's assets as the bar and the tooltip name them; one the portfolio no longer holds has
 *  no name to give. */
function partsOf(amounts: AssetAmount[], assets: Asset[]): SeasonalityPart[] {
  return amounts.flatMap(({ assetId, amount }) => {
    const asset = assets.find((a) => a.id === assetId);
    return asset ? [{ name: assetName(asset), value: amount }] : [];
  });
}

/** Who a bar names after its value: its one asset, or the count of several (wave 27, step 1 B). */
function payers(
  amounts: AssetAmount[],
  parts: SeasonalityPart[],
  countAssets: (n: number) => string,
): string | undefined {
  return amounts.length > 1 ? countAssets(amounts.length) : parts[0]?.name;
}

const named = (value: string, who: string | undefined) => (who ? `${value} · ${who}` : value);

/**
 * The day axis's points. Every bar is the accent, so the asset is named on the bar, after its
 * value (`charts.md` § Signed › Identity); an expected bar alone on its day names its own, and
 * one paired with a received bar stays «N*» (`open-values-charts-type.md` § Wave 27).
 */
export function seasonalityDayPoints(
  days: SeasonalityDayRow[],
  assets: Asset[],
  whole: (n: number) => string,
  countAssets: (n: number) => string,
): SeasonalityChartPoint[] {
  return days.map((d) => {
    const actualParts = partsOf(d.actualByAsset, assets);
    const expectedParts = partsOf(d.expectedByAsset, assets);
    const due = expectedLabel(d.expected, whole);
    return {
      day: d.day,
      actual: d.actual,
      expected: d.expected,
      actualLabel:
        d.actual > 0
          ? named(whole(d.actual), payers(d.actualByAsset, actualParts, countAssets))
          : undefined,
      expectedLabel:
        due !== undefined && d.actual === 0
          ? named(due, payers(d.expectedByAsset, expectedParts, countAssets))
          : due,
      actualParts,
      expectedParts,
    };
  });
}

/** The month axis's points: a month holds several assets, so its bar prints the total alone and
 *  the tooltip names them. */
export function seasonalityMonthPoints(
  months: SeasonalityMonth[],
  assets: Asset[],
  whole: (n: number) => string,
): SeasonalityChartPoint[] {
  return months.map((m) => ({
    day: m.month,
    actual: m.actual,
    expected: m.expected,
    actualLabel: m.actual > 0 ? whole(m.actual) : undefined,
    expectedLabel: expectedLabel(m.expected, whole),
    actualParts: partsOf(m.actualByAsset, assets),
    expectedParts: partsOf(m.expectedByAsset, assets),
  }));
}

/**
 * The names each `<Bar>` passes to recharts as `name`, which the tooltip prefers
 * over the `dataKey` — so renaming a key cannot put the raw word back on screen.
 */
export function seasonalitySeriesNames(
  t: Dict,
): Record<keyof Pick<SeasonalityChartPoint, 'actual' | 'expected'>, string> {
  return { actual: t.analytics.seasonality.received, expected: t.analytics.seasonality.expected };
}

/**
 * Which label, if any, the EXPECTED series' `index`-th rectangle should carry —
 * and the reason this is a function rather than `data[index]`.
 *
 * `index` COUNTS THAT SERIES' OWN RECTANGLES, NOT THE CHART'S DATA. Recharts
 * drops points whose value is nullish before it lays a series out, so a
 * LabelList is called once per rectangle the series actually drew, numbered from
 * zero. The two numberings coincide only where a series has a value at every
 * point, which is why the income label and both of `PayoutsBars`' read straight
 * out of `data`: those series are numbers everywhere, zeros included. `expected`
 * is sparse, so `data[index]` named the wrong month for every rectangle it
 * placed, and each one fell through the guards.
 *
 * Filtering the way recharts filters restores the correspondence: it is the
 * PROJECTION that must be indexed, never the data behind it.
 *
 * A bucket whose actual bar is non-zero returns null — the income label already
 * draws the expectation's line there, and a second would draw it twice.
 */
export function expectedOnlyLabel(data: SeasonalityChartPoint[], index: number): string | null {
  const point = data.filter((p) => p.expected !== undefined)[index];
  if (point === undefined || point.actual !== 0) return null;
  return point.expectedLabel ?? null;
}

/**
 * The centre x a value label must be drawn at to stay inside the plot.
 *
 * A LABEL THAT OVERFLOWS IS NOT A COSMETIC FAULT, which is why this exists at
 * all: `<text textAnchor="middle">` is CLIPPED by the SVG viewport, and the
 * clamp holds both ends. On the left a label loses its leading digit and reads
 * as a plausible smaller number; on the right it loses trailing characters,
 * which on an expected label is the `*` marking it as expected. A truncated
 * figure is worse than an absent one.
 *
 * The width is ESTIMATED, deliberately. JetBrains Mono's advance is `MONO_ADVANCE`, so
 * `chars × size × MONO_ADVANCE` is exact for the digits and generous for the rest — and
 * generous is the safe direction, over-estimating only nudging a label further
 * inside the plot. Measuring the real box would mean rendering it first, a
 * layout pass per label per frame for the length of the animation.
 */
export function clampLabelX(
  centre: number,
  text: string,
  fontSize: number,
  plot: { x: number; width: number } | undefined,
): number {
  if (plot === undefined) return centre;
  const half = (text.length * fontSize * MONO_ADVANCE) / 2;
  // A label wider than the whole plot cannot be placed; centring it at least
  // loses the same amount from both ends rather than beheading the number.
  if (half * 2 >= plot.width) return plot.x + plot.width / 2;
  return Math.min(Math.max(centre, plot.x + half), plot.x + plot.width - half);
}
