import { renderFact, type Fact } from './registry';

const OPEN = /<!--f:([a-zA-Z0-9._-]+)-->/y;
const CLOSE = '<!--/f-->';
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/** Strip the "code context" markers this scanner recognises cheaply — a
 *  single blockquote level ("> ") and one leading tab — before checking a
 *  line for a fence marker. Deliberately NOT 4-space indentation: telling an
 *  indented code block apart from a list-item continuation is CommonMark's
 *  hairiest corner, this repo's docs are dense with indented list content,
 *  and a wrong guess there would silently SKIP real fences inside list
 *  items — worse than the bug this exists to fix. The convention here is
 *  ``` fences. */
function stripCodeContext(line: string): string {
  const bq = /^ {0,3}> ?/.exec(line);
  if (bq) return line.slice(bq[0].length);
  if (line.startsWith('\t')) return line.slice(1);
  return line;
}

/** The line's content for MATCHING a fence/context marker — never for output.
 *  `text.slice(i, lineEnd)` stops before the `\n` but keeps a `\r` right
 *  before it on a CRLF file. `.` does not match `\r` (it is a line
 *  terminator to the regex engine), so `FENCE_OPEN`'s trailing `(.*)$` could
 *  never reach the end of a CRLF line and rejected every CRLF-opened fence —
 *  while `FENCE_CLOSE`'s `\s*$` tolerated it fine, closing what the opener
 *  never opened. Stripping it once here, before either regex runs, removes
 *  the asymmetry instead of patching each pattern separately. */
function matchLine(line: string): string {
  return stripCodeContext(line).replace(/\r$/, '');
}

export interface CodeRange {
  start: number;
  end: number;
}

/** Every `[start, end)` character range in `text` that is CODE — inside a
 *  fenced block (``` or ~~~, blockquote/tab context stripped, a
 *  same-or-longer closer of the same character) or an inline code span (a
 *  run of N backticks closed by the next run of exactly N backticks on the
 *  same line). `rewrite` below is built on this — its own inline
 *  `<!--f:key-->` fences skip whatever this reports as code — and
 *  src/decisions/render.ts's block-level `<!-- decisions:rows -->` markers
 *  use it too, for the same reason: one scanner, so the hardening below
 *  protects both instead of one copy earning it and the other drifting.
 *
 *  - A backtick-fenced opener with a backtick in its info string never
 *    opens at all (CommonMark) — treating it as one is how a false fence
 *    blinds every real one after it to EOF.
 *  - A fence that never closes throws `unclosed code fence opened on line
 *    N` rather than silently marking the rest of the file as code.
 *  - The blockquote/tab strip applies unconditionally, even to a line that
 *    is CONTENT inside an already-open fence — so a blockquoted or
 *    tab-indented fence marker quoted as an example inside an open fence
 *    reads as a real closer and ends the block early. Declared limit, not a
 *    bug — see src/facts/README.md's "Rules". */
export function codeRanges(text: string): CodeRange[] {
  const ranges: CodeRange[] = [];
  let i = 0;
  let lineNo = 1;
  let fence: { char: string; len: number; openedOnLine: number } | null = null;

  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    const lineEnd = nl === -1 ? text.length : nl;
    const lineAfter = nl === -1 ? text.length : nl + 1;
    const atLineStart = i === 0 || text[i - 1] === '\n';

    if (fence) {
      ranges.push({ start: i, end: lineAfter });
      const closer = FENCE_CLOSE.exec(matchLine(text.slice(i, lineEnd)));
      if (closer && closer[1][0] === fence.char && closer[1].length >= fence.len) fence = null;
      i = lineAfter;
      if (nl !== -1) lineNo += 1;
      continue;
    }

    if (atLineStart) {
      const opener = FENCE_OPEN.exec(matchLine(text.slice(i, lineEnd)));
      if (opener && (opener[1][0] === '~' || !opener[2].includes('`'))) {
        fence = { char: opener[1][0], len: opener[1].length, openedOnLine: lineNo };
        ranges.push({ start: i, end: lineAfter });
        i = lineAfter;
        if (nl !== -1) lineNo += 1;
        continue;
      }
    }

    const ch = text[i];

    if (ch === '\n') {
      i += 1;
      lineNo += 1;
      continue;
    }

    if (ch === '`') {
      let runEnd = i;
      while (runEnd < text.length && text[runEnd] === '`') runEnd += 1;
      const runLen = runEnd - i;
      let k = runEnd;
      let closerEnd = -1;
      while (k < lineEnd) {
        if (text[k] === '`') {
          let ce = k;
          while (ce < lineEnd && text[ce] === '`') ce += 1;
          if (ce - k === runLen) {
            closerEnd = ce;
            break;
          }
          k = ce;
        } else {
          k += 1;
        }
      }
      // No same-length closer on this line: the run is literal text, not an
      // open span — an unterminated backtick must not poison the rest of the
      // scan.
      const spanEnd = closerEnd === -1 ? runEnd : closerEnd;
      if (closerEnd !== -1) ranges.push({ start: i, end: spanEnd });
      i = spanEnd;
      continue;
    }

    i += 1;
  }

  if (fence) {
    throw new Error(
      `unclosed code fence opened on line ${fence.openedOnLine} — reached end of file still inside it`,
    );
  }

  return ranges;
}

