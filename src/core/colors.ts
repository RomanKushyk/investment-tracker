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

// One tooltip surface for every chart. It lived as four byte-identical inline
// objects, which is four places to forget when the value moves.
// NOT a pure extraction: the radius goes 12 -> 16, because a tooltip is a
// floating surface and 16 is the surface value (D56), the same as the
// DatePicker popover. The Select popover is deliberately NOT the comparison —
// it ships 14, since its items hug its corners and make it the concentric
// case; a tooltip holds text, so nothing pulls it off the surface value.
// The surface, border and text are declared rather than left to recharts,
// which paints its own #ffffff and would leave a white slab over a dark chart.
// `panel`, NOT `card`, and that is the reference's own choice (Phase 5 S4): in
// dark `panel` is the highest plane, so the tooltip lifts off the card it
// covers instead of merging with it. In light it is a recess instead, which is
// the asymmetry the palette carries on purpose.
// These are the plain palette tokens, not the `chart-*` aliases: the tooltip is
// HTML, and only SVG props need the aliases. There is deliberately no
// `chart-panel`.
// This DOES move the light theme, off recharts' own white and onto `panel`,
// and that is deliberate rather than overlooked: the app never specified a
// tooltip background at all, so the white was a library default and not a
// designed value. Adopting the token in both themes puts the tooltip inside the
// app's surface vocabulary instead of adding a theme-conditional colour.
// This tooltip carries no shadow in EITHER theme and renders inside a `bg-card`
// Card at all four of its consumers, so its stroke was always the whole
// boundary and `panel-border` was never enough of one. #98 moved it to the
// palette's control-boundary rank; `floating-edges.test.ts` holds the ratios.
export const CHART_TOOLTIP = {
  borderRadius: 16,
  background: 'var(--color-panel)',
  border: `1px solid var(--color-field-border)`,
  color: 'var(--color-ink)',
  fontSize: 12,
};

// The hover indicator recharts draws BEHIND the tooltip. Left alone it is a
// hard-coded rgba(204,204,204,.5), which is a pale wash over a dark chart —
// the one piece of chart paint the token sweep could not reach, because it
// lives in the library's defaults rather than in any prop we set.
// `hairline` is the same one-step separation it has in light, in both themes.
// Two shapes, because recharts fills the cursor on a categorical chart and
// strokes it on a continuous one.
export const CHART_CURSOR_FILL = { fill: CHART.hairline };
export const CHART_CURSOR_LINE = { stroke: CHART.hairline, strokeWidth: 1 };
