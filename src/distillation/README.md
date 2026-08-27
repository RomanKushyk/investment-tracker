# src/distillation/ — the distillation ratchets

The mechanical half of the design spec's step 4
(`docs/superpowers/specs/2026-08-26-verifiable-documentation-design.md` §4): three checks over
what a reader has to wade through to find the one true fact — repeated sentences, comment
volume, and history narrated inside the artifact instead of left to git. `pnpm vitest run
src/distillation` scans the repo and fails naming the file, the line and which check;
`distillation-baseline.json` (repo root) is the ratchet — one file, three sections for these
checks, not three baselines. (A fourth section, `docLineCounts`, rides the same file for an
unrelated check — see "A fourth section, not a fourth check" near the bottom.)

**All three are diagnostics, never a verdict.** Exceeding a baseline number means "this grew and
nobody looked at it yet", not "this file is broken" — high comment volume in particular can be
the *correct* shape (see "What this deliberately does not flag" below). Nothing here ever forces
a cut.

## The three checks

1. **Repeated sentences** — a sentence (≥8 words, ≥50 normalised characters) that appears,
   word-for-word once normalised, in **2 or more distinct files**. A repeat inside one file is
   not this class of problem. An inline code span (`` `A21-A40.md` ``) stays literal in the
   comparison — it is routinely the one identifier that tells two otherwise-identical sentences
   apart, and blanking it (as fenced code correctly is) understated real groups as artefacts of
   erased text.
2. **Comment volume** — for every `.ts`/`.tsx` file, the raw COUNT of characters
   `commentRanges` classifies as comment. Deliberately not a percentage — see below.
3. **History-in-the-artifact** — narration that belongs in a commit message, not the artifact
   ("the first draft", "review found", `fix round N`, …) — see `HISTORY_PHRASES` in `scan.ts` for
   the full, documented list. Two exclusions, deliberate rather than gaps: ordinary past-tense
   prose (this repo dates its decisions constantly and legitimately; that is D-numbered content,
   a different, already-governed class), and `CRITICAL:`/`PIN:` (a forward-looking test-severity
   convention — `src/facts/fences.test.ts` alone carries 9 — not backward-looking narration).

## Why comment volume is a COUNT, not a percentage

A percentage (comment chars ÷ total chars, rounded) changes whenever EITHER side changes, so a
code-only edit with no comment in it still moves the ratio and can flip the rounded integer:
probed by appending one ordinary code line to every tracked `.ts`/`.tsx` file, **55 of 218**
flipped — roughly one code-only change in three, in the WRONG direction (more code lowers the
ratio, so the ratchet reported it as `stale`, "the file improved", which is not what happened).
The raw character count is invariant under exactly that class of edit — probed the same way,
**0 of 218** flip — and only moves when comment TEXT itself is added, edited or removed, which is
the ratchet the spec actually asked for ("a cap yields worse comments, not fewer").

## Reuse, not a fifth scanner

`claimTargetFiles()` (`src/claims/target-files.ts`) is the file list. `codeRanges`
(`src/facts/fences.ts`) finds Markdown code/inline-span ranges; `blank`/`keepOnly`, the masking
glue over them, are ALSO `fences.ts` exports now — shared with `src/claims/scan.ts` rather than
each carrying its own private copy. `commentRanges` (`src/claims/comments.ts`) extracts
`.ts`/`.tsx` comments. `fileKind` (`src/claims/scan.ts`) and `isDeclaredDamage`/
`isDeclaredDamage` (`src/claims/repo-scan.ts`) are reused for the same file-kind dispatch and
the same declared-damage classification the claim lint already makes.

**Fenced vs. inline, `.md` alone:** `codeRanges` conflates fenced-block ranges with single-line
inline-span ranges. `fencedRanges` in `scan.ts` filters to fenced-only (a fenced range ends right
after its own newline; an inline span's does not — see that function's own doc comment for the
one edge case this cannot distinguish), so sentence/history detection blanks real code but keeps
an inline identifier legible.

**One deliberate scope split, `.ts`/`.tsx` only:** repeated-sentence detection reads a file's
COMMENTS (`commentRanges`, masked) — code is not prose. History-phrase detection instead runs
TWO passes and merges them: `historyHits` over the file's **whole, unmasked text**, scanned
line-by-line — the worst offender this check found (`describe`/`it` titles narrating
`fix round 2 — …`) is a STRING LITERAL, not a comment, and joining raw code lines would glue
unrelated statements together — PLUS `wrapOnlyHistoryHits` over the marker-stripped comment view,
which paragraph-joins first and keeps only what the line scan could not have found (three real
JSDoc-wrapped instances existed, e.g. "the first" ending one `*`-continuation line and "draft"
starting the next). `.md` history detection instead runs `historyHitsInProse` alone, with no
second pass over the same view, so it is deliberately NOT filtered to wrap-only; it returns
every hit.