export function inCode(ranges: CodeRange[], pos: number): boolean {
  return ranges.some((r) => pos >= r.start && pos < r.end);
}

/** Find this fence's `<!--/f-->` in `text[from, to)`, skipping over inline
 *  code spans — a run of N backticks closed by the next run of exactly N
 *  backticks within the range, same matching as `codeRanges`. A `CLOSE`
 *  occurrence inside such a span does not count: a `<!--/f-->` shown as an
 *  example inside backticks is not a real closer. An unterminated run (no
 *  same-length closer before `to`) is literal text, searched like anything
 *  else — same "don't let one stray backtick poison everything after it"
 *  rule as the main scan's span handling.
 *
 *  Also stops — as if unclosed — at an intervening `<!--f:`, well-formed or
 *  not: two openers on one line ("A <!--f:k-->3 B <!--f:k-->4<!--/f-->")
 *  must not let the SECOND fence's closer resolve the first and silently
 *  fold everything between them (including the whole second fence) into
 *  the first's value. Returns -1 if no valid closer exists. */
function findCloser(text: string, from: number, to: number): number {
  let k = from;
  while (k < to) {
    if (text[k] === '`') {
      let runEnd = k;
      while (runEnd < to && text[runEnd] === '`') runEnd += 1;
      const runLen = runEnd - k;
      let j = runEnd;
      let closerEnd = -1;
      while (j < to) {
        if (text[j] === '`') {
          let ce = j;
          while (ce < to && text[ce] === '`') ce += 1;
          if (ce - j === runLen) {
            closerEnd = ce;
            break;
          }
          j = ce;
        } else {
          j += 1;
        }
      }
      k = closerEnd === -1 ? runEnd : closerEnd;
      continue;
    }
    if (text.startsWith('<!--f:', k)) return -1;
    if (text.startsWith(CLOSE, k)) return k;
    k += 1;
  }
  return -1;
}

/** Fill every `<!--f:key-->…<!--/f-->` with its fact's current value. Pure, so
 *  the drift test compares without writing.
 *
 *  Built on `codeRanges` above: fence syntax and inline spans are markup
 *  being DOCUMENTED, not markup being USED, so this scan copies whatever
 *  `codeRanges` reports as code straight through untouched, and only looks
 *  for `<!--f:` outside it.
 *
 *  A fact fence must open and close ON THE SAME LINE, OUTSIDE CODE — a fact's
 *  value is a number or a short string, so a multi-line body has no
 *  legitimate use, and bounding the close search to the current line is what
 *  stops a dropped `<!--/f-->` from silently reaching past intervening
 *  prose, or a whole code block, to a `<!--/f-->` documented further down.
 *  The "outside code" half matters just as much: a `<!--/f-->` shown inside
 *  an inline span on the same line (documenting the syntax, not using it)
 *  is not a real closer either, so the close search shares the main scan's
 *  span-skipping via `findCloser` rather than a plain `indexOf`. A second
 *  `<!--f:` before any valid closer stops that search too — the fence is
 *  unclosed, not "closed by whatever comes after the next opener." */
