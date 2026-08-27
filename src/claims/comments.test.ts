import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPO } from '../facts/markdown-files';
import { commentRanges } from './comments';

function commentsOf(text: string, fileName = 'x.ts'): string[] {
  return commentRanges(text, fileName).map((r) => text.slice(r.start, r.end));
}

describe('commentRanges', () => {
  it('finds a // line comment, up to the newline', () => {
    expect(commentsOf('const x = 1; // hello\nconst y = 2;')).toEqual(['// hello']);
  });

  it('finds a /* */ block comment, including a multi-line one', () => {
    expect(commentsOf('/* a\nb */\nconst x = 1;')).toEqual(['/* a\nb */']);
  });

  it('finds a JSDoc comment as a block comment', () => {
    expect(commentsOf('/** does a thing */\nfunction f() {}')).toEqual(['/** does a thing */']);
  });

  it('does NOT treat a // inside a single-quoted string as a comment', () => {
    const text = "const url = 'https://example.com/x'; // real comment";
    expect(commentsOf(text)).toEqual(['// real comment']);
  });

  it('does NOT treat a // inside a double-quoted string as a comment', () => {
    const text = 'const url = "https://example.com/x"; // real comment';
    expect(commentsOf(text)).toEqual(['// real comment']);
  });

  it('does NOT treat a // inside a template literal as a comment', () => {
    const text = 'const url = `https://example.com/${x}`; // real comment';
    expect(commentsOf(text)).toEqual(['// real comment']);
  });

  it('does NOT treat a /* inside a string as opening a block comment', () => {
    const text = "const s = '/* not a comment */ still string'; // real";
    expect(commentsOf(text)).toEqual(['// real']);
  });

  it('a nested-looking // inside a /* */ block does not end it early', () => {
    const text = '/* line one // still comment\nline two */\ncode();';
    expect(commentsOf(text)).toEqual(['/* line one // still comment\nline two */']);
  });

  it('a /* inside a // line comment does not open a block comment', () => {
    const text = '// see /* this */ later\ncode();';
    expect(commentsOf(text)).toEqual(['// see /* this */ later']);
  });

  it('handles an escaped quote inside a string without ending it early', () => {
    const text = String.raw`const s = 'it\'s // not a comment'; // real`;
    expect(commentsOf(text)).toEqual(['// real']);
  });

  it('a trailing comment with nothing lexical after it is still found (EOF token trivia)', () => {
    expect(commentsOf('code();\n// trailing, nothing follows')).toEqual([
      '// trailing, nothing follows',
    ]);
  });

  it('returns no ranges for a file with no comments at all', () => {
    expect(commentsOf("const s = 'no comments here';")).toEqual([]);
  });

  // The two review-reproduced defects of the hand-rolled predecessor this
  // module replaced — both resolved by using TypeScript's own parser, which
  // settles the regex-vs-division ambiguity as part of real parsing.

  it('a quote INSIDE a regex literal does not desynchronise string tracking', () => {
    // The exact review reproduction: a `/[",\r\n]/` regex literal's quote
    // character used to be read as opening a string, silently swallowing
    // every comment after it on the file.
    const text = String.raw`
function csvField(value) {
  return /[",\r\n]/.test(value) ? value : value; // real comment after the regex
}
`;
    expect(commentsOf(text)).toEqual(['// real comment after the regex']);
  });

  it('two adjacent slashes from a regex literal are not read as a line comment', () => {
    // The exact review reproduction: `.replace(/\/\*[\s\S]*?\*\//g, '')`
    // contains a real `//` sequence (escaped slashes back to back) that a
    // hand-rolled scanner reads as a line-comment opener, hiding the rest
    // of that CODE line as if it were prose.
    const text = String.raw`
const stripped = s.replace(/\/\*[\s\S]*?\*\//g, ''); // real trailing comment
`;
    expect(commentsOf(text)).toEqual(['// real trailing comment']);
  });

  it('picks TS vs TSX parsing from the filename — an angle-bracket cast is valid only in .ts', () => {
    const text = 'const n = <number>value; // real comment';
    expect(commentsOf(text, 'x.ts')).toEqual(['// real comment']);
    // The other half of the same proof: a hard-coded ".ts" scriptKind for
    // every file would leave the assertion above green even after a
    // regression, since it would never actually exercise TSX parsing. The
    // identical text is genuinely ambiguous with JSX in a .tsx file, so
    // asserting it now THROWS is what proves the filename's extension is
    // real, not decorative.
    expect(() => commentsOf(text, 'x.tsx')).toThrow();
  });

  // Proof against the real file the review named: the hand-rolled
  // predecessor's quote-tracking desynchronised at line 77's regex literal
  // and everything after it went dark. Asserting specific comment text
  // from BEFORE and, decisively, from AFTER that line proves the fix
  // rather than re-deriving the same walk the function under test uses.
  it('finds real comments in src/core/backup/csv.ts on both sides of the line-77 regex literal', () => {
    const path = `${REPO}/src/core/backup/csv.ts`;
    const text = readFileSync(path, 'utf8');
    const found = commentRanges(text, path).map((r) => text.slice(r.start, r.end));
    const joined = found.join('\n');
    expect(joined).toContain('RFC 4180 writer');
    expect(joined).toContain('WIDE: `date,cash,<Asset name (id)>');
    expect(found.length).toBeGreaterThan(30);
  });
});
