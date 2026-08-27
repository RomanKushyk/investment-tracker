import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoFiles, REPO } from '../facts/markdown-files';
import { claimTargetFiles, TARGET_EXTENSIONS } from './target-files';
import { scanFile, UNCHECKED_RE, type Claim } from './scan';
import { PARSE_ERROR_PREFIX } from './comments';

/** Substrings unique to the two declared, pre-existing damage classes this
 *  scan refuses to guess its way through — a genuinely unclosed Markdown
 *  fence (`src/facts/fences.ts`'s `codeRanges`) and a `.ts`/`.tsx` file
 *  `commentRanges` rejects (`./comments`'s `PARSE_ERROR_PREFIX`). Any
 *  OTHER thrown message is a real bug in this module's own scanning (a
 *  malformed escape-hatch marker, say) and must propagate, not be folded
 *  into "pre-existing document damage" alongside these two. */
const DECLARED_DAMAGE = ['unclosed code fence', PARSE_ERROR_PREFIX];

/** Exported so the classification `scanRepo`'s `catch` relies on has its
 *  own test (`repo-scan.test.ts`) independent of faking disk/git — a bare
 *  `catch {}` here would also swallow a real bug in this module's own
 *  scanning (a malformed escape-hatch marker throwing from `scanFile`,
 *  say) and misreport it as pre-existing document damage, permanently
 *  hiding it behind the pinned, already-explained files instead of
 *  failing the suite on it. */
export function isDeclaredDamage(message: string): boolean {
  return DECLARED_DAMAGE.some((d) => message.includes(d));
}

export interface RepoScan {
  claims: Claim[];
  /** Files this scan could not parse at all — see `DECLARED_DAMAGE` above.
   *  Five instances of the Markdown kind are known: the 2026-08-26 D95
   *  split cut a single fenced code block across file boundaries in four
   *  sibling plan documents (`amplify-hybrid-deploy/02` through `05`),
   *  where the closer now lives in a different file than its opener;
   *  reconstructing that was already tried and reverted by a prior task,
   *  which ruled it out of scope, not something to redo here on this
   *  task's own judgement. The fifth — the parent
   *  `2026-07-29-amplify-hybrid-deploy.md` — was the SAME split, one level
   *  up: the fenced block's actual content moved into `amplify-hybrid-
   *  deploy/`, and the split's own navigation heading landed right where
   *  that content used to be, leaving an opener with nothing left to
   *  close. Fixed by deleting the orphan opener (not by adding a closer
   *  around nothing, which a first attempt at this got wrong), so it was
   *  never added to this list. The four that remain are skipped rather than
   *  crashing the whole scan — `claim-lint.test.ts` pins this exact list,
   *  so a new file joining it (of either damage kind) still fails a test
   *  instead of silently losing claim-lint coverage. */
  unparseable: string[];
  /** Files where `scanFile` threw something OTHER than declared damage — a
   *  real bug in this module, or a genuine authoring mistake (a malformed
   *  escape-hatch marker) that must not be silently absorbed into
   *  `unparseable` (that list is PINNED as a known, already-explained set;
   *  an unexpected error joining it would corrupt the pin's meaning), but
   *  also must not abort the scan of every other file — `pnpm claim-
   *  baseline`, the one tool meant to help recover from a broken tree,
   *  must not itself become unusable the moment one file breaks. Never
   *  pinned: `claim-lint.test.ts` fails on any entry here at all — a clean
   *  tree should always have zero. */
  errors: { file: string; message: string }[];
}

/** Scans every claim-lint target file and returns every claim found,
 *  across all three rules. The one place in this mechanism that touches
 *  disk — `scanFile` itself stays pure, given text.
 *
 *  `knownFactKeys` is threaded through to `scanFile` so `.md`'s
 *  fact-citation exemption (rule 3's pass-through and rule 1/2's masking —
 *  `.ts`/`.sql` instead get `scan.ts`'s own empty `NO_FACT_KEYS`) can
 *  resolve a fence's key against the real registry. Callers pass
 *  `new Set(Object.keys(FACTS))` from `src/facts/facts.ts` rather than
 *  this module importing `FACTS` directly — `scan.ts`/`repo-scan.ts` stay
 *  import-safe for ANY future consumer in `src/facts/`, not just today's,
 *  without either side needing to know about the other. */
export function scanRepo(knownFactKeys: ReadonlySet<string>): RepoScan {
  const claims: Claim[] = [];
  const unparseable: string[] = [];
  const errors: RepoScan['errors'] = [];
  for (const relPath of claimTargetFiles()) {
    const text = readFileSync(join(REPO, relPath), 'utf8');
    try {
      claims.push(...scanFile(relPath, text, knownFactKeys));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (isDeclaredDamage(message)) unparseable.push(relPath);
      else errors.push({ file: relPath, message });
    }
  }
  return { claims, unparseable, errors };
}

/** How many LINES, across every claim-lint target file, carry a
 *  well-formed `<!--unchecked: reason-->` marker — a plain per-line
 *  regex test over raw file text, nothing more. This is deliberately NOT
 *  "how many claims are marked unchecked" (`Claim.unchecked`, set inside
 *  `scanFile`'s `scanRegion`): a marker on a line where the rules find no
 *  claim to suppress still carries the marker, and both markers that exist
 *  in this repository today are on exactly such a line — counting claims
 *  instead of markers rendered `src/claims/README.md`'s own "N lines...
 *  carry the marker" sentence false the moment it shipped.
 *
 *  Deliberately NOT `scanRepo`/`claimTargetFiles` either, even though this
 *  lives in the same "touches disk" module: this is `src/facts/facts.ts`'s
 *  `claims.unchecked` compute, which runs inside `pnpm facts` and inside
 *  `fences.test.ts`'s repo-wide drift check — routes neither test suite
 *  should need TypeScript to parse every `.ts` file, or `git` to be on
 *  `PATH`, just to answer a question a plain `grep` already answers. Uses
 *  the plain filesystem walk (`repoFiles`, `markdownFiles.ts`'s own SKIP
 *  list) instead of the git-scoped one — an untracked scratch file
 *  inflating this COUNT by one is a harmless inaccuracy, unlike inflating
 *  the RATCHET's baseline, which is what `claimTargetFiles` exists to
 *  prevent. */
export function countUncheckedMarkers(): number {
  let count = 0;
  for (const path of repoFiles(REPO, TARGET_EXTENSIONS)) {
    const text = readFileSync(path, 'utf8');
    for (const line of text.split(/\r\n|\r|\n/)) {
      if (UNCHECKED_RE.test(line)) count += 1;
    }
  }
  return count;
}
