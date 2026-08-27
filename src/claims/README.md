# src/claims/ — the claim lint and its ratchet

The mechanism against unverifiable prose: a **claim** is a bare fact this repo's Markdown, SQL
and TypeScript comments state with nothing checking it — the class the design spec
(`docs/superpowers/specs/2026-08-26-verifiable-documentation-design.md` §2) found behind most of
three tasks' worth of `/code-review` findings. `pnpm vitest run src/claims` scans the repo for
three shapes of claim and fails naming the file, the line and which rule; `claim-baseline.json`
(repo root) is the ratchet that lets existing prose stay red-free while new claims cannot.

## The three rules

1. **A bare number of measured shape** — a digit run immediately carrying `DPU`, `ms`, `%` or
   `×` — outside a fenced code block.
2. **A bare count of a repository thing** — a digit run near a noun like "lines", "files",
   "decisions", "tests" (`REPO_NOUNS` in `scan.ts`; representative, not exhaustive — widening or
   narrowing it is a judgement call each time, not a bug).
3. **An absolute that names a code identifier** — "never"/"only"/"nothing"/… next to a
   backtick-wrapped, code-shaped token (dotted, constant-case, camelCase, a call, a filename) on
   the same line. Design intent with no identifier cited passes; citing a fact on the same line
   (a rendered `<!--f:key-->…<!--/f-->`) passes too — citing it IS the fix, but `key` must
   resolve against the real fact registry: a made-up key does not exempt anything, in any of
   the three file kinds.

All three are deliberately literal and noisy by design (see the spec's own measurement of a
narrower rule vs. this one) — the ratchet, not a curated pattern, is what keeps that from
blocking work.

## Scope

`.md` and `.sql` are scanned wholesale. `.ts`/`.tsx` are scanned **only inside comment
blocks** (`comments.ts`'s `commentRanges`) — the worst claims were in comments, not documents.
Fenced/inline Markdown code is exempt from rules 1/2 (`src/facts/fences.ts`'s `codeRanges`/
`inCode`, imported — not reimplemented; see that module's own README for why a third hand-rolled
scanner is exactly the defect class this repo is trying to stop). SQL has no fenced-code
convention of its own, so "wholesale" there means no masking at all.

## The escape hatch

`<!--unchecked: reason-->`, same line as the claim it excuses. Suppresses that line's claims
from the ratchet's failing count. The count of unchecked claims is itself a derived fact, per
the spec — `claims.unchecked` in `src/facts/facts.ts`, cited live right here: as of now,
<!--f:claims.unchecked-->12<!--/f--> lines in the tracked tree carry text matching the marker's
well-formed shape. A plain per-line regex test, deliberately — it counts every line the pattern
matches, this section's own worked examples of the syntax included, not "how many claims did
the rules actually suppress" (a marker on a line with no claim to suppress still carries the
marker, which is why that narrower count would have been the wrong thing to render here).

**One form covers all three file kinds.** `.ts` and `.sql` cannot make `<!--`/`-->` mean
anything to their own parser, but detection here only ever needs the substring to sit inside a
comment span the scanner already recognises — never for the host language to parse it as
syntax. `// <!--unchecked: reason-->` and `-- <!--unchecked: reason-->` are both just text
inside an already-open `//`/`--` comment, so the identical marker and the identical grep
pattern (`UNCHECKED_RE` in `scan.ts`) work everywhere, instead of inventing a second form to
remember.

## The ratchet

`claim-baseline.json` holds `{ "path/to/file": count }` for every file with at least one
counted (non-`unchecked`) claim — sorted keys, 2-space indent, matching prettier's own JSON
formatting so `pnpm format` leaves it alone. `pnpm claim-baseline` (`scripts/claim-baseline.ts`)
rewrites it from a fresh scan; `claim-lint.test.ts` is the read-only check, and it fails two
ways, not one: a file **over** its baseline (a new, un-ratcheted claim) and a file **under** it
(a stale number — the file improved, or lost its claims, or was deleted, and nobody lowered the
count). Running `pnpm claim-baseline` twice in a row must change nothing.

## Layout

| Module | Responsibility |
|--------|----------------|
| `scan.ts` | The three rule patterns, `Claim`/`Rule`/`fileKind`, `scanFile` (the masking/dispatch by file kind), `countUnchecked` |
| `comments.ts` | `commentRanges(text, fileName)` — the `.ts`/`.tsx` comment extractor, built on TypeScript's own parser (`ts.createSourceFile` + `getChildren()`), not a hand-rolled scanner; `PARSE_ERROR_PREFIX` names its declared failure mode |
| `target-files.ts` | `claimTargetFiles` — the repo walk, reusing `repoFiles`/`SKIP` from `src/facts/markdown-files.ts`, scoped to `git ls-files` |
| `repo-scan.ts` | `scanRepo` — reads every target file and calls `scanFile`; the one place in this mechanism that touches disk; `isDeclaredDamage` is its `catch`'s classification, exported for its own test |
| `baseline.ts` | `Baseline`, `loadBaseline`/`serializeBaseline`, `countsFromClaims`, `diffBaseline` |
| `claim-lint.test.ts` | **Not app code.** The repo-wide ratchet check — the real scan against the real `claim-baseline.json` |

Every module above ships a colocated `*.test.ts` except `claim-lint.test.ts` itself, which *is*
the repo-wide check (same shape as `src/facts/fences.test.ts`'s drift test).
