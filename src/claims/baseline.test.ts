import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Claim } from './scan';
import { countsFromClaims, diffBaseline, loadBaseline, serializeBaseline } from './baseline';

function claim(file: string, line: number, unchecked = false): Claim {
  return { file, line, rule: 3, match: 'x', unchecked };
}

/** Writes `content` to a fresh scratch file and hands its path to `run`,
 *  deleting the file afterward regardless of outcome. */
function withScratchFile<T>(content: string, run: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'claim-baseline-test-'));
  const path = join(dir, 'claim-baseline.json');
  writeFileSync(path, content);
  try {
    return run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('loadBaseline', () => {
  it('returns an empty baseline when the file does not exist', () => {
    expect(loadBaseline(join(tmpdir(), 'definitely-does-not-exist.json'))).toEqual({});
  });

  it('loads a well-formed baseline as-is', () => {
    withScratchFile('{"a.md": 3, "b.sql": 0}', (path) => {
      expect(loadBaseline(path)).toEqual({ 'a.md': 3, 'b.sql': 0 });
    });
  });

  it("THROWS on a non-integer count — silently allowing it disables that file's ratchet forever", () => {
    // NaN compares false against everything, so an un-validated "many"
    // would make diffBaseline report neither over nor stale, ever.
    withScratchFile('{"a.md": "many"}', (path) => {
      expect(() => loadBaseline(path)).toThrow(/"a\.md".*non-negative integer/);
    });
  });

  it('THROWS on a negative count', () => {
    withScratchFile('{"a.md": -1}', (path) => {
      expect(() => loadBaseline(path)).toThrow(/non-negative integer/);
    });
  });

  it('THROWS when the top level is not a plain object', () => {
    withScratchFile('[1, 2, 3]', (path) => {
      expect(() => loadBaseline(path)).toThrow(/expected a JSON object/);
    });
  });
});

describe('countsFromClaims', () => {
  it('counts non-unchecked claims per file, omitting files with zero', () => {
    const claims = [claim('a.md', 1), claim('a.md', 2), claim('b.md', 1, true)];
    expect(countsFromClaims(claims)).toEqual({ 'a.md': 2 });
  });

  it('an all-unchecked file has no entry at all', () => {
    expect(countsFromClaims([claim('a.md', 1, true)])).toEqual({});
  });
});

describe('serializeBaseline', () => {
  it('sorts keys regardless of input order', () => {
    const out = serializeBaseline({ 'z.md': 1, 'a.md': 2 });
    expect(out.indexOf('"a.md"')).toBeLessThan(out.indexOf('"z.md"'));
  });

  it('is deterministic: same input, byte-identical output, twice', () => {
    const counts = { 'b.md': 3, 'a.sql': 1 };
    expect(serializeBaseline(counts)).toBe(serializeBaseline({ ...counts }));
  });

  it('ends with exactly one trailing newline, 2-space indent', () => {
    const out = serializeBaseline({ 'a.md': 1 });
    expect(out).toBe('{\n  "a.md": 1\n}\n');
  });
});

describe('diffBaseline', () => {
  it('is silent when baseline and actual agree', () => {
    const diff = diffBaseline({ 'a.md': 2 }, { 'a.md': 2 });
    expect(diff).toEqual({ over: [], stale: [] });
  });

  it('flags a file whose live count exceeds its baseline as `over`', () => {
    const diff = diffBaseline({ 'a.md': 2 }, { 'a.md': 3 });
    expect(diff.over).toEqual([{ file: 'a.md', baseline: 2, actual: 3 }]);
    expect(diff.stale).toEqual([]);
  });

  it('flags a file whose live count is BELOW its baseline as `stale`', () => {
    const diff = diffBaseline({ 'a.md': 3 }, { 'a.md': 2 });
    expect(diff.stale).toEqual([{ file: 'a.md', baseline: 3, actual: 2 }]);
    expect(diff.over).toEqual([]);
  });

  it('a brand-new file with claims and no prior baseline entry is `over`', () => {
    const diff = diffBaseline({}, { 'new.md': 1 });
    expect(diff.over).toEqual([{ file: 'new.md', baseline: 0, actual: 1 }]);
  });

  it('a baseline entry for a file that no longer has any claims is `stale`', () => {
    const diff = diffBaseline({ 'gone.md': 5 }, {});
    expect(diff.stale).toEqual([{ file: 'gone.md', baseline: 5, actual: 0 }]);
  });
});
