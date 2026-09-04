import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE SWITCH'S BOUNDARY, PINNED AT THE SAME BAR AS THE FIELD EDGE AND THE
// FLOATING SURFACES'.
//
// `design/extensions/switch-border.dc.html` (#83) mints `--color-switch-border`
// so the OFF state has a boundary that clears 3 : 1 (WCAG 1.4.11) in both
// themes. Before it the edge was `panel-border` and read 1.26 / 1.37 / 1.14 on
// page / card / panel in light and 1.47 / 1.36 / 1.25 in dark, with the dark
// knob's ring on the same value at 1.36 — the whole control was a rumour.
//
// IT IS A NAME, NOT A VALUE: `var(--color-field-border)` in both blocks, so no
// fourth grey enters the palette and the edge cannot drift from the rank it was
// measured as. The ratio assertions below therefore duplicate
// `field-border.test.ts` while the alias holds and CANNOT fail before it does.
// They are kept deliberately: the entire argument for minting a name is that it
// can take its own hex later, and on that day these are the only assertions
// standing between a re-valued token and a boundary under the bar.
//
// SELF-CONTAINED ON PURPOSE — the house idiom, not an oversight.
// `field-border.test.ts`, `popover-edge.test.ts` and `filled-track.test.ts` each
// carry their own reader, so a guard can be read without opening another one.
// `resolve()` is copied from `popover-edge.test.ts:180` because a literal-hex
// reader sees nothing through a `var()`. Folding these into
// `field-border.test.ts` instead would put the switch inside the FIELD guard,
// which is the single distinction this whole ruling rests on.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
/** TS comments out before the markup half reads a line — `field-border.test.ts`
 *  applies the same one for the same reason. Not cosmetic: this branch's own
 *  `Switch.tsx` comment records the token it replaced, and a comment naming a
 *  utility would otherwise fail an assertion the code passes, or satisfy one it
 *  fails. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[\t ]*\/\/.*$/gm, '');

/** CSS comments out, quote-aware. Not cosmetic: the readers below take the
 *  FIRST match in a block and this stylesheet quotes token declarations in its
 *  comments constantly — including retired values it tells you not to re-mint —
 *  so a comment could satisfy an assertion the CSS fails. Quote-aware because a
 *  regex is not enough: `index.css` line 5 holds a literal comment opener inside
 *  a string, and a naive strip swallows from there to the first real terminator,
 *  taking `@theme` with it. */
function stripCss(source: string, what: string): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      out += c;
      if (c === '\\') out += source[++i] ?? '';
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
      out += c;
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      // Loudly, not silently: truncating would let every assertion pass over a
      // partial file. `ruleBody` throws for the same reason.
      if (end === -1) throw new Error(`${what} has an unterminated /* comment`);
      i = end + 1;
    } else {
      out += c;
    }
  }
  return out;
}

const CSS = stripCss(read('index.css'), 'index.css');

/* ─────────────────────────── the CSS half ─────────────────────────── */

/** sRGB → relative luminance, WCAG 2.x. */
function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function ratio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The span of a `selector { … }` rule, matched on its own braces. BOTH sides
 *  are bounded: an unbounded slice would let "declared in both blocks" pass on a
 *  token declared in a later, unrelated rule. */
