import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// THE PAGE HOLDS NO ACCESS TOKEN, so it calls nothing that takes one: the account's passkeys go
// through the relay (*Auth model*). Comments are cut, so a sentence naming the endpoint is no call.
const src = join(dirname(fileURLToPath(import.meta.url)), '..');
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

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
const files = walk(src);
const named = (file: string) => relative(src, file).replace(/\\/g, '/');

// SPLIT, or this file would be the first to name what it looks for.
const ENDPOINT = ['cognito' + '-idp', 'amazon' + 'aws.com'];

describe('the page and Cognito’s endpoint', () => {
  it('reads every source under src/, so an empty walk cannot pass', () => {
    expect(files.length).toBeGreaterThan(150);
    expect(files.map(named)).toContain('auth/passkey.ts');
  });

  it('names the endpoint in no code under src/', () => {
    const calling = files.filter((file) => {
      const code = stripTs(readFileSync(file, 'utf8'), named(file));
      return ENDPOINT.some((part) => code.includes(part));
    });
    expect(calling.map(named)).toEqual([]);
  });
});
