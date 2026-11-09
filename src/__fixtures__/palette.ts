import { expect } from 'vitest';

// The colour guards' one reader of `index.css`; pure, so each guard hands the text in.
// `resolve` reads what renders, following `var()` as the cascade does (CSS Variables L1 §3);
// `declaredHex` reads the literal hex, for what cannot follow `var()`: the favicon, the browser
// chrome and mail.

/** Quote-aware, because `index.css` holds a comment opener inside a string; loud on an open
 *  comment or string, because truncating would let every assertion pass over a partial file. */
export function stripCss(source: string, what: string): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      // A CSS string cannot hold a raw newline, form feed included (CSS Syntax 3 §3.3, §4.3.5).
      if (c === '\n' || c === '\r' || c === '\f') {
        throw new Error(`${what} has an unterminated string`);
      }
      out += c;
      if (c === '\\') {
        out += source[++i] ?? '';
        // An escaped line break continues the string; CR LF is one break (CSS Syntax 3 §3.3).
        if (source[i] === '\r' && source[i + 1] === '\n') out += source[++i];
      } else if (c === quote) quote = '';
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
  if (quote) throw new Error(`${what} has an unterminated string`);
  return out;
}

/** Each index from `from` that sits outside a string, so a brace in a string value is no rule. */
function* code(source: string, from: number): Generator<number> {
  let quote = '';
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else yield i;
  }
}

/** Bounded by its own braces, so a later rule cannot answer for this one. */
export function ruleBody(source: string, opener: string): string {
  const at = source.indexOf(opener + ' {');
  expect(at, `${opener} must be findable — index.css's shape changed`).toBeGreaterThan(-1);
  let depth = 0;
  for (const i of code(source, source.indexOf('{', at))) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error(`${opener} is never closed`);
}

export type Blocks = { light: string; dark: string };
export type Theme = keyof Blocks;

/** The two theme blocks of an already-stripped stylesheet. */
export const themeBlocks = (css: string): Blocks => ({
  light: ruleBody(css, '@theme'),
  dark: ruleBody(css, "[data-theme='dark']"),
});

export const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const rgbHex = (ch: number[]) =>
  '#' + ch.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

/** sRGB → relative luminance, WCAG 2.x. */
export function luminance(hex: string): number {
  const ch = channels(hex).map((c) => c / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function ratio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** A block's own level: a nested rule's (`@keyframes`, `@media`) declarations are not its own. */
function ownLevel(block: string): string {
  let depth = 0;
  let out = '';
  let last = 0;
  for (const i of code(block, 0)) {
    if (block[i] === '{' && ++depth === 2) out += block.slice(last, i);
    else if (block[i] === '}' && --depth === 1) last = i + 1;
  }
  return out + block.slice(last);
}

/** One block's own declaration, raw; the last one wins, as in the cascade, and the last in a
 *  block may omit its `;`. `undefined` is not an error: the dark block inherits `@theme`. */
export function declaredIn(block: string, name: string): string | undefined {
  const all = [...ownLevel(block).matchAll(new RegExp(`--color-${name}:\\s*([^;}]+)`, 'g'))];
  return all.length ? all[all.length - 1][1].trim() : undefined;
}

export function declared(block: string, name: string): string {
  const value = declaredIn(block, name);
  expect(value, `--color-${name} is not declared in this block`).toBeDefined();
  return value!;
}

/** The declaration the cascade uses for a theme: its own block's, else `@theme`'s. */
function inTheme(blocks: Blocks, theme: Theme, name: string): string {
  const value = declaredIn(blocks[theme], name) ?? declaredIn(blocks.light, name);
  expect(value, `--color-${name} is declared in neither ${theme} nor @theme`).toBeDefined();
  return value!;
}

/** The colour that renders: a `var(--color-x)` chain followed to its hex. */
export function resolve(blocks: Blocks, theme: Theme, name: string, seen: string[] = []): string {
  expect(seen, `--color-${name} resolves in a cycle: ${[...seen, name].join(' → ')}`).not.toContain(
    name,
  );
  const value = inTheme(blocks, theme, name);
  const alias = value.match(/^var\(\s*--color-([a-z0-9-]+)\s*(?:,\s*(.+))?\)$/);
  if (alias) return resolve(blocks, theme, alias[1], [...seen, name]);
  const hex = value.toLowerCase();
  expect(hex, `--color-${name} is neither a hex nor a --color-* alias (got \`${value}\`)`).toMatch(
    /^#[0-9a-f]{6}$/,
  );
  return hex;
}

/** A translucent token's channels and alpha, through the cascade like `resolve`: a dark block
 *  that omits it renders `@theme`'s, and the one-for-one palette guard is what refuses that. */
export function veilOf(blocks: Blocks, theme: Theme, name: string): { ch: number[]; alpha: number } {
  const value = inTheme(blocks, theme, name);
  const m = value.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/);
  expect(m, `--color-${name} is not an rgba(…) veil (got ${value})`).not.toBeNull();
  return { ch: [+m![1], +m![2], +m![3]], alpha: +m![4] };
}

/** Source-over on an opaque plane (Compositing and Blending L1 §5.1): what a veil renders as. */
export function composite(veil: { ch: number[]; alpha: number }, behind: string): string {
  const b = channels(behind);
  return rgbHex(veil.ch.map((c, i) => c * veil.alpha + b[i] * (1 - veil.alpha)));
}

/** The literal hex a theme declares; an alias is refused, since this reader's consumers
 *  cannot follow one. */
export function declaredHex(blocks: Blocks, theme: Theme, name: string): string {
  const value = inTheme(blocks, theme, name);
  expect(value, `--color-${name} is not a plain hex in ${theme} — resolve the alias here`).toMatch(
    /^#[0-9a-fA-F]{6}$/,
  );
  return value.toLowerCase();
}
