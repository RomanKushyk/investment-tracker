import { codeRanges, blank, keepOnly, FACT_KEY_SRC, type CodeRange } from '../facts/fences';
import { commentRanges } from './comments';

export type Rule = 1 | 2 | 3;

export interface Claim {
  /** Repo-relative, POSIX separators — matches how the baseline keys files. */
  file: string;
  /** 1-based. */
  line: number;
  rule: Rule;
  /** The matched text, for a human-readable failure message. */
  match: string;
  /** True when `<!--unchecked: reason-->` sits on the same line. Still a
   *  real claim (kept in the list, e.g. for `facts.ts`'s derived count) —
   *  just excluded from what the ratchet counts as failing. */
  unchecked: boolean;
}

export type FileKind = 'md' | 'sql' | 'ts';

export function fileKind(relPath: string): FileKind | null {
  if (relPath.endsWith('.md')) return 'md';
  if (relPath.endsWith('.sql')) return 'sql';
  // A pure ambient declaration file has no runtime code and, per
  // src/README.md's own top-level file table, "no behaviour to describe" —
  // same reasoning, applied here for a second, load-bearing reason:
  // ts.transpileModule cannot EMIT a .d.ts (nothing to emit) and crashes
  // with an internal "Debug Failure. Output generation failed" rather than
  // returning a diagnostic, which `commentRanges` has no way to recover
  // from. Checked before the plain `.ts` branch, which would otherwise
  // shadow it (`.d.ts` ends with `.ts` too).
  if (relPath.endsWith('.d.ts')) return null;
  if (relPath.endsWith('.ts') || relPath.endsWith('.tsx')) return 'ts';
  return null;
}

// --- Rule patterns -----------------------------------------------------
//
// Deliberately literal, not hand-tuned to a target count — the design spec
// (docs/superpowers/specs/2026-08-26-verifiable-documentation-design.md §2)
// was chosen specifically over a narrower rule that would have flagged far
// fewer places, and the baseline ratchet (not a curated pattern) is what
// keeps the noise this produces from blocking work. Nouns/units below are a
// representative, not exhaustive, set of "measured shape" and "repository
// thing" — widening or narrowing them is a judgement call each time, not a
// bug to chase.

/** Rule 1 — a bare number carrying one of the four measured-shape units the
 *  spec names verbatim: DPU, ms, %, ×. `(?![A-Za-z0-9])` after the unit
 *  stops it matching as a prefix of a longer word (e.g. a stray "msg").
 *  `[^\S\r\n]*` between the number and the unit, not `\s*` — `\s` also
 *  matches a newline, which would let a number on one line pair with a
 *  unit on the next as if they were adjacent. */
const RULE1_RE = /\d[\d,]*(?:\.\d+)?[^\S\r\n]*(?:DPU|ms|%|×)(?![A-Za-z0-9])/g;

/** Rule 2 — a bare number immediately followed (within two words) by a noun
 *  naming a repository thing — a line count, a file count, a decision
 *  count, and so on. */
const REPO_NOUNS = [
  'lines?',
  'files?',
  'tests?',
  'decisions?',
  'findings?',
  'tables?',
  'rows?',
  'columns?',
  'functions?',
  'comments?',
  'instances?',
  'commits?',
  'branches?',
  'components?',
  'screens?',
  'routes?',
  'tasks?',
  'keys?',
  'fields?',
  'types?',
  'hooks?',
  'stores?',
  'quer(?:y|ies)',
  'migrations?',
  'snapshots?',
  'transactions?',
  'assets?',
  'alarms?',
  'endpoints?',
  'props?',
  'params?',
  'records?',
  'entr(?:y|ies)',
  'sections?',
  'plans?',
  'folders?',
  'modules?',
  'scripts?',
  'constraints?',
  'index(?:es)?|indices',
  'facts?',
  'fences?',
  'claims?',
  'datasets?',
  'dialogs?',
  'tabs?',
  'pages?',
];
// `(?<![\d.])` before the number — without it, "3.5 files" matches "5
// files": `\d[\d,]*` is free to start mid-decimal, since this rule (unlike
// rule 1) has no fractional branch — counts of repository things are
// integers. The lookbehind refuses to START a match right after a digit or
// a decimal point, so a genuine decimal number is skipped whole rather than
// fragmented, not taught to parse one. `[^\S\r\n]+`, not `\s+`, in both
// gaps — `\s` matches a newline, which would let the number and its noun
// pair across a line or paragraph break and get attributed to the wrong
// line.
const RULE2_RE = new RegExp(
  String.raw`(?<![\d.])\d[\d,]*[^\S\r\n]+(?:\p{L}+[^\S\r\n]+){0,2}(?:${REPO_NOUNS.join('|')})\b`,
  'giu',
);

