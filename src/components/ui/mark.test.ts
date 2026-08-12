import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The logo mark exists twice on purpose — as JSX in `src/app/Sidebar.tsx`, so it
// inherits `currentColor` inside the sidebar circle, and as a standalone file in
// `public/favicon.svg`, because a favicon is fetched by URL and can never be a
// component. `public/README.md` says the two must change together; this is what
// makes that sentence enforceable rather than hopeful. D56.
const SIDEBAR = readFileSync('src/app/Sidebar.tsx', 'utf8');
const FAVICON = readFileSync('public/favicon.svg', 'utf8');

/** Every `d="…"` in source order — the four bars of mark 04. */
function paths(source: string): string[] {
  return [...source.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);
}

/** Every `opacity=".45"` in source order — opacity is the mark's age channel. */
function opacities(source: string): string[] {
  return [...source.matchAll(/\bopacity="([^"]+)"/g)].map((m) => m[1]);
}

describe('the logo mark is one drawing, kept in two files', () => {
  it('draws the same four bars in both copies', () => {
    const sidebar = paths(SIDEBAR);
    expect(sidebar).toEqual(['M7 24v-5', 'M13 24v-10', 'M19 24v-6', 'M25 24V8']);
    expect(paths(FAVICON)).toEqual(sidebar);
  });

  it('fades the same three older bars in both copies', () => {
    const sidebar = opacities(SIDEBAR);
    expect(sidebar).toEqual(['.45', '.65', '.8']);
    expect(opacities(FAVICON)).toEqual(sidebar);
  });

  it('keeps the even stroke that lands the bars on whole pixels', () => {
    // 4 on a 32 grid: at 16px each bar covers exactly 2 device pixels instead
    // of straddling two — the reason the geometry uses whole units at all.
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
});
