import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// THE SEASONALITY TOOLTIP NAMES ITS ROWS FROM THE DICTIONARY. recharts prints a series'
// `dataKey` wherever the `<Bar>` carries no `name`, so the wiring is the fix, not the words.
//
// A source test: the suite is `environment: 'node'` with no jsdom, so there is no way to
// mount the chart here.
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

  it('orders the rows by key, not by the translated name', () => {
    expect(CHART).toMatch(/<Tooltip\s[^>]*\bitemSorter="dataKey"/);
  });
});
