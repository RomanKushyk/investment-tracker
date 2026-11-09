import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { CHART_TOOLTIP, CHART_TOOLTIP_ITEM } from '@quirenote/core/colors';
import { ratio, resolve, stripCss, themeBlocks } from '../../__fixtures__/palette';

// A CHART TOOLTIP'S ROWS TAKE ONE TEXT COLOUR. recharts paints a row in its series' own paint —
// never chosen to be read as text — or black where a `<Bar>` draws through a custom `shape`, unless
// the caller's `itemStyle` overrides it. One colour for every row leaves the name to tell them apart.
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

const CSS = stripCss(readFileSync(join(SRC, 'index.css'), 'utf8'), 'index.css');
const BLOCKS = themeBlocks(CSS);

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
    expect(
      ratio(resolve(BLOCKS, block, row), resolve(BLOCKS, block, ground)),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
