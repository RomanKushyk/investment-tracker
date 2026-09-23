// An output alias that shadows the column a query sorts on: `to_char(as_of, …)
// AS as_of` plus a bare `ORDER BY as_of` binds the sort to the TEXT output
// rather than the indexed DATE column. It type-checks and returns the right
// rows, so the guard reads source text — the one place the defect shows without
// a live cluster.
//
// NOT UNIFORM ACROSS CLAUSES: PostgreSQL resolves a bare `ORDER BY` name against
// OUTPUT columns first, where a `GROUP BY` name resolves to the INPUT column, so
// flagging GROUP BY would report a defect that does not exist.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC_DIR = new URL('.', import.meta.url);

/**
 * Every non-test source in `infra/src`, globbed so a query moved into a new
 * module is guarded on arrival rather than leaving the guard reading less.
 */
function sources(): { file: string; text: string }[] {
  return readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({ file: f, text: readFileSync(new URL(f, SRC_DIR), 'utf8') }));
}

/**
 * Template-literal contents, found by SCANNING rather than pairing backticks
 * with a regex: one unpaired backtick in a comment mis-pairs every literal after
 * it, so the count goes DOWN and no assertion fails. Comments and quoted strings
 * are skipped for that reason.
 */
function templateLiterals(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      i = src.indexOf('\n', i);
      if (i === -1) break;
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (c === "'" || c === '"') {
      i += 1;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i += 1;
    } else if (c === '`') {
      i += 1;
      const start = i;
      while (i < src.length && src[i] !== '`') i += src[i] === '\\' ? 2 : 1;
      out.push(src.slice(start, i));
      i += 1;
    } else {
      i += 1;
    }
  }
  return out;
}

/** Index of `token` at parenthesis depth 0, searching from `at`. Else -1. */
function findAtTopLevel(sql: string, re: RegExp, at: number): number {
  let depth = 0;
  for (let i = at; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    else if (sql[i] === ')') depth -= 1;
    else if (depth === 0) {
      re.lastIndex = i;
      const m = re.exec(sql);
      if (m && m.index === i) return i;
    }
  }
  return -1;
}

/**
 * Output aliases — `… AS name` inside the SELECT LIST only. Scoped to the span
 * before `FROM`, because an alias after it is a TABLE alias: `FROM price_capture
 * AS pc` would otherwise make `ORDER BY pc.as_of` fail the guard. A `name`
 * followed by `)` is skipped, so `CAST(x AS text)` contributes no type name.
 */
function outputAliases(sql: string): string[] {
  const selectAt = sql.search(/\bSELECT\b/i);
  if (selectAt === -1) return [];
  const fromAt = findAtTopLevel(sql, /\bFROM\b/gi, selectAt);
  const list = sql.slice(selectAt, fromAt === -1 ? sql.length : fromAt);
  return [...list.matchAll(/\bAS\s+([a-z_][a-z0-9_]*)\s*(.?)/gi)]
    .filter((m) => m[2] !== ')')
    .map((m) => m[1].toLowerCase());
}

/**
 * The sort clauses: every `ORDER BY` body, and every `DISTINCT ON (…)` list.
 * `ORDER BY` runs to a top-level `LIMIT`/`OFFSET` OR TO THE END. To the end,
 * because an earlier version cut at the first `)` and `ORDER BY coalesce(x, y),
 * as_of` then hid the shadowed key behind the function call; top-level, for a
 * `LIMIT` inside a parenthesised group. `DISTINCT ON` takes its BALANCED group.
 */
function sortClauses(sql: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(/\bORDER\s+BY\b/gi)) {
    const from = m.index + m[0].length;
    const end = findAtTopLevel(sql, /\b(?:LIMIT|OFFSET)\b/gi, from);
    out.push(sql.slice(from, end === -1 ? sql.length : end));
  }
  for (const m of sql.matchAll(/\bDISTINCT\s+ON\s*\(/gi)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < sql.length && depth > 0) {
      if (sql[i] === '(') depth += 1;
      else if (sql[i] === ')') depth -= 1;
      i += 1;
    }
    out.push(sql.slice(start, i - 1));
  }
  return out;
}

const NOT_A_COLUMN = new Set([
  'asc',
  'desc',
  'nulls',
  'first',
  'last',
  'collate',
  'using',
  'and',
  'or',
]);

/**
 * Bare column references. Not bare when qualified (`t.col`), when it is itself
 * the qualifier, or when it is a function name.
 */
