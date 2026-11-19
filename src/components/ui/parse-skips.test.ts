import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// H2 (controls.md § Signed): the import's `warn` disclosure hovers with the ghost's `ink` 5 % veil
// on a padded box, pulled back so its text keeps the edge of the lines around it, and never fades.
const here = dirname(fileURLToPath(import.meta.url));
/** Comments cut, so a sentence about a prop cannot answer for the prop. The canonical reader,
 *  copied whole as the house idiom has it (`ts-reader-census.test.ts`). */
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
const SRC = stripTs(readFileSync(join(here, 'ParseSkips.tsx'), 'utf8'), 'ParseSkips.tsx');

/** The class list of the `<button>` whose children hold `marker`, bounded by that element. */
function classOf(marker: string): string[] {
  const at = SRC.indexOf(marker);
  expect(at, `${marker} is not in ParseSkips.tsx`).toBeGreaterThan(-1);
  const own = [...SRC.slice(SRC.lastIndexOf('<button', at), at).matchAll(/className="([^"]*)"/g)];
  expect(own, `no className between <button and ${marker}`).not.toHaveLength(0);
  return own.at(-1)![1].split(/\s+/);
}

describe('the import’s skipped-lines disclosure', () => {
  const cls = classOf('t.parse.failed(count)');

  it('hovers with the ink veil and never fades', () => {
    expect(cls).toContain('hover:bg-ink/5');
    expect(cls.filter((c) => /^hover:!?opacity-/.test(c))).toEqual([]);
  });

  // 10 px aside and 4 px above and below: `text-small`'s 16 px line makes 24, r round(24 × .26).
  // Pulled back on BOTH sides: Settings sets it right-aligned, where a left pull-back alone
  // would move the text in by the right padding.
  // The label wraps at 360; a wrapped label keeps the one-line radius at every width (*Shape system*).
  it('draws a padded box at its shape radius, pulled back by its padding on both sides', () => {
    expect(cls).toEqual(expect.arrayContaining(['px-2.5', 'py-1', '-mx-2.5', 'rounded-[6px]']));
    expect(cls.filter((c) => c.includes('rounded-'))).toEqual(['rounded-[6px]']);
  });

  it('keeps its type and colour', () => {
    expect(cls).toEqual(
      expect.arrayContaining(['text-small', 'text-warn', 'underline', 'underline-offset-2']),
    );
  });
});
