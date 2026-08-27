import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { authoredLines, countLines, docLineCounts, lineCount, LIMIT } from './doc-line-counts';
import { REPO } from '../facts/markdown-files';

describe('authoredLines', () => {
  // D102: a generated row is data, not a purpose, so it does not count against
  // the length diagnostic. The markers do — a person put them there.
  const OPEN = '<!-- decisions:rows range="1-20" -->';
  const CLOSE = '<!-- /decisions:rows -->';

  it('equals the raw count when nothing is generated', () => {
    const text = 'a\nb\nc\n';
    expect(authoredLines(text)).toBe(countLines(text));
  });

  it('subtracts the rows between markers and keeps the markers', () => {
    const text = ['intro', OPEN, 'row 1', 'row 2', 'row 3', CLOSE, 'outro', ''].join('\n');
    // intro + OPEN + CLOSE + outro
    expect(authoredLines(text)).toBe(4);
    expect(countLines(text)).toBe(7);
  });

  it('does not shrink when the generated block grows — the point of the whole change', () => {
    const withRows = (n: number) =>
      ['intro', OPEN, ...Array.from({ length: n }, (_, i) => `row ${i}`), CLOSE, ''].join('\n');
    expect(authoredLines(withRows(3))).toBe(authoredLines(withRows(3000)));
  });

  it('reads a marker inside a fenced code block as documentation, not a live region', () => {
    // `docs/decisions/RULES.md` documents the syntax in prose. Counting that
    // example as an opener would swallow the rest of the file.
    const text = ['```', OPEN, 'EXAMPLE', CLOSE, '```', 'still authored', ''].join('\n');
    expect(authoredLines(text)).toBe(countLines(text));
  });

  it('falls back to the raw count when an opener is never closed', () => {
    // A length check that silently under-reports is the failure this module
    // exists to prevent, so an unbalanced file counts as if nothing were
    // generated rather than as a short one.
    const text = ['intro', OPEN, 'row', 'row', ''].join('\n');
    expect(authoredLines(text)).toBe(countLines(text));
  });

  it('never throws on an unbalanced code fence, and never under-reports', () => {
    // This was a real regression: `codeRanges` throws on a stray fence, and
    // calling it unconditionally took `docLineCounts` — and with it
    // `pnpm distillation-baseline`, the one command that repairs the ratchet —
    // down for the WHOLE repo over one stray ``` in one document.
    const stray = ['intro', '```', 'code', 'more', ''].join('\n');
    expect(() => authoredLines(stray)).not.toThrow();
    expect(authoredLines(stray)).toBe(countLines(stray));

    // And with a marker present, so the cheap reject does not hide it.
    const both = ['```', 'unclosed', OPEN, 'row', CLOSE, ''].join('\n');
    expect(() => authoredLines(both)).not.toThrow();
    expect(authoredLines(both)).toBe(countLines(both));
  });

  it('resolves every malformed shape to the RAW count, never a shorter one', () => {
    // A length check that under-reports is the failure this module exists to
    // prevent; loudness is `render.ts`'s job, which throws on these shapes.
    const unclosed = ['intro', OPEN, 'row', 'row', ''].join('\n');
    const twoOpens = ['intro', OPEN, 'row', OPEN, 'row', CLOSE, ''].join('\n');
    for (const text of [unclosed, twoOpens]) {
      expect(authoredLines(text)).toBe(countLines(text));
    }
    // An orphan closer has nothing to subtract, so the raw count IS the
    // authored count — pinned so the behaviour is chosen rather than incidental.
    const orphan = ['intro', CLOSE, 'outro', ''].join('\n');
    expect(authoredLines(orphan)).toBe(countLines(orphan));
  });

  it('sees a marker exactly where `spliceGeneratedRows` sees one', () => {
    // The counter and the generator must agree about which regions exist, or
    // the index quietly re-enters the ratchet. A mid-line opener is one
    // `spliceGeneratedRows` matches, so it is one this subtracts.
    const midLine = ['intro', `See ${OPEN}`, 'row', CLOSE, ''].join('\n');
    expect(authoredLines(midLine)).toBe(countLines(midLine) - 1);
  });

  it('counts the real decision index as well under the limit', () => {
    // The file that forced D102: ~130 raw lines, ~30 authored.
    const readme = readFileSync(join(REPO, 'docs/decisions/README.md'), 'utf8');
    expect(countLines(readme)).toBeGreaterThan(100);
    expect(authoredLines(readme)).toBeLessThan(LIMIT);
  });
});

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
