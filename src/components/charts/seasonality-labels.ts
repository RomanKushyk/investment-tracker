import type { SeasonalityChartPoint } from './SeasonalityBars';

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
 * joins both amounts into one line there, and a second would draw the
 * expectation twice.
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
 * The width is ESTIMATED, deliberately. JetBrains Mono has a 0.6em advance, so
 * `chars × size × 0.6` is exact for the digits and generous for the rest — and
 * generous is the safe direction, over-estimating only nudging a label further
 * inside the plot. Measuring the real box would mean rendering it first, a
 * layout pass per label per frame for the length of the animation.
 */
const MONO_ADVANCE = 0.6;

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
