import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@tailwindcss/node';
import { describe, expect, it } from 'vitest';

import {
  type Theme,
  channels,
  composite,
  declared,
  declaredHex,
  ratio,
  resolve,
  ruleBody,
  stripCss,
  themeBlocks,
} from './__fixtures__/palette';

// THE AMBIENT GLOW AND GRAIN behind both shells (shell.md § Backdrop, glass-light.md § Signed).
// The glow keeps hues of its own, so the caps hold when the asset colours change
// (loading-and-compositions.md § Settled by the brief).
const here = dirname(fileURLToPath(import.meta.url));
const CSS = stripCss(readFileSync(join(here, 'index.css'), 'utf8'), 'index.css');
const BLOCKS = themeBlocks(CSS);
const THEMES: Theme[] = ['light', 'dark'];

// [spot, the hue it was taken from, light hex, dark hex, light peak %, dark peak %]. The hexes are
// literals here too: an asset colour moving must not move the glow.
const SPOTS: [number, string, string, string, number, number][] = [
  [1, 'accent', '#8a5a3a', '#d8b494', 19, 20],
  [2, 'reit', '#b07a52', '#b07a52', 25, 18],
  [3, 'ovdp8976', '#4a6178', '#93a4b5', 18.5, 16],
  [4, 'energy', '#8a5a3a', '#d8b494', 19, 12],
];

const peakOf = (theme: Theme, spot: number) => {
  const value = declared(BLOCKS[theme], `glow-${spot}-peak`);
  const pct = value.match(/^color-mix\(in srgb, var\(--color-glow-\d\) ([0-9.]+)%, transparent\)$/);
  expect(pct, `--color-glow-${spot}-peak is not a mix of its hue (got ${value})`).not.toBeNull();
  return { ch: channels(declaredHex(BLOCKS, theme, `glow-${spot}`)), alpha: +pct![1] / 100 };
};
/** A spot's peak painted on the page, which is what text on the bare page reads against. */
const bare = (theme: Theme, spot: number) =>
  composite(peakOf(theme, spot), resolve(BLOCKS, theme, 'page'));
const muted = (theme: Theme) => resolve(BLOCKS, theme, 'muted');

describe('the glow tokens', () => {
  it.each(SPOTS)('--color-glow-%i holds %s’s hue as a literal in each theme', (spot, _, l, d) => {
    expect(declared(BLOCKS.light, `glow-${spot}`)).toBe(l);
    expect(declared(BLOCKS.dark, `glow-${spot}`)).toBe(d);
  });

  it.each(SPOTS)(
    '--color-glow-%i-peak is %s at its signed alpha',
    (spot, _h, _l, _d, light, dark) => {
      const mix = (pct: number) =>
        `color-mix(in srgb, var(--color-glow-${spot}) ${pct}%, transparent)`;
      expect(declared(BLOCKS.light, `glow-${spot}-peak`)).toBe(mix(light));
      expect(declared(BLOCKS.dark, `glow-${spot}-peak`)).toBe(mix(dark));
    },
  );
});

/** The text that sits on the bare page: `muted`, which the caps were set for (shell.md § Backdrop),
 *  and the dissolved header's change line, whose values meet the same floor (rail-and-account-foot.md
 *  § Wave 30). */
const BARE_TEXT = ['muted', 'pos', 'neg'] as const;

