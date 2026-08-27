import { execFileSync } from 'node:child_process';
import { relative, sep } from 'node:path';
import { repoFiles, REPO } from '../facts/markdown-files';

/** The claim lint's scope, verbatim from the design spec (§2): `.md` and
 *  `.sql` wholesale, plus `.ts`/`.tsx` (comment blocks only — enforced in
 *  `scan.ts`, not here). Reuses `repoFiles`'s walk and `SKIP` set rather
 *  than a second copy of either. */
export const TARGET_EXTENSIONS = ['.md', '.sql', '.ts', '.tsx'];

/** `git ls-files`, run once per call, as the set of paths this scan is
 *  scoped to — `repoFiles`'s own `SKIP` list is seven directory names, not
 *  gitignore-aware, so a stray untracked file (a local scratch directory, a
 *  probe file dropped next to a real one, `.idea/`) would otherwise be
 *  walked, scanned, and — via `pnpm claim-baseline` — written into the
 *  committed baseline under a path nobody else's checkout has.
 *
 *  `-c core.quotePath=false` and `-z` are both load-bearing, not defensive
 *  styling: with quoting on (git's default), a tracked path outside plain
 *  ASCII comes back double-quoted with octal escapes (`"\321\200..."`,
 *  never `path`), which never equals what the filesystem walk below
 *  produces — such a file would silently never match `tracked.has(p)` and
 *  drop out of the scan with no error. This app's default language is
 *  Ukrainian, so a Cyrillic path is not a hypothetical. `-z` NUL-terminates
 *  each entry instead of `\n`, which is what makes turning quoting off
 *  safe — an unquoted path CAN legitimately contain a literal newline. */
function trackedFiles(): Set<string> {
  const out = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  return new Set(out.split('\0').filter((line) => line.length > 0));
}

/** Every claim-lint target file in the repository that git also tracks, as
 *  paths relative to `REPO` with POSIX separators — the same key shape
 *  `claim-baseline.json` uses, so a baseline entry and a live scan result
 *  always compare directly. Always scoped to the whole repository — no
 *  `dir` parameter, because `git ls-files` and the filesystem walk below
 *  disagreed about what "relative" meant for anything else: `git`'s output
 *  is relative to its own `cwd`, the walk's is relative to `REPO` in every
 *  case, and no caller ever actually passed anything but `REPO` in the first
 *  place. A file only just created and not yet `git add`ed is excluded
 *  until it is staged — the same trade-off `git ls-files` itself makes,
 *  favouring "never scan what is not in the repository" over "always scan
 *  work in progress". */
export function claimTargetFiles(): string[] {
  const tracked = trackedFiles();
  return repoFiles(REPO, TARGET_EXTENSIONS)
    .map((p) => relative(REPO, p).split(sep).join('/'))
    .filter((p) => tracked.has(p))
    .sort();
}