/** Rule 3 — an absolute quantifier ("never", "only", "nothing", …). Design
 *  intent with no identifier cited passes (the spec's own two clean
 *  examples); the same wording naming a backtick-wrapped code symbol fails
 *  unless the same line also cites a fact or carries the escape hatch —
 *  see the design spec §2 for the worked pair. "one"/"ONE" deliberately
 *  excluded: as a bare numeral it is far too common to use as a trigger,
 *  and neither of the spec's passing examples needs it exempted for a
 *  different reason — they simply name no identifier. */
// `(?<![\w-])`/`(?![\w-])`, not `\b` — a plain `\b` treats the hyphen in
// "read-only" as a word boundary (it is not a word character), so `only`
// alone would match as if it were standalone. Excluding hyphen-adjacency
// too closes that specific false-positive class (a hyphenated compound —
// "read-only", "self-contained" — is not the word used as a quantifier)
// without narrowing which STANDALONE occurrences of these words count.
// `[^\S\r\n]+`, not `\s+`, inside the three multi-word alternatives — the
// same newline-crossing bug rules 1 and 2 were fixed for: `\s` matches a
// line break, so "the only\n`X`" would otherwise still read as "the only"
// wrapping onto the next line, silently losing the claim if a paragraph is
// re-wrapped with no content change.
const ABSOLUTE_RE =
  /(?<![\w-])(?:never|always|nothing|none|only|solely|exclusively|cannot|must[^\S\r\n]+never|the[^\S\r\n]+only|the[^\S\r\n]+sole)(?![\w-])/gi;

/** The "names a code identifier" half of rule 3 — a backtick span shaped
 *  like code: dotted (`Transaction.source`), a call (`foo()`), CONST_CASE,
 *  camelCase, or a filename with a known extension — including a full
 *  repo-relative path (`src/components/ui/Scroller.tsx`): `/` is in the
 *  filename branch's character class precisely because this repo mostly
 *  cites files that way, not by bare name, and excluding it made that the
 *  rule's largest blind spot: the identical exclusivity claim was flagged
 *  or missed depending only on whether the path shown was a bare filename
 *  or included its directory. Plain emphasis words in backticks (`` `only` ``) match
 *  none of these shapes. Non-global — reused via `.exec()`, one line at a
 *  time, so there is no `lastIndex` to go stale between calls. */
const CODE_IDENT_RE =
  /`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|[A-Za-z_$][\w$]*\(\)|[A-Z][A-Z0-9_]{2,}|[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[\w./-]+\.(?:ts|tsx|sql|md|json|ya?ml))`/;

