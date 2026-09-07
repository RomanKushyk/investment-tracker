import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE UI FACE AND THE ONE RULE THAT MAKES ITS FIGURES LINE UP, PINNED TOGETHER.
//
// Manrope's figures are PROPORTIONAL — every digit a different advance — and it
// ships `tnum`. So the face and `body { font-variant-numeric: tabular-nums }`
// are one decision, not two: with the rule, a KPI column is exact; without it,
// every column of figures in the app wobbles, and nothing else in the repo
// would notice. That is why both halves are asserted in one file.
//
// THREE WAYS TO LOSE IT, and each has an assertion below. Drop the rule; put
// the family back without it; or set any OTHER Tailwind numeric utility at a
// call site — they compose through `--tw-*` slots, so `slashed-zero` alone
// leaves `--tw-numeric-spacing` unset and that subtree silently returns to
// proportional figures. The import list and the absence of the previous face
// close the same door on a half-revert.
//
// SELF-CONTAINED ON PURPOSE — the house idiom, not an oversight.
// `field-border.test.ts`, `switch-border.test.ts` and `floating-edges.test.ts`
// each carry their own reader, so a guard can be read without opening another
// one. Paths resolve from THIS file, not from `process.cwd()`: a cwd-relative
// read takes the whole suite down with ENOENT the moment vitest is run from a
// subdirectory.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

/** TS comments out before the import half reads a line — `switch-border.test.ts`
 *  applies the same one for the same reason. Not cosmetic: a comment naming a
 *  weight would otherwise satisfy an assertion the imports fail. */
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

/** The span of a `selector { … }` rule, matched on its own braces. BOTH sides
 *  are bounded: an unbounded slice would let a declaration in a later, unrelated
 *  rule answer for one this rule never makes. */
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

const CSS = stripCss(read('index.css'), 'index.css');
const THEME = ruleBody(CSS, '@theme');
/** Nested on purpose: `@layer base` is where the rule belongs, so a copy moved
 *  out of the layer — where a plain utility would no longer beat it — does not
 *  answer for one inside it.
 *  The sibling copies of `ruleBody` only ever open `@theme` or a `[data-theme]`
 *  block, which no other selector can spell. `body` can: `.card-body {` would
 *  satisfy the same `indexOf` and the guard would watch the wrong rule without
 *  saying so, which is why the opener's uniqueness is asserted, not assumed. */
const LAYER = ruleBody(CSS, '@layer base');
const BODY = ruleBody(LAYER, 'body');

const WEIGHTS = ['500', '600', '700'] as const;

/** The declaration as written, so a failure names the value rather than printing
 *  the 260-line block it was read out of. */
function declared(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`--font-${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : undefined;
}

describe('the UI face', () => {
  it('is Manrope, read through `--font-display`', () => {
    expect(declared(THEME, 'display')).toBe("'Manrope', sans-serif");
  });

  it('loads exactly the three weights the tokens use, and nothing else', () => {
    const imported = [...strip(read('main.tsx')).matchAll(/@fontsource\/manrope\/([^'"]+)\.css/g)]
      .map((m) => m[1])
      .sort();
    expect(imported).toEqual([...WEIGHTS]);
  });

  it('declares the package it imports', () => {
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    expect(pkg.dependencies['@fontsource/manrope']).toBeDefined();
  });
});

describe('tabular figures', () => {
  it('read the one `body` rule, not a selector that merely ends in it', () => {
    expect(LAYER.split('body {').length - 1, '`@layer base` has more than one `body {`').toBe(1);
  });

  it('are asked for once, on `body`, because the face does not give them for free', () => {
    // The LAST declaration, not the first: CSS applies the last one at equal
    // specificity, so a `font-variant-numeric: normal` appended after this rule
    // would win in the browser while a `toMatch` still found the good one above.
    const all = [...BODY.matchAll(/font-variant-numeric:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(all.at(-1), '`body` does not set font-variant-numeric').toBe('tabular-nums');
    expect(all, '`body` sets font-variant-numeric more than once').toHaveLength(1);
  });

  // Tailwind's numeric utilities compose through `--tw-*` slots: any ONE of
  // these on an element emits a whole `font-variant-numeric` with the spacing
  // slot unset, so that subtree drops back to proportional figures and the
  // `body` rule above never sees it. `tabular-nums` itself is absent from this
  // list on purpose — it is the base rule written twice, not a contradiction.
  it('are not thrown away by a numeric utility at a call site', () => {
    // Comments out first, and `ordinal` only where it is not a call: it is also
    // the name of the day-suffix helper this app writes labels with
    // (`attributes.ts`), and a guard that cries on prose gets deleted.
    const RESETS =
      /\b(normal-nums|slashed-zero|lining-nums|oldstyle-nums|proportional-nums|diagonal-fractions|stacked-fractions)\b|\bordinal(?![\w(])/;
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
          strip(readFileSync(full, 'utf8'))
            .split('\n')
            .forEach((line, i) => {
              if (RESETS.test(line)) hits.push(`${entry}:${i + 1}`);
            });
        }
      }
    };
    walk(here);
    expect(hits, 'a numeric utility here overrides the inherited tabular figures').toEqual([]);
  });

  // RAW, not stripped: prose naming the previous face is exactly what this
  // catches. A comment that still argues the old case is a comment that will be
  // believed, and `docs/DECISIONS.md` carries current state only.
  it('leave no trace of the face that had them by default', () => {
    for (const rel of ['index.css', 'main.tsx', '../package.json']) {
      // The boolean, not the text: `.not.toMatch` on an 800-line file prints the
      // file, and a guard nobody can read the failure of is a guard nobody keeps.
      expect(/ibm.?plex/i.test(read(rel)), `${rel} still names the previous face`).toBe(false);
    }
  });
});
