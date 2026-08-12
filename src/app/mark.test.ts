import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The logo mark exists in THREE copies, and only two of them are text:
//   1. `Mark` in ./Sidebar.tsx        — JSX, so it inherits `currentColor`
//   2. ../../public/favicon.svg       — a file, because a favicon is a URL
//   3. ../../public/apple-touch-icon.png — a raster, because iOS wants one
// This pins 1 against 2. Copy 3 cannot be pinned here (comparing a raster to an
// SVG needs a renderer vitest does not have), so it has a checked-in
// regeneration step instead — `node scripts/build-touch-icon.mjs` — and
// public/README.md names all three in its change-together rule.
//
// Paths resolve from THIS file, not from `process.cwd()`: a cwd-relative read
// takes the whole suite down with ENOENT the moment vitest is run from a
// subdirectory or given a different root.
const here = dirname(fileURLToPath(import.meta.url));
const SIDEBAR = readFileSync(join(here, 'Sidebar.tsx'), 'utf8');
const FAVICON = readFileSync(join(here, '..', '..', 'public', 'favicon.svg'), 'utf8');

/** Every `d="…"` in source order — the four bars of mark 04. */
function paths(source: string): string[] {
  return [...source.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);
}

/** Every `opacity="…"` in source order — opacity is the mark's age channel. */
function opacities(source: string): string[] {
  return [...source.matchAll(/\bopacity="([^"]+)"/g)].map((m) => m[1]);
}

/** The x of each bar: `M6 24v-4` → 6. */
function barCentres(source: string): number[] {
  return paths(source).map((d) => Number(/^M(\d+)/.exec(d)![1]));
}

describe('the logo mark is one drawing, kept in two text copies', () => {
  it('draws the same four bars in both', () => {
    const sidebar = paths(SIDEBAR);
    expect(sidebar).toEqual(['M6 24v-4', 'M12 24v-10', 'M18 24v-6', 'M24 24v-16']);
    expect(paths(FAVICON)).toEqual(sidebar);
  });

  it('fades the same three older bars in both', () => {
    const sidebar = opacities(SIDEBAR);
    expect(sidebar).toEqual(['.45', '.65', '.8']);
    expect(opacities(FAVICON)).toEqual(sidebar);
  });

  // The actual pixel invariant, and the one the first version of this test got
  // backwards. A bar spans [x-2, x+2] user units; at 16px that halves to
  // [(x-2)/2, (x+2)/2], whose ends are integers only when x is EVEN. Odd
  // centres put every edge on a half-pixel and blur the icon across three
  // columns. The same holds vertically, because the round caps reach two units
  // past each endpoint — hence even tops and an even baseline too.
  it('keeps every bar centre even, which is what lands them on whole pixels', () => {
    for (const source of [SIDEBAR, FAVICON]) {
      for (const x of barCentres(source)) expect(x % 2).toBe(0);
    }
  });

  it('keeps every vertical endpoint even, for the same reason', () => {
    for (const source of [SIDEBAR, FAVICON]) {
      for (const d of paths(source)) {
        const [, bottom, height] = /^M\d+ (\d+)v-(\d+)$/.exec(d)!;
        expect(Number(bottom) % 2).toBe(0);
        expect((Number(bottom) - Number(height)) % 2).toBe(0);
      }
    }
  });

  it('keeps the even stroke both copies are drawn with', () => {
    expect(SIDEBAR).toContain('strokeWidth="4"');
    expect(FAVICON).toContain('stroke-width="4"');
  });

  it('keeps both copies on the same 32-unit grid', () => {
    expect(SIDEBAR).toContain('viewBox="0 0 32 32"');
    expect(FAVICON).toContain('viewBox="0 0 32 32"');
  });

  it('leaves the favicon theme-aware, so it survives a dark browser chrome', () => {
    // A fixed colour goes invisible in one theme; the tab is painted by the
    // browser, not by the app, so the file has to carry the query itself.
    expect(FAVICON).toContain('prefers-color-scheme: dark');
    expect(FAVICON).toContain('#26262a');
    expect(FAVICON).toContain('#e9e8e6');
  });

  it('leaves the sidebar copy decorative, so the wordmark is not read twice', () => {
    expect(SIDEBAR).toContain('aria-hidden="true"');
  });
});
