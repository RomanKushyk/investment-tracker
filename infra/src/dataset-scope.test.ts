// Every statement over a data table reaches it through the user's LIVE pointer: each of
// `asset`, `transaction` and `user_price` the statement names is bound, by a chain of
// `dataset_id` equalities, to `app_user.dataset_id`, and the caller is `app_user.user_id = $1`.
// A generation is the leading key, never a filter beside `user_id`, so a statement that skips
// the binding reads every generation the user has, staged imports included (#390,
// *User schema and deletes*). Read off PostgreSQL's own parse tree, so a qualified name, `ONLY` or
// a comma join is still a relation, and only a chain of equalities among the statement's own
// conditions binds one — never a condition under an OR, a NOT or an EXISTS. A backstop over
// `infra/src`'s modules: each statement it finds also has a behavioural test against a second
// generation.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'libpg-query';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

/** Each module is read through this, once, so a commented-out statement is no statement.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled. */
function stripTs(source: string, file: string): string {
  const sf = ts.createSourceFile(
    file,
    source,
    // Parsed JSDoc puts a comment's own tokens in the walk: a `//` inside a JSDoc type is then
    // cut on its own, and the rest of the block is left.
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    true,
  );
  // Not in the public typings; typescript-estree reads the same field and throws on it too.
  const [error] = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (error) {
    const why = ts.flattenDiagnosticMessageText(error.messageText, ' ');
    throw new Error(`${file} does not parse: ${why}`);
  }
  const cuts: [number, number][] = [];
  // Returns nothing: a truthy return stops TypeScript's iteration.
  const cut = (pos: number, end: number) => {
    cuts.push([pos, end]);
  };
  // Every comment is trivia before some token; JSX text is a token, never trivia.
  const visit = (node: ts.Node): void => {
    if (!ts.isTokenKind(node.kind)) return node.getChildren(sf).forEach(visit);
    if (node.kind === ts.SyntaxKind.JsxText) return;
    ts.forEachTrailingCommentRange(source, node.pos, cut);
    ts.forEachLeadingCommentRange(source, node.pos, cut);
  };
  visit(sf);
  let out = '';
  let at = 0;
  for (const [pos, end] of cuts) {
    // At position 0 the leading scan starts collecting at once and repeats the trailing scan.
    if (pos < at) continue;
    out += source.slice(at, pos) + source.slice(pos, end).replace(/[^\r\n\u2028\u2029]/g, '');
    at = end;
  }
  return out + source.slice(at);
}
/** Every string and template literal in a module, substitutions read as `$`. */
function literals(source: string, file: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateExpression(node)) {
      out.push(node.head.text + node.templateSpans.map((s) => `$${s.literal.text}`).join(''));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const DATA = new Set(['asset', 'transaction', 'user_price']);

/** A literal naming a data table and OPENING with a statement verb, in any case, is SQL and must
 *  parse; prose that mentions deleting an asset does not open with one. */
const CANDIDATE = /\b(?:asset|transaction|user_price)\b/i;
const VERB = /^\s*(?:WITH|SELECT|INSERT|UPDATE|DELETE|TRUNCATE)\b/i;
/** A relation named by a substitution, `FROM ${table}`, which no reading of the text can judge. */
const SUBSTITUTED = /\b(?:FROM|INTO|UPDATE|JOIN)\s+\$(?!\d)/i;

type Tree = Record<string, unknown>;
type Rel = { relname: string; alias?: { aliasname: string } };

const isTree = (v: unknown): v is Tree => typeof v === 'object' && v !== null;

/** Every value at any depth, with the key it sits under. */
function* entries(tree: unknown): Generator<[string, unknown]> {
  if (Array.isArray(tree)) for (const item of tree) yield* entries(item);
  else if (isTree(tree)) {
    for (const [key, value] of Object.entries(tree)) {
      yield [key, value];
      yield* entries(value);
    }
  }
}

const fieldsOf = (node: unknown): string[] | undefined => {
  if (!isTree(node) || !isTree(node.ColumnRef)) return undefined;
  const fields = node.ColumnRef.fields as Tree[];
  return fields.map((f) => (isTree(f.String) ? String(f.String.sval) : '*'));
};
const nameOf = (rel: Rel) => rel.alias?.aliasname ?? rel.relname;
/** `$1`, or `$1` cast to a type. */
const isParam1 = (node: unknown): boolean =>
  isTree(node) &&
  ((isTree(node.ParamRef) && node.ParamRef.number === 1) ||
    (isTree(node.TypeCast) && isParam1(node.TypeCast.arg)));

/** `x IN (SELECT …)`, or `= ANY`: a key-set. `<> ANY` is the opposite of one. */
const isKeySet = (term: unknown): term is { SubLink: Tree } => {
  if (!isTree(term) || !isTree(term.SubLink) || term.SubLink.subLinkType !== 'ANY_SUBLINK') {
    return false;
  }
  const op = term.SubLink.operName as Tree[] | undefined;
  return op === undefined || (op.length === 1 && isTree(op[0].String) && op[0].String.sval === '=');
};

/** A clause's conjuncts: an AND is flattened, an OR or a NOT stays one opaque term. */
function conjuncts(expr: unknown): unknown[] {
  if (isTree(expr) && isTree(expr.BoolExpr) && expr.BoolExpr.boolop === 'AND_EXPR') {
    return (expr.BoolExpr.args as unknown[]).flatMap(conjuncts);
  }
  return expr === undefined ? [] : [expr];
}

/** The join conditions a FROM list states, through nested joins. */
function joinQuals(from: unknown): unknown[] {
  if (Array.isArray(from)) return from.flatMap(joinQuals);
  if (!isTree(from) || !isTree(from.JoinExpr)) return [];
  const j = from.JoinExpr;
  // An outer join's ON keeps the unmatched rows, so only an inner join's conditions filter.
  const own = j.jointype === 'JOIN_INNER' ? conjuncts(j.quals) : [];
  return [...joinQuals(j.larg), ...joinQuals(j.rarg), ...own];
}

/**
 * The conditions that bind a statement, and only those: its own WHERE and JOIN conjuncts, and a
 * key-set sub-select's, which is a conjunct itself. A condition under an OR, a NOT, an EXISTS or
 * any other sub-select constrains nothing the guard can rely on, so it is not read.
 */
function scope(stmt: Tree): unknown[] {
  const terms = [...conjuncts(stmt.whereClause), ...joinQuals(stmt.fromClause ?? stmt.usingClause)];
  const out = [...terms];
  for (const term of terms) {
    if (!isKeySet(term)) continue;
    out.push(...scope((term.SubLink.subselect as Tree).SelectStmt as Tree));
  }
  return out;
}

/** What a statement over a data table owes; empty when it pays all of it. */
async function owed(sql: string): Promise<string[]> {
  if (SUBSTITUTED.test(sql)) return ['names its table at run time'];
  const tree = await parse(sql).catch(() => undefined);
  if (tree === undefined) return ['does not parse'];
  const all = [...entries(tree)];
  const rels: Rel[] = all
    .filter(([key, value]) => (key === 'RangeVar' || key === 'relation') && isTree(value))
    .map(([, value]) => value as Rel)
    .filter((rel) => typeof rel.relname === 'string');
  const data = rels.filter((rel) => DATA.has(rel.relname));
  if (data.length === 0) return [];
  const out: string[] = [];
  if (all.some(([key]) => key === 'TruncateStmt')) return ['truncates a data table'];
  // One name, one relation: binding an inner `asset` must not bind an outer one.
  const names = rels.map(nameOf);
  if (new Set(names).size !== names.length) out.push('names a relation twice');
  const pointerRels = rels.filter((r) => r.relname === 'app_user');
  if (pointerRels.length !== 1) out.push('joins app_user other than once');
  const pointer = pointerRels[0] === undefined ? undefined : nameOf(pointerRels[0]);

  const root = (tree as Tree).stmts as Tree[];
  const stmt = (root[0].stmt as Tree) ?? {};
  const kind = Object.keys(stmt)[0];
  const body = stmt[kind] as Tree;
  const target = isTree(body.relation) ? (body.relation as unknown as Rel) : undefined;
  const top =
    kind === 'InsertStmt' && isTree(body.selectStmt) ? (body.selectStmt.SelectStmt as Tree) : body;
  const terms = scope(top);

  const equalities = terms.flatMap((term) => {
    if (!isTree(term) || !isTree(term.A_Expr) || term.A_Expr.kind !== 'AEXPR_OP') return [];
    const op = (term.A_Expr.name as Tree[])[0];
    if (!isTree(op.String) || op.String.sval !== '=') return [];
    return [{ l: term.A_Expr.lexpr, r: term.A_Expr.rexpr }];
  });
  const isCaller = (node: unknown) => {
    const f = fieldsOf(node);
    return f?.length === 2 && f[0] === pointer && f[1] === 'user_id';
  };
  if (
    !equalities.some(({ l, r }) => (isCaller(l) && isParam1(r)) || (isCaller(r) && isParam1(l)))
  ) {
    out.push('names no caller');
  }

  // Which relations are bound to the LIVE pointer: union-find over `dataset_id` equalities.
  const LIVE = '@live';
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const found = find(p);
    parent.set(x, found);
    return found;
  };
  const link = (a: string | undefined, b: string | undefined) => {
    if (a !== undefined && b !== undefined && a !== b) parent.set(find(a), find(b));
  };
  /** The relation a `dataset_id` column belongs to. A bare one beside the single `app_user` would
   *  be ambiguous, so it belongs to nothing — except on the left of a key-set, as the target's. */
  const owner = (f: string[] | undefined): string | undefined => {
    if (f === undefined || f.at(-1) !== 'dataset_id') return undefined;
    if (f.length === 1) return undefined;
    return f[0] === pointer ? LIVE : f[0];
  };
  for (const { l, r } of equalities) link(owner(fieldsOf(l)), owner(fieldsOf(r)));
  // A key-set `(dataset_id, …) IN (SELECT x.dataset_id, …)` binds the outer relation to `x`.
  for (const term of terms) {
    if (!isKeySet(term)) continue;
    const test = term.SubLink.testexpr as Tree;
    const left = isTree(test.RowExpr) ? (test.RowExpr.args as unknown[]) : [test];
    const select = (term.SubLink.subselect as Tree).SelectStmt as Tree;
    const right = ((select.targetList as Tree[]) ?? []).map((t) => (t.ResTarget as Tree).val);
    const bare = (node: unknown) => target && fieldsOf(node)?.join() === 'dataset_id';
    left.forEach((node, i) =>
      link(bare(node) ? nameOf(target!) : owner(fieldsOf(node)), owner(fieldsOf(right[i]))),
    );
  }
  // An INSERT is bound when the `dataset_id` it writes is the pointer row's.
  if (kind === 'InsertStmt' && target) {
    const cols = ((body.cols as Tree[]) ?? []).map((c) => (c.ResTarget as Tree).name);
    const values = ((top.targetList as Tree[] | undefined) ?? []).map(
      (t) => (t.ResTarget as Tree).val,
    );
    const i = cols.indexOf('dataset_id');
    if (i >= 0 && owner(fieldsOf(values[i])) === LIVE) link(nameOf(target), LIVE);
  }
  for (const rel of data) {
    if (find(nameOf(rel)) !== find(LIVE)) out.push(`binds ${nameOf(rel)} to no live pointer`);
  }

  // A data table's own `user_id` spans every generation the user has.
  const dataNames = new Set(data.map(nameOf));
  for (const [key, value] of all) {
    if (key !== 'ColumnRef') continue;
    const f = fieldsOf({ ColumnRef: value });
    if (f?.at(-1) !== 'user_id') continue;
    if ((f.length === 2 && dataNames.has(f[0])) || f.length === 1) {
      out.push('reads a data table’s own user_id');
      break;
    }
  }
  return out;
}

