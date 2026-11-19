import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  channels,
  composite,
  declaredIn,
  knobTintOf,
  mixOf,
  ratio,
  resolve,
  ruleBody,
  stripCss,
  themeBlocks,
} from './__fixtures__/palette';

// THE SWITCH, AS SIGNED (controls.md § Signed, S2 with D2's knob): on, an `accent` fill and edge
// with an `accent` check in the knob; off, the glass well with a 1 px `field-border` edge. Every
// state reaches 3 : 1 (WCAG 1.4.11) and the check carries the state beside the colour.
//
// A GUARD OF ITS OWN ON PURPOSE: folding this into `field-border.test.ts` would put the switch
// inside the FIELD guard, whose sites are fields and whose edge is a field's state.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
/** Not cosmetic: a comment naming a utility would fail an assertion the code passes.
 *
 *  Copied SIGNATURE AND ALL rather than imported:
 *  `ts-reader-census.test.ts` holds every copy to one text. */
function stripTs(source: string, file: string): string {
  const sf = ts.createSourceFile(
    file,
    source,
    // Parsed JSDoc puts a comment's own tokens in the walk: a `//` inside a JSDoc type is then
    // cut on its own, and the rest of the block is left.
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    true,
  );
  // Not in the public typings; typescript-estree reads the same field and throws on it too.
  const [error] = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (error) {
    const why = ts.flattenDiagnosticMessageText(error.messageText, ' ');
    throw new Error(`${file} does not parse: ${why}`);
  }
  const cuts: [number, number][] = [];
  // Returns nothing: a truthy return stops TypeScript's iteration.
  const cut = (pos: number, end: number) => {
    cuts.push([pos, end]);
  };
  // Every comment is trivia before some token; JSX text is a token, never trivia.
  const visit = (node: ts.Node): void => {
    if (!ts.isTokenKind(node.kind)) return node.getChildren(sf).forEach(visit);
    if (node.kind === ts.SyntaxKind.JsxText) return;
    ts.forEachTrailingCommentRange(source, node.pos, cut);
    ts.forEachLeadingCommentRange(source, node.pos, cut);
  };
  visit(sf);
  let out = '';
  let at = 0;
  for (const [pos, end] of cuts) {
    // At position 0 the leading scan starts collecting at once and repeats the trailing scan.
    if (pos < at) continue;
    out += source.slice(at, pos) + source.slice(pos, end).replace(/[^\r\n\u2028\u2029]/g, '');
    at = end;
  }
  return out + source.slice(at);
}

const CSS = stripCss(read('index.css'), 'index.css');

/* ─────────────────────────── the CSS half ─────────────────────────── */

const BLOCKS = themeBlocks(CSS);

const SURFACES = ['page', 'card', 'panel'] as const;
const THEMES = ['light', 'dark'] as const;

