import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// THE SHELL ASKS FOR THE SESSION ON EVERY PORTFOLIO LOAD, AND AGAIN ON EACH ROUTE UNTIL THE RELAY
// ANSWERS (`design/extensions/sign-out.dc.html`): the session half — `restore` asking nothing once
// answered — is `session.test.ts`'s; this holds the half no unit test can reach.
const here = dirname(fileURLToPath(import.meta.url));
/** Comments cut, so a sentence about the effect cannot answer for the effect. The canonical
 *  reader, copied whole as the house idiom has it (`ts-reader-census.test.ts`). */
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
const read = (rel: string) => stripTs(readFileSync(join(here, rel), 'utf8'), rel);

describe('the portfolio shell and the session', () => {
  it('asks on mount and again on each route, which is free once the relay has answered', () => {
    expect(read('app/Layout.tsx'), 'the shell no longer asks per route').toMatch(
      /useEffect\(\(\) => \{\s*void session\.restore\(\);\s*\}, \[pathname\]\);/,
    );
  });

  it('is asked on `/sign-in` too, which the shell does not mount', () => {
    expect(read('screens/sign-in/SignIn.tsx'), '`/sign-in` no longer asks').toMatch(
      /useEffect\(\(\) => \{\s*void session\.restore\(\);\s*\}, \[\]\);/,
    );
  });
});