function bareRefs(clause: string): string[] {
  const out: string[] = [];
  for (const m of clause.matchAll(/[a-z_][a-z0-9_]*/gi)) {
    const before = clause.slice(0, m.index).match(/\.\s*$/);
    const after = clause.slice(m.index + m[0].length).match(/^\s*[.(]/);
    const id = m[0].toLowerCase();
    if (!before && !after && !NOT_A_COLUMN.has(id)) out.push(id);
  }
  return out;
}

describe('no output alias shadows a sorted column', () => {
  const queries = sources().flatMap(({ file, text }) =>
    templateLiterals(text)
      .filter((sql) => /\bSELECT\b/.test(sql))
      .map((sql) => ({ file, sql })),
  );

  it('reads the queries it is meant to guard', () => {
    // EXACT, not a floor: a floor cannot catch the scanner going blind, because
    // the count then goes DOWN. Update it deliberately, in the commit that adds
    // or removes a query. The file set is named rather than counted alone.
    expect(queries.length).toBe(15);
    expect(new Set(queries.map((q) => q.file))).toEqual(
      new Set([
        'capture.ts',
        'diagnose-reconciliation.ts',
        'asset-delete.ts',
        'authorize.ts',
        'approve.ts',
        'provision.ts',
      ]),
    );
  });

  it.each(queries.map((q, i) => [i, q.file, q.sql] as const))(
    '%s query %i sorts on no aliased output name',
    (_i, _file, sql) => {
      const aliases = new Set(outputAliases(sql));
      if (aliases.size === 0) return;
      const shadowed = sortClauses(sql)
        .flatMap(bareRefs)
        .filter((ref) => aliases.has(ref));
      // The message carries the query: an index alone would send the reader hunting.
      expect(shadowed, `alias-shadowed sort key(s) in:\n${sql}`).toEqual([]);
    },
  );

  it('keeps the two queries the audit was opened for qualified, by name', () => {
    // A positive pin beside the negative guard: a refactor that rewrote these
    // past the analysis above would otherwise be silent.
    const capture = sources().find((s) => s.file === 'capture.ts')!.text;
    expect(capture).toContain('SELECT DISTINCT ON (price_capture.as_of)');
    expect(capture).toContain('ORDER BY price_capture.as_of, requested_at DESC');
    expect(capture).toContain('ORDER BY price_observation.as_of DESC, instrument_ref');
  });
});

describe('the guard itself', () => {
  // A guard never exercised on a defect is a guard nobody knows the shape of.
  const shadowed = (sql: string) => {
    const aliases = new Set(outputAliases(sql));
    return sortClauses(sql)
      .flatMap(bareRefs)
      .filter((r) => aliases.has(r));
  };

  it('catches the reported query verbatim', () => {
    expect(
      shadowed(`SELECT to_char(as_of, 'YYYY-MM-DD') AS as_of FROM price_capture
                 ORDER BY as_of DESC LIMIT 60`),
    ).toEqual(['as_of']);
  });

  it('catches a shadowed key hidden behind a function call', () => {
    expect(
      shadowed(`SELECT to_char(as_of, 'YYYY-MM-DD') AS as_of FROM t
                 ORDER BY coalesce(x, y), as_of DESC`),
    ).toEqual(['as_of']);
  });

  it('catches it in DISTINCT ON, which must match the ORDER BY', () => {
    expect(
      shadowed(`SELECT DISTINCT ON (as_of) to_char(as_of, 'YYYY-MM-DD') AS as_of
                  FROM t ORDER BY as_of, requested_at DESC`),
    ).toEqual(['as_of', 'as_of']);
  });

  it('passes the qualified form', () => {
    expect(
      shadowed(`SELECT DISTINCT ON (t.as_of) to_char(t.as_of, 'YYYY-MM-DD') AS as_of
                  FROM t ORDER BY t.as_of, requested_at DESC`),
    ).toEqual([]);
  });

  it('does not mistake a TABLE alias for an output alias', () => {
    expect(
      shadowed('SELECT pc.as_of AS day FROM price_capture AS pc ORDER BY pc.as_of DESC'),
    ).toEqual([]);
  });

  it('does not mistake a CAST type for an output alias', () => {
    expect(shadowed('SELECT CAST(as_of AS text) AS d, x FROM t ORDER BY text')).toEqual([]);
  });

  it('leaves GROUP BY alone — PostgreSQL resolves it to the input column', () => {
    expect(
      shadowed(`SELECT to_char(as_of, 'YYYY-MM-DD') AS as_of, count(*) FROM t GROUP BY as_of`),
    ).toEqual([]);
  });

  it('is not blinded by an unpaired backtick in a comment', () => {
    // The first version's failure: the count fell and the suite stayed green.
    const src = '// a note about `price_capture and the archive\nconst q = `SELECT a FROM t`;';
    expect(templateLiterals(src)).toEqual(['SELECT a FROM t']);
  });
});
