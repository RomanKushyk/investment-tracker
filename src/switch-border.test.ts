import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// THE SWITCH'S BOUNDARY, at the same bar as the field edge and the floating surfaces'.
// `design/extensions/switch-border.dc.html` mints `--color-switch-border` so the OFF state
// has a boundary clearing 3 : 1 (WCAG 1.4.11) in both themes, where the edge it replaced
// left the whole control a rumour.
//
// IT IS A NAME, NOT A VALUE — `var(--color-field-border)` in both blocks, so no fourth grey
// enters the palette and the edge cannot drift from the rank it was measured as. THE RATIO
// ASSERTIONS BELOW THEREFORE CANNOT FAIL WHILE THE ALIAS HOLDS, and are kept deliberately:
// the entire argument for minting a name is that it can take its own hex later, and on that
// day these are the only assertions between a re-valued token and a boundary under the bar.
//
// SELF-CONTAINED ON PURPOSE. Folding this into `field-border.test.ts` would put the switch
// inside the FIELD guard, which is the single distinction this whole ruling rests on.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
/** Not cosmetic: `Switch.tsx`'s own comment records the token it replaced, so a comment
 *  naming a utility would fail an assertion the code passes.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled. */
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

/** The readers below take the FIRST match in a block and this stylesheet quotes token
 *  declarations in its comments constantly. Quote-aware, because `index.css` line 5 holds a
 *  comment opener inside a string and a naive strip takes `@theme` with it. */
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
      // Loudly, not silently: truncating would let every assertion pass over a partial file.
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

/** BOTH sides bounded: an unbounded slice let "declared in both blocks" pass on a token
 *  declared in a later, unrelated rule. */
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

/** `undefined` is not an error on its own: the cascade falls back to `@theme` for anything
 *  the dark block does not override. */
function declaredIn(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : undefined;
}

function declared(block: string, name: string): string {
  const value = declaredIn(block, name);
  expect(value, `--color-${name} is not declared in this block`).toBeDefined();
  return value!;
}

/** Follows a `var(--color-x)` chain THE WAY THE CASCADE DOES. A hex-matching reader would
 *  see nothing here, because every declaration this file cares about is an ALIAS. */
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

/** The dark knob's boundary is a SHADOW and not a border, so the colour half of this ruling
 *  lives in both families. */
function shadowIn(block: string, name: string): string {
  const m = block.match(new RegExp(`--shadow-${name}:\\s*([^;]+);`));
  expect(m, `--shadow-${name} is not declared in this block`).not.toBeNull();
  return m![1].trim();
}

const SURFACES = ['page', 'card', 'panel'] as const;
const THEMES = ['light', 'dark'] as const;

describe('the switch edge clears 3 : 1 on every surface, in both themes', () => {
  // All three bind, and neither known site is the whole census: a switch is a component
  // wherever it is drawn, which is what 1.4.11 measures.
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

  // A NAME, NOT A VALUE: inlining the rank's hex would still pass the ratios above and then
  // stop tracking it the next time it moves. What is pinned is that the value is READ, not
  // the spelling of the chain, which `resolve()` is relaxed about.
  for (const theme of THEMES) {
    it(`${theme} reads the edge through a token, never as a copy of its hex`, () => {
      expect(
        declared(BLOCKS[theme], 'switch-border'),
        `${theme} switch-border inlines a hex`,
      ).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
      expect(resolve(BLOCKS[theme], 'switch-border')).toBe(resolve(BLOCKS[theme], 'field-border'));
    });
  }

  // Belt and braces over `floating-edges.test.ts`'s palette parity, for the token this file
  // owns — and this one names which block is missing it.
  it('declares `switch-border` in `@theme` AND in the dark block', () => {
    expect(declaredIn(BLOCKS.light, 'switch-border'), 'missing from @theme').toBeDefined();
    expect(declaredIn(BLOCKS.dark, 'switch-border'), 'missing from the dark block').toBeDefined();
  });
});

describe('the track is frozen, and the state gap is what freezes it', () => {
  // THE RULING REFUSED TO REPAIR THE OFF STATE BY DARKENING THE TRACK, and the two values
  // are frozen because the OFF/ON GAP IS THE ARGUMENT AGAINST DARKENING IT: a track moved
  // far enough to clear 3 : 1 against the card behind it spends that gap.
  it('keeps `switch-track` on the two values the ruling froze', () => {
    expect(resolve(BLOCKS.light, 'switch-track')).toBe('#efeae2');
    expect(resolve(BLOCKS.dark, 'switch-track')).toBe('#4a4650');
  });

  it.each(THEMES)('%s keeps at least 7 : 1 between the OFF and ON fills', (theme) => {
    const block = BLOCKS[theme];
    expect(ratio(resolve(block, 'switch-track'), resolve(block, 'ink'))).toBeGreaterThanOrEqual(7);
  });
});

describe("the dark knob's ring is the same boundary", () => {
  // Dark zeroes its shadows bar this one, so the ring IS the knob's boundary — a spread-only
  // shadow used as a 1px edge, read through the token so it cannot drift from the value above.
  it('points dark `--shadow-thumb` at `switch-border`', () => {
    expect(shadowIn(BLOCKS.dark, 'thumb')).toBe('0 0 0 1px var(--color-switch-border)');
  });

  // THE RING HAS TWO BACKDROPS, because it is applied in BOTH states: the `card` knob it
  // rings and the track it sits over, `ink` when checked. The second must not live only in a
  // comment — re-valuing the shared rank lighter would take the ON knob's halo under the bar
  // with every other assertion here still green. The OFF track is the recorded shortfall and
  // is deliberately absent: its reason is at the value.
  it('clears 3 : 1 on the knob it rings and on the ON track it sits over', () => {
    const ring = resolve(BLOCKS.dark, 'switch-border');
    expect(ratio(ring, resolve(BLOCKS.dark, 'card')), 'ring on the knob').toBeGreaterThanOrEqual(3);
    expect(ratio(ring, resolve(BLOCKS.dark, 'ink')), 'ring on the ON track').toBeGreaterThanOrEqual(
      3,
    );
  });

  // Light's is a drop shadow and not an edge, named here because the two halves of this one
  // token are easy to "unify" by accident.
  //
  // COMPARED AGAINST `--shadow-card`, NEVER AGAINST A COPY OF ITS SPELLING: the invariant is
  // byte-identity with the card shadow, so a session re-valuing only `--shadow-card` must
  // fail here, where a hard-coded string would stay green while the knob kept the old drop.
  it('leaves light `--shadow-thumb` the card shadow, not a ring', () => {
    expect(shadowIn(BLOCKS.light, 'thumb')).toBe(shadowIn(BLOCKS.light, 'card'));
  });
});

/* ────────────────────────── the markup half ────────────────────────── */

describe('the markup points at the token', () => {
  // ON THE ARM, not merely in the file: a whole-file match stays green with the token on any
  // sibling of the track.
  it('`Switch.tsx` wears `switch-border` on the unchecked arm and nothing else', () => {
    const src = stripTs(read('components/ui/Switch.tsx'), 'components/ui/Switch.tsx');
    const arm = src.split('\n').filter((l) => /\bbg-switch-track\b/.test(l));
    expect(arm.length, 'the switch track line vanished').toBeGreaterThan(0);
    for (const line of arm) expect(line).toMatch(/\bborder-switch-border\b/);
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
