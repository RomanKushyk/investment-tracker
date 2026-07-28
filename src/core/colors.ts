// Chart paint colors as CSS var() strings — resolved by the --color-chart-*
// aliases in src/index.css @theme (SVG fill/stroke presentation attributes
// resolve var() in all engines), so charts re-theme with the tokens instead
// of mirroring hex. No chart computes with a color value in JS, so no hex
// constants remain here.
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

// New assets cycle through the palette: COLOR_KEYS[existingAssetCount % 4]
export const COLOR_KEYS: ColorKey[] = ['reit', 'energy', 'ovdp8976', 'ovdp6475'];

export const CHART = {
  pos: 'var(--color-chart-pos)',
  posTint: 'var(--color-chart-pos-tint)',
  neg: 'var(--color-chart-neg)',
  hairline: 'var(--color-chart-hairline)',
  faint: 'var(--color-chart-faint)',
  muted: 'var(--color-chart-muted)',
  ink: 'var(--color-chart-ink)',
};
