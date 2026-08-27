import { codeRanges, inCode } from '../facts/fences';
import type { DecisionRecord } from './records';

/** One or two table row lines for a decision — two only for the D43 case,
 *  whose `indexExtraRow` renders directly after its own row, labelled
 *  `*(original)*` and dated the same as the decision itself. */
export function renderRow(r: DecisionRecord): string[] {
  const rows = [`| [${r.id}](${r.id}.md) | ${r.summary} | ${r.date} |`];
  if (r.indexExtraRow !== undefined) {
    rows.push(`| [${r.id} *(original)*](${r.id}.md) | ${r.indexExtraRow} | ${r.date} |`);
  }
  return rows;
}

function recordsInRange(
  records: DecisionRecord[],
  from: number,
  to: number | null,
): DecisionRecord[] {
  return records.filter((r) => r.num >= from && (to === null || r.num <= to));
}

const OPEN_PREFIX = '<!-- decisions:rows ';
const CLOSE_TAG = '<!-- /decisions:rows -->';

// `\r?\n` — NOT a hard-coded `\r\n`. See src/decisions/frontMatter.ts for the
// same fix on the read side: this tree reads CRLF only because of
// core.autocrlf on a Windows checkout, the committed blobs are LF, and CI
// checks out LF directly.
//
// Anchored (`^`, tested against a slice starting exactly at a genuine open),
// never a global scan of the whole file — a global, code-blind
// `text.replace(MARKER_RE, ...)` can match STARTING inside a documented
// example that has no closer of its own (a blockquoted illustration
// showing only the open tag), and its non-greedy body then reaches PAST
// that example, across a real marker, to whatever `<!-- /decisions:rows
// -->` comes next — silently folding the real marker's own open, content
// and close into the documented example's "body" and never matching it on
// its own. The `(?!<!-- decisions:rows )` guard in the body is the same
// fix src/facts/fences.ts's `findCloser` makes for two `<!--f:` openers on
// one line: a second opener before any closer means unclosed, not "closed
// by whatever comes after the next opener."
const ANCHORED_MARKER_RE =
  /^<!-- decisions:rows range="(\d+)-(\d*)" -->\r?\n(?:(?!<!-- decisions:rows )[\s\S])*?\r?\n<!-- \/decisions:rows -->/;

function lineNumberAt(text: string, pos: number): number {
  let n = 1;
  for (let i = 0; i < pos; i++) if (text[i] === '\n') n += 1;
  return n;
}

export interface SpliceResult {
  text: string;
  /** How many live marker blocks were matched and filled. */
  blocksFilled: number;
  /** Total row lines rendered across every filled block. */
  rowsRendered: number;
}

/** Fills every `<!-- decisions:rows range="A-B" -->…<!-- /decisions:rows -->`
 *  block in `readme` with the current rows for that id range. Pure, so the
 *  drift test can compare without writing. Block-level by design — this is
 *  a separate mechanism from src/facts/fences.ts's inline `<!--f:key-->`
 *  fences, which must open and close on one line; a table's rows cannot.
 *  Code/prose detection (fenced blocks, inline spans) is NOT
 *  reimplemented here — `codeRanges`/`inCode`, imported above, are the
 *  same scanner `rewrite` in that module is built on, so the marker syntax
 *  can be documented in the README it maintains with the same hardening
 *  that mechanism earned, not a second copy of it.
 *
 *  Refuses to go quiet instead of failing loudly:
 *  - a marker whose range matches zero decisions throws — a blank line
 *    between the header separator and the next content ENDS the Markdown
 *    table, so everything after it would silently stop rendering as one;
 *  - a decision that lands in two blocks throws, not only one that lands
 *    in none;
 *  - a marker that looks complete enough to COUNT but not enough to MATCH
 *    (a typo'd range, a missing closing tag) throws, naming its line —
 *    each genuine (non-code) open is matched independently and anchored
 *    to its own position, not by one global scan (see `ANCHORED_MARKER_RE`
 *    below for why: a global scan can let an unclosed one reach past a
 *    real marker and swallow it);
 *  - and none of the above fires for a marker shown in a code span or a
 *    fenced block. */
