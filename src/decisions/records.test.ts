import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readDecisions, validateDecisions } from './records';
import type { DecisionRecord } from './records';

function record(over: Partial<DecisionRecord> & { id: string; num: number }): DecisionRecord {
  return { date: '2026-01-01', summary: 'summary', amends: [], ...over };
}

/** Hand-builds fixture front matter — this codec has no writer (front
 *  matter is hand-authored, never generated), so tests build it directly. */
function writeFixture(
  dir: string,
  filename: string,
  fm: { id: string; date: string; summary: string },
): void {
  writeFileSync(
    join(dir, filename),
    `---\r\nid: ${fm.id}\r\ndate: ${fm.date}\r\nsummary: "${fm.summary}"\r\n---\r\n\r\n> body\r\n`,
  );
}

describe('validateDecisions', () => {
  it('passes a clean set through with no problems', () => {
    const records = [record({ id: 'D1', num: 1 }), record({ id: 'D2', num: 2, amends: ['D1'] })];
    expect(validateDecisions(records)).toEqual([]);
  });

  it('flags a decision that amends itself', () => {
    const records = [record({ id: 'D1', num: 1, amends: ['D1'] })];
    expect(validateDecisions(records)).toEqual([{ id: 'D1', problem: 'amends itself (D1)' }]);
  });

  it('flags an amends target with no file', () => {
    const records = [record({ id: 'D2', num: 2, amends: ['D99'] })];
    expect(validateDecisions(records)).toEqual([
      { id: 'D2', problem: 'amends D99, which has no file' },
    ]);
  });
});

describe('readDecisions', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('exercises the `dir` parameter: reads and sorts a small fixture directory by numeric id', () => {
    dir = mkdtempSync(join(tmpdir(), 'decisions-test-'));
    writeFixture(dir, 'D10.md', { id: 'D10', date: '2026-01-10', summary: 's10' });
    writeFixture(dir, 'D2.md', { id: 'D2', date: '2026-01-02', summary: 's2' });
    writeFixture(dir, 'D1.md', { id: 'D1', date: '2026-01-01', summary: 's1' });

    const records = readDecisions(dir);
    expect(records.map((r) => r.id)).toEqual(['D1', 'D2', 'D10']); // sorted numerically, not lexically
    expect(records.map((r) => r.num)).toEqual([1, 2, 10]);
    expect(records[1]).toMatchObject({ id: 'D2', date: '2026-01-02', summary: 's2' });
  });

  it('throws, naming the file, when a filename and its own front-matter id disagree', () => {
    dir = mkdtempSync(join(tmpdir(), 'decisions-test-'));
    writeFixture(dir, 'D2.md', { id: 'D3', date: '2026-01-01', summary: 's' }); // mismatch

    expect(() => readDecisions(dir)).toThrow(/D2\.md.*does not match the filename/);
  });

  it('reports the file path — not a bare message — when a file fails to parse', () => {
    dir = mkdtempSync(join(tmpdir(), 'decisions-test-'));
    writeFileSync(join(dir, 'D1.md'), 'no front matter here\r\n');

    expect(() => readDecisions(dir)).toThrow(/D1\.md: no front matter block found/);
  });
});