describe('text on the glow', () => {
  // WCAG F83: text over a background image keeps 4.5 : 1 where the image is least contrasting.
  it.each(
    THEMES.flatMap((theme) =>
      BARE_TEXT.flatMap((token) => SPOTS.map(([spot, hue]) => [theme, token, spot, hue] as const)),
    ),
  )('%s: `%s` on spot %i (%s) at its peak clears 4.5 : 1', (theme, token, spot) => {
    expect(ratio(resolve(BLOCKS, theme, token), bare(theme, spot))).toBeGreaterThanOrEqual(4.5);
  });

  // § Wave 30: the change line sits at the header's right end, under the accent spot.
  it.each(THEMES.flatMap((theme) => (['pos', 'neg'] as const).map((t) => [theme, t] as const)))(
    '%s: the dissolved header’s change, `%s`, on the accent peak',
    (theme, token) => {
      expect(ratio(resolve(BLOCKS, theme, token), bare(theme, 1))).toBeGreaterThanOrEqual(4.5);
    },
  );

  // glass-light.md § Implementation checks: the tightest reading on any screen, the date range's
  // `muted` under the /balances period picker.
  it.each(THEMES)('%s: the /balances date range’s token, `muted`, on the accent peak', (theme) => {
    expect(ratio(muted(theme), bare(theme, 1))).toBeGreaterThanOrEqual(4.5);
  });
});

/* ────────────────────────── the layer ────────────────────────── */

const utility = () => ruleBody(CSS, '@utility glow');
const flat = () => utility().replace(/\s+/g, ' ');
const REDUCED = '@media (prefers-reduced-transparency: reduce)';

// The spec signs no figures for the geometry; radii in vmin scale the layer with the viewport
// (signed-out.md § Signed). [spot, radius, centre x %, centre y %]
const GEOMETRY: [number, number, number, number][] = [
  [1, 62.5, 85, 0],
  [2, 55.6, 10, 15],
  [3, 62.5, 20, 100],
  [4, 55.6, 95, 90],
];
const FADE = 0.68;

describe('the glow layer', () => {
  it.each(GEOMETRY)('paints spot %i, %s vmin across at %s% %s%', (spot, r, x, y) => {
    expect(flat()).toContain(
      `radial-gradient(${r}vmin ${r}vmin at ${x}% ${y}%, var(--color-glow-${spot}-peak), transparent ${FADE * 100}%)`,
    );
  });

  // Each fade is linear, so two overlapping spots are darker than one peak only where one reaches
  // the other's centre; then a peak capped for `muted` no longer holds. Phones, tablets, desktops.
  const VIEWPORTS = [
    [360, 740],
    [360, 800],
    [390, 844],
    [430, 932],
    [768, 1024],
    [1024, 768],
    [1280, 720],
    [1440, 900],
    [1920, 1080],
    [2560, 1440],
  ];
  const spots = (w: number, h: number) =>
    GEOMETRY.map(([, r, x, y]) => ({
      reach: (FADE * r * Math.min(w, h)) / 100,
      x: (x * w) / 100,
      y: (y * h) / 100,
    }));

  it.each(VIEWPORTS)('at %i × %i no spot reaches another’s centre', (w, h) => {
    const all = spots(w, h);
    for (const [i, a] of all.entries())
      for (const [j, b] of all.entries())
        if (i !== j)
          expect(a.reach, `spot ${i + 1} reaches spot ${j + 1}`).toBeLessThanOrEqual(
            Math.hypot(a.x - b.x, a.y - b.y),
          );
  });

  // shell.md § Backdrop: "The spots overlap at 360".
  it('overlaps the bottom pair at 360', () => {
    const [, , c, d] = spots(360, 740);
    expect(c.reach + d.reach).toBeGreaterThan(Math.hypot(c.x - d.x, c.y - d.y));
  });

  // Viewport units, so a scrollbar coming or going and a toolbar retracting move nothing
  // (motion.md: the glow stays put); behind everything, taking no pointer.
  it('is fixed behind the page at the large viewport’s size, and takes no pointer', () => {
    for (const declaration of [
      'position: fixed',
      'left: 0',
      'width: 100vw',
      'top: 0',
      'height: 100lvh',
      'z-index: -1',
      'pointer-events: none',
    ])
      expect(flat()).toContain(declaration);
  });

  it('lays the grain over the spots', () => {
    expect(flat()).toMatch(/background-image: var\(--glow-grain\), radial-gradient\(/);
  });

  it(`paints neither glow nor grain under ${REDUCED}`, () => {
    expect(ruleBody(utility(), REDUCED).replace(/\s+/g, ' ')).toContain('display: none');
  });
});

/* ────────────────────────── the grain ────────────────────────── */

/** The grain tile a theme declares, decoded: an SVG noise filter. */
function grain(theme: 'light' | 'dark'): string {
  const block = theme === 'light' ? ruleBody(CSS, ':root') : BLOCKS.dark;
  const url = block.match(/--glow-grain:\s*url\("data:image\/svg\+xml,([^"]+)"\)/);
  expect(url, `${theme} declares no --glow-grain tile`).not.toBeNull();
  return decodeURIComponent(url![1]);
}
const matrix = (svg: string) =>
  svg
    .match(/<feColorMatrix values='([^']+)'/)![1]
    .trim()
    .split(/\s+/)
    .map(Number);
