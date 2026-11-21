// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { CHART_TOOLTIP_ITEM } from '@quirenote/core/colors';
import { ratio, resolve, stripCss, themeBlocks } from '../../__fixtures__/palette';
import { ChartTooltipContent } from './ChartTooltip';

// ONE TOOLTIP FOR EVERY CHART (`charts.md` § Signed › Anatomy, Tooltip): glass, the date, then a
// row per series — a colour key, the name and the value in 700 — sorted by value. Its rows take
// one text colour: a series' paint is never chosen to be read as text, so the key carries the
// colour and the name tells the rows apart.
//
// The colour maths and token readers are the shared `__fixtures__/palette.ts`; the TypeScript
// reader below is a copy, held to one text by `ts-reader-census.test.ts`.
const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '../..');

/* ─────────────────────── the call sites ─────────────────────── */

/** Copied from `ts-reader.test.ts`, signature and all: comments out, so prose can neither pass
 *  nor fail a match. */
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
    source: stripTs(readFileSync(join(SRC, rel), 'utf8'), rel),
  }))
  .filter(({ source }) => /\bfrom\s*'recharts(?:\/[^']*)?'/.test(source))
  .map(({ rel, source }) => ({ rel, tags: tooltipTags(source) }))
  .filter(({ tags }) => tags.length > 0);

/** Every `<ChartTooltip …>`, the shared one, across the same census. */
const SHARED = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((rel) => rel.endsWith('.tsx') && !/\.test\.tsx$/.test(rel))
  .flatMap((rel) =>
    [...stripTs(readFileSync(join(SRC, rel), 'utf8'), rel).matchAll(/<ChartTooltip\s/g)].map(() =>
      rel.split(sep).join('/'),
    ),
  );

describe('every chart draws the one shared tooltip', () => {
  // THE FOUR IT WAS WRITTEN AGAINST, as a floor: a chart that leaves the census by a route the
  // matchers miss would otherwise take its tooltip out of this check with nothing going red.
  it('finds the four chart tooltips, at least', () => {
    expect(SHARED.length).toBeGreaterThanOrEqual(4);
  });

  // A second `<Tooltip>` is a second set of rows the shared content never reaches.
  it("holds recharts' own `<Tooltip>` in the shared module alone", () => {
    expect(CHARTS.map(({ rel }) => rel)).toEqual(['components/charts/ChartTooltip.tsx']);
    expect(CHARTS[0].tags).toHaveLength(1);
  });
});

/* ─────────────────────────── the rows ─────────────────────────── */

afterEach(cleanup);

function draw(
  payload: { name: string; value: number; color: string }[],
  accessibilityLayer = true,
) {
  const { container } = render(
    createElement(ChartTooltipContent, {
      active: true,
      label: '2026-03-05',
      payload,
      accessibilityLayer,
      formatLabel: (l: string | number) => `on ${l}`,
      formatValue: (v: number) => `${v} ₴`,
    }),
  );
  const box = container.querySelector<HTMLElement>('[data-chart-tooltip]');
  if (!box) throw new Error('no tooltip content');
  return box;
}

const PAYLOAD = [
  { name: 'Small', value: 1, color: 'var(--color-chart-reit)' },
  { name: 'Large', value: 300, color: 'var(--color-chart-energy)' },
  { name: 'Middle', value: 20, color: 'var(--color-chart-ovdp8976)' },
];

describe('the shared tooltip', () => {
  it('is glass at r12, with the glass edge and no override of it (wave 25)', () => {
    const box = draw(PAYLOAD);
    expect([...box.classList]).toEqual(
      expect.arrayContaining(['glass', 'rounded-[12px]', 'font-mono', 'text-small']),
    );
    expect(box.className).not.toMatch(/--glass-edge/);
  });

  // What recharts' own content does under its accessibility layer: the keyboard walk is read out.
  it('is a live region while the accessibility layer is on, and only then', () => {
    const live = draw(PAYLOAD);
    expect(live.getAttribute('role')).toBe('status');
    expect(live.getAttribute('aria-live')).toBe('assertive');
    cleanup();
    expect(draw(PAYLOAD, false).hasAttribute('role')).toBe(false);
  });

  it('opens on the date in `muted` at the label size', () => {
    const box = draw(PAYLOAD);
    const date = box.querySelector('[data-tooltip-date]');
    expect(date?.textContent).toBe('on 2026-03-05');
    expect([...date!.classList]).toEqual(expect.arrayContaining(['text-label', 'text-muted']));
    expect(box.firstElementChild).toBe(date);
  });

  it('gives each series a row, largest first', () => {
    const rows = [...draw(PAYLOAD).querySelectorAll('[data-tooltip-row]')];
    expect(rows.map((r) => r.querySelector('[data-tooltip-name]')?.textContent)).toEqual([
      'Large',
      'Middle',
      'Small',
    ]);
  });

  it('keys each row with a 12 × 2 mark in its series colour', () => {
    const [row] = draw(PAYLOAD).querySelectorAll<HTMLElement>('[data-tooltip-row]');
    const key = row.querySelector<HTMLElement>('[data-tooltip-key]')!;
    expect(key.style.width).toBe('12px');
    expect(key.style.height).toBe('2px');
    expect(key.style.backgroundColor).toBe('var(--color-chart-energy)');
  });

  it('prints the value in 700, and every row in the one text colour', () => {
    for (const row of draw(PAYLOAD).querySelectorAll<HTMLElement>('[data-tooltip-row]')) {
      expect(row.querySelector<HTMLElement>('[data-tooltip-value]')!.style.fontWeight).toBe('700');
      expect(row.style.color).toBe(CHART_TOOLTIP_ITEM.color);
    }
    expect(draw(PAYLOAD).querySelector('[data-tooltip-value]')?.textContent).toBe('300 ₴');
  });
});

/* ─────────────────────────── the token ─────────────────────────── */

const CSS = stripCss(readFileSync(join(SRC, 'index.css'), 'utf8'), 'index.css');
const BLOCKS = themeBlocks(CSS);

describe('the row colour is a theme token that reads as text', () => {
  it('is one colour, named by a token and never a literal', () => {
    expect(CHART_TOOLTIP_ITEM, '`core/colors` exports no shared row style').toBeDefined();
    expect(Object.keys(CHART_TOOLTIP_ITEM)).toEqual(['color']);
    expect(CHART_TOOLTIP_ITEM.color).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
  });

  // On the glass's ground: its fill is `card` at an alpha over the card it covers, and its
  // fallback is `card` itself. The rows are under the large-text size, so 1.4.3 asks 4.5 : 1.
  it.each(['light', 'dark'] as const)('%s: clears 4.5 : 1 on the tooltip ground', (block) => {
    const token = (css: string) => css.match(/^var\(--color-([a-z0-9-]+)\)$/)![1];
    const [row, ground] = [token(CHART_TOOLTIP_ITEM.color), 'card'];
    expect(
      ratio(resolve(BLOCKS, block, row), resolve(BLOCKS, block, ground)),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
