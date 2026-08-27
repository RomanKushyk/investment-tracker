import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderRow, spliceGeneratedRows } from './decisions/render';
import { DECISIONS_DIR, readDecisions, validateDecisions } from './decisions/records';

// docs/superpowers/specs/2026-08-26-verifiable-documentation-design.md §3: the 97
// decisions' front matter (id/date/summary/amends — see src/decisions/frontMatter.ts for
// why not the spec's original title/supersedes/superseded_by) is the source of truth for
// `docs/decisions/README.md`'s three index tables — hand-maintaining a table ABOUT 97
// other documents was itself an unchecked claim, the two-cell D48 row among them. This is
// the standing version of the acceptance test the migration had to pass: the generated
// rows reproduce the README byte for byte.
//
// Lives in `src/` for the same reason `docs-line-cap.test.ts` does: the toolchain runs
// here, even though what it checks is `docs/`.

describe('the decision index (docs/decisions/README.md) is generated from front matter', () => {
  const readmePath = join(DECISIONS_DIR, 'README.md');
  const readme = readFileSync(readmePath, 'utf8');
  const records = readDecisions();

  it('finds the decisions, and their ids form an unbroken sequence starting at 1', () => {
    // A read that silently found zero files would pass a plain sequence
    // check vacuously — guard against that without hand-coding the total.
    expect(records.length).toBeGreaterThan(0);
    const nums = records.map((r) => r.num).sort((a, b) => a - b);
    expect(nums).toEqual(Array.from({ length: nums.length }, (_, i) => i + 1));
  });

  it('has no drift: regenerating the README from front matter changes nothing', () => {
    const result = spliceGeneratedRows(readme, records);
    expect(result.text).toBe(readme);
    expect(result.blocksFilled).toBe(3);
  });

  it('the drift check is not vacuous — a changed summary is actually detected', () => {
    const tampered = records.map((r, i) => (i === 0 ? { ...r, summary: 'TAMPERED' } : r));
    expect(spliceGeneratedRows(readme, tampered).text).not.toBe(readme);
  });

  it('every amends target names a real decision, and none amends itself', () => {
    expect(validateDecisions(records)).toEqual([]);
  });

  it('renders exactly one row per decision, plus each declared extra row, across every block', () => {
    const extraRows = records.filter((r) => r.indexExtraRow !== undefined).length;
    const generatedRows = records.flatMap(renderRow).length;
    expect(generatedRows).toBe(records.length + extraRows);

    // Not a naive `| [D` line count: the README documents the marker syntax
    // with a real example row inside a fenced block, which such a
    // code-blind regex would over-count by one. `rowsRendered` is
    // spliceGeneratedRows's own code-aware count.
    const result = spliceGeneratedRows(readme, records);
    expect(result.rowsRendered).toBe(generatedRows);
  });

  describe('the whole pipeline on an LF checkout (what CI actually sees)', () => {
    let lfDir: string | undefined;

    afterEach(() => {
      if (lfDir) rmSync(lfDir, { recursive: true, force: true });
      lfDir = undefined;
    });

    it('readDecisions parses every decision file, and the drift check still catches a stale row, when every file is genuinely LF', () => {
      lfDir = mkdtempSync(join(tmpdir(), 'decisions-lf-'));
      for (const file of readdirSync(DECISIONS_DIR)) {
        if (!/^D\d+\.md$/.test(file)) continue;
        const crlf = readFileSync(join(DECISIONS_DIR, file), 'utf8');
        const lf = crlf.replace(/\r\n/g, '\n');
        expect(lf).not.toContain('\r'); // the fixture itself must be genuinely LF
        writeFileSync(join(lfDir, file), lf);
      }

      const lfRecords = readDecisions(lfDir);
      expect(lfRecords.length).toBe(records.length);

      const lfReadme = readme.replace(/\r\n/g, '\n');
      const clean = spliceGeneratedRows(lfReadme, lfRecords);
      expect(clean.text).toBe(lfReadme);
      expect(clean.text).not.toContain('\r\n');

      // The primary check, not only a vacuity check — a stale row sourced
      // from genuinely-LF decision files must still be caught.
      const tampered = lfRecords.map((r, i) => (i === 0 ? { ...r, summary: 'TAMPERED' } : r));
      expect(spliceGeneratedRows(lfReadme, tampered).text).not.toBe(lfReadme);
    });
  });
});
