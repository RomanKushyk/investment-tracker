/**
 * Minimal YAML front-matter parser for `docs/decisions/D*.md`.
 *
 * Not a general YAML parser — the repo has no YAML dependency, and the
 * schema is fixed and small: two bare scalars (`id`, `date`), one or two
 * double-quoted strings (`summary`, and the optional `index_extra_row`),
 * and one optional flow list of bare ids (`amends`). Front matter is
 * hand-written by whoever adds a decision — nothing in this codebase
 * generates it — so this module is read-only: `unquoteYaml` decodes a
 * quoted scalar; there is no writer.
 *
 * `amends`, not `supersedes`, and no `title`: a 4-agent read of all 19
 * declared relations across both files each names found zero full
 * supersessions — every one is a scoped amendment ("D59 stands in every
 * other respect… only its cadence clause is replaced"), and the scope is
 * already written into `summary` ("supersedes D59's cadence", "narrows
 * D27"), so a separate scope field would only be that fact stored twice.
 * `title` was rendered by nothing (`summary` is the table cell) and 27 of
 * 97 didn't match their own heading — a third, unverified copy. The
 * reciprocal `amended_by` is not a field either: extraction found 7 pairs
 * where one side of `supersedes`/`superseded_by` recorded the link and the
 * other did not, so a stored reverse can disagree with its own forward
 * direction; derived on demand (a reduce over every file's `amends`) it
 * cannot. This paragraph is the one place this reasoning is written out —
 * everywhere else in the repo that mentions it links here.
 */

export interface DecisionFrontMatter {
  id: string;
  date: string;
  summary: string;
  amends: string[];
  indexExtraRow?: string;
}

/** Inverse of the quoting a decision's front matter is hand-written with:
 *  `\\` -> `\`, `\"` -> `"`. `raw` includes the surrounding quotes. */
export function unquoteYaml(raw: string): string {
  if (raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') {
    throw new Error(`expected a double-quoted YAML scalar, got: ${raw}`);
  }
  const inner = raw.slice(1, -1);
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\') {
      const next = inner[i + 1];
      if (next !== '\\' && next !== '"') {
        throw new Error(`unsupported YAML escape "\\${String(next)}" in: ${raw}`);
      }
      out += next;
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

// `\r?\n` throughout — NOT a hard-coded `\r\n`. `git ls-files --eol` shows
// every decision file's committed blob is LF (`i/lf`); this tree only reads
// CRLF because of core.autocrlf on a Windows checkout, and CI checks out
// the LF blob directly. A hard-coded `\r\n` here means this regex — and the
// `block.split` below — match nothing on that checkout, and every one of
// a decision file throws "no front matter block found".
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n\r?\n/;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in `YYYY-MM-DD` form — not just the right
 *  shape. `Date`'s ISO-string parser rejects an out-of-range month (`13`)
 *  outright, but silently rolls an out-of-range DAY forward (`02-30` becomes
 *  March), so the fix is a roundtrip: build the date, then check every
 *  component reads back what was typed. */
function isValidIsoDate(date: string): boolean {
  const m = ISO_DATE_RE.exec(date);
  if (!m) return false;
  const asDate = new Date(`${date}T00:00:00.000Z`);
  return (
    asDate.getUTCFullYear() === Number(date.slice(0, 4)) &&
    asDate.getUTCMonth() + 1 === Number(date.slice(5, 7)) &&
    asDate.getUTCDate() === Number(date.slice(8, 10))
  );
}

/** True if `s` contains a `|` not preceded by `\`. `summary` and
 *  `index_extra_row` render straight into a Markdown table cell — an
 *  unescaped pipe adds a column, silently pushing every cell after it
 *  (including the whole Date column) sideways. D92's summary already
 *  carries a correctly hand-escaped `\|`; this is what would have caught
 *  it typed wrong. */
function hasUnescapedPipe(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '|' && s[i - 1] !== '\\') return true;
  }
  return false;
}

/** Parses one decision file's front matter. Throws on a missing required
 *  field, an unknown key, a `date` that is not a real ISO calendar date,
 *  or a `summary`/`index_extra_row` with an unescaped `|`. */
export function parseDecisionFile(text: string): DecisionFrontMatter {
  const m = FRONT_MATTER_RE.exec(text);
  if (!m) throw new Error('no front matter block found at the top of the file');
  const block = m[1];

  const data: Partial<DecisionFrontMatter> = {};
  for (const line of block.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const sep = line.indexOf(': ');
    if (sep === -1) throw new Error(`malformed front matter line: ${line}`);
    const key = line.slice(0, sep);
    const value = line.slice(sep + 2);
    switch (key) {
      case 'id':
        data.id = value;
        break;
      case 'date':
        data.date = value;
        break;
      case 'summary':
        data.summary = unquoteYaml(value);
        break;
      case 'amends': {
        if (!value.startsWith('[') || !value.endsWith(']')) {
          throw new Error(`amends must be a flow list, got: ${value}`);
        }
        const inner = value.slice(1, -1).trim();
        data.amends = inner === '' ? [] : inner.split(',').map((s) => s.trim());
        break;
      }
      case 'index_extra_row':
        data.indexExtraRow = unquoteYaml(value);
        break;
      default:
        throw new Error(`unknown front matter key: ${key}`);
    }
  }
  if (!data.id || !data.date || !data.summary) {
    throw new Error(`front matter missing a required field: ${JSON.stringify(data)}`);
  }
  if (!isValidIsoDate(data.date)) {
    throw new Error(`date must be a real ISO calendar date (YYYY-MM-DD), got: ${data.date}`);
  }
  if (hasUnescapedPipe(data.summary)) {
    throw new Error(`summary has an unescaped "|" — write a literal pipe as "\\|"`);
  }
  if (data.indexExtraRow !== undefined && hasUnescapedPipe(data.indexExtraRow)) {
    throw new Error(`index_extra_row has an unescaped "|" — write a literal pipe as "\\|"`);
  }
  return {
    id: data.id,
    date: data.date,
    summary: data.summary,
    amends: data.amends ?? [],
    indexExtraRow: data.indexExtraRow,
  };
}

/** Runs `parseDecisionFile`, attaching `path` to any thrown error — the
 *  same shape as src/facts/fences.ts's `rewriteFile` over `rewrite`, and
 *  for the same reason: a bare parse error across a 97-file fan-out names
 *  no file. `parseDecisionFile` stays path-unaware so it can be
 *  unit-tested against bare strings. */
export function parseDecisionFileAt(path: string, text: string): DecisionFrontMatter {
  try {
    return parseDecisionFile(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`${path}: ${message}`);
  }
}
