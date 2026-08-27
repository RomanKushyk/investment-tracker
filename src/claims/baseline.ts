import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../facts/markdown-files';
import type { Claim } from './scan';

export const BASELINE_PATH = join(REPO, 'claim-baseline.json');

/** File (repo-relative, POSIX) → count of NOT-unchecked claims in it. Files
 *  with zero counted claims have no entry — an entry that reads 0 would be
 *  indistinguishable from "never scanned". */
export type Baseline = Record<string, number>;

/** Parses and validates the shape `diffBaseline` assumes: a plain object
 *  whose every value is a non-negative integer. Unvalidated, a hand edit
 *  like `"docs/x.md": "many"` would silently disable that file's ratchet
 *  forever — every comparison against a `NaN` baseline is `false`, so
 *  `diffBaseline` would report neither `over` nor `stale` no matter how the
 *  file changes. Throws naming the offending key rather than let that
 *  happen quietly. */
export function loadBaseline(path: string): Baseline {
  if (!existsSync(path)) return {};
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path}: expected a JSON object, got ${JSON.stringify(parsed)}`);
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!Number.isInteger(value) || (value as number) < 0) {
      throw new Error(
        `${path}: "${key}" must be a non-negative integer, got ${JSON.stringify(value)}`,
      );
    }
  }
  return parsed as Baseline;
}

/** Counts non-`unchecked` claims per file — what the ratchet compares
 *  against the committed baseline. An `unchecked` claim contributes to
 *  `facts.ts`'s `claims.unchecked` count instead (see `countUnchecked` in
 *  `./scan`), never to this one. */
export function countsFromClaims(claims: readonly Claim[]): Baseline {
  const counts: Baseline = {};
  for (const c of claims) {
    if (c.unchecked) continue;
    counts[c.file] = (counts[c.file] ?? 0) + 1;
  }
  return counts;
}

/** Sorted keys, 2-space indent, trailing newline — matches prettier's own
 *  default JSON formatting, so `pnpm format` never fights this writer over
 *  whitespace, and two runs against the same claims produce byte-identical
 *  output (the determinism the ratchet needs to have a meaningful diff). */
export function serializeBaseline(counts: Baseline): string {
  const sorted: Baseline = {};
  for (const key of Object.keys(counts).sort()) sorted[key] = counts[key];
  return JSON.stringify(sorted, null, 2) + '\n';
}

export interface BaselineDiscrepancy {
  file: string;
  baseline: number;
  actual: number;
}

export interface BaselineDiff {
  /** Live count exceeds the baseline — a new, un-ratcheted claim. */
  over: BaselineDiscrepancy[];
  /** Baseline count exceeds the live count — stale: the file improved (or
   *  its claims were removed, or the file itself is gone) and nobody
   *  lowered the number. This is what stops the baseline from silently
   *  becoming a floor nobody lowers. */
  stale: BaselineDiscrepancy[];
}

/** Compares a live scan's counts against the committed baseline. A file
 *  absent from one side reads as 0 there — new claims in a file with no
 *  prior entry show up as `over`; a baseline entry for a file that no
 *  longer has any (or no longer exists) shows up as `stale`. Equal counts
 *  produce neither. */
export function diffBaseline(baseline: Baseline, actual: Baseline): BaselineDiff {
  const files = [...new Set([...Object.keys(baseline), ...Object.keys(actual)])].sort();
  const over: BaselineDiscrepancy[] = [];
  const stale: BaselineDiscrepancy[] = [];
  for (const file of files) {
    const b = baseline[file] ?? 0;
    const a = actual[file] ?? 0;
    if (a > b) over.push({ file, baseline: b, actual: a });
    else if (a < b) stale.push({ file, baseline: b, actual: a });
  }
  return { over, stale };
}
