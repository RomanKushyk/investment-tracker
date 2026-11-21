import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { CHART, CHART_CURSOR_FILL, CHART_CURSOR_LINE } from '@quirenote/core/colors';

// ONE ANATOMY FOR EVERY CHART (`charts.md` § Signed › Anatomy, C2; the bar band is wave 25's,
// `open-values-charts-type.md` § Signed). What every chart shares is read from one place, so a
// chart that inlines its own tick, cursor or motion is a chart that drifts from the others.
//
// A source census over this folder: every module that draws a recharts chart is in it, so a new
// chart is caught without an edit here.
const here = dirname(fileURLToPath(import.meta.url));

/** COMMENTS STRIPPED BEFORE MATCHING: prose must not be able to pass or fail a test.
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

/** Every `<Name …>` opening tag, closed on a `>` outside any brace: a prop's arrow function
 *  carries a `>` of its own. The `\s` after the name keeps `<BarChart>` out of `<Bar`. */
function tags(source: string, name: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(new RegExp(`<${name}\\s`, 'g'))) {
    let depth = 0;
    for (let i = m.index + m[0].length; i < source.length; i++) {
      const c = source[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) {
        out.push(source.slice(m.index, i + 1));
        break;
      }
    }
  }
  return out;
}

const CHARTS = readdirSync(here)
  .filter((f) => f.endsWith('.tsx') && !/\.test\.tsx$/.test(f))
  .map((f) => ({ file: f, source: stripTs(readFileSync(join(here, f), 'utf8'), f) }))
  .filter(({ source }) => /<(?:Area|Line|Bar|Pie)Chart\b/.test(source));
const CARTESIAN = CHARTS.filter(({ source }) => /<(?:Area|Line|Bar)Chart\b/.test(source));
const SERIES_TAGS = ['Area', 'Line', 'Bar', 'Pie'];

describe('the census', () => {
  it('finds the five charts, at least', () => {
    expect(CHARTS.map((c) => c.file)).toEqual(
      expect.arrayContaining([
        'AllocationDonut.tsx',
        'BalancesArea.tsx',
        'PayoutsBars.tsx',
        'SeasonalityBars.tsx',
        'YieldLines.tsx',
      ]),
    );
    expect(CARTESIAN.length).toBeGreaterThanOrEqual(4);
  });
});

describe.each(CARTESIAN.map((c) => [c.file, c.source] as const))('%s', (_file, source) => {
  it('draws a horizontal grid only, on the hairline', () => {
    const grids = tags(source, 'CartesianGrid');
    expect(grids).toHaveLength(1);
    expect(grids[0]).toMatch(/\bvertical=\{false\}/);
    expect(grids[0]).toMatch(/\bstroke=\{CHART\.hairline\}/);
  });

  it('draws an x baseline hairline and no tick marks, with the shared tick', () => {
    const xs = tags(source, 'XAxis');
    expect(xs).toHaveLength(1);
    for (const x of xs) {
      expect(x).toMatch(/\baxisLine=\{\{\s*stroke:\s*CHART\.hairline\s*\}\}/);
      expect(x).toMatch(/\btickLine=\{false\}/);
      expect(x, 'a tick style of its own').toMatch(/\btick=\{TICK\}/);
    }
  });

  it('draws no y axis line and no tick marks, with the shared tick', () => {
    for (const y of tags(source, 'YAxis')) {
      expect(y).toMatch(/\baxisLine=\{false\}/);
      expect(y).toMatch(/\btickLine=\{false\}/);
      expect(y, 'a tick style of its own').toMatch(/\btick=\{TICK\}/);
    }
  });

  it("draws its tooltip through the shared one, never recharts' own", () => {
    expect(source, 'imports recharts’ Tooltip').not.toMatch(
      /import\s*\{[^}]*\bTooltip\b[^}]*\}\s*from\s*'recharts'/,
    );
    expect(tags(source, 'ChartTooltip')).toHaveLength(1);
  });

  // Wave 25: the 1 px line for line and area charts, the hovered category's band for bars.
  it('reads the shared cursor for its kind of chart', () => {
    const [tooltip] = tags(source, 'ChartTooltip');
    const bars = /<BarChart\b/.test(source);
    expect(tooltip).toMatch(
      bars ? /\bcursor=\{CHART_CURSOR_FILL\}/ : /\bcursor=\{CHART_CURSOR_LINE\}/,
    );
  });
});

describe.each(CHARTS.map((c) => [c.file, c.source] as const))('%s motion', (_file, source) => {
  it('takes the shared motion on every series, and sets none of its own', () => {
    const series = SERIES_TAGS.flatMap((name) => tags(source, name));
    expect(series.length, 'the chart drew no series').toBeGreaterThan(0);
    for (const tag of series) {
      expect(tag).toMatch(/\{\.\.\.CHART_MOTION\}/);
      expect(tag).not.toMatch(/\b(?:isAnimationActive|animationDuration|animationEasing)\b/);
    }
  });
});

describe('the shared cursors', () => {
  it('draw the line in `field-border` at 1 px', () => {
    expect(CHART_CURSOR_LINE).toEqual({ stroke: CHART.fieldBorder, strokeWidth: 1 });
    expect(CHART.fieldBorder).toBe('var(--color-chart-field-border)');
  });

  it('fill the bar band in `hairline`', () => {
    expect(CHART_CURSOR_FILL).toEqual({ fill: CHART.hairline });
  });
});