describe('the off edge clears 3 : 1 on every surface, in both themes', () => {
  // All three bind, and neither known site is the whole census: a switch is a component
  // wherever it is drawn, which is what 1.4.11 measures.
  for (const theme of THEMES) {
    it(`${theme} \`field-border\` is at or above 3 : 1 on page, card and panel`, () => {
      const edge = resolve(BLOCKS, theme, 'field-border');
      for (const surface of SURFACES) {
        expect(
          ratio(edge, resolve(BLOCKS, theme, surface)),
          `field-border on ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

describe('the on fill clears 3 : 1 on every surface, in both themes', () => {
  // The on arm's boundary is its `accent` fill and edge; a re-valued `accent` must not take it under.
  it.each(THEMES)('%s `accent` is at or above 3 : 1 on page, card and panel', (theme) => {
    const on = resolve(BLOCKS, theme, 'accent');
    for (const surface of SURFACES)
      expect(
        ratio(on, resolve(BLOCKS, theme, surface)),
        `accent on ${surface}`,
      ).toBeGreaterThanOrEqual(3);
  });
});

describe('the two arms keep one shadow shape, so a focused toggle fades', () => {
  // A list pair where one shadow is inset and the other is not interpolates discretely (CSS
  // Backgrounds 3, box-shadow animation), so the on arm holds an inset slot of its own.
  it('paints `switch-on` in `accent`, with an inset slot first and the halo last', () => {
    const body = ruleBody(CSS, '@utility switch-on');
    expect(body).toMatch(/background-color:\s*var\(--color-accent\);/);
    expect(body).toMatch(/box-shadow:\s*inset [^,;]+,\s*var\(--focus-halo\);\s*\}$/);
  });

  it('gives `switch-well` the well inset first and the halo last', () => {
    expect(ruleBody(CSS, '@utility switch-well')).toMatch(
      /box-shadow:\s*var\(--shadow-glass-well\),\s*var\(--focus-halo\);\s*\}$/,
    );
  });

  it.each(THEMES)(
    "%s `--shadow-glass-well`, the off arm's first slot, is an inset shadow",
    (theme) => {
      expect(BLOCKS[theme]).toMatch(/--shadow-glass-well:\s*inset /);
    },
  );
});

describe('the knob is the glass knob tinted, at 94 %', () => {
  const SIGNED = { light: 16, dark: 22 } as const;

  it('declares `switch-knob` in `@theme` AND in the dark block', () => {
    expect(declaredIn(BLOCKS.light, 'switch-knob'), 'missing from @theme').toBeDefined();
    expect(declaredIn(BLOCKS.dark, 'switch-knob'), 'missing from the dark block').toBeDefined();
  });

  it.each(THEMES)('%s mixes the signed share of `accent` into `card`, at 94 %%', (theme) => {
    const knob = knobTintOf(BLOCKS, theme, 'switch-knob');
    expect(knob.alpha).toBe(0.94);
    const tint = composite(
      { ch: channels(resolve(BLOCKS, theme, 'accent')), alpha: SIGNED[theme] / 100 },
      resolve(BLOCKS, theme, 'card'),
    );
    expect(knob.ch).toEqual(channels(tint));
  });

  // controls.md § Implementation checks: "The check on the tinted switch knob was not checked for
  // contrast." The check shows only when on, where the 94 % knob sits over the `accent` track.
  // DESCRIPTIVE, not a floor: the readings the signed recipe gives, so a change cannot be quiet.
  it.each([
    ['light', 4.0],
    ['dark', 5.11],
  ] as const)(
    '%s reads the `accent` check against the knob on the track as recorded',
    (theme, at) => {
      const accent = resolve(BLOCKS, theme, 'accent');
      const knob = composite(knobTintOf(BLOCKS, theme, 'switch-knob'), accent);
      expect(ratio(accent, knob)).toBeCloseTo(at, 2);
    },
  );

  // The sheen fades out by 40 % of the knob, so the check's top meets it; its peak bounds that.
  it.each([
    ['light', 5.09],
    ['dark', 4.37],
  ] as const)('%s reads the check against the sheen at its peak as recorded', (theme, at) => {
    const accent = resolve(BLOCKS, theme, 'accent');
    const knob = composite(knobTintOf(BLOCKS, theme, 'switch-knob'), accent);
    const peak = composite(mixOf(BLOCKS, theme, 'glass-knob-sheen'), knob);
    expect(ratio(accent, peak)).toBeCloseTo(at, 2);
  });

  it('drops `0 1px 4px` under the knob, and lists no focus halo, being no focus target', () => {
    const body = ruleBody(CSS, '@utility switch-knob');
    expect(body).toMatch(/var\(--shadow-switch-knob\)/);
    expect(body).not.toMatch(/--focus-halo/);
    for (const block of [BLOCKS.light, BLOCKS.dark])
      expect(block).toMatch(/--shadow-switch-knob:\s*0 1px 4px /);
  });

  it("puts the root's focus halo last on the off well", () => {
    expect(ruleBody(CSS, '@utility switch-well')).toMatch(/var\(--focus-halo\);\s*\}$/);
  });
});

/* ────────────────────────── the markup half ────────────────────────── */

describe('the markup points at the recipe', () => {
  // ON THE ARM, not merely in the file: a whole-file match stays green with the edge on any
  // sibling of the track.
  it('`Switch.tsx` wears `field-border` on the off arm and `accent` on the on arm', () => {
    const src = stripTs(read('components/ui/Switch.tsx'), 'components/ui/Switch.tsx');
    const off = src.split('\n').filter((l) => /\bswitch-well\b/.test(l));
    expect(off.length, 'the off arm vanished').toBeGreaterThan(0);
    for (const line of off) expect(line).toMatch(/\bborder-field-border\b/);
    const on = src.split('\n').filter((l) => /\bswitch-on\b/.test(l));
    expect(on.length, 'the on arm vanished').toBeGreaterThan(0);
    for (const line of on) expect(line).toMatch(/\bborder-accent\b/);
    expect(src, 'the `ink` on-fill is back').not.toMatch(/\bbg-ink\b/);
    expect(src, 'the switch is back on `panel-border`').not.toMatch(/\bborder-panel-border\b/);
  });

  // THE RAIL DOES NOT MOVE: it is a region's decorative edge, which *Design pipeline* puts
  // outside the 3 : 1 bar, so a later pass cannot "finish the job" without its own ruling.
  it('leaves the `Scroller` rail on `panel-border`', () => {
    const rail = stripTs(read('components/ui/Scroller.tsx'), 'components/ui/Scroller.tsx')
      .split('\n')
      .filter((l) => /touch-none select-none/.test(l));
    expect(rail.length, 'the rail line vanished').toBeGreaterThan(0);
    for (const line of rail) expect(line).toMatch(/\bborder-panel-border\b/);
  });
});