export function spliceGeneratedRows(readme: string, records: DecisionRecord[]): SpliceResult {
  const eol = readme.includes('\r\n') ? '\r\n' : '\n';
  const ranges = codeRanges(readme);

  const genuineOpens: number[] = [];
  for (
    let idx = readme.indexOf(OPEN_PREFIX);
    idx !== -1;
    idx = readme.indexOf(OPEN_PREFIX, idx + 1)
  ) {
    if (!inCode(ranges, idx)) genuineOpens.push(idx);
  }

  // One attempt per genuine open, each independently anchored — never a
  // single scan over the whole file. A documented example's opener is
  // never even attempted (excluded above), so it cannot reach past itself
  // into a real marker; among genuine opens, an unclosed one still cannot
  // swallow the next, because ANCHORED_MARKER_RE's body refuses to cross a
  // second opener.
  const unmatched: number[] = [];
  let cursor = 0;
  let text = '';
  let blocksFilled = 0;
  let rowsRendered = 0;
  const seen = new Map<string, number>();

  for (const pos of genuineOpens) {
    const m = ANCHORED_MARKER_RE.exec(readme.slice(pos));
    if (!m) {
      unmatched.push(pos);
      continue;
    }
    const [whole, fromStr, toStr] = m;

    const from = Number(fromStr);
    const to = toStr === '' ? null : Number(toStr);
    const inRange = recordsInRange(records, from, to);
    if (inRange.length === 0) {
      throw new Error(
        `range "${fromStr}-${toStr}" matches no decisions — an empty block would end the ` +
          `Markdown table at the line above it`,
      );
    }
    for (const r of inRange) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);

    blocksFilled += 1;
    const rows = inRange.flatMap(renderRow);
    rowsRendered += rows.length;

    text += readme.slice(cursor, pos);
    text += `<!-- decisions:rows range="${fromStr}-${toStr}" -->${eol}${rows.join(eol)}${eol}${CLOSE_TAG}`;
    cursor = pos + whole.length;
  }
  text += readme.slice(cursor);

  if (unmatched.length > 0) {
    const lines = unmatched.map((pos) => lineNumberAt(readme, pos));
    throw new Error(
      `marker(s) failed to match a complete block, at line ${lines.join(', line ')} — check ` +
        `the range attribute and the closing "${CLOSE_TAG}" tag`,
    );
  }

  const missing = records.filter((r) => !seen.has(r.id)).map((r) => r.id);
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} decision(s) landed in no "decisions:rows" block: ${missing.join(', ')}`,
    );
  }

  const duplicated = records.filter((r) => (seen.get(r.id) ?? 0) > 1).map((r) => r.id);
  if (duplicated.length > 0) {
    throw new Error(
      `${duplicated.length} decision(s) landed in more than one "decisions:rows" block: ` +
        duplicated.join(', '),
    );
  }

  return { text, blocksFilled, rowsRendered };
}

/** The same 200-line cap src/docs-line-cap.test.ts enforces for every
 *  Markdown file in the repo. `pnpm decisions` checks the file it is about
 *  to write against it directly, so crossing it is a plain thrown message
 *  naming the count, not an unrelated test failure left for a future
 *  author to decode. Splitting the index is deliberately NOT built here —
 *  it is speculative until a table needs it; D95/D96 is the precedent to
 *  follow once one does. */
export const README_LINE_CAP = 200;

function countLines(text: string): number {
  let n = 0;
  for (const ch of text) if (ch === '\n') n += 1;
  return n;
}

export function assertUnderLineCap(text: string, path: string): void {
  const lines = countLines(text);
  if (lines > README_LINE_CAP) {
    throw new Error(
      `${path} would be ${lines} lines, over the ${README_LINE_CAP}-line cap — split the ` +
        `index (D95/D96's precedent: the named file stays the index, bodies move verbatim, ` +
        `IDs never change) before adding another decision`,
    );
  }
}