function ruleBody(source: string, opener: string): string {
  const at = source.indexOf(opener + ' {');
  expect(at, `${opener} must be findable — index.css's shape changed`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error(`${opener} is never closed`);
}

const BLOCKS = {
  light: ruleBody(CSS, '@theme'),
  dark: ruleBody(CSS, "[data-theme='dark']"),
};

/** The declaration as written — a hex or a `var()`. `undefined` when the block
 *  does not declare it, which is not an error on its own: the cascade falls back
 *  to `@theme` for anything the dark block does not override. */
function declaredIn(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : undefined;
}

function declared(block: string, name: string): string {
  const value = declaredIn(block, name);
  expect(value, `--color-${name} is not declared in this block`).toBeDefined();
  return value!;
}

/** Follows a `var(--color-x)` chain to the hex at the end of it, THE WAY THE
 *  CASCADE DOES — a name the dark block does not override resolves against
 *  `@theme`. Copied from `popover-edge.test.ts:180`; `field-border.test.ts`'s
 *  hex-matching `token()` would see nothing here, because every declaration this
 *  file cares about is an alias. */
function resolve(block: string, name: string, seen: string[] = []): string {
  expect(seen, `--color-${name} resolves in a cycle: ${[...seen, name].join(' → ')}`).not.toContain(
    name,
  );
  const value = declaredIn(block, name) ?? declared(BLOCKS.light, name);
  const alias = value.match(/^var\(\s*--color-([a-z0-9-]+)\s*(?:,\s*(.+))?\)$/);
  if (alias) return resolve(block, alias[1], [...seen, name]);
  const hex = value.toLowerCase();
  expect(hex, `--color-${name} is neither a hex nor a --color-* alias (got \`${value}\`)`).toMatch(
    /^#[0-9a-f]{6}$/,
  );
  return hex;
}

/** The same reader for the shadow family — the dark knob's boundary is a shadow
 *  and not a border, so the colour half of this ruling lives in both. */
function shadowIn(block: string, name: string): string {
  const m = block.match(new RegExp(`--shadow-${name}:\\s*([^;]+);`));
  expect(m, `--shadow-${name} is not declared in this block`).not.toBeNull();
  return m![1].trim();
}

const SURFACES = ['page', 'card', 'panel'] as const;
const THEMES = ['light', 'dark'] as const;

describe('the switch edge clears 3 : 1 on every surface, in both themes', () => {
  // All three bind: the Settings rows sit on `card`, the asset form's "Link to
  // Inzhur" row inside a `panel`, and neither is the whole census — a switch is
  // a component wherever it is drawn, which is what 1.4.11 measures.
  for (const theme of THEMES) {
    it(`${theme} \`switch-border\` is at or above 3 : 1 on page, card and panel`, () => {
      const block = BLOCKS[theme];
      const value = resolve(block, 'switch-border');
      for (const surface of SURFACES) {
        expect(
          ratio(value, resolve(block, surface)),
          `switch-border on ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }

  // A NAME, NOT A VALUE. Inlining `#84827d` or `#747169` would still pass the
  // ratios above and then stop tracking the control-boundary rank the next time
  // it moves — the thing the ruling refused. What is pinned is that the value is
  // READ, not the spelling of the chain, which `resolve()` is relaxed about.
  for (const theme of THEMES) {
    it(`${theme} reads the edge through a token, never as a copy of its hex`, () => {
      expect(
        declared(BLOCKS[theme], 'switch-border'),
        `${theme} switch-border inlines a hex`,
      ).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
      expect(resolve(BLOCKS[theme], 'switch-border')).toBe(resolve(BLOCKS[theme], 'field-border'));
    });
  }

  // Declared in BOTH blocks. `popover-edge.test.ts:262-279` derives the palette
  // of each block and asserts set equality, so this is belt and braces for the
  // token this file owns — and it names which block is missing it.
  it('declares `switch-border` in `@theme` AND in the dark block', () => {
    expect(declaredIn(BLOCKS.light, 'switch-border'), 'missing from @theme').toBeDefined();
    expect(declaredIn(BLOCKS.dark, 'switch-border'), 'missing from the dark block').toBeDefined();
  });
});

describe('the track is frozen, and the state gap is what freezes it', () => {
  // THE RULING REFUSED TO REPAIR THE OFF STATE BY DARKENING THE TRACK, and this
  // is the assertion that holds it. Both values are exact because the arithmetic
  // is the argument: OFF must stay clearly distinct from ON (`ink`), and a track
  // moved far enough to clear 3 : 1 against the card behind it spends that gap.
  it('keeps `switch-track` on the two values the ruling froze', () => {
    expect(resolve(BLOCKS.light, 'switch-track')).toBe('#e8e7e4');
    expect(resolve(BLOCKS.dark, 'switch-track')).toBe('#4a4a55');
  });

  it.each(THEMES)('%s keeps at least 7 : 1 between the OFF and ON fills', (theme) => {
    const block = BLOCKS[theme];
    expect(ratio(resolve(block, 'switch-track'), resolve(block, 'ink'))).toBeGreaterThanOrEqual(7);
  });
});

describe("the dark knob's ring is the same boundary", () => {
  // Dark zeroes its shadows bar this one, so the ring IS the knob's boundary — a
  // spread-only shadow used as a 1px edge. Through the token, never a copy of
  // the hex, so it cannot drift from the value above it: 1.36 → 3.49.
  it('points dark `--shadow-thumb` at `switch-border`', () => {
    expect(shadowIn(BLOCKS.dark, 'thumb')).toBe('0 0 0 1px var(--color-switch-border)');
  });

  // THE RING HAS TWO BACKDROPS, because it is applied in BOTH states: the `card`
  // knob it rings (3.49) and the track it sits over — `ink` when checked (4.06).
  // The second is the figure this ruling accepts as a REGRESSION from 10.44, so
  // it is the one that must not live only in a comment: `field-border` is the
  // shared control-boundary rank and a later session re-valuing it lighter for
  // its own reasons would take the ON knob's halo under the bar with every other
  // assertion in this file still green. The OFF track is the recorded shortfall
  // (1.79) and is deliberately absent from here — its reason is at the value.
  it('clears 3 : 1 on the knob it rings and on the ON track it sits over', () => {
    const ring = resolve(BLOCKS.dark, 'switch-border');
    expect(ratio(ring, resolve(BLOCKS.dark, 'card')), 'ring on the knob').toBeGreaterThanOrEqual(3);
    expect(ratio(ring, resolve(BLOCKS.dark, 'ink')), 'ring on the ON track').toBeGreaterThanOrEqual(
      3,
    );
  });

  // Light's is a drop shadow and not an edge, and it does not move. Named here
  // because the two halves of this one token are easy to "unify" by accident.
  it('leaves light `--shadow-thumb` the drop shadow it was', () => {
    expect(shadowIn(BLOCKS.light, 'thumb')).toBe('0 1px 3px rgba(38, 38, 42, 0.06)');
  });
});

/* ────────────────────────── the markup half ────────────────────────── */

describe('the markup points at the token', () => {
  // ON THE ARM, not merely in the file: a whole-file match would stay green with
  // the token on any sibling of the track.
  it('`Switch.tsx` wears `switch-border` on the unchecked arm and nothing else', () => {
    const src = strip(read('components/ui/Switch.tsx'));
    const arm = src.split('\n').filter((l) => /\bbg-switch-track\b/.test(l));
    expect(arm.length, 'the switch track line vanished').toBeGreaterThan(0);
    for (const line of arm) expect(line).toMatch(/\bborder-switch-border\b/);
    expect(src, 'the switch is back on `panel-border`').not.toMatch(/\bborder-panel-border\b/);
  });

  // THE RAIL DOES NOT MOVE, and this says so out loud: it is a region's
  // decorative edge, which *Design pipeline* puts outside the 3 : 1 bar, so a
  // later pass cannot "finish the job" without a ruling of its own.
  it('leaves the `Scroller` rail on `panel-border`', () => {
    const rail = strip(read('components/ui/Scroller.tsx'))
      .split('\n')
      .filter((l) => /touch-none select-none/.test(l));
    expect(rail.length, 'the rail line vanished').toBeGreaterThan(0);
    for (const line of rail) expect(line).toMatch(/\bborder-panel-border\b/);
  });
});
