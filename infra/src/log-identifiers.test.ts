// A LOG LINE NAMES AN ACCOUNT BY ITS SUB, NEVER BY ITS ADDRESS, and a federated sign-up by a hash
// of its username, never the `Google_<subject>` Cognito hands the trigger: CloudWatch keeps a
// Lambda's lines for thirty days, and OWASP's Logging Cheat Sheet counts an email address among the
// data to remove, mask or hash before it is logged (*Deployment*). Read at the source, where a
// console call's arguments still say what they carry.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

/** Each module is read through this, once, so a commented-out call is no call.
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

/** The levels Lambda sends to CloudWatch. */
const LEVELS = new Set(['log', 'info', 'warn', 'error', 'debug']);

/** THE NAMES THAT HOLD AN ADDRESS OR A FEDERATED USERNAME in these modules, and this list IS the
 *  rule: a console argument may mention a sub, a user_id, a code or a hash, never one of these.
 *  A value that reaches a log line under another name is bound outside the call, where the hash
 *  or the sub is taken — which is what keeps the binding readable at the call. */
const FORBIDDEN = new Set([
  'supplied',
  'address',
  'email',
  'Email',
  'EMAIL',
  'userName',
  'UserName',
  'Username',
  'userAttributes',
  'claims',
]);

type Call = { file: string; line: number; names: string[] };

/** Every `console.<level>(…)` in a module, with every name its arguments mention: identifiers and
 *  property names alike, a template's substitutions included. */
function consoleCalls(source: string, file: string): Call[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: Call[] = [];
  const names = (node: ts.Node, into: string[]): void => {
    if (ts.isIdentifier(node)) into.push(node.text);
    ts.forEachChild(node, (child) => names(child, into));
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'console' &&
      LEVELS.has(node.expression.name.text)
    ) {
      const into: string[] = [];
      for (const arg of node.arguments) names(arg, into);
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      out.push({ file, line: line + 1, names: into });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The console calls of every non-test module under `dir`, subdirectories included. */
const callsIn = (dir: string) =>
  (readdirSync(dir, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.includes('__fixtures__/'))
    .flatMap((file) => consoleCalls(stripTs(readFileSync(join(dir, file), 'utf8'), file), file));

/** `file:line name` for every forbidden name a call mentions. */
const offending = (calls: Call[]) =>
  calls.flatMap((c) =>
    c.names.filter((n) => FORBIDDEN.has(n)).map((n) => `${c.file}:${c.line} ${n}`),
  );

const calls = callsIn(here);

describe('no log line in infra/src names an address or a federated username', () => {
  it('finds exactly the console calls it guards, in the modules that hold them', () => {
    // EXACT, not a floor: a scanner gone blind makes the count go DOWN. Update it in the commit
    // that adds or removes a call; a new module joins the set by name.
    expect(calls).toHaveLength(90);
    expect(new Set(calls.map((c) => c.file))).toEqual(
      new Set([
        'admin-users.ts',
        'applications.ts',
        'approve.ts',
        'archive-reader-grant.ts',
        'auth-relay.ts',
        'authorize.ts',
        'backup-freshness.ts',
        'backup-wake.ts',
        'capture.ts',
        'collect.ts',
        'dsql.ts',
        'imports.ts',
        'migrate.ts',
        'mutations.ts',
        'official-rate.ts',
        'pool-usage.ts',
        'pre-signup.ts',
        'rate-ahead.ts',
        'settings.ts',
        'view.ts',
      ]),
    );
  });

  // A module moved into a subdirectory is guarded on arrival; a name reaches the rule whether it
  // sits in a template, behind a property or as a bare argument, and a sub passes.
  it('reads a module in a subdirectory, and a name wherever the arguments hold it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'log-identifiers-'));
    try {
      mkdirSync(join(dir, 'sub'));
      writeFileSync(
        join(dir, 'sub', 'm.ts'),
        [
          'declare const row: { email: string; user_id: string };',
          'declare const event: { userName: string };',
          'declare const sub: string;',
          'console.error(`m: ${row.email} is active under ${row.user_id}`);',
          'console.warn(event.userName);',
          "console.log('m: created', sub);",
          '',
        ].join('\n'),
      );
      expect(offending(callsIn(dir))).toEqual(['sub/m.ts:4 email', 'sub/m.ts:5 userName']);
      expect(callsIn(dir)).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('mentions none of the names that hold an address or a username', () => {
    expect(offending(calls)).toEqual([]);
  });
});