/** The escape hatch — greppable, and identical across all three file kinds
 *  (see src/claims/README.md for why one form covers `.md`, `.sql` and
 *  `.ts`: it only has to sit inside an already-open comment, never be
 *  parsed as syntax by the host language). Suppresses whatever rule 1/2/3
 *  claim(s) share its line. Two deliberate departures from the spec's own
 *  literal `[^>]*` reason pattern, both load-bearing:
 *  - an optional space right after the opening `<!--`, so both natural
 *    spellings of the tag are accepted, not only the exact one spelled;
 *  - the reason may contain a bare `>` (`[^\r\n]*?`, non-greedy, stops at
 *    the nearest closer rather than the reason's first `>` character,
 *    which is what silently broke a reason like "true only when a > b
 *    holds").
 *  `[^\r\n]*?`, not `[\s\S]*?` — a reason must never be allowed to cross a
 *  line, because doing so would let it eat past the newline into whatever
 *  comes next, defeating the "same line as the claim it excuses" contract
 *  this whole mechanism rests on. The `(?=[^\r\n]*?\S[^\r\n]*?-->)`
 *  lookahead requires some non-whitespace character before the nearest
 *  closer, so an empty-or-blank-reason marker correctly fails to match at
 *  all (defeating the entire point of requiring a reason) rather than
 *  "succeeding" with an empty one, which a simpler `[^\r\n]*?` alone would
 *  do. Case-SENSITIVE, deliberately — see
 *  `UNCHECKED_ATTEMPT_RE` below for why a wrong-case marker throws instead
 *  of silently matching here. Non-global — reused via `.test()`/`.exec()`
 *  against one line at a time, so there is no `lastIndex` to go stale
 *  between calls. */
export const UNCHECKED_RE = /<!--[ \t]*unchecked:(?=[^\r\n]*?\S[^\r\n]*?-->)[^\r\n]*?-->/;

/** Broader than `UNCHECKED_RE` on purpose, and case-INSENSITIVE where
 *  `UNCHECKED_RE` is not: an empty reason or a dropped closer, after the
 *  right prefix in any case, is a typo, not a marker, and
 *  `assertWellFormedUnchecked` below throws on it rather than letting it
 *  silently fall through and get scanned as an ordinary, un-suppressed
 *  claim with no hint anything was attempted. Without the `i` flag here, a
 *  capitalised spelling of the tag's own name matched NEITHER regex and
 *  produced exactly that silent fall-through — the one case this file's
 *  `.test()` calls stay case-sensitive for is the STRICT marker itself,
 *  not the detector that decides whether to demand it.
 *
 *  The colon is REQUIRED here, not just in `UNCHECKED_RE` — an earlier
 *  version matched on the bare word `unchecked`, which made an ordinary
 *  HTML comment like `<!-- unchecked items below -->` or
 *  `<!--unchecked-boxes-->` look like a botched attempt and throw. Neither
 *  contains this mechanism's own syntax at all; requiring the colon before
 *  anything is even considered an attempt is the unambiguous line between
 *  "this text is trying to be our marker" and "this text merely contains
 *  the English word". */
const UNCHECKED_ATTEMPT_RE = /<!--[ \t]*unchecked:/gi;

/** Throws, naming the file and line, the first time some attempted
 *  escape-hatch marker in `view` fails to resolve to a well-formed
 *  `UNCHECKED_RE` match starting at that same position. */
function assertWellFormedUnchecked(file: string, view: string, starts: readonly number[]): void {
  for (const m of view.matchAll(UNCHECKED_ATTEMPT_RE)) {
    const found = UNCHECKED_RE.exec(view.slice(m.index));
    if (!found || found.index !== 0) {
      throw new Error(
        `${file}:${lineNumberAt(starts, m.index)}: looks like the unchecked-hatch marker but ` +
          `does not parse — needs a colon and a "-->" closer, e.g. ` +
          `\`<!--unchecked: reason-->\``,
      );
    }
  }
}

