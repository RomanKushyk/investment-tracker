// Chart paint as CSS var() strings, not hex: SVG fill/stroke presentation
// attributes resolve var(), so charts re-theme with the tokens.
import type { ColorKey } from './types';

export const SERIES: Record<ColorKey, { main: string; tint: string; tintText: string }> = {
  reit: {
    main: 'var(--color-chart-reit)',
    tint: 'var(--color-chart-reit-tint)',
    tintText: 'var(--color-chart-reit-tint-text)',
  },
  energy: {
    main: 'var(--color-chart-energy)',
    tint: 'var(--color-chart-energy-tint)',
    tintText: 'var(--color-chart-energy-tint-text)',
  },
  ovdp8976: {
    main: 'var(--color-chart-ovdp8976)',
    tint: 'var(--color-chart-ovdp8976-tint)',
    tintText: 'var(--color-chart-ovdp8976-tint-text)',
  },
  ovdp6475: {
    main: 'var(--color-chart-ovdp6475)',
    tint: 'var(--color-chart-ovdp6475-tint)',
    tintText: 'var(--color-chart-ovdp6475-tint-text)',
  },
};

// New assets cycle: COLOR_KEYS[existingAssetCount % COLOR_KEYS.length]
export const COLOR_KEYS: ColorKey[] = ['reit', 'energy', 'ovdp8976', 'ovdp6475'];

export const CHART = {
  // Gain and loss belong to DELTAS (*Interaction rules*), and total capital over
  // time has no direction to report, so the capital line reads the accent instead.
  accent: 'var(--color-chart-accent)',
  accentTint: 'var(--color-chart-accent-tint)',
  neg: 'var(--color-chart-neg)',
  hairline: 'var(--color-chart-hairline)',
  faint: 'var(--color-chart-faint)',
  muted: 'var(--color-chart-muted)',
  ink: 'var(--color-chart-ink)',
};

// One tooltip surface for every chart, declared rather than left to recharts,
// which paints its own #ffffff and would leave a white slab over a dark chart.
// `panel`, not `card`: in dark it is the highest plane, so the tooltip lifts off
// the card it covers. Plain palette tokens — the tooltip is HTML, and only SVG
// props need the `chart-*` aliases.
export const CHART_TOOLTIP = {
  borderRadius: 16,
  background: 'var(--color-panel)',
  border: `1px solid var(--color-field-border)`,
  color: 'var(--color-ink)',
  fontSize: 12,
};

// Rows in the surface's ink, not recharts' per-series paint: a series' fill or stroke is not a
// text colour, so a row's name, never its colour, ties it to its series.
export const CHART_TOOLTIP_ITEM = { color: CHART_TOOLTIP.color };

// The hover indicator recharts draws BEHIND the tooltip. Left alone it is a
// hard-coded rgba wash that no theme token reaches. Two shapes: recharts fills
// the cursor on a categorical chart and strokes it on a continuous one.
export const CHART_CURSOR_FILL = { fill: CHART.hairline };
export const CHART_CURSOR_LINE = { stroke: CHART.hairline, strokeWidth: 1 };
