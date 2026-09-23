// A bare ORDER BY or DISTINCT ON name resolves to a same-named OUTPUT before the input column, so
// `to_char(as_of, …) AS as_of` sorts text, not the indexed date; GROUP BY resolves the other way.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parse, type Node, type SelectStmt } from 'libpg-query';

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

/** The unqualified column a node names, else undefined: `t.as_of` names a table's column, and
 *  PostgreSQL resolves only a bare name against the output list. */
function bareName(node: Node | undefined): string | undefined {
  const fields = node && 'ColumnRef' in node ? node.ColumnRef.fields : undefined;
  return fields?.length === 1 && 'String' in fields[0] ? fields[0].String.sval : undefined;
}

type Figured = [name: string, strength: number];

function named(field: Node | undefined, strength = 2): Figured | undefined {
  const name = field && 'String' in field ? field.String.sval : undefined;
  return name === undefined ? undefined : [name, strength];
}

/** PostgreSQL's FigureColname, which names an output given no alias. Strength 1 marks a fallback,
 *  such as a cast's type, that any name its operand carries overrides. */
function figure(node: Node | undefined): Figured | undefined {
  if (!node) return undefined;
  if ('ColumnRef' in node) return named(node.ColumnRef.fields?.at(-1));
  if ('A_Indirection' in node) {
    return named(node.A_Indirection.indirection?.at(-1)) ?? figure(node.A_Indirection.arg);
  }
  if ('CollateClause' in node) return figure(node.CollateClause.arg);
  if ('FuncCall' in node) return named(node.FuncCall.funcname?.at(-1));
  if ('TypeCast' in node) {
    const inner = figure(node.TypeCast.arg);
    return inner && inner[1] > 1
      ? inner
      : (named(node.TypeCast.typeName?.names?.at(-1), 1) ?? inner);
  }
  if ('CaseExpr' in node) {
    const inner = figure(node.CaseExpr.defresult);
    return inner && inner[1] > 1 ? inner : ['case', 1];
  }
  if ('SubLink' in node) {
    const { subLinkType, subselect } = node.SubLink;
    if (subLinkType === 'EXISTS_SUBLINK') return ['exists', 2];
    if (subLinkType === 'ARRAY_SUBLINK') return ['array', 2];
    if (subLinkType === 'EXPR_SUBLINK' && subselect && 'SelectStmt' in subselect) {
      const first = firstArm(subselect.SelectStmt).targetList?.[0];
      const target = first && 'ResTarget' in first ? first.ResTarget : undefined;
      const name = target?.name ?? figure(target?.val)?.[0];
      return name === undefined ? undefined : [name, 2];
    }
  }
  return undefined;
}

/** Whether an output is that very column, which sorts as the column does. */
function isColumn(node: Node | undefined, name: string): boolean {
  return !!node && 'ColumnRef' in node && figure(node)?.[0] === name;
}

/** A set operation's columns are named by its first arm. */
function firstArm(select: SelectStmt): SelectStmt {
  return select.larg ? firstArm(select.larg) : select;
}

/** Keys of this SELECT's ORDER BY and DISTINCT ON that name an output other than that column.
 *  Every output under a name counts, since PostgreSQL refuses a name two outputs share. */
function shadowedIn(select: SelectStmt): string[] {
  const outputs = new Map<string, (Node | undefined)[]>();
  for (const target of firstArm(select).targetList ?? []) {
    if (!('ResTarget' in target)) continue;
    const name = target.ResTarget.name ?? figure(target.ResTarget.val)?.[0];
    if (name !== undefined) outputs.set(name, [...(outputs.get(name) ?? []), target.ResTarget.val]);
  }
  const keys = [
    ...(select.sortClause ?? []).map((key) => ('SortBy' in key ? key.SortBy.node : undefined)),
    ...(select.distinctClause ?? []),
  ];
  return keys
    .map(bareName)
    .filter(
      (name): name is string => !!name && !!outputs.get(name)?.some((v) => !isColumn(v, name)),
    );
}