export function rewrite(text: string, facts: Record<string, Fact>): string {
  // A file with neither an OPEN nor a CLOSE tag cannot hold a stale fence OR
  // an orphan closer — there is nothing for this function to do, so its own
  // code-state (fenced or not) is irrelevant and never gets built. This is
  // what lets a document with a genuinely malformed code fence (one that
  // never closes) sit in the tree unbothered as long as it carries neither.
  // CLOSE is included deliberately, not just OPEN: a file whose only damage
  // is a lost opener — the exact corruption this guard exists to catch —
  // has no `<!--f:` left in it at all, only the orphaned `<!--/f-->`; an
  // OPEN-only check would let precisely that file slip past unscanned.
  // Also why `codeRanges` (which can throw on a genuinely unclosed code
  // fence) is not called until AFTER this check — a document with neither
  // tag is untouched regardless of what its code fences do.
  if (!text.includes('<!--f:') && !text.includes(CLOSE)) return text;

  const ranges = codeRanges(text);

  let out = '';
  let i = 0;
  let lineNo = 1;

  while (i < text.length) {
    const range = ranges.find((r) => i >= r.start && i < r.end);
    if (range) {
      const chunk = text.slice(i, range.end);
      for (const ch of chunk) if (ch === '\n') lineNo += 1;
      out += chunk;
      i = range.end;
      continue;
    }

    const ch = text[i];

    if (ch === '\n') {
      out += ch;
      i += 1;
      lineNo += 1;
      continue;
    }

    const nl = text.indexOf('\n', i);
    const lineEnd = nl === -1 ? text.length : nl;

    OPEN.lastIndex = i;
    const m = OPEN.exec(text);
    if (m) {
      const [tag, key] = m;
      // `facts[key]` alone walks the prototype chain — `<!--f:constructor-->`
      // or `<!--f:toString-->` would resolve to a function and render
      // "undefined undefined" with no error. `Object.hasOwn` checks the
      // registry's own keys only.
      if (!Object.hasOwn(facts, key)) {
        throw new Error(`unknown fact key \`${key}\` — add it to src/facts/facts.ts`);
      }
      const fact = facts[key];
      const bodyStart = i + tag.length;
      const end = findCloser(text, bodyStart, lineEnd);
      if (end === -1) {
        throw new Error(
          `unclosed fence for \`${key}\` on line ${lineNo} — a fence must open and close on the same line`,
        );
      }
      // Consume the closer here, in bulk, rather than leaving it for the
      // generic per-character fallback below to copy through one character
      // at a time — that would walk straight back over this same `<!--/f-->`
      // and, with nothing to say "this one is already spoken for", trip the
      // orphan-closer check right below on the closer that just legitimately
      // closed this very fence.
      out += tag + renderFact(fact) + CLOSE;
      i = end + CLOSE.length;
      continue;
    }

    if (text.startsWith('<!--f:', i)) {
      // `<!--f:` present but OPEN didn't match — a malformed key (a space,
      // an unsupported character, a missing `-->`). Left alone, this is
      // copied through byte-identical: a fence that looks machine-maintained
      // and never is. Worse, if a `<!--/f-->` happens to follow it later on
      // the line, the scan would otherwise reach that first and misreport an
      // "orphan closer" — the wrong defect. Catching the malformed opener
      // here, before the scan can walk past it, names the real one.
      throw new Error(
        `malformed fact tag on line ${lineNo} — <!--f: is not followed by a well-formed key and -->`,
      );
    }

    if (text.startsWith(CLOSE, i)) {
      // Reached in ordinary prose (never inside a span or a fenced block —
      // both already handled above), and not as the tail end of an OPEN
      // this scan just resolved (that case consumed its closer already,
      // above). A closer with nothing to close is the mirror of the
      // unclosed-opener case: losing the opener half of a fence — a hand
      // edit, a careless search-and-replace, a conflict resolution — must
      // be exactly as loud as losing the closer half.
      throw new Error(`orphan closer \`${CLOSE}\` on line ${lineNo} — no matching <!--f: opener`);
    }

    out += ch;
    i += 1;
  }

  return out;
}

/** Runs `rewrite`, attaching `path` to any thrown error. `rewrite` stays
 *  file-unaware on purpose; this is the one home for the two callers (the
 *  writer script and the drift test) that know the path. */
export function rewriteFile(path: string, text: string, facts: Record<string, Fact>): string {
  try {
    return rewrite(text, facts);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`${path}: ${message}`);
  }
}
