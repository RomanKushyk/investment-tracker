import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE UI FACE AND THE ONE RULE THAT MAKES ITS FIGURES LINE UP ARE ONE DECISION, NOT TWO.
// Manrope's figures are PROPORTIONAL — every digit a different advance — AND IT SHIPS
// `tnum`, so with `body { font-variant-numeric: tabular-nums }` a KPI column is exact and
// without it every column of figures wobbles, which nothing else in the repo would notice.
//
// THREE WAYS TO LOSE IT, each with an assertion below: drop the rule; put the family back
// without it; or set any OTHER Tailwind numeric utility at a call site — THEY COMPOSE
// THROUGH `--tw-*` SLOTS, so `slashed-zero` alone leaves `--tw-numeric-spacing` unset and
// that subtree silently returns to proportional figures. The import list and the absence of
// the previous face close the same door on a half-revert, which is what the last two tests
// are for.
//
// SELF-CONTAINED ON PURPOSE. Paths resolve from THIS file, not from `process.cwd()`.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

/** Not cosmetic: a comment naming a weight would otherwise satisfy an assertion the imports
 *  fail. QUOTE-EXACT AND LINE BY LINE, the half a regex cannot do — dropping only whole-line
 *  `//` comments leaves the trailing ones, and one apostrophe in prose then desynchronises
 *  every quote pair after it.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled.
 *  INJECTION-VERIFIED: a trailing `// normal-nums` in `Switch.tsx` leaves this green and turns
 *  the reader it replaces red. */
function stripTs(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split('\n')) {
    let line = '';
    let quote = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inBlock) {
        if (c === '*' && raw[i + 1] === '/') {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (quote) {
        line += c;
        if (c === '\\') line += raw[++i] ?? '';
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'" || c === '`') {
        quote = c;
        line += c;
      } else if (c === '/' && raw[i + 1] === '*') {
        inBlock = true;
        i++;
      } else if (c === '/' && raw[i + 1] === '/') {
        break;
      } else {
        line += c;
      }
    }
    out.push(line);
  }
  return out.join('\n');
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

/** BOTH sides bounded: an unbounded slice lets a declaration in a later, unrelated rule
 *  answer for one this rule never makes. */
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
/** Nested on purpose: `@layer base` is where the rule belongs, so a copy moved OUT of the
 *  layer — where a plain utility would no longer beat it — does not answer for one inside it.
 *  AND `body {` IS NOT A UNIQUE OPENER the way `@theme` is: `.card-body {` satisfies the
 *  same `indexOf`, so this one is nested inside `@layer base` to pin which rule is meant.
 *  Nothing asserts that uniqueness — the nesting is the whole of the defence. */
const LAYER = ruleBody(CSS, '@layer base');
const BODY = ruleBody(LAYER, 'body');

const WEIGHTS = ['500', '600', '700'] as const;

/** The declaration as written, so a failure names the value rather than printing the whole
 *  block it was read out of. */
function declared(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`--font-${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : undefined;
}

describe('the UI face', () => {
  it('is Manrope, read through `--font-display`', () => {
    expect(declared(THEME, 'display')).toBe("'Manrope', sans-serif");
  });

  it('loads exactly the three weights the tokens use, and nothing else', () => {
    const imported = [...stripTs(read('main.tsx')).matchAll(/@fontsource\/manrope\/([^'"]+)\.css/g)]
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
    // The LAST declaration, not the first: CSS applies the last at equal specificity, so a
    // `font-variant-numeric: normal` appended after this rule wins in the browser while a
    // `toMatch` still finds the good one above.
    const all = [...BODY.matchAll(/font-variant-numeric:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(all.at(-1), '`body` does not set font-variant-numeric').toBe('tabular-nums');
    expect(all, '`body` sets font-variant-numeric more than once').toHaveLength(1);
  });

  // Any ONE of these on an element emits a whole `font-variant-numeric` with the spacing slot
  // unset, so that subtree drops back to proportional figures and the `body` rule never sees
  // it. `tabular-nums` is absent on purpose: it is the base rule written twice.
  it('are not thrown away by a numeric utility at a call site', () => {
    // `ordinal` only where it is not a CALL: it is also this app's day-suffix helper, and a
    // guard that cries on prose gets deleted.
    const RESETS =
      /\b(normal-nums|slashed-zero|lining-nums|oldstyle-nums|proportional-nums|diagonal-fractions|stacked-fractions)\b|\bordinal(?![\w(])/;
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
          stripTs(readFileSync(full, 'utf8'))
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

  // RAW, NOT STRIPPED: prose naming the previous face is exactly what this catches — a
  // comment that still argues the old case is a comment that will be believed.
  it('leave no trace of the face that had them by default', () => {
    for (const rel of ['index.css', 'main.tsx', '../package.json']) {
      // The boolean, not the text: `.not.toMatch` on a long file prints the whole file, and
      // a guard nobody can read the failure of is a guard nobody keeps.
      expect(/ibm.?plex/i.test(read(rel)), `${rel} still names the previous face`).toBe(false);
    }
  });

  // IS THE NEEDLE ACTUALLY A NEEDLE? The absence above holds on a tree where the name is
  // already gone from all three files, so the record below is what proves the regex still
  // matches the thing it names. Held in a `.txt`, outside every corpus this repo walks.
  it('is actually looking — the needle still matches the record', () => {
    const record = read('__fixtures__/retired-face-prose.txt');
    expect(/ibm.?plex/i.test(record), 'the record no longer names the previous face').toBe(true);
  });
});
