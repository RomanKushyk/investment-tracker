import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { docLineCounts, lineCount, LIMIT } from './doc-line-counts';

describe('lineCount', () => {
  function withScratchFile<T>(content: string, run: (path: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'line-count-test-'));
    const path = join(dir, 'f.md');
    writeFileSync(path, content);
    try {
      return run(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('counts newlines, `wc -l` semantics — a trailing newline is not an extra line', () => {
    withScratchFile('a\nb\nc\n', (path) => expect(lineCount(path)).toBe(3));
  });

  it('does not count a final line with no trailing newline', () => {
    withScratchFile('a\nb\nc', (path) => expect(lineCount(path)).toBe(2));
  });

  it('reads 0 for an empty file', () => {
    withScratchFile('', (path) => expect(lineCount(path)).toBe(0));
  });

  it('counts the same for a CRLF file and its LF twin — CI checks the LF blob out regardless of a Windows working tree', () => {
    const lf = 'a\nb\nc\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    withScratchFile(lf, (lfPath) => {
      withScratchFile(crlf, (crlfPath) => {
        expect(lineCount(crlfPath)).toBe(lineCount(lfPath));
      });
    });
  });

  it('names the file in the thrown error rather than a bare fs error', () => {
    const missing = join(tmpdir(), 'definitely-does-not-exist-line-count.md');
    expect(() => lineCount(missing)).toThrow(missing);
  });
});

describe('docLineCounts', () => {
  /** A fresh scratch tree per test, with a nested subdirectory — the shape
   *  needed to actually exercise the Windows path-separator normalisation,
   *  which a flat `CLAUDE.md`-only fixture never touches. */
  function withScratchTree<T>(run: (root: string, nestedFile: string) => T): T {
    const root = mkdtempSync(join(tmpdir(), 'doc-line-counts-test-'));
    const nestedDir = join(root, 'docs', 'plans');
    mkdirSync(nestedDir, { recursive: true });
    const nestedFile = join(nestedDir, 'long.md');
    try {
      return run(root, nestedFile);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  function linesOf(n: number): string {
    return Array.from({ length: n }, (_, i) => `line ${i}`).join('\n') + '\n';
  }

  it(`excludes a file at exactly ${LIMIT} lines`, () => {
    withScratchTree((root, nestedFile) => {
      writeFileSync(nestedFile, linesOf(LIMIT));
      expect(docLineCounts([nestedFile], root)).toEqual({});
    });
  });

  it(`includes a file over ${LIMIT} lines, keyed relative to the given root, forward-slashed`, () => {
    withScratchTree((root, nestedFile) => {
      writeFileSync(nestedFile, linesOf(LIMIT + 1));
      const counts = docLineCounts([nestedFile], root);
      expect(counts).toEqual({ 'docs/plans/long.md': LIMIT + 1 });
      expect(Object.keys(counts)[0]).not.toContain('\\');
    });
  });

  it('reports only the over-limit files out of a mixed list', () => {
    withScratchTree((root, nestedFile) => {
      const shortFile = join(root, 'short.md');
      writeFileSync(shortFile, linesOf(5));
      writeFileSync(nestedFile, linesOf(LIMIT + 10));
      const counts = docLineCounts([shortFile, nestedFile], root);
      expect(counts).toEqual({ 'docs/plans/long.md': LIMIT + 10 });
    });
  });

  it('returns empty for an empty file list — a silent walk-nothing bug would look identical to "nothing is over the limit" without this', () => {
    expect(docLineCounts([])).toEqual({});
  });
});