/** The SQL-looking literals of every non-test module under `dir`, subdirectories included. */
const statementsIn = (dir: string) =>
  (readdirSync(dir, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.includes('__fixtures__/'))
    .flatMap((file) =>
      literals(stripTs(readFileSync(join(dir, file), 'utf8'), file), file)
        .filter((sql) => (CANDIDATE.test(sql) || SUBSTITUTED.test(sql)) && VERB.test(sql))
        .map((sql) => ({ file, sql })),
    );

const statements = statementsIn(here);

describe('every statement over a data table reads the live dataset', () => {
  it('finds exactly the statements it guards, in the modules allowed to hold them', () => {
    // EXACT, not a floor: a scanner gone blind makes the count go DOWN. Update it in the commit
    // that adds or removes a statement; a new module joins the set by name.
    expect(statements).toHaveLength(6);
    expect(new Set(statements.map((s) => s.file))).toEqual(
      new Set(['asset-delete.ts', 'ledger.ts']),
    );
  });

  // A module moved into a subdirectory is guarded on arrival, not read past; an import path or
  // prose that deletes something is not SQL.
  it('reads a module in a subdirectory, and neither its imports nor its prose', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dataset-scope-'));
    try {
      mkdirSync(join(dir, 'sub'));
      writeFileSync(
        join(dir, 'sub', 'm.ts'),
        [
          "import { deleteAsset } from './asset-delete';",
          "export const why = 'could not delete the asset';",
          'export const Q = `SELECT a.id FROM asset a`;',
          '',
        ].join('\n'),
      );
      expect(statementsIn(dir)).toEqual([{ file: 'sub/m.ts', sql: 'SELECT a.id FROM asset a' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(statements.map((s) => [s.file, s.sql] as const))('%s: %s', async (_file, sql) => {
    expect(await owed(sql)).toEqual([]);
  });

  // The rules, held on statements written to pass and to break each one.
  it.each([
    `SELECT a.id FROM asset a JOIN app_user u ON u.dataset_id = a.dataset_id
       JOIN "transaction" t ON t.dataset_id = a.dataset_id AND t.asset_id = a.id
      WHERE u.user_id = $1`,
    `INSERT INTO "transaction" (dataset_id, id, user_id, account_id)
     SELECT u.dataset_id, $2, u.user_id, $3 FROM app_user u WHERE u.user_id = $1`,
    `SELECT t.id FROM "transaction" t JOIN app_user u ON u.dataset_id = t.dataset_id
       JOIN account c ON c.user_id = u.user_id AND c.id = t.account_id
      WHERE u.user_id = $1::uuid`,
  ])('accepts %s', async (sql) => {
    expect(await owed(sql)).toEqual([]);
  });

  it.each([
    ['SELECT a.id FROM asset a WHERE a.dataset_id = $1', 'binds a to no live pointer'],
    [
      'SELECT x.id FROM public.asset x, app_user u WHERE u.user_id = $1',
      'binds x to no live pointer',
    ],
    [
      'SELECT a.id FROM ONLY asset a JOIN app_user u ON u.dataset_id = u.dataset_id WHERE u.user_id = $1',
      'binds a to no live pointer',
    ],
    [
      `SELECT t.id FROM "transaction" t JOIN app_user u ON u.dataset_id = t.dataset_id
         JOIN asset a ON a.id = t.asset_id WHERE u.user_id = $1`,
      'binds a to no live pointer',
    ],
    [
      'SELECT a.id FROM asset a JOIN app_user u ON u.dataset_id = a.dataset_id WHERE u.user_id = $1 OR true',
      'names no caller',
    ],
    [
      'SELECT a.id FROM asset a JOIN app_user u ON u.dataset_id = a.dataset_id WHERE u.email = $1',
      'names no caller',
    ],
    [
      `DELETE FROM asset WHERE id IN (
         SELECT a.id FROM asset a JOIN app_user u ON u.dataset_id = a.dataset_id
          WHERE u.user_id = $1)`,
      'binds asset to no live pointer',
    ],
    [
      `DELETE FROM asset a WHERE a.id IN (
         SELECT a.id FROM asset a JOIN app_user u ON u.dataset_id = a.dataset_id
          WHERE u.user_id = $1)`,
      'names a relation twice',
    ],
    [
      `DELETE FROM "transaction" WHERE id IN (
         SELECT "transaction".id FROM "transaction"
           JOIN app_user u ON u.dataset_id = "transaction".dataset_id
          WHERE u.user_id = $1 AND "transaction".asset_id = $2)`,
      'names a relation twice',
    ],
    [
      `SELECT a.id FROM asset a JOIN app_user u ON u.dataset_id = a.dataset_id
         JOIN app_user v ON v.user_id = $1`,
      'joins app_user other than once',
    ],
    [
      `SELECT a.id FROM asset a JOIN app_user u ON u.dataset_id = a.dataset_id
        WHERE a.id = $2 OR EXISTS (SELECT 1 WHERE u.user_id = $1)`,
      'names no caller',
    ],
    [
      `SELECT a.id FROM asset a, app_user u
        WHERE u.user_id = $1 AND NOT EXISTS (SELECT 1 WHERE a.dataset_id = u.dataset_id)`,
      'binds a to no live pointer',
    ],
    [
      `DELETE FROM asset WHERE EXISTS (
         SELECT 1 FROM app_user u WHERE u.user_id = $1 AND u.dataset_id = dataset_id)`,
      'binds asset to no live pointer',
    ],
    [
      `SELECT t.id FROM "transaction" t JOIN app_user u ON u.dataset_id = t.dataset_id
        WHERE u.user_id = $1 AND t.user_id = $1`,
      'reads a data table’s own user_id',
    ],
    [
      'SELECT a.id FROM asset a LEFT JOIN app_user u ON u.dataset_id = a.dataset_id AND u.user_id = $1',
      'binds a to no live pointer',
    ],
    [
      'SELECT t.id FROM app_user u RIGHT JOIN "transaction" t ON t.dataset_id = u.dataset_id AND u.user_id = $1',
      'binds t to no live pointer',
    ],
    [
      'DELETE FROM asset WHERE dataset_id <> ANY (SELECT u.dataset_id FROM app_user u WHERE u.user_id = $1)',
      'binds asset to no live pointer',
    ],
    ['select a.id from asset a', 'binds a to no live pointer'],
    ['TRUNCATE asset', 'truncates a data table'],
    ['INSERT INTO asset (dataset_id, id) VALUES ($1, $2)', 'binds asset to no live pointer'],
    ['DELETE FROM $ WHERE dataset_id = $1', 'names its table at run time'],
    ['SELECT * FROM asset WHERE', 'does not parse'],
  ])('refuses %s', async (sql, why) => {
    expect((CANDIDATE.test(sql) || SUBSTITUTED.test(sql)) && VERB.test(sql)).toBe(true);
    expect(await owed(sql)).toContain(why);
  });
});
