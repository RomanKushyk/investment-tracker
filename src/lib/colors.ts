// Hex constants for SVG/recharts, mirroring the @theme tokens in src/index.css.
// Keep the two in sync — recharts can't resolve CSS variables in SVG attributes.
import type { ColorKey } from './types';

export const SERIES: Record<ColorKey, { main: string; tint: string; tintText: string }> = {
  reit: { main: '#8ba283', tint: '#e3eadf', tintText: '#4c5a48' },
  energy: { main: '#c2a189', tint: '#efe4e0', tintText: '#6d5a53' },
  ovdp8976: { main: '#98a3ad', tint: '#e4e8eb', tintText: '#525c64' },
  ovdp6475: { main: '#5f5e5a', tint: '#e8e7e4', tintText: '#5f5e5a' },
};

// New assets cycle through the palette: KEYS[existingAssetCount % 4]
export const COLOR_KEYS: ColorKey[] = ['reit', 'energy', 'ovdp8976', 'ovdp6475'];

export const CHART = {
  pos: '#5c7355',
  posTint: '#e3eadf',
  neg: '#a8695a',
  hairline: '#e8e7e4',
  faint: '#b3b2ae',
  muted: '#8b8a86',
  ink: '#26262a',
};
