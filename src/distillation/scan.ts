import { codeRanges, blank, keepOnly, type CodeRange } from '../facts/fences';
import { commentRanges } from '../claims/comments';
import { fileKind } from '../claims/scan';

// The three mechanical checks from the design spec
// (docs/superpowers/specs/2026-08-26-verifiable-documentation-design.md §4):
// repeated sentences, comment volume, and history-in-the-artifact narration.
// All three read the SAME two building blocks the claim lint already built —
// `codeRanges` (Markdown code/inline-span ranges) and `commentRanges`
// (TypeScript-backed `.ts`/`.tsx` comment ranges) — rather than a fourth or
// fifth hand-rolled scanner. `fileKind` is reused too, for the same file-kind
// dispatch the claim lint already makes. `blank`/`keepOnly` are `facts/
// fences.ts`'s own exports — the masking glue over `ranges`, shared with
// `src/claims/scan.ts` rather than a third private copy.

/** Normalises CRLF/CR to LF before any of the three checks run. Comment
 *  volume (below) sums comment-range lengths in CHARACTERS, and
 *  `actions/checkout` hands ubuntu CI every tracked file LF regardless of
 *  what a Windows working tree carries (measured: 207 of 219 tracked
 *  `.ts`/`.tsx` files are CRLF here) — an un-normalised scan would count a
 *  different number of characters on each platform for the identical
 *  content, and the ratchet could never pass both. Applied once, up front,
 *  so sentence and history detection see the same platform-independent
 *  text too. */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

// --- 1. Repeated sentences ---------------------------------------------------

/** A sentence must clear both thresholds to count — short fragments ("See
 *  above.") repeat harmlessly and would swamp the signal. Matches the
 *  methodology this task's own report cites (§ "What I measured"). */
const MIN_WORDS = 8;
const MIN_CHARS = 50;

export interface SentenceHit {
  /** Repo-relative, POSIX separators. */
  file: string;
  /** 1-based; the START of the paragraph the sentence was found in, not the
   *  sentence's own line — see `paragraphs` below for why a finer-grained
   *  number is not attempted. */
  line: number;
  /** Normalised text — the grouping key two occurrences must share exactly
   *  to count as "repeated". */
  key: string;
  /** Close to the original wording, for a human-readable failure message. */
  excerpt: string;
}

/** Splits `view` into blank-line-separated paragraphs, each with the line
 *  number it STARTS on and its constituent RAW (trimmed) lines. Necessary
 *  because this repo's prose soft-wraps at roughly one line per ~90
 *  characters (see any file under `docs/`) — a sentence routinely spans two
 *  or three raw lines, so scanning line-by-line would silently split it and
 *  never recognise it as repeated. Every sentence found inside one
 *  paragraph is attributed to the PARAGRAPH's start line, not its own — a
 *  declared approximation, not a bug: precise per-sentence line tracking
 *  would need mapping the joined text's offsets back through each wrapped
 *  line, for a failure message that only ever needs to get a reader close
 *  enough to find the sentence by eye. `rawLines` exists for
 *  `historyHitsInProse`'s own dedup, below.
 *
 *  DECLARED LIMIT: a run of non-blank lines is joined even when it is not
 *  prose — a Markdown table's rows, or adjacent list items, fuse into one
 *  block whose "sentences" span text that exists on no single line. Not
 *  fixed: no live instance produces a false repeated-sentence or
 *  history-phrase hit today (checked against the real tree), and a
 *  block/list-aware join is exactly the CommonMark-parsing complexity
 *  `src/facts/fences.ts`'s own README already declines for the same
 *  reason. */
function paragraphs(view: string): { line: number; text: string; rawLines: string[] }[] {
  const lines = view.split(/\r\n|\r|\n/);
  const blocks: { line: number; text: string; rawLines: string[] }[] = [];
  let buf: string[] = [];
  let startLine = 1;
  const flush = () => {
    const joined = buf
      .join(' ')
      .replace(/[^\S\r\n]+/g, ' ')
      .trim();
    if (joined) blocks.push({ line: startLine, text: joined, rawLines: [...buf] });
    buf = [];
  };
  lines.forEach((raw, idx) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      flush();
    } else {
      if (buf.length === 0) startLine = idx + 1;
      buf.push(trimmed);
    }
  });
  flush();
  return blocks;
}

