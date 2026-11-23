import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// THE SEASONALITY TOOLTIP NAMES ITS ROWS FROM THE DICTIONARY. recharts prints a series'
// `dataKey` wherever the `<Bar>` carries no `name`, so the wiring is the fix, not the words.
//
// A source test: it reads the chart's source rather than mounting it, in the suite's `node`
// environment.
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
const CHART = stripTs(
  readFileSync(join(here, 'SeasonalityBars.tsx'), 'utf8'),
  'SeasonalityBars.tsx',
);

// The props of every `<Bar …>` opening tag; `\s` after the name keeps `<BarChart>` out.
const BARS = [...CHART.matchAll(/<Bar\s([^>]*)>/g)].map((m) => m[1] ?? '');

function barProps(dataKey: string): string {
  const found = BARS.filter((props) => props.includes(`dataKey="${dataKey}"`));
  expect(found, `exactly one <Bar dataKey="${dataKey}">`).toHaveLength(1);
  return found[0] ?? '';
}

describe('the Seasonality tooltip rows', () => {
  it('takes both names from the dictionary helper', () => {
    expect(CHART).toMatch(/\bconst names = seasonalitySeriesNames\(t\);/);
  });

  it('gives each <Bar> its name, so the dataKey never reaches the screen', () => {
    expect(barProps('actual')).toMatch(/\bname=\{names\.actual\}/);
    expect(barProps('expected')).toMatch(/\bname=\{names\.expected\}/);
  });

  // By value, as every chart's tooltip is (`charts.md` § Signed › Anatomy, Tooltip): the shared
  // tooltip sorts, so a sorter of its own would put the translated names or the keys back in charge.
  it('orders the rows by value, through the shared tooltip', () => {
    expect(CHART).toMatch(/<ChartTooltip\s/);
    expect(CHART).not.toMatch(/\bitemSorter=/);
  });

  // Wave 27: the asset rows extend the shared content, so no chart grows a tooltip of its own.
  it('hands each series’ assets and the counted noun to the shared tooltip', () => {
    expect(CHART).toMatch(/\bparts=\{\{\s*of: partsOf, more: t\.importing\.count\.assets\s*\}\}/);
  });
});

// `charts.md` § Signed › Identity: one colour, `accent`, for every bar; colouring a day by its
// dominant asset is rejected as colour-only identity (§ Rejected).
describe('the Seasonality paint', () => {
  it('paints both series in the accent', () => {
    expect(barProps('actual')).toMatch(/\bfill=\{CHART\.accent\}/);
    expect(barProps('expected')).toMatch(/\bfill=\{CHART\.accent\}/);
  });

  it('reads no asset colour anywhere in the chart', () => {
    expect(CHART).not.toMatch(/\bSERIES\b/);
    expect(CHART).not.toMatch(/colorKey/i);
    expect(CHART).not.toMatch(/\bkeyColor\b/);
  });
});