/** A rendered fact fence (`<!--f:key-->value<!--/f-->`) — masked out before
 *  rule 1/2 run, and required in full (not merely the `<!--f:` opener) to
 *  exempt rule 3's line, because a number or identifier reached through the
 *  fact registry is cited, not bare. Syntactic well-formedness alone is NOT
 *  enough, either for the mask or the citation: `key` is captured and every
 *  caller of `factFenceRanges`/`citesKnownFact` below must check it against
 *  `knownFactKeys` before treating a match as real — otherwise
 *  `<!--f:totally.made.up-->99<!--/f-->` masks a bare rule-1/2 number, or
 *  exempts rule 3's line, on a key nothing resolves.
 *
 *  BOTH exemptions are `.md`-only, in both directions — see `NO_FACT_KEYS`
 *  below for why `.ts`/`.sql` never see the real registry at all: nothing
 *  outside `.md` renders or checks a fence's value, so even a REAL key
 *  cited there is a hand-written number wearing a machine-maintained
 *  appearance that `pnpm facts` will never touch and no test will ever
 *  read. Use the escape hatch there instead.
 *
 *  `[^\r\n]*?`, not `[\s\S]*?`, for the value — the same "must stay on one
 *  line" reason `UNCHECKED_RE` does. The key's own character class is
 *  `src/facts/fences.ts`'s exported `FACT_KEY_SRC`, not a second copy of
 *  it — a re-typed class here would silently stop matching a key
 *  `fences.ts` widens tomorrow, with no failing test to say so. Not a
 *  second implementation of that module's tokenizer otherwise, which has
 *  to additionally reject malformed/unclosed fences; this one only ever
 *  needs to find well-formed pairs and check their key, and a malformed
 *  fence is already caught elsewhere (`fences.test.ts`'s repo-wide drift
 *  check). Global — reused via `matchAll` everywhere (masking and the
 *  single-line citation check alike), which needs no statefulness to
 *  worry about. */
const FACT_FENCE_RE = new RegExp(`<!--f:([${FACT_KEY_SRC}]+)-->[^\\r\\n]*?<!--\\/f-->`, 'g');

/** What `scanRegion` is given as `knownFactKeys` for `.ts`/`.sql`,
 *  irrespective of what the real registry contains. Restricts the
 *  fact-citation exemption to `.md` without a second code path, since a
 *  lookup against an empty set is guaranteed to fail every time. The
 *  reasoning is `FACT_FENCE_RE`'s own doc comment, above: a fence outside
 *  `.md` goes entirely unrendered and unchecked. */
const NO_FACT_KEYS: ReadonlySet<string> = new Set();

// --- Masking -------------------------------------------------------------
//
// `blank`/`keepOnly` are imported from `../facts/fences` — see their own
// doc comments there for the sorted/non-overlapping precondition both
// assume, and what breaks (silently) if a caller violates it.

/** Keeps a fence whose key is in `knownFactKeys`, drops the rest — see
 *  `FACT_FENCE_RE`'s own doc comment for why a syntactically well-formed
 *  but forged key must not qualify. */
