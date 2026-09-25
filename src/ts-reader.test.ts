import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPO, skipped } from './repo-root';

// THE READER THE SOURCE GUARDS COPY, save the reads the census exempts: held to the shapes a hand
// lexer or a carelessly set-up parse gets wrong, and swept over the tree.
// `ts-reader-census.test.ts` pins every copy in the suite to the text of this one.

/** Comments out, every line break kept, READ THROUGH TYPESCRIPT'S OWN PARSER: whether a `/` opens
 *  a regex, and whether a `}` resumes a template, is decided by the syntactic context (ECMA-262
 *  §12), so no lexer short of a parse can be exact. `file` gives the script kind by its extension,
 *  as it does for tsc: `<T>(x: T) => x` is a generic in `.ts` and an element in `.tsx`. A parse
 *  error throws rather than being misread, but a source that parses as the wrong kind is read as
 *  that kind, so each guard passes the name of the file it read. */
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

// Exact output: a cut comment leaves the space before it.
const CASES: [name: string, file: string, input: string, output: string][] = [
  [
    'a comment on the line that closes a template',
    'x.ts',
    'client.query(`\n  SELECT $1\n`, [a, // was a, b\n]);',
    'client.query(`\n  SELECT $1\n`, [a, \n]);',
  ],
  [
    'a `//` on a template continuation line',
    'x.ts',
    'const s = `\n  see https://quirenote.com today\n`;',
    'const s = `\n  see https://quirenote.com today\n`;',
  ],
  [
    'a regex holding a quote and `//`',
    'x.ts',
    'const r = /"\\/\\//g; // tail',
    'const r = /"\\/\\//g; ',
  ],
  [
    'a regex holding a backtick, with a comment on a later line',
    'x.ts',
    'const r = /`/;\nconst x = 1; // next',
    'const r = /`/;\nconst x = 1; ',
  ],
  [
    'a nested template holding `//`',
    'x.ts',
    'const s = `a ${`b // c`} d`; // tail',
    'const s = `a ${`b // c`} d`; ',
  ],
  [
    'a comment inside a substitution',
    'x.ts',
    'const v = `x ${/* c */ 1}`;',
    'const v = `x ${ 1}`;',
  ],
  [
    'JSX text holding `//`, which is text',
    'x.tsx',
    'const e = <p>// see https://quirenote.com</p>; // tail',
    'const e = <p>// see https://quirenote.com</p>; ',
  ],
  [
    'a comment opener in a string',
    'x.ts',
    'const s = "/*"; const t = 1; // tail',
    'const s = "/*"; const t = 1; ',
  ],
  ['a division beside a comment', 'x.ts', 'const a = b / c; // x / y', 'const a = b / c; '],
  [
    'a block comment across lines',
    'x.ts',
    'const a = 1; /* start\n middle\n end */ const b = 2;',
    'const a = 1; \n\n const b = 2;',
  ],
  [
    'a JSDoc block holding `//`',
    'x.ts',
    '/** @type {{ a: 1, // y\n  b: 2 }} */\nconst a = 1;',
    '\n\nconst a = 1;',
  ],
  [
    'a generic arrow in a `.ts` file, before a later comment',
    'x.ts',
    'const id = <T>(x: T): T => x;\nconst n = 1; // next',
    'const id = <T>(x: T): T => x;\nconst n = 1; ',
  ],
  ['a CRLF line break after a comment', 'x.ts', 'a; // c\r\nb;', 'a; \r\nb;'],
];

describe('the reader', () => {
  it.each(CASES)('is exact on %s', (_name, file, input, output) => {
    expect(stripTs(input, file)).toBe(output);
  });

  // A source that does not parse as the kind its name gives can have its comments misread; a
  // throw is the one answer that cannot pass for a reading.
  it('refuses a source that does not parse as the kind its name gives', () => {
    expect(() => stripTs('const e = <p>hi</p>;', 'x.ts')).toThrow(/x\.ts does not parse/);
  });
});

const walk = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) return skipped(e.name) ? [] : walk(rel);
    return /\.([cm]?tsx?|mjs)$/.test(e.name) ? [rel] : [];
  });
// The whole repository, skipping what the census skips: its TypeScript, and the `.mjs` scripts a
// guard also reads.
const FILES = walk('');
const OPTIONS = {
  languageVersion: ts.ScriptTarget.Latest,
  jsDocParsingMode: ts.JSDocParsingMode.ParseNone,
};

/** Every token in source order. The text between two of them is trivia, and trivia is where a
 *  comment lives. */
function tokensOf(sf: ts.SourceFile): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isTokenKind(n.kind)) out.push(n);
    else n.getChildren(sf).forEach(visit);
  };
  visit(sf);
  return out;
}

// EVERY TYPESCRIPT MODULE, AND THE `.mjs` SCRIPTS, checked three ways. Each check takes a parsed
// file, never text: the raw text goes only to the reader and the parser, the two routes the census
// trusts.
describe('the reader over the tree', () => {
  it('keeps the line count and every token, and leaves no comment', () => {
    expect(FILES.length, 'the walk found almost nothing').toBeGreaterThanOrEqual(200);
    const wrong: string[] = [];
    for (const rel of FILES) {
      const raw = readFileSync(join(REPO, rel), 'utf8');
      const before = ts.createSourceFile(rel, raw, OPTIONS, true);
      const after = ts.createSourceFile(rel, stripTs(raw, rel), OPTIONS, true);
      if (after.getLineStarts().length !== before.getLineStarts().length) {
        wrong.push(`${rel}: the line count changed`);
      }
      const tokens = tokensOf(after);
      // The gap before a token is its trivia: whitespace only, once the comments are out.
      const left = tokens.find((t) =>
        /\S/.test(t.getFullText(after).slice(0, t.getStart(after) - t.pos)),
      );
      if (left)
        wrong.push(
          `${rel}:${after.getLineAndCharacterOfPosition(left.pos).line + 1}: a comment is left`,
        );
      // And nothing else moved: the tokens read the same, so no code was cut with a comment.
      const was = tokensOf(before);
      const is = tokens.map((t) => t.getText(after));
      const at = was.findIndex((t, i) => t.getText(before) !== is[i]);
      if (at !== -1 || was.length !== is.length) {
        const t = was[at === -1 ? was.length - 1 : at];
        const line = before.getLineAndCharacterOfPosition(t.getStart(before)).line + 1;
        wrong.push(`${rel}:${line}: a token changed`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
