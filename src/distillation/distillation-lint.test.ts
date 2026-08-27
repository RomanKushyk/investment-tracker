import { describe, expect, it } from 'vitest';
import { BASELINE_PATH, diffBaseline, loadBaseline } from './baseline';
import { scanRepo } from './repo-scan';

// The distillation ratchets (design spec §4): repeated sentences, comment
// volume, and history-in-the-artifact narration. `distillation-
// baseline.json` holds a per-file count for each of the three, section by
// section. A file whose live count exceeds its baseline entry fails — a
// new, un-ratcheted instance. A file whose baseline entry EXCEEDS its live
// count also fails — a stale number nobody lowered after the file improved
// (or the file itself went away). Raising or lowering the baseline is
// `pnpm distillation-baseline`'s job, not a hand edit — see
// scripts/distillation-baseline.ts.
//
// None of the three is a cap: exceeding a baseline number means "this grew
// and nobody looked at it yet", never "this file is now broken". Reviewing
// the growth and running the regenerate script is how a legitimate increase
// gets accepted.
//
// The scan must be able to read every tracked file: one it cannot parse is a
// document nothing checks. Asserted empty rather than compared against a pinned
// list, so adding a path to that list cannot buy a green run.

/** Truncates a sentence excerpt for a one-line failure message — the exact
 *  text is not the point, enough of it to recognise by eye is. */
function short(s: string): string {
  return s.length > 90 ? s.slice(0, 87) + '…' : s;
}

describe('the distillation ratchets', () => {
  const scan = scanRepo();
  const baseline = loadBaseline(BASELINE_PATH);
  const diff = diffBaseline(baseline, {
    repeatedSentences: scan.repeatedSentences,
    commentChars: scan.commentChars,
    historyPhrases: scan.historyPhrases,
  });

  it('scans real files — a silent empty scan would pass every assertion below vacuously', () => {
    expect(Object.keys(scan.commentChars).length).toBeGreaterThan(0);
  });

  it('every tracked file is scannable — the unparseable list is empty and must stay so', () => {
    expect(scan.unparseable).toEqual([]);
  });

  it('has no unexpected scan error — never pinned, because none should exist in a clean tree', () => {
    expect(scan.errors).toEqual([]);
  });

  it('has no file over its repeated-sentence baseline — run `pnpm distillation-baseline` after review', () => {
    const lines = diff.repeatedSentences.over.flatMap((d) => {
      const header = `${d.file}: ${d.actual} repeated-sentence hit(s), baseline allows ${d.baseline} (+${d.actual - d.baseline})`;
      const detail = scan.repeatedGroups.flatMap((g) =>
        g.hits
          .filter((h) => h.file === d.file)
          .map((h) => {
            const elsewhere = [...g.files].filter((f) => f !== d.file);
            return `  line ${h.line}: "${short(h.excerpt)}" (also in ${elsewhere.join(', ')})`;
          }),
      );
      return [header, ...detail];
    });
    expect(lines).toEqual([]);
  });

  it('has no stale repeated-sentence baseline entry — run `pnpm distillation-baseline` to bring it down', () => {
    const lines = diff.repeatedSentences.stale.map(
      (d) => `${d.file}: baseline says ${d.baseline}, actual is ${d.actual}`,
    );
    expect(lines).toEqual([]);
  });

  it('has no file over its comment-volume baseline — a real increase needs `pnpm distillation-baseline`, not a cut', () => {
    const lines = diff.commentChars.over.map(
      (d) =>
        `${d.file}: ${d.actual} comment chars, baseline allows ${d.baseline} (+${d.actual - d.baseline})`,
    );
    expect(lines).toEqual([]);
  });

  it('has no stale comment-volume baseline entry — run `pnpm distillation-baseline` to bring it down', () => {
    const lines = diff.commentChars.stale.map(
      (d) => `${d.file}: baseline says ${d.baseline} comment chars, actual is ${d.actual}`,
    );
    expect(lines).toEqual([]);
  });

  it('has no file over its history-phrase baseline — run `pnpm distillation-baseline` after review', () => {
    const lines = diff.historyPhrases.over.flatMap((d) => {
      const header = `${d.file}: ${d.actual} history phrase(s), baseline allows ${d.baseline} (+${d.actual - d.baseline})`;
      const detail = scan.historyHitList
        .filter((h) => h.file === d.file)
        .map((h) => `  line ${h.line}: "${h.match}"`);
      return [header, ...detail];
    });
    expect(lines).toEqual([]);
  });

  it('has no stale history-phrase baseline entry — run `pnpm distillation-baseline` to bring it down', () => {
    const lines = diff.historyPhrases.stale.map(
      (d) => `${d.file}: baseline says ${d.baseline}, actual is ${d.actual}`,
    );
    expect(lines).toEqual([]);
  });
});