## The ratchet

`distillation-baseline.json` holds `{ repeatedSentences, commentChars, historyPhrases }` for the
three checks here (plus `docLineCounts`, a fourth, unrelated section — see below), each a
`{ "path/to/file": count }` map — sorted keys, 2-space indent, matching prettier. `pnpm
distillation-baseline` (`scripts/distillation-baseline.ts`) rewrites it from a fresh scan, and
refuses to write at all if a file that HAD a baseline entry just went unparseable or erroring —
the same guard `scripts/claim-baseline.ts` carries, checked across the three sections here.
`distillation-lint.test.ts` is the read-only check, and — same as the claim lint — it fails two
ways per section: a file **over** its baseline (new, un-ratcheted growth) and a file **under** it
(stale — the file improved, lost its instances, or was deleted, and nobody lowered the number).
Running `pnpm distillation-baseline` twice in a row changes nothing. Every character count is
measured after normalising CRLF/CR to LF first — `actions/checkout` hands ubuntu CI every
tracked file LF regardless of a Windows working tree's own line endings (measured: 207 of 219
tracked `.ts`/`.tsx` were CRLF here), and an un-normalised count would differ by platform.

Three prefixes are excluded from BOTH the repeated-sentence and the history-phrase check
(`isDistillationExempt` in `scan.ts`), each a DECLARED LIMIT:

- `docs/decisions/` and `docs/archive/` — every `docs/decisions/D<n>.md` files
  shares an identical structural footer BY DESIGN, and so does every
  `docs/archive/plan-a/section-*.md` file's "moved verbatim" line, so a brand-new decision or a
  newly-closed task — created exactly as `CLAUDE.md` instructs — would otherwise be immediately
  `over` a baseline of 0. Narrating history is also what a decision record is *for* (§4's "git
  already holds it" rationale does not apply to a document whose job is to make that history
  discoverable as prose), and both trees are immutable (D96), so a violation there could only be
  "fixed" by editing a record this repository forbids editing. The trade-off, accepted: organic,
  non-template duplication inside either tree also goes unflagged — both are already governed by
  their own mechanisms (D96, the D95 archival convention), not this ratchet.
- `src/distillation/` — this module IS the check, so `HISTORY_PHRASES`' own pattern literals and
  `scan.test.ts`'s fixtures exercising them are what the check finds when it scans itself
  (measured, before this exemption: 52% of the whole-repo history-phrase baseline came from here
  alone). Adding a phrase makes the source line defining it match itself, turning the gate red on
  the file that DEFINES the check — not a defect in the file.

## What this deliberately does not flag as a defect

`src/components/ui/tap-target.ts` measures 91% comment (3,410 of 3,765 characters) — the highest
ratio in the repo — and that is *correct*: the comment explains why the tap-target's HIT AREA
grows while its drawn box does not, a D56 shape-chain consequence that would otherwise look like
a silent radius change five call sites away. Cutting it would make the file shorter and the
codebase worse. That is why this check is a ratchet and not a cap.

## Declared limits

- **No per-occurrence escape hatch for the history check**, unlike the claim lint's
  `<!--unchecked: reason-->`. A per-file COUNT cannot distinguish "one legitimate phrase removed,
  one new one added" from "nothing changed" — but neither can the claim lint's own count-only
  baseline, for the identical reason, and an escape hatch would not close that gap either (it
  only excuses a KNOWN match from counting, it does not detect a same-count swap). Real
  per-occurrence tracking needs hashed line identity, not a count — heavier machinery than a
  ratchet whose whole philosophy is "catch growth", not "prove nothing changed". Accepted as a
  known gap rather than built.
- **Ukrainian sentences, and this repo's typographic quotes (`« »`, `„ "`), split correctly** —
  the sentence-boundary lookahead accepts any script's uppercase letter (`\p{Lu}`, not `A-Z`;
  Ukrainian is this app's default language, D54) and those quote marks, not just ASCII.
- **`paragraphs()` joins every run of non-blank lines, prose or not** — a Markdown table's rows,
  or adjacent list items, fuse into one block whose "sentences" span text that exists on no single
  line. Not fixed: no live instance produces a false hit today, and a block/list-aware join is the
  same CommonMark-parsing complexity `src/facts/fences.ts`'s own README already declines, for the
  same reason.