/** A SELECT and a set operation's arms, which the tree holds under `larg` and `rarg` rather than
 *  under a `SelectStmt` key of their own. */
function* arms(select: SelectStmt): Generator<SelectStmt> {
  yield select;
  if (select.larg) yield* arms(select.larg);
  if (select.rarg) yield* arms(select.rarg);
}

/** Every SELECT at any depth: the statement, a CTE, a subquery. */
function* selects(tree: unknown): Generator<SelectStmt> {
  if (Array.isArray(tree)) {
    for (const item of tree) yield* selects(item);
  } else if (tree && typeof tree === 'object') {
    for (const [key, value] of Object.entries(tree)) {
      if (key === 'SelectStmt') yield* arms(value as SelectStmt);
      yield* selects(value);
    }
  }
}

/** Sort keys naming an output column that is not that column, at every level of the statement.
 *  A statement the parser refuses throws, so an unreadable query fails rather than passes. */
async function shadowedKeys(sql: string): Promise<string[]> {
  const tree = await parse(sql).catch((err: unknown) => {
    throw new Error(`${err instanceof Error ? err.message : String(err)} in:\n${sql}`);
  });
  return [...selects(tree)].flatMap(shadowedIn);
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

  it('reads a WITH statement’s outer output list', async () => {
    // RECONCILE opens with a CTE whose list aliases nothing, and `earliest_as_of` is an alias of
    // the outer list alone, so it is caught only if that list is the one read.
    const reconcile = queries.find((q) => q.file === 'diagnose-reconciliation.ts')!.sql;
    const sorted = reconcile.replace(
      'ORDER BY g.instrument_ref',
      'ORDER BY earliest_as_of, g.instrument_ref',
    );
    expect(sorted).not.toBe(reconcile);
    expect(await shadowedKeys(sorted)).toEqual(['earliest_as_of']);
  });

  it.each(queries.map((q, i) => [i, q.file, q.sql] as const))(
    'query %i in %s sorts on no aliased output name',
    async (_i, _file, sql) => {
      // The message carries the query: an index alone would send the reader hunting.
      expect(await shadowedKeys(sql), `alias-shadowed sort key(s) in:\n${sql}`).toEqual([]);
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
  // A guard never exercised on a defect is a guard nobody knows the shape of: each row is a
  // statement and the keys it must report.
  const d = `to_char(as_of, 'YYYY-MM-DD')`;
  it.each([
    // The defect and its fix.
    ['the reported query', `SELECT ${d} AS as_of FROM t ORDER BY as_of DESC LIMIT 60`, ['as_of']],
    [
      'a key behind a function call',
      `SELECT ${d} AS as_of FROM t ORDER BY coalesce(x, y), as_of`,
      ['as_of'],
    ],
    [
      'DISTINCT ON, read as ORDER BY is',
      `SELECT DISTINCT ON (as_of) ${d} AS as_of FROM t ORDER BY as_of`,
      ['as_of', 'as_of'],
    ],
    [
      'the qualified form',
      `SELECT DISTINCT ON (t.as_of) ${d} AS as_of FROM t ORDER BY t.as_of`,
      [],
    ],
    ['a plain column', `SELECT as_of FROM t ORDER BY as_of`, []],
    [
      'GROUP BY, which resolves to the input',
      `SELECT ${d} AS as_of, count(*) FROM t GROUP BY as_of`,
      [],
    ],
    ['a table alias', `SELECT x FROM price_capture AS as_of ORDER BY as_of`, []],
    ['a CAST type', `SELECT CAST(as_of AS text) AS d, x FROM t ORDER BY text`, []],
    // Each level is read against its own list.
    [
      'a WITH statement’s outer sort',
      `WITH a AS (SELECT x FROM t) SELECT ${d} AS as_of FROM a ORDER BY as_of`,
      ['as_of'],
    ],
    [
      'a CTE’s own sort',
      `WITH a AS (SELECT ${d} AS as_of FROM t ORDER BY as_of LIMIT 5) SELECT * FROM a`,
      ['as_of'],
    ],
    [
      'a bracketed query sorted in a CTE',
      `WITH a AS ((SELECT ${d} AS as_of FROM t) ORDER BY as_of) SELECT * FROM a`,
      ['as_of'],
    ],
    [
      'a CTE’s alias against the outer sort',
      `WITH a AS (SELECT count(*) AS n FROM t) SELECT n FROM a ORDER BY n`,
      [],
    ],
    [
      'an outer alias against a CTE’s sort',
      `WITH a AS (SELECT DISTINCT ON (as_of) as_of FROM t) SELECT ${d} AS as_of FROM a`,
      [],
    ],
    [
      'a nested DISTINCT ON',
      `SELECT ${d} AS b FROM t WHERE c IN (SELECT DISTINCT ON (b) b FROM u ORDER BY b)`,
      [],
    ],
    [
      'a subquery’s alias in the list',
      `SELECT (SELECT max(p) AS as_of FROM u) AS latest, as_of FROM t ORDER BY as_of`,
      [],
    ],
    [
      'a subquery inside ORDER BY',
      `SELECT x AS as_of FROM t ORDER BY (SELECT max(as_of) FROM u)`,
      [],
    ],
    ['a window’s ORDER BY', `SELECT ${d} AS as_of, rank() OVER (ORDER BY as_of) AS r FROM t`, []],
    // No quoting or comment changes the verdict.
    [
      'a paren in a literal',
      `SELECT ${d} AS as_of FROM t WHERE e LIKE '%(t%' ORDER BY as_of`,
      ['as_of'],
    ],
    [
      'a doubled quote',
      `SELECT ${d} AS as_of FROM t WHERE e = 'it''s (' ORDER BY as_of`,
      ['as_of'],
    ],
    [
      'an E-string escape',
      `SELECT ${d} AS as_of FROM t WHERE e = E'can\\'t (' ORDER BY as_of`,
      ['as_of'],
    ],
    [
      'a dollar quote',
      `SELECT ${d} AS as_of FROM t WHERE e = $$it's ($$ ORDER BY as_of`,
      ['as_of'],
    ],
    [
      'a paren in a line comment',
      `SELECT ${d} AS as_of -- the date (as text\n FROM t ORDER BY as_of`,
      ['as_of'],
    ],
    [
      'a nested block comment',
      `SELECT ${d} AS as_of /* a /* b */ ( */ FROM t ORDER BY as_of`,
      ['as_of'],
    ],
    ['a quoted sort key', `SELECT ${d} AS as_of FROM t ORDER BY "as_of" DESC`, ['as_of']],
    ['a quoted alias', `SELECT ${d} AS "as_of" FROM t ORDER BY as_of`, ['as_of']],
    [
      'a quoted name spelling a keyword',
      `SELECT ${d} AS as_of FROM t ORDER BY "offset", as_of`,
      ['as_of'],
    ],
    ['a quoted name holding --', `SELECT ${d} AS as_of, "a--b" FROM t ORDER BY as_of`, ['as_of']],
    [
      'a quoted name holding a quote',
      `SELECT "o'k" AS x, ${d} AS as_of FROM t WHERE y = 'z' ORDER BY as_of`,
      ['as_of'],
    ],
    ['a qualified quoted key', `SELECT ${d} AS as_of FROM t ORDER BY t."as_of"`, []],
    ['a quoted key in another case', `SELECT ${d} AS as_of FROM t ORDER BY "AS_OF"`, []],
    // A set operation is named by its first arm.
    ['a parenthesised query', `(SELECT ${d} AS as_of FROM t) ORDER BY as_of`, ['as_of']],
    ['a UNION', `SELECT ${d} AS as_of FROM t UNION ALL SELECT b FROM u ORDER BY as_of`, ['as_of']],
    ['a UNION arm’s DISTINCT ON', `SELECT DISTINCT ON (x) x FROM t UNION SELECT y FROM u`, []],
    [
      'a UNION arm’s own sort',
      `(SELECT ${d} AS as_of FROM t ORDER BY as_of LIMIT 1) UNION ALL SELECT b FROM u`,
      ['as_of'],
    ],
    // Names PostgreSQL gives without an explicit alias, and lists that hide one.
    ['a cast’s own name', `SELECT as_of::text, n FROM t ORDER BY as_of DESC`, ['as_of']],
    ['CAST’s own name', `SELECT CAST(as_of AS text), n FROM t ORDER BY as_of DESC`, ['as_of']],
    ['an alias without AS', `SELECT ${d} as_of FROM t ORDER BY as_of`, ['as_of']],
    [
      'IS DISTINCT FROM in the list',
      `SELECT a IS DISTINCT FROM b AS c, ${d} AS as_of FROM t ORDER BY as_of`,
      ['as_of'],
    ],
    [
      'an alias named last',
      `SELECT to_char(max(as_of), 'x') AS last FROM t GROUP BY k ORDER BY last`,
      ['last'],
    ],
    [
      'an alias named first',
      `SELECT to_char(min(as_of), 'x') AS first FROM t GROUP BY k ORDER BY first`,
      ['first'],
    ],
    ['a qualified column cast', `SELECT t.as_of::text, n FROM t ORDER BY as_of`, ['as_of']],
    ['COLLATE, which keeps the name', `SELECT name COLLATE "C", n FROM t ORDER BY name`, ['name']],
    ['a subscript, which keeps the name', `SELECT arr[1], n FROM t ORDER BY arr`, ['arr']],
    ['a field selection', `SELECT (rec).as_of::text, n FROM t ORDER BY as_of`, ['as_of']],
    [
      'CASE, named by its ELSE',
      `SELECT CASE WHEN x THEN y ELSE as_of END, n FROM t ORDER BY as_of`,
      ['as_of'],
    ],
    [
      'a scalar subquery, named by its column',
      `SELECT (SELECT max(as_of) AS as_of FROM u)::text FROM t ORDER BY as_of`,
      ['as_of'],
    ],
    [
      'a function, named for itself',
      `SELECT max(as_of), k FROM t GROUP BY k ORDER BY max`,
      ['max'],
    ],
    [
      'an expression cast, named for its type',
      `SELECT (n + 1)::text, x FROM t ORDER BY text`,
      ['text'],
    ],
    ['another column under the name', `SELECT other AS as_of FROM t ORDER BY as_of`, ['as_of']],
    ['the name twice, alias first', `SELECT ${d} AS as_of, as_of FROM t ORDER BY as_of`, ['as_of']],
    [
      'the name twice, column first',
      `SELECT as_of, ${d} AS as_of FROM t ORDER BY as_of`,
      ['as_of'],
    ],
    // A shadowed sort nested anywhere is still found.
    [
      'a subquery in WHERE',
      `SELECT x FROM t WHERE c IN (SELECT ${d} AS as_of FROM u ORDER BY as_of)`,
      ['as_of'],
    ],
    [
      'a subquery in FROM',
      `SELECT * FROM (SELECT ${d} AS as_of FROM t ORDER BY as_of) s`,
      ['as_of'],
    ],
    ['a later arm’s alias', `SELECT n FROM t UNION ALL SELECT count(*) AS n FROM u ORDER BY n`, []],
  ] as const)('%s', async (_name, sql, keys) => {
    expect(await shadowedKeys(sql)).toEqual(keys);
  });

  it('fails a statement it cannot parse, naming it', async () => {
    await expect(shadowedKeys('SELECT FROM WHERE')).rejects.toThrow(/SELECT FROM WHERE/);
  });

  it('is not blinded by an unpaired backtick in a comment', () => {
    // An unpaired backtick would mis-pair every literal after it: the count falls, nothing fails.
    const src = '// a note about `price_capture and the archive\nconst q = `SELECT a FROM t`;';
    expect(templateLiterals(src)).toEqual(['SELECT a FROM t']);
  });
});