function factFenceRanges(text: string, knownFactKeys: ReadonlySet<string>): CodeRange[] {
  const ranges: CodeRange[] = [];
  for (const m of text.matchAll(FACT_FENCE_RE)) {
    if (knownFactKeys.has(m[1])) ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  return ranges;
}

/** True when `lineText` contains a fence citing a REAL key — the rule 3
 *  exemption's own gate, same key-resolution rule as `factFenceRanges`. */
function citesKnownFact(lineText: string, knownFactKeys: ReadonlySet<string>): boolean {
  for (const m of lineText.matchAll(FACT_FENCE_RE)) {
    if (knownFactKeys.has(m[1])) return true;
  }
  return false;
}

// --- Line bookkeeping ------------------------------------------------------

/** Character offset of the start of every line, 0-indexed (`starts[0]` is
 *  0). Precomputed once per file so `lineNumberAt`/`lineBounds` are O(log
 *  n) instead of an O(n) rescan per match. */
function lineIndex(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineNumberAt(starts: readonly number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** `[start, end)` of the line containing `pos`, trailing `\n`/`\r` excluded
 *  from `end`, so a plain substring search on it never crosses a line. */
function lineBounds(starts: readonly number[], text: string, pos: number): CodeRange {
  const n = lineNumberAt(starts, pos) - 1;
  const start = starts[n];
  let end = n + 1 < starts.length ? starts[n + 1] - 1 : text.length;
  if (end > start && text[end - 1] === '\r') end -= 1;
  return { start, end };
}

// --- The scan --------------------------------------------------------------

/** `numbersView` — code AND rendered fact fences blanked; rule 1/2 match
 *  against this, so a cited number does not show up bare. `proseView` —
 *  code blanked, fact fences left LITERAL; rule 3's absolute-word search and
 *  every escape-hatch/fact-citation lookup use this instead, because both
 *  need to still see the `<!--f:` text a fact citation renders as — which
 *  `numbersView` has already erased. `identSource` — where rule 3 looks for
 *  the backtick-wrapped identifier itself (see `scanFile` below for why
 *  this differs by file kind). All three are the same length, with
 *  identical newline positions, so one `starts` index serves all of them. */
function scanRegion(
  file: string,
  numbersView: string,
  proseView: string,
  identSource: string,
  knownFactKeys: ReadonlySet<string>,
): Claim[] {
  const starts = lineIndex(proseView);
  assertWellFormedUnchecked(file, proseView, starts);
  const claims: Claim[] = [];

  const lineTextAt = (pos: number) => {
    const { start, end } = lineBounds(starts, proseView, pos);
    return proseView.slice(start, end);
  };

  const push = (rule: Rule, pos: number, match: string) => {
    claims.push({
      file,
      line: lineNumberAt(starts, pos),
      rule,
      match: match.trim(),
      unchecked: UNCHECKED_RE.test(lineTextAt(pos)),
    });
  };

  for (const m of numbersView.matchAll(RULE1_RE)) push(1, m.index, m[0]);
  for (const m of numbersView.matchAll(RULE2_RE)) push(2, m.index, m[0]);

  for (const m of proseView.matchAll(ABSOLUTE_RE)) {
    const pos = m.index;
    const lineText = lineTextAt(pos);
    if (citesKnownFact(lineText, knownFactKeys)) continue; // cites a fact — the fix IS citing it
    const { start, end } = lineBounds(starts, identSource, pos);
    const idMatch = CODE_IDENT_RE.exec(identSource.slice(start, end));
    if (!idMatch) continue;
    push(3, pos, `${m[0]} … ${idMatch[0]}`);
  }

  return claims;
}

/** Scans one file's text for claim-lint violations. `relPath` decides both
 *  scope (only `.md`/`.sql`/`.ts`/`.tsx` are scanned — anything else
 *  returns `[]`) and how much of the text is in play:
 *  - `.md` — the whole file, minus fenced/inline code (`codeRanges`,
 *    imported, not reimplemented). Rule 3's identifier search runs against
 *    the fully unmasked text, because the identifier it looks for is
 *    normally itself an inline code span, which `codeRanges` would
 *    otherwise blank right along with everything else.
 *  - `.sql` — wholesale, no masking: SQL has no fenced-block convention of
 *    its own, so there is nothing to exempt.
 *  - `.ts`/`.tsx` — comment blocks alone (`commentRanges`), everything else
 *    blanked; rule 3's identifier search runs against that same masked
 *    view, since a citation inside a comment is the sole kind in scope.
 *
 *  `knownFactKeys` is the real fact registry's key set (`Object.keys(FACTS)`
 *  from `src/facts/facts.ts`, threaded in by the caller — see
 *  `repo-scan.ts` for why this module does not import `FACTS` directly) —
 *  what a `.md` fact-fence citation is checked against before it is
 *  allowed to exempt anything. `.sql`/`.ts` are always given the empty
 *  `NO_FACT_KEYS` below instead — the exemption is `.md`-only in both
 *  directions. */
export function scanFile(
  relPath: string,
  text: string,
  knownFactKeys: ReadonlySet<string>,
): Claim[] {
  const kind = fileKind(relPath);
  if (kind === null) return [];

  if (kind === 'sql') return scanRegion(relPath, text, text, text, NO_FACT_KEYS);

  if (kind === 'ts') {
    const view = keepOnly(text, commentRanges(text, relPath));
    return scanRegion(relPath, view, view, view, NO_FACT_KEYS);
  }

  // md — codeRanges can throw on a genuinely unclosed fence; that is the
  // same signal fences.test.ts's drift check already relies on, so it is
  // allowed to propagate here too rather than being swallowed.
  const proseView = blank(text, codeRanges(text));
  const numbersView = blank(proseView, factFenceRanges(proseView, knownFactKeys));
  return scanRegion(relPath, numbersView, proseView, text, knownFactKeys);
}
