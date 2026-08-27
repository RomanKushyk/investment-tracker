import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  diffBaseline,
  loadBaseline,
  serializeBaseline,
  type DistillationBaseline,
} from './baseline';

/** Writes `content` to a fresh scratch file and hands its path to `run`,
 *  deleting the file afterward regardless of outcome — same helper shape
 *  as `src/claims/baseline.test.ts`'s own `withScratchFile`. */
function withScratchFile<T>(content: string, run: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'distillation-baseline-test-'));
  const path = join(dir, 'distillation-baseline.json');
  writeFileSync(path, content);
  try {
    return run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const EMPTY: DistillationBaseline = {
  repeatedSentences: {},
  commentChars: {},
  historyPhrases: {},
};

describe('loadBaseline', () => {
  it('returns three empty sections when the file does not exist', () => {
    expect(loadBaseline(join(tmpdir(), 'definitely-does-not-exist.json'))).toEqual(EMPTY);
  });

  it('loads a well-formed baseline as-is', () => {
    withScratchFile(
      '{"repeatedSentences": {"a.md": 3}, "commentChars": {"b.ts": 40}, "historyPhrases": {}}',
      (path) => {
        expect(loadBaseline(path)).toEqual({
          repeatedSentences: { 'a.md': 3 },
          commentChars: { 'b.ts': 40 },
          historyPhrases: {},
        });
      },
    );
  });

  it('treats a missing section as empty rather than throwing', () => {
    withScratchFile('{"commentChars": {"b.ts": 40}}', (path) => {
      expect(loadBaseline(path)).toEqual({
        repeatedSentences: {},
        commentChars: { 'b.ts': 40 },
        historyPhrases: {},
      });
    });
  });

  it('THROWS on a non-integer count — silently allowing it disables that entry’s ratchet forever', () => {
    withScratchFile('{"repeatedSentences": {"a.md": "many"}}', (path) => {
      expect(() => loadBaseline(path)).toThrow(/"repeatedSentences\.a\.md".*non-negative integer/);
    });
  });

  it('THROWS on a negative count', () => {
    withScratchFile('{"commentChars": {"a.ts": -1}}', (path) => {
      expect(() => loadBaseline(path)).toThrow(/non-negative integer/);
    });
  });

  it('THROWS when the top level is not a plain object', () => {
    withScratchFile('[1, 2, 3]', (path) => {
      expect(() => loadBaseline(path)).toThrow(/expected a JSON object/);
    });
  });

  it('THROWS when a section is not a plain object', () => {
    withScratchFile('{"repeatedSentences": [1, 2]}', (path) => {
      expect(() => loadBaseline(path)).toThrow(/"repeatedSentences".*must be a JSON object/);
    });
  });
});

describe('serializeBaseline', () => {
  it('sorts keys within each section regardless of input order', () => {
    const out = serializeBaseline({
      repeatedSentences: { 'z.md': 1, 'a.md': 2 },
      commentChars: {},
      historyPhrases: {},
    });
    expect(out.indexOf('"a.md"')).toBeLessThan(out.indexOf('"z.md"'));
  });

  it('orders the three sections consistently regardless of input key order', () => {
    const out = serializeBaseline({
      historyPhrases: { 'h.md': 1 },
      commentChars: { 'd.ts': 1 },
      repeatedSentences: { 'r.md': 1 },
    } as DistillationBaseline);
    expect(out.indexOf('"repeatedSentences"')).toBeLessThan(out.indexOf('"commentChars"'));
    expect(out.indexOf('"commentChars"')).toBeLessThan(out.indexOf('"historyPhrases"'));
  });

  it('is deterministic: same input, byte-identical output, twice', () => {
    const b: DistillationBaseline = {
      repeatedSentences: { 'b.md': 3 },
      commentChars: { 'a.ts': 40 },
      historyPhrases: {},
    };
    expect(serializeBaseline(b)).toBe(serializeBaseline({ ...b }));
  });

  it('ends with exactly one trailing newline, 2-space indent', () => {
    const out = serializeBaseline({
      repeatedSentences: { 'a.md': 1 },
      commentChars: {},
      historyPhrases: {},
    });
    expect(out).toBe(
      '{\n  "repeatedSentences": {\n    "a.md": 1\n  },\n  "commentChars": {},\n  "historyPhrases": {}\n}\n',
    );
  });
});

describe('diffBaseline', () => {
  it('is silent when all three sections agree', () => {
    const b: DistillationBaseline = {
      repeatedSentences: { 'a.md': 2 },
      commentChars: { 'b.ts': 40 },
      historyPhrases: {},
    };
    const diff = diffBaseline(b, b);
    expect(diff.repeatedSentences).toEqual({ over: [], stale: [] });
    expect(diff.commentChars).toEqual({ over: [], stale: [] });
    expect(diff.historyPhrases).toEqual({ over: [], stale: [] });
  });

  it('flags a file over its comment-volume baseline as `over`, independent of the other two sections', () => {
    const diff = diffBaseline(
      { ...EMPTY, commentChars: { 'a.ts': 40 } },
      { ...EMPTY, commentChars: { 'a.ts': 55 } },
    );
    expect(diff.commentChars.over).toEqual([{ file: 'a.ts', baseline: 40, actual: 55 }]);
    expect(diff.repeatedSentences.over).toEqual([]);
  });

  it('flags a file below its repeated-sentences baseline as `stale`', () => {
    const diff = diffBaseline(
      { ...EMPTY, repeatedSentences: { 'a.md': 5 } },
      { ...EMPTY, repeatedSentences: { 'a.md': 2 } },
    );
    expect(diff.repeatedSentences.stale).toEqual([{ file: 'a.md', baseline: 5, actual: 2 }]);
  });

  it('flags a new history-phrase file with no prior baseline entry as `over`', () => {
    const diff = diffBaseline(EMPTY, { ...EMPTY, historyPhrases: { 'new.ts': 1 } });
    expect(diff.historyPhrases.over).toEqual([{ file: 'new.ts', baseline: 0, actual: 1 }]);
  });
});