## Why the repeated split notices are NOT generated

§4 says boilerplate that must repeat becomes a generated block. The notices the
2026-08-26 split left on its child files are the biggest repeated group anyone has pointed at, and they
stay hand-written. The reason is what happened when this section tried to count them.

**Five attempts to count the notices gave five answers** — 57, 51, 58, 65 and 89 — because
each used a slightly different pattern: whether the parent is a link or a code span,
whether `(D95)` is present, whether the `from [parent]` clause appears at all. Four of
the five were written down as fact. None is the right one: the question has no single
answer, which is what the counting actually established.

That is the argument. A generator has to be keyed on an exact sentence, and there is no
exact sentence here — there is a family of them, and the boundary between "the same
notice" and "a different one" is a judgement no pattern settles. A generator would either
rewrite notices it should not touch, or miss the ones it should.

Two things are true regardless of the count. Many of the notices live under
`docs/archive/`, which is frozen, so neither a pass nor a generator may normalise them.
And each notice carries a tail saying what THAT file holds — `docs/reference/deployment/`
alone carries four — which a generator must leave alone. What is left to generate is one
short sentence whose only variable is the parent reference.

Against that: a marker in every child file, a generator, its tests, and a fifth
regeneration step whose ordering against `pnpm facts` and `pnpm decisions` would have to
be remembered. The ratchet above already stops the group growing.

The ratchet's own largest group is the parent-side `Split 2026-08-26 (D95)…`, not the
child notice: the parent reference is part of the normalised key, so the child sentence
never forms one group. Any count of "the notices" is a hand measurement, not something
the mechanism sees — which is the same problem from the other side.

**Revisit** when a second split needs the same notice under different rules, or when the
sentence can be stated exactly enough that two people counting it agree.

### The other repeated block, still deferred

`REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development…` appears in 6 plan
documents. Not a split notice, no per-file tail, identical in every copy — the one group
here that §4's answer fits. Generating it belongs to whatever writes plans, not to this
module, which only counts.

## Layout

| Module | Responsibility |
|--------|----------------|
| `scan.ts` | The three checks' pure logic — `sentenceHits`/`groupRepeated`/`repeatedCountsByFile`, `commentChars`, `historyHits`/`historyHitsInProse`/`wrapOnlyHistoryHits`/`historyCountsByFile`, `HISTORY_PHRASES`, `fencedRanges`, and `scanFile` (the per-file-kind dispatch, mirroring `src/claims/scan.ts`'s own) |
| `repo-scan.ts` | `scanRepo` — the one place in this mechanism that touches disk: walks `claimTargetFiles()`, calls `scanFile`, aggregates the repo-wide sentence groups, and classifies declared vs. unexpected scan errors |
| `baseline.ts` | `DistillationBaseline` (I/O shape, all four sections), `loadBaseline`/`serializeBaseline` (all four), `diffBaseline` (the three checks ONLY — three calls into `src/claims/baseline.ts`'s own `diffBaseline`, reused not reimplemented) |
| `doc-line-counts.ts` | `docLineCounts`/`lineCount`/`LIMIT` — the fourth section's scanner; unrelated to the three checks above, shared by `../docs-line-cap.test.ts` and `scripts/distillation-baseline.ts` |
| `distillation-lint.test.ts` | **Not app code.** The repo-wide ratchet check — the real scan against the real `distillation-baseline.json`, same shape as `src/claims/claim-lint.test.ts` |

Every module above ships a colocated `*.test.ts` except `distillation-lint.test.ts` itself,
which *is* the repo-wide check.

## A fourth section, not a fourth check

`docLineCounts` lives in `distillation-baseline.json` because that is the existing baseline
machinery (§6 reuses it rather than growing a fifth mechanism), but it is not one of the three
checks above and `diffBaseline` in `baseline.ts` does not touch it — `../docs-line-cap.test.ts`
loads `baseline.docLineCounts` and diffs it directly with `src/claims/baseline.ts`'s own
`diffBaseline`, the identical primitive, one level down. Only a Markdown file already over 200
lines gets an entry at all (`doc-line-counts.ts`'s own doc comment says why: pinning every file's
exact length, the first cut of this ratchet, baselined the length of the owner's two hand-edited
draft files — `USER-FEATURES-DRAFT.md`, `USER-BUGS-DRAFT.md` — as committed integers, which is
private uncommitted state leaking into the repository by another name). A file at or under 200 is
unconstrained; a file already over it may not grow further without `pnpm distillation-baseline`
being re-run and reviewed. `LIMIT` (`doc-line-counts.ts`) is the one place that number is written.
