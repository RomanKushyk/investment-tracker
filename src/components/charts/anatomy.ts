// The values every chart shares (`docs/superpowers/specs/2026-11-05-layout-refresh/charts.md`
// § Signed › Anatomy, C2), held here so no chart drifts from the others.
import type { PlotArea } from 'recharts';

import { CHART } from '@quirenote/core/colors';

export const TICK = { fontSize: 11, fill: CHART.muted, className: 'font-mono' };

// JetBrains Mono's advance, in em: every glyph of chart text is this wide, so a label's width is
// known before it is drawn. `chart-face.test.tsx` holds recharts' text to that face, and the
// allocation screen test the bar's.
export const MONO_ADVANCE = 0.6;

// `'auto'` is recharts' own `prefers-reduced-motion` check; a bare `true` animates regardless.
// The curve is `--ease-soft`, mirrored because recharts takes a string, never a `var()`.
export const CHART_MOTION = {
  isAnimationActive: 'auto',
  animationDuration: 400,
  animationEasing: 'cubic-bezier(0.22,1,0.36,1)',
} as const;

// A series drawn again over the others to bring it forward («Разом»'s focus, wave 14): no row of
// its own and no entry draw, since its motion is the fade it mounts with.
export const FOCUS_COPY = {
  isAnimationActive: false,
  tooltipType: 'none',
  legendType: 'none',
} as const;

/** An r4 marker in the series colour on an r6 `card` disc, drawn as one circle. */
export function ringed(color: string) {
  return { r: 5, fill: color, stroke: CHART.card, strokeWidth: 2 };
}

/** A plot narrower than this is narrow: the tooltip holds inside it, and a date axis prints its
 *  first, middle and last date. */
export const NARROW_PLOT = 500;

interface Placement {
  position?: { x: number };
  reverseDirection: { x: boolean; y: boolean };
  maxWidth?: number;
}

// Right of the crosshair, left of it past mid-plot; on a narrow plot, held inside its left
// edge and wrapped to its width, so the box never leaves the card.
export function tooltipPlacement(plot: PlotArea | undefined, x: number | undefined): Placement {
  const reverseDirection = { x: false, y: false };
  if (!plot) return { reverseDirection };
  if (plot.width < NARROW_PLOT)
    return { position: { x: plot.x }, reverseDirection, maxWidth: plot.width };
  return { reverseDirection: { x: x !== undefined && x > plot.x + plot.width / 2, y: false } };
}

export interface TooltipEntry {
  name?: string | number;
  value?: unknown;
  color?: string;
  dataKey?: unknown;
  payload?: unknown;
  /** recharts' `tooltipType`: `'none'` keeps a series out of the rows. */
  type?: string;
}
