import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CHART_TOOLTIP, CHART_TOOLTIP_ITEM } from '@quirenote/core/colors';

// A CHART TOOLTIP'S ROWS TAKE ONE TEXT COLOUR. recharts paints a row in its series' own paint —
// never chosen to be read as text — or black where a `<Bar>` draws through a custom `shape`, unless
// the caller's `itemStyle` overrides it. One colour for every row leaves the name to tell them apart.
//
// SELF-CONTAINED ON PURPOSE, the house idiom — a guard stands alone.
const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '../..');

/* ─────────────────────── the call sites ─────────────────────── */

/** Copied from `seasonality-tooltip.test.ts`, signature and all: comments out, quote-exact
 *  and line by line, so prose can neither pass nor fail a match. */
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

/** Every `<Tooltip …>` or `<X.Tooltip …>` opening tag, closed on a `>` outside any brace: a
 *  prop's arrow function carries a `>` of its own, where a `[^>]*` match would stop. */
function tooltipTags(source: string): string[] {
  const tags: string[] = [];
  for (const m of source.matchAll(/<(?:[A-Za-z_$][\w$]*\.)?Tooltip\s/g)) {
    let depth = 0;
    for (let i = m.index + m[0].length; i < source.length; i++) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) {
        tags.push(source.slice(m.index, i + 1));
        break;
      }
    }
  }
  return tags;
}

// A CENSUS, NOT A LIST: every file importing recharts in any form that draws a tooltip, so a
// fifth chart is caught without an edit here — and the sidebar's Radix `<Tooltip>` is not.
const CHARTS = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((rel) => rel.endsWith('.tsx'))
  .map((rel) => ({
    rel: rel.split(sep).join('/'),
    source: stripTs(readFileSync(join(SRC, rel), 'utf8')),
  }))
  .filter(({ source }) => /\bfrom\s*'recharts(?:\/[^']*)?'/.test(source))
  .map(({ rel, source }) => ({ rel, tags: tooltipTags(source) }))
  .filter(({ tags }) => tags.length > 0);

describe('every chart tooltip takes the shared row style', () => {
  // THE FOUR IT WAS WRITTEN AGAINST, as a floor: a chart that leaves the census by a route the
  // matchers miss would otherwise take its tooltip out of this check with nothing going red.
  it('finds the four chart tooltips, at least', () => {
    expect(CHARTS.flatMap(({ tags }) => tags).length).toBeGreaterThanOrEqual(4);
  });

  it.each(CHARTS.map(({ rel, tags }) => [rel, tags]))('%s', (_rel, tags) => {
    for (const tag of tags) {
      expect(tag, "a row falls back to its series' paint, or to black").toMatch(
        /\bitemStyle=\{CHART_TOOLTIP_ITEM\}/,
      );
      // Each of these puts a colour on a row that the shared style does not decide: a second
      // `itemStyle` or a spread after it overrides it, a custom `content` draws rows it never
      // reaches, and a series colour or inline style in a formatter paints the text itself.
      expect(tag.match(/\bitemStyle=/g)).toHaveLength(1);
      expect(tag).not.toMatch(/\{\s*\.\.\./);
      expect(tag).not.toMatch(/\bcontent=/);
      expect(tag).not.toMatch(/\bSERIES\b|\bstyle=/);
    }
  });
});

/* ─────────────────────────── the token ─────────────────────────── */

/** Copied from `palette-mirror.test.ts`: CSS comments out, quote-aware, because `index.css`
 *  holds a comment opener inside a string. */
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
      if (end === -1) throw new Error(`${what} has an unterminated /* comment`);
      i = end + 1;
    } else {
      out += c;
    }
  }
  return out;
}

/** The span of a `selector { … }` rule, matched on its own braces. */
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

const CSS = stripCss(readFileSync(join(SRC, 'index.css'), 'utf8'), 'index.css');
const BLOCKS = {
  light: ruleBody(CSS, '@theme'),
  dark: ruleBody(CSS, "[data-theme='dark']"),
};

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

/** Copied from `palette-mirror.test.ts`, plus a check that the chain ends in a hex: a token's
 *  hex in a block, following a `var()` chain the way the cascade does — a name the dark block
 *  does not override resolves against `@theme`. */
function resolve(block: keyof typeof BLOCKS, name: string, seen: string[] = []): string {
  expect(seen, `--color-${name} resolves in a cycle`).not.toContain(name);
  // Sliced rather than matched: a name interpolated into a `RegExp` is one stray escape from a
  // pattern that matches the wrong thing and still passes. The `:` in the needle is what keeps
  // `--color-info` off `--color-info-tint`.
  const needle = `--color-${name}:`;
  const decl = (b: string) => {
    const at = b.indexOf(needle);
    return at === -1 ? undefined : b.slice(at + needle.length, b.indexOf(';', at)).trim();
  };
  const value = decl(BLOCKS[block]) ?? decl(BLOCKS.light);
  expect(value, `--color-${name} is declared in neither block`).toBeDefined();
  const alias = value!.match(/^var\(\s*--color-([a-z0-9-]+)\s*\)$/);
  if (alias) return resolve(block, alias[1], [...seen, name]);
  expect(value, `--color-${name} does not resolve to a hex`).toMatch(/^#[0-9a-fA-F]{6}$/);
  return value!.toLowerCase();
}

describe('the row colour is a theme token that reads as text', () => {
  it('is one colour, named by a token and never a literal', () => {
    expect(CHART_TOOLTIP_ITEM, '`core/colors` exports no shared row style').toBeDefined();
    expect(Object.keys(CHART_TOOLTIP_ITEM)).toEqual(['color']);
    expect(CHART_TOOLTIP_ITEM.color).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
  });

  // Against the ground the surface actually declares, read rather than named. The rows are
  // under the large-text size, so 1.4.3 asks 4.5 : 1 rather than 3.
  it.each(['light', 'dark'] as const)('%s: clears 4.5 : 1 on the tooltip ground', (block) => {
    const token = (css: string) => css.match(/^var\(--color-([a-z0-9-]+)\)$/)![1];
    const [row, ground] = [token(CHART_TOOLTIP_ITEM.color), token(CHART_TOOLTIP.background)];
    expect(ratio(resolve(block, row), resolve(block, ground))).toBeGreaterThanOrEqual(4.5);
  });
});
