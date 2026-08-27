import { describe, expect, it } from 'vitest';
import { FACTS } from '../facts/facts';
import { BASELINE_PATH, countsFromClaims, diffBaseline, loadBaseline } from './baseline';
import { scanRepo } from './repo-scan';

// The ratchet (design spec §2, "the ratchet"): claim-baseline.json holds a
// per-file count. A file whose live claim count exceeds its baseline entry
// fails — a new, un-ratcheted claim. A file whose baseline entry EXCEEDS
// its live count also fails — a stale number nobody lowered after the file
// improved (or after the claims/file went away entirely). Raising or
// lowering the baseline is `pnpm claim-baseline`'s job, not a hand edit —
// see scripts/claim-baseline.ts.
//
// The scan must be able to read every tracked file: one it cannot parse is a
// document nothing checks. Asserted empty rather than compared against a pinned
// list, so adding a path to such a list cannot buy a green run.

describe('the claim-lint ratchet', () => {
  const { claims, unparseable, errors } = scanRepo(new Set(Object.keys(FACTS)));
  const actual = countsFromClaims(claims);
  const baseline = loadBaseline(BASELINE_PATH);
  const diff = diffBaseline(baseline, actual);

  it('scans real files — a silent empty scan would pass every assertion below vacuously', () => {
    expect(claims.length).toBeGreaterThan(0);
  });

  it('every tracked file is scannable — the unparseable list is empty and must stay so', () => {
    expect(unparseable).toEqual([]);
  });

  it('has no unexpected scan error — never pinned, because none should exist in a clean tree', () => {
    expect(errors).toEqual([]);
  });

  it('has no file over its baseline — run `pnpm claim-baseline` after reviewing new claims', () => {
    // Every claim in the offending file, not just the file-level count —
    // `PLAN-NOW.md: N claims, baseline allows fewer` alone gives an
    // author no way to find the one that needs a look. The baseline is
    // count-only (no per-claim identity), so this cannot single out which
    // claim is the "+1"; listing all of them still answers "where do I
    // look", which a bare count never could.
    const lines = diff.over.flatMap((d) => {
      const header = `${d.file}: ${d.actual} claims, baseline allows ${d.baseline} (+${d.actual - d.baseline})`;
      const detail = claims
        .filter((c) => c.file === d.file && !c.unchecked)
        .map((c) => `  line ${c.line} rule ${c.rule}: ${c.match}`);
      return [header, ...detail];
    });
    expect(lines).toEqual([]);
  });

  it('has no stale baseline entry — run `pnpm claim-baseline` to bring it down', () => {
    const lines = diff.stale.map(
      (d) => `${d.file}: baseline says ${d.baseline}, actual is ${d.actual}`,
    );
    expect(lines).toEqual([]);
  });
});
