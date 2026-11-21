// Chart paint as CSS var() strings, not hex: SVG fill/stroke presentation
// attributes resolve var(), so charts re-theme with the tokens.
import type { ColorKey } from './types';

export const SERIES: Record<
  ColorKey,
  { main: string; tint: string; tintText: string; label: string }
> = {
  reit: {
    main: 'var(--color-chart-reit)',
    tint: 'var(--color-chart-reit-tint)',
    tintText: 'var(--color-chart-reit-tint-text)',
    label: 'var(--color-chart-reit-label)',
  },
  energy: {
    main: 'var(--color-chart-energy)',
    tint: 'var(--color-chart-energy-tint)',
    tintText: 'var(--color-chart-energy-tint-text)',
    label: 'var(--color-chart-energy-label)',
  },
  ovdp8976: {
    main: 'var(--color-chart-ovdp8976)',
    tint: 'var(--color-chart-ovdp8976-tint)',
    tintText: 'var(--color-chart-ovdp8976-tint-text)',
    label: 'var(--color-chart-ovdp8976-label)',
  },
  ovdp6475: {
    main: 'var(--color-chart-ovdp6475)',
    tint: 'var(--color-chart-ovdp6475-tint)',
    tintText: 'var(--color-chart-ovdp6475-tint-text)',
    label: 'var(--color-chart-ovdp6475-label)',
  },
};

// New assets cycle: COLOR_KEYS[existingAssetCount % COLOR_KEYS.length]
export const COLOR_KEYS: ColorKey[] = ['reit', 'energy', 'ovdp8976', 'ovdp6475'];

export const CHART = {
  // Gain and loss belong to DELTAS (*Interaction rules*), and total capital over
  // time has no direction to report, so the capital line reads the accent instead.
  accent: 'var(--color-chart-accent)',
  neg: 'var(--color-chart-neg)',
  hairline: 'var(--color-chart-hairline)',
  faint: 'var(--color-chart-faint)',
  muted: 'var(--color-chart-muted)',
  ink: 'var(--color-chart-ink)',
  // The ring under a marker, and the crosshair and the 0 % line (`charts.md` § Signed › Anatomy).
  card: 'var(--color-chart-card)',
  fieldBorder: 'var(--color-chart-field-border)',
};

// A payout type's own paint, apart from `SERIES`: re-valuing an asset moves no payout.
export const PAYOUT = {
  dividend: 'var(--color-chart-payout-dividend)',
  coupon: 'var(--color-chart-payout-coupon)',
};

// Rows in the surface's ink, not recharts' per-series paint: a series' fill or stroke is not a
// text colour, so a row's key carries its colour and its name ties it to its series.
export const CHART_TOOLTIP_ITEM = { color: 'var(--color-ink)' };

// The hover indicator, which recharts would draw as an rgba wash no theme reaches: bar charts fill
// the hovered category's band, line and area charts stroke the crosshair.
export const CHART_CURSOR_FILL = { fill: CHART.hairline };
export const CHART_CURSOR_LINE = { stroke: CHART.fieldBorder, strokeWidth: 1 };
