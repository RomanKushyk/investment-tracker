import { readFileSync } from 'node:fs';
import { codeRanges, inCode } from '../facts/fences';
import { relative, sep } from 'node:path';
import { REPO } from '../facts/markdown-files';
import type { Baseline } from '../claims/baseline';

/** A file at or under this many lines is unconstrained (§6: "a diagnostic,
 *  not a rule"). Only a file already over it is pinned by `docLineCounts`
 *  below — see that function's own doc comment for why. */
export const LIMIT = 200;

/** The question §6 says a long file should be asked, in the one wording every
 *  reporter uses. `src/docs-line-cap.test.ts` asks it of a file over its
 *  baseline; `src/decisions/render.ts` asks it of the index it just wrote.
 *  Two copies of a sentence drift into two different rules. */
export const DIAGNOSTIC_QUESTION =
  'a file this long usually holds more than one purpose, and the fix is to find the second one';

/** `wc -l` semantics: newline count, so a file with no trailing newline is
 *  not over-counted. Takes TEXT, so a caller holding a string it has not
 *  written yet counts by the same rule as one reading a file. */
export function countLines(text: string): number {
  let n = 0;
  for (const ch of text) if (ch === '\n') n += 1;
  return n;
}

/** A generated BLOCK's delimiters, and the one place they are written down —
 *  `../decisions/render.ts` imports these rather than declaring its own pair,
 *  because two copies of a marker syntax drift into two different rules and
 *  only one of them would still subtract. (`src/app/mark.test.ts` is the
 *  precedent for pinning a duplicated literal; not duplicating it is better.)
 *
 *  "Block" is the operative word: `../facts/fences.ts`'s `<!--f:key-->…<!--/f-->`
 *  is also machine-maintained, and needs nothing here because it is INLINE and
 *  the surrounding line is authored. A second BLOCK generator adds its opener
 *  here. */
export const GENERATED_OPEN = '<!-- decisions:rows ';
export const GENERATED_CLOSE = '<!-- /decisions:rows -->';

/** Lines a HUMAN wrote: `countLines` minus everything a generator emitted
 *  between its own markers. The markers themselves count — a person put them
 *  there.
 *
 *  **This is what the cap measures, and O35 is why (D102).** §6's diagnostic
 *  asks whether a long file holds more than one purpose. Rows emitted one per
 *  decision are not a purpose, they are data, and a file that is 60% generated
 *  table was tripping a question it could not answer — every new decision
 *  needing a reviewed baseline bump, which teaches a reviewer to bump without
 *  reading. Exempting the FILE was the obvious fix and the wrong one: it turns
 *  the guard off for the prose too. Counting only authored lines keeps the
 *  question live on the half that can actually hold a second purpose, and
 *  keeps it live forever, however long the table gets.
 *
 *  **Every uncertain case resolves to the RAW count, never to a shorter one.**
 *  A length check that under-reports is the failure this module exists to
 *  prevent, so an unclosed opener, a second opener before any closer, and an
 *  unparseable file all fall back to `countLines`. Loudness lives in
 *  `../decisions/render.ts`, which throws on exactly these shapes when
 *  `pnpm decisions` runs; a line counter's job is a number.
 *
 *  A marker shown in a FENCED code block is documentation, not a live region —
 *  `../facts/fences.ts`'s `inCode` tells those apart. A marker inside a
 *  4-space INDENTED code block is not distinguished, because `fences.ts`
 *  deliberately does not treat indentation as code; the detection here matches
 *  `render.ts`'s exactly, deliberately, so the counter and the generator can
 *  never disagree about which regions exist. */
export function authoredLines(text: string): number {
  // Cheap reject first, for two reasons: almost every Markdown file in the
  // repository carries no block marker at all and needs no parse (measured
  // 2026-08-28: three of 278, and two of those only because they DOCUMENT the
  // syntax), and `codeRanges` THROWS on an
  // unbalanced code fence — which, called unconditionally, took the whole
  // ratchet and `pnpm distillation-baseline` down with one stray ``` in one
  // document. `fences.ts`'s `rewrite` guards the same hazard the same way.
  if (!text.includes(GENERATED_OPEN) && !text.includes(GENERATED_CLOSE)) {
    return countLines(text);
  }
  let code: ReturnType<typeof codeRanges>;
  try {
    code = codeRanges(text);
  } catch {
    // Unparseable: report the raw count rather than a guess or an exception.
    return countLines(text);
  }
  const lines = text.split('\n');
  let generated = 0;
  let offset = 0;
  let inGenerated = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // `indexOf`, not `startsWith` on a trimmed line: this is what
    // `render.ts`'s `spliceGeneratedRows` does, and a marker it fills must be
    // a marker this subtracts.
    const at = (tag: string) => {
      const j = line.indexOf(tag);
      return j >= 0 && !inCode(code, offset + j);
    };
    if (inGenerated) {
      if (at(GENERATED_CLOSE)) inGenerated = false;
      else if (at(GENERATED_OPEN))
        return countLines(text); // two opens, no close
      // `wc -l` counts newline-terminated lines only, so `split`'s final
      // element is not a line. Subtracting from `countLines` rather than
      // counting up keeps this function's semantics identical to it by
      // construction — the first cut counted up instead and was off by one on
      // a file with no trailing newline, which the two oldest tests here
      // caught.
      else if (i < lines.length - 1) generated += 1;
    } else if (at(GENERATED_OPEN)) {
      inGenerated = true;
    }
    offset += line.length + 1;
  }
  return inGenerated ? countLines(text) : countLines(text) - generated;
}

/** `authoredLines` of a file's contents. Shared by the docs-line-cap ratchet
 *  (`src/docs-line-cap.test.ts`) and `scripts/distillation-baseline.ts`, so
 *  the check and the regenerator can never disagree about what a line is. */
export function lineCount(path: string): number {
  try {
    return authoredLines(readFileSync(path, 'utf8'));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`${path}: ${message}`);
  }
}

/** File (relative to `repoRoot`, POSIX) → line count, for every path in
 *  `absPaths` that is OVER `LIMIT` — a file at or under it gets no entry at
 *  all, the same "zero counted, no row" convention `commentChars` and
 *  `countsFromClaims` already use. This is deliberately not every tracked
 *  Markdown file: pinning every file's exact length (as the first cut of
 *  this ratchet did) baselines the length of files nobody should ever have
 *  to stage — `USER-FEATURES-DRAFT.md` and `USER-BUGS-DRAFT.md` are edited
 *  directly by the owner and are **never committed on an agent's own
 *  initiative**, so at any moment their length is private, uncommitted state
 *  that a baseline run from the working tree would record as two integers in
 *  a committed file. (D98 and this comment first said "never committed by an
 *  agent" flat. That is false — the owner has asked for them to be committed,
 *  and a code review counted three such commits. The rationale is untouched
 *  by the correction: what leaks is whatever happens to be UNCOMMITTED in the
 *  tree when a regenerator runs, and that is true of a file committed
 *  yesterday.)
 *  Excluding anything at or under 200 lines removes that leak structurally
 *  — those two files sit at a few dozen lines by their own "bare bullets,
 *  no ceremony" rule and are never candidates.
 *  Both files were retired 2026-08-28 (D103) and **the exclusion stays**: the
 *  leak is structural, not theirs. Deleting a rule because its example left is
 *  the regression D103 names.
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