/** Deliberately naive — splits after `.`/`!`/`?` followed by whitespace and
 *  a capital letter (any script — `\p{Lu}`, not `A-Z`: this app's default
 *  language is Ukrainian, D54, and an ASCII-only class silently fused every
 *  pair of Cyrillic sentences into one unsplittable, un-repeatable "sentence"
 *  — measured, two real Ukrainian sentences returned one 93-character hit),
 *  a digit, or an opening quote — straight or the typographic pairs this
 *  repo's design docs actually use (`« »`, `„ "`, `" "`). Over-splits on
 *  abbreviations ("e.g.", "Fig.") and under-splits the odd run-on sentence;
 *  accepted noise, same trade-off `src/claims/scan.ts`'s own rule patterns
 *  make explicitly — the ratchet absorbs it, a curated grammar is not
 *  needed for a diagnostic. No `|$` alternative: every caller already
 *  trims trailing whitespace before this runs (`paragraphs`'s own `flush`),
 *  so `\s+` immediately before end-of-string can never occur. */
function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])\s+(?=[\p{Lu}0-9"'«„“‘(`])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Lowercases and collapses whitespace — two occurrences of the same
 *  sentence with different surrounding spacing must still normalise to the
 *  same key. Markdown emphasis/heading/reference punctuation (`*_#>[]`) is
 *  stripped too, but backticks are DELIBERATELY left alone: an inline code
 *  span is kept literal by `scanFile`'s `.md` view (`fencedRanges`, below)
 *  precisely because it routinely carries the one identifier that tells two
 *  otherwise-identical sentences apart ("moved verbatim from `A21-A40.md`"
 *  vs. "…`A01-A20.md`") — stripping the backticks here would still keep the
 *  filename text itself, which is the part that actually needs to differ. */
function normalizeSentence(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_#>[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strips a leading line-comment (`//`, `///`) or block-comment
 *  (opener `/*`/`/**`, continuation `*`, closer) marker from every line —
 *  and a TRAILING closer too, when a JSDoc block's last content line ends
 *  its prose and closes the block on the same line ("continuation text. * /"
 *  — reflowed here without the space CommonMark would otherwise need to
 *  keep this comment itself well-formed). `scanFile`'s `.ts`/`.tsx` branch
 *  runs this on `commentRanges`' comment-only view before sentence
 *  detection, never `.md`. Necessary for the same reason `paragraphs` joins
 *  wrapped lines: a `.ts` comment routinely spans several adjacent
 *  line-comment lines, or a JSDoc block's `*`-prefixed continuation lines,
 *  with NO blank source line between them — `paragraphs` joins them into
 *  one block exactly as it should, but every marker character would then
 *  sit MID-PARAGRAPH between two sentences, and `splitSentences`'s boundary
 *  regex never recognises `/`/`*` as a valid continuation — silently gluing
 *  an entire multi-line comment into one unsplittable "sentence" that
 *  clears neither threshold. Without the trailing strip, a block comment's
 *  own closer glues a stray `" /"` onto its last sentence's key, so the
 *  IDENTICAL sentence written instead as a `//` comment (no closer to glue)
 *  normalised to a DIFFERENT key and the two never grouped as repeated —
 *  fixed the same way the leading strip is: markers only ever occur at a
 *  comment line's own start or end, never inside genuine prose, so
 *  stripping them here is safe everywhere this is called. */
function stripTsCommentMarkers(view: string): string {
  return view
    .split(/\r\n|\r|\n/)
    .map((line) =>
      line.replace(/^\s*(\/\*\*?|\*\/|\*(?!\/)|\/\/\/?)\s?/, '').replace(/\s*\*\/\s*$/, ''),
    )
    .join('\n');
}

/** Every sentence-shaped span (≥8 words, ≥50 normalised characters) found in
 *  `view` — `scanFile`'s masked prose view for `.md`/`.ts`, not raw file
 *  text (a `.ts`/`.tsx` file's CODE is not prose and would only add noise
 *  no ratchet should have to absorb). */
export function sentenceHits(relPath: string, view: string): SentenceHit[] {
  const hits: SentenceHit[] = [];
  for (const { line, text } of paragraphs(view)) {
    for (const raw of splitSentences(text)) {
      const words = raw.split(/\s+/).filter(Boolean);
      const key = normalizeSentence(raw);
      if (words.length >= MIN_WORDS && key.length >= MIN_CHARS) {
        hits.push({ file: relPath, line, key, excerpt: raw });
      }
    }
  }
  return hits;
}

export interface RepeatedGroup {
  key: string;
  /** Every occurrence across the whole repo — not just this group's own
   *  file, which is the whole point: a sentence groups with its twins in
   *  OTHER files. */
  hits: SentenceHit[];
  files: ReadonlySet<string>;
}

/** Groups sentence hits by their normalised key and keeps only groups whose
 *  occurrences span 2+ DISTINCT files — the design spec's own criterion
 *  ("Sentences repeated across 2+ files"). A sentence repeated twice within
 *  a single file (a doc quoting itself) is not this class of problem and is
 *  deliberately not flagged. */
export function groupRepeated(hits: readonly SentenceHit[]): RepeatedGroup[] {
  const byKey = new Map<string, SentenceHit[]>();
  for (const h of hits) {
    const arr = byKey.get(h.key);
    if (arr) arr.push(h);
    else byKey.set(h.key, [h]);
  }
  const groups: RepeatedGroup[] = [];
  for (const [key, groupHits] of byKey) {
    const files = new Set(groupHits.map((h) => h.file));
    if (files.size >= 2) groups.push({ key, hits: groupHits, files });
  }
  return groups;
}

/** Per-file instance count across every qualifying group — what the ratchet
 *  baseline compares, the same shape `src/claims/baseline.ts`'s
 *  `countsFromClaims` produces for the claim lint. */
export function repeatedCountsByFile(groups: readonly RepeatedGroup[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const g of groups) {
    for (const h of g.hits) counts[h.file] = (counts[h.file] ?? 0) + 1;
  }
  return counts;
}

// --- 2. Comment volume --------------------------------------------------------

export interface CommentCharsResult {
  file: string;
  /** Raw count of characters `commentRanges` classified as comment — NOT a
   *  ratio. A percentage (comment / total characters, rounded) changes
   *  whenever EITHER side changes, so a code-only edit with no comment in
   *  it still moves the ratio, and rounding can flip the reported integer:
   *  measured by appending one ordinary code line to every tracked
   *  `.ts`/`.tsx` file, 55 of 218 flipped their rounded percent, each
   *  requiring a baseline run for an edit that touched no comment at all —
   *  and in the wrong direction (more code lowers the ratio, so the ratchet
   *  reported the change as `stale`, "the file improved", which is not
   *  what happened). This absolute count is invariant under exactly that
   *  class of edit: appending code elsewhere in the file changes no
   *  existing comment range's length, so the sum is unchanged — probed the
   *  same way, 0 of 218 flip. It only moves when comment TEXT itself is
   *  added, edited or removed, which is the ratchet the design spec (§4)
   *  actually asked for. */
  chars: number;
}

/** `.ts`/`.tsx` only (`fileKind(relPath) === 'ts'`) — the question this
 *  check means is "how much explanation exists in this SOURCE FILE", which
 *  has no equivalent for `.md` (which is ALL prose) or `.sql` (no reusable
 *  comment extractor exists for it — see this module's README for why one
 *  is not being added here). `ranges` is `commentRanges`'s own output,
 *  threaded in by the caller so a `.ts` file is parsed by TypeScript once
 *  per scan, not twice (once for this, once for `sentenceHits`'s masked
 *  view). */
export function commentChars(relPath: string, ranges: readonly CodeRange[]): CommentCharsResult {
  return { file: relPath, chars: ranges.reduce((sum, r) => sum + (r.end - r.start), 0) };
}

// --- 3. History-in-the-artifact ---------------------------------------------

/** Narration that belongs in a commit message, not in the artifact it
 *  describes — "which git already holds" (design spec §4). Two are the
 *  spec's own worked examples; the rest are this repository's own recurring
 *  idioms for the same thing, found by grepping the tree for how its tests
 *  and decisions actually narrate their own history — deliberately NOT
 *  general past-tense words ("previously", "no longer", "originally"): this
 *  repository is decision-heavy and legitimately dates things constantly
 *  (`docs/decisions/`, `CLAUDE.md`'s own "swapped 2026-08-12 because…") —
 *  that is D-numbered decision content, a different, already-governed
 *  class, not the development-process narration this check targets.
 *  `/verified before this fix/` is deliberately NOT its own entry — it
 *  CONTAINS `/before this fix/`, so both would match the identical text and
 *  double-count every occurrence (and halve, not zero, the count when one
 *  is removed — a stale-baseline trap of this check's own making).
 *  `CRITICAL:`/`PIN:` are likewise deliberately ABSENT, not merely unlisted
 *  — this repo's tests use both as a forward-looking severity marker on a
 *  regression pin ("this must never silently pass again"), not backward-
 *  looking narration of how the bug was found; `src/facts/fences.test.ts`
 *  alone carries 9 of them. Same "a different, already-governed class"
 *  reasoning as the past-tense exclusion just above, applied to a
 *  convention instead of a decision record. */
const HISTORY_PHRASES: RegExp[] = [
  /the first draft/gi,
  /review found/gi,
  /fix round \d+/gi,
  /before this fix/gi,
  /after this fix/gi,
  /the exact review reproduction/gi,
  /already tried and reverted/gi,
  /ruled it out of scope/gi,
  /not something to redo/gi,
  /a prior task/gi,
  /prior attempt/gi,
  /a previous attempt/gi,
  /shipped with (?:precisely |exactly )?that defect/gi,
  /was already correct but untested/gi,
  /pre-merge review/gi,
  /the predecessor/gi,
  /second proof/gi,
  /third proof/gi,
];

export interface HistoryHit {
  file: string;
  line: number;
  match: string;
}

/** Every history-phrase occurrence in `view`, one RAW line at a time (no
 *  paragraph joining). Used for a `.ts`/`.tsx` file's WHOLE, unmasked text
 *  (see `scanFile` below for why) — consecutive non-blank CODE lines are
 *  independent statements, not a wrapped sentence, so joining them the way
 *  `historyHitsInProse` joins genuine prose would glue unrelated statements
 *  together and attribute every hit in a dense file to one early line; a
 *  `describe`/`it` title is already confined to a single physical line in
 *  this codebase, so line-by-line scanning does not miss it. */
export function historyHits(relPath: string, view: string): HistoryHit[] {
  const hits: HistoryHit[] = [];
  const lines = view.split(/\r\n|\r|\n/);
  lines.forEach((line, idx) => {
    for (const re of HISTORY_PHRASES) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        hits.push({ file: relPath, line: idx + 1, match: m[0] });
      }
    }
  });
  return hits;
}

/** Runs the same phrase pass as `historyHits`, but over `view` PARAGRAPH-
 *  JOINED first (`paragraphs`, the same soft-wrap-aware join `sentenceHits`
 *  uses) — a phrase split across a wrap ("review\nfound", the exact shape
 *  this repo's prose wraps at) is otherwise invisible to a line-by-line
 *  scan. Every hit is attributed to its PARAGRAPH's start line, the same
 *  declared approximation `sentenceHits` already makes. Finds EVERY hit,
 *  wrapped or not — the right behaviour for `.md`, where `scanFile` runs
 *  this ALONE (nothing else scans the same view, so nothing must be left
 *  for another pass to catch). For `.ts`'s comment view, which a second,
 *  raw line-based pass ALSO scans, use `wrapOnlyHistoryHits` instead. */
export function historyHitsInProse(relPath: string, view: string): HistoryHit[] {
  const hits: HistoryHit[] = [];
  for (const { line, text } of paragraphs(view)) {
    for (const h of historyHits(relPath, text)) hits.push({ ...h, line });
  }
  return hits;
}

/** The WRAP-ONLY subset of `historyHitsInProse(relPath, view)`: a hit whose
 *  matched text already appears whole within one of its own paragraph's
 *  `rawLines` was reachable without joining anything, so a plain per-line
 *  scan of `view` finds (or would find) it too — counting it again here
 *  would double it. Only a hit whose match exists in the JOINED text but in
 *  NO single raw line is a genuine wrap-catch. This is what lets
 *  `scanFile`'s `.ts` branch combine this with `historyHits` over the
 *  file's whole raw text (which already finds every un-wrapped comment
 *  phrase, plus every `describe`/`it` string literal) without
 *  double-counting anything both would otherwise see. */
export function wrapOnlyHistoryHits(relPath: string, view: string): HistoryHit[] {
  const hits: HistoryHit[] = [];
  for (const { line, text, rawLines } of paragraphs(view)) {
    for (const h of historyHits(relPath, text)) {
      const alreadyLineVisible = rawLines.some((l) => l.includes(h.match));
      if (!alreadyLineVisible) hits.push({ ...h, line });
    }
  }
  return hits;
}

export function historyCountsByFile(hits: readonly HistoryHit[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const h of hits) counts[h.file] = (counts[h.file] ?? 0) + 1;
  return counts;
}

/** Three prefixes, excluded from BOTH the history-phrase check AND the
 *  repeated-sentence check:
 *  - `docs/decisions/` and `docs/archive/` — narrating history is what a
 *    decision record is FOR (§4's "git already holds it" rationale does not
 *    apply to a document whose job is to make that history discoverable as
 *    prose), and every one of the 97 `docs/decisions/D<n>.md` files shares
 *    an identical structural footer BY DESIGN, as does every
 *    `docs/archive/plan-a/section-*.md` file's "moved verbatim" line — a
 *    new decision or a newly-closed task, created exactly as `CLAUDE.md`
 *    instructs, would otherwise be immediately `over` a baseline of 0, and
 *    archiving one moves its sentences to a new path, `stale` on the old.
 *    Both trees are also immutable (D96), so a violation there could only
 *    be "fixed" by editing a record this repository forbids editing.
 *  - `src/distillation/` — DECLARED LIMIT: this module IS the check, so
 *    `HISTORY_PHRASES`' own pattern literals and `scan.test.ts`'s fixtures
 *    exercising them are what the check finds when it scans itself
 *    (measured: 52% of the whole-repo baseline, before this exemption, came
 *    from here alone) — adding a phrase makes the source line defining it
 *    match itself, turning the gate red on the file that DEFINES the
 *    check, which is not a defect in the file.
 *
 *  See `src/distillation/README.md`. The trade-off for the first two:
 *  organic, non-template duplication inside either tree also goes
 *  unflagged — accepted, since both are already governed by their own
 *  mechanisms (D96 immutability, the D95 "moved verbatim" archival
 *  convention), not this ratchet. */
const DISTILLATION_EXEMPT_PREFIXES = ['docs/decisions/', 'docs/archive/', 'src/distillation/'];

function isDistillationExempt(relPath: string): boolean {
  return DISTILLATION_EXEMPT_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

// --- Fenced-vs-inline code, for Markdown only -------------------------------

/** `codeRanges`'s output conflates fenced-block ranges (one entry per
 *  physical line the fence spans) with single-line INLINE code-span ranges
 *  — see `src/facts/fences.ts`. Sentence/history detection over `.md` prose
 *  must mask the former (real code, not prose) but must NOT mask the
 *  latter: an inline span routinely carries the one identifier that tells
 *  two otherwise-identical sentences apart ("moved verbatim from
 *  `A21-A40.md`" vs. "…`A01-A20.md`") — blanking it collapsed both to the
 *  same normalised key, understating a 13-instance and a 97-instance group
 *  alike as artefacts of erased identifiers rather than genuine repeats.
 *
 *  Distinguishing the two kinds without a second scanner: every range
 *  `codeRanges` emits for a FENCED line always ends immediately after that
 *  line's own newline (`lineAfter`, by construction) — or at literal EOF,
 *  for an unterminated final line. An INLINE span's range instead always
 *  ends immediately after its own CLOSING BACKTICKS, which sit before that
 *  line's newline even when the span is the only thing on the line — so
 *  `text[r.end - 1] === '\n'` is true for a fenced-line range and false for
 *  an inline one, in every case except a file with no trailing newline
 *  whose very last content is either kind (treated as fenced here, the
 *  safer default: losing one trailing inline identifier is a smaller error
 *  than scanning a trailing fenced line as prose). */
function isFencedRange(text: string, r: CodeRange): boolean {
  return r.end === text.length || text[r.end - 1] === '\n';
}

function fencedRanges(text: string): CodeRange[] {
  return codeRanges(text).filter((r) => isFencedRange(text, r));
}

// --- Per-file dispatch --------------------------------------------------------

export interface FileScan {
  sentences: SentenceHit[];
  commentChars: CommentCharsResult | null;
  history: HistoryHit[];
}

/** Scans one file's text for all three checks at once, dispatched by
 *  `fileKind` exactly as `src/claims/scan.ts`'s own `scanFile` does. `text`
 *  is normalised (`normalizeLineEndings`) before anything else runs.
 *  - `.md` — prose with FENCED code blanked but inline code spans kept
 *    literal (`fencedRanges`, above — not `codeRanges` directly) feeds BOTH
 *    sentence detection and history-phrase detection (`historyHitsInProse`,
 *    which paragraph-joins first).
 *  - `.ts`/`.tsx` — `commentRanges`, parsed once, feeds the comment-only,
 *    marker-stripped view sentence detection uses AND (unstripped) the
 *    comment-volume count directly. History-phrase detection runs TWICE and
 *    merges: `historyHits` over the raw, unmasked whole text, scanned
 *    line-by-line (catches `describe`/`it` string literals, which are
 *    code, and any un-wrapped comment phrase), PLUS `historyHitsInProse`
 *    over the marker-stripped comment view (catches a phrase wrapped across
 *    a JSDoc continuation line — three real instances existed, e.g. "the
 *    first" ending one `*`-prefixed line and "draft" starting the next).
 *    `historyHitsInProse`'s own dedup is what keeps this from double-
 *    counting an un-wrapped comment phrase both passes would otherwise see.
 *  - `.sql` and anything else — excluded from all three checks. `.sql` has
 *    no fenced-code convention (`codeRanges` does not apply) and no
 *    existing comment extractor (`commentRanges` is TypeScript-specific);
 *    building a third masker for one file kind is exactly the "fifth
 *    scanner" this module was told not to write.
 *  - The three `isDistillationExempt` prefixes — excluded from sentence and
 *    history detection alike; still fully in scope for comment volume
 *    (moot in practice — none of the three carries `.ts`/`.tsx` files).
 *
 *  Can throw — a genuinely unclosed Markdown fence (`codeRanges`) or a
 *  `.ts`/`.tsx` file `commentRanges` rejects — same declared-damage classes
 *  `src/claims/repo-scan.ts` already classifies; propagated here for the
 *  same reason, and caught the same way by this module's own `repo-scan.ts`. */
export function scanFile(relPath: string, rawText: string): FileScan {
  const text = normalizeLineEndings(rawText);
  const kind = fileKind(relPath);
  const exempt = isDistillationExempt(relPath);

  if (kind === 'md') {
    const view = blank(text, fencedRanges(text));
    return {
      sentences: exempt ? [] : sentenceHits(relPath, view),
      commentChars: null,
      history: exempt ? [] : historyHitsInProse(relPath, view),
    };
  }

  if (kind === 'ts') {
    const ranges = commentRanges(text, relPath);
    const strippedCommentView = stripTsCommentMarkers(keepOnly(text, ranges));
    return {
      sentences: exempt ? [] : sentenceHits(relPath, strippedCommentView),
      commentChars: commentChars(relPath, ranges),
      history: exempt
        ? []
        : [...historyHits(relPath, text), ...wrapOnlyHistoryHits(relPath, strippedCommentView)],
    };
  }

  return { sentences: [], commentChars: null, history: [] };
}
