import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { REPO } from '../facts/markdown-files';
import type { Baseline } from '../claims/baseline';

/** A file at or under this many lines is unconstrained (§6: "a diagnostic,
 *  not a rule"). Only a file already over it is pinned by `docLineCounts`
 *  below — see that function's own doc comment for why. */
export const LIMIT = 200;

/** `wc -l` semantics: newline count, so a file with no trailing newline is
 *  not over-counted. Shared by the docs-line-cap ratchet
 *  (`src/docs-line-cap.test.ts`) and `scripts/distillation-baseline.ts`, so
 *  the check and the regenerator can never disagree about what a line is. */
export function lineCount(path: string): number {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`${path}: ${message}`);
  }
  let n = 0;
  for (const ch of text) if (ch === '\n') n += 1;
  return n;
}

/** File (relative to `repoRoot`, POSIX) → line count, for every path in
 *  `absPaths` that is OVER `LIMIT` — a file at or under it gets no entry at
 *  all, the same "zero counted, no row" convention `commentChars` and
 *  `countsFromClaims` already use. This is deliberately not every tracked
 *  Markdown file: pinning every file's exact length (as the first cut of
 *  this ratchet did) baselines the length of files nobody should ever have
 *  to stage — `USER-FEATURES-DRAFT.md` and `USER-BUGS-DRAFT.md` are edited
 *  directly by the owner and are never committed by an agent, so their
 *  lengths are private, uncommitted state a baseline run from the working
 *  tree would otherwise record as two integers in a committed file.
 *  Excluding anything at or under 200 lines removes that leak structurally
 *  — those two files sit at a few dozen lines by their own "bare bullets,
 *  no ceremony" rule and are never candidates.
 *
 *  Takes the file list rather than walking `repoRoot` itself, so a caller
 *  that already has one (`docs-line-cap.test.ts` walks once for its own
 *  vacuity check) does not pay for a second walk, and a test can hand it a
 *  synthetic list with no filesystem walk at all. */
export function docLineCounts(absPaths: readonly string[], repoRoot: string = REPO): Baseline {
  const counts: Baseline = {};
  for (const absPath of absPaths) {
    const n = lineCount(absPath);
    if (n > LIMIT) {
      counts[relative(repoRoot, absPath).split(sep).join('/')] = n;
    }
  }
  return counts;
}