const opacity = (svg: string) => +svg.match(/<rect [^>]*opacity='([0-9.]+)'/)![1];

describe('the grain', () => {
  it.each(['light', 'dark'] as const)('%s: feTurbulence noise at 3 per cent', (theme) => {
    const svg = grain(theme);
    expect(svg).toContain(
      "<feTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/>",
    );
    expect(opacity(svg)).toBe(0.03);
    // A filter works in linearRGB by default, which would lift the noise's mean far above the
    // 128 the readings below assume.
    expect(svg).toContain("<filter id='n' color-interpolation-filters='sRGB'>");
  });

  // The owner's ruling: light specks only in light, so the grain never darkens what `muted` reads
  // against (WCAG F83's quick check: the darkest area for dark text).
  // White over a peak only lightens it, so the bare-peak readings above hold under the grain.
  it('light: every speck is white', () => {
    // RGB rows constant 1, alpha the noise.
    expect(matrix(grain('light'))).toEqual([
      0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0,
    ]);
  });

  // WinUI Acrylic's neutral ramp (NoiseAsset_256X256_PNG.png, mean 128): opaque grey, the mean of
  // the channels. F83's per-letter step reads the speck's mean.
  it('dark: the specks are an opaque grey ramp, and the bare-page text clears 4.5 : 1 over its mean on each peak', () => {
    const svg = grain('dark');
    const third = 1 / 3;
    expect(matrix(svg)).toEqual(
      [
        third,
        third,
        third,
        0,
        0,
        third,
        third,
        third,
        0,
        0,
        third,
        third,
        third,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
      ].map((v) => +v.toFixed(4)),
    );
    for (const [spot] of SPOTS) {
      const speck = composite({ ch: [128, 128, 128], alpha: opacity(svg) }, bare('dark', spot));
      for (const token of BARE_TEXT) {
        expect(
          ratio(resolve(BLOCKS, 'dark', token), speck),
          `${token} on spot ${spot}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('the build keeps what the layer reads', () => {
  // Tailwind drops a theme variable nothing it builds uses; built here as a consumer builds it.
  it('declares every glow variable the utility uses, and keeps the reduced-transparency rule', async () => {
    const compiler = await compile(CSS, { base: here, onDependency: () => {} });
    const built = compiler.build(['glow']);
    const rule = ruleBody(built, '.glow');
    const used = [...new Set([...rule.matchAll(/var\((--color-glow[\w-]*)/g)].map((m) => m[1]))];
    expect(used.sort()).toEqual(SPOTS.map(([spot]) => `--color-glow-${spot}-peak`).sort());
    const theme = ruleBody(built, '@layer theme');
    // A peak reads its hue, so the hues must survive the build too.
    for (const [spot] of SPOTS)
      for (const name of [`--color-glow-${spot}`, `--color-glow-${spot}-peak`])
        expect(theme, name).toContain(`${name}:`);
    expect(built.match(/--glow-grain:/g), 'a grain tile per theme').toHaveLength(2);
    expect(rule).toContain(REDUCED);
  });
});
