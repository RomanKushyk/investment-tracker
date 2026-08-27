import { relative, sep } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { diffBaseline, type BaselineDiff } from './claims/baseline';
import { docLineCounts, LIMIT } from './distillation/doc-line-counts';
import { BASELINE_PATH, loadBaseline } from './distillation/baseline';
import { markdownFiles, REPO } from './facts/markdown-files';

// D95 made "no documentation file exceeds 200 lines" a hard rule enforced by
// this file. The verifiable-documentation design
// (docs/superpowers/specs/2026-08-26-verifiable-documentation-design.md §6)
// ruled that a hard wall is the wrong shape — it forced the ID-range
// splitting D98 later undoes — so the cap becomes a diagnostic instead
// (D98): a file at or under `LIMIT` is unconstrained; only a file already
// over it is pinned, in `distillation-baseline.json`'s `docLineCounts`
// section (`src/distillation/doc-line-counts.ts`), on the same over/stale
// baseline machinery `distillation-lint.test.ts` uses for its own checks.
// `pnpm distillation-baseline` regenerates it, and a pinned file may not
// grow past its own recorded length without that being reviewed and
// bumped — reported with the diagnostic question, not an instruction to
// split.
//
// It lives in `src/` because that is where the toolchain runs; it governs the whole
// repository, which is the one exception to src/README's structure table.

const FILES = markdownFiles(REPO);
const REL_FILES = FILES.map((p) => relative(REPO, p).split(sep).join('/'));

describe('documentation line-count ratchet (D95, ratcheted by D98)', () => {
  it('finds the documentation to measure', () => {
    // A walk that quietly matches nothing would pass every assertion below.
    expect(REL_FILES.length).toBeGreaterThan(100);
    expect(REL_FILES).toContain('CLAUDE.md');
    expect(REL_FILES).toContain('docs/plans/PLAN-NOW.md');
  });

  // Computed in `beforeAll`, not at collection time in the `describe` body:
  // a corrupt baseline or an unreadable file must fail only the tests in
  // THIS describe, never abort collection for the whole file and take the
  // unrelated D96 guard below down with it.
  let diff: BaselineDiff;
  beforeAll(() => {
    const baseline = loadBaseline(BASELINE_PATH).docLineCounts;
    diff = diffBaseline(baseline, docLineCounts(FILES));
  });

  it('has no file over its recorded length — run `pnpm distillation-baseline` after review', () => {
    // Longest-first: a bulk change with one real offender should not bury
    // it alphabetically among unrelated diffs.
    const lines = diff.over
      .slice()
      .sort((a, b) => b.actual - a.actual)
      .map(
        (d) =>
          `${d.file}: ${d.actual} lines, baseline allows ${d.baseline} (+${d.actual - d.baseline}) ` +
          `— over ${LIMIT} lines: a file this long usually holds more than one purpose, and the fix is to find the second one`,
      );
    expect(lines).toEqual([]);
  });

  it('has no stale line-count baseline entry — run `pnpm distillation-baseline` to bring it down', () => {
    const lines = diff.stale.map(
      (d) => `${d.file}: baseline says ${d.baseline}, actual is ${d.actual}`,
    );
    expect(lines).toEqual([]);
  });
});

describe('the decision log is one file per decision (D96)', () => {
  const decisions = REL_FILES.filter(
    (f) => f.startsWith('docs/decisions/') && f !== 'docs/decisions/README.md',
  );

  it('has no range files left, and none may come back', () => {
    // `D41-D50.md` held D41-D60 and `D61-D80.md` held D81-D83: a filename asserting
    // a range it does not hold. Appending is creating a file now, so this is dead.
    expect(decisions.filter((f) => /\/D\d+-D\d+\.md$/.test(f))).toEqual([]);
  });

  it('names every entry exactly as it is cited', () => {
    // Bare-number citations across `src/` and `docs/` must keep resolving forever.
    expect(decisions.filter((f) => !/\/D\d+\.md$/.test(f))).toEqual([]);
  });

  it('has no gap in the sequence', () => {
    const numbers = decisions
      .map((f) => Number(/\/D(\d+)\.md$/.exec(f)?.[1]))
      .sort((a, b) => a - b);
    expect(numbers[0]).toBe(1);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
  });
});
