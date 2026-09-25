import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPO, skipped } from './repo-root';

// EVERY GUARD READING A `.ts` OR `.tsx` SOURCE READS IT THROUGH THE QUOTE-EXACT READER, held here
// rather than by a list of the guards: a comment left in the text can satisfy a `toContain` the code
// fails, or trip a `not.toMatch` the code passes, and a new guard is written by copying an old one.
//
// A TAINT CENSUS, the shape Semgrep and CodeQL give the question: `readFileSync` is the source, the
// canonical `stripTs` is the sanitizer, and every other use is a sink. What cannot be followed or
// classified counts as a raw `.ts` read — fail closed, so the census errs towards a false alarm.
// A parse through TypeScript is trusted past the name it is bound to: every AST guard reads its
// nodes' text, so a node's `getText()` is not a raw read.
// Names are resolved through TypeScript's own binder, never by spelling: this suite reuses `file`,
// `f` and `rel` across scopes, and a lookup by name resolves a callback's parameter to an unrelated
// `const` elsewhere in the file.
//
// SELF-CONTAINED ON PURPOSE, the house idiom — and it reads through a real parser, not `stripTs`,
// because it must read the very tests whose reader it checks.

/** What vitest collects, with no `include` of its own, and EVERY TypeScript module besides: a
 *  guard's helper may live outside the tests, as `repo-root.ts` does, and no import graph tells a
 *  test-only module from a Lambda entry point that nothing else imports either. */
const COLLECTED = /\.(test|spec)\.[cm]?[jt]sx?$/;
const MODULE = /\.[cm]?tsx?$/;

const walk = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) return skipped(e.name) ? [] : walk(rel);
    return COLLECTED.test(e.name) || MODULE.test(e.name) ? [rel] : [];
  });

const scriptKind = (name: string) => (/x$/.test(name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

// Read straight into the parser, so the census passes itself.
const SUITE = walk('').map((rel) =>
  ts.createSourceFile(
    `/${rel}`,
    readFileSync(join(REPO, rel), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(rel),
  ),
);

/** The one reader, as `ts-reader.test.ts` writes it; every copy must be this text. */
const readerText = (fn: ts.Node) => fn.getText().replace(/\r\n/g, '\n');
const CANONICAL = (() => {
  const home = SUITE.find((sf) => sf.fileName === '/src/ts-reader.test.ts');
  const fn = home?.statements.find(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'stripTs',
  );
  if (!fn) throw new Error('src/ts-reader.test.ts no longer holds the canonical stripTs');
  return readerText(fn);
})();

/** One program, bound but never type-checked: `getSymbolAtLocation` is all this asks of it. */
function bind(files: ts.SourceFile[]): ts.TypeChecker {
  const byName = new Map(files.map((sf) => [sf.fileName, sf]));
  const host: ts.CompilerHost = {
    getSourceFile: (name) => byName.get(name),
    getDefaultLibFileName: () => '/lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => byName.has(name),
    readFile: () => undefined,
  };
  return ts
    .createProgram([...byName.keys()], { noResolve: true, noLib: true, types: [] }, host)
    .getTypeChecker();
}

const FS = new Set(['fs', 'node:fs']);
const FS_ELSEWHERE = new Set(['fs/promises', 'node:fs/promises']);
/** `?raw`, `?inline` and the like: a specifier with a query is Vite's, and may load text. */
const QUERY = /\?[a-z]/i;
/** Named imports from `fs` that read a file by a route this census does not follow. */
const OTHER_READS = new Set(['readFile', 'createReadStream', 'promises', 'openSync', 'readSync']);

type Offender = { file: string; line: number; site: string; expr: string; why: string };
type Census = { offenders: Offender[]; cleaned: number; foreign: number };

/** A helper's parameters bound to one call's arguments, so a path is judged where it is supplied. */
type Env = Map<ts.Symbol, { expr: ts.Expression; env: Env } | { list: ts.Expression[]; env: Env }>;

function census(files: ts.SourceFile[]): Census {
  const checker = bind(files);
  const out: Census = { offenders: [], cleaned: 0, foreign: 0 };

  for (const sf of files) {
    const symbolOf = (n: ts.Node) => checker.getSymbolAtLocation(n);
    const declOf = (n: ts.Node) => symbolOf(n)?.declarations?.[0];
    const identifiers: ts.Identifier[] = [];
    const reads: ts.CallExpression[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isIdentifier(n)) identifiers.push(n);
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        if (n.expression.text === 'readFileSync') reads.push(n);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    // A shorthand property and an export specifier answer with their OWN symbol, so a use written
    // `{ text }` or `export { text }` is found through the value it names.
    const refSymbol = (i: ts.Identifier) =>
      ts.isShorthandPropertyAssignment(i.parent) && i.parent.name === i
        ? checker.getShorthandAssignmentValueSymbol(i.parent)
        : ts.isExportSpecifier(i.parent)
          ? checker.getExportSpecifierLocalTargetSymbol(i.parent)
          : symbolOf(i);
    const bySymbol = new Map<ts.Symbol, ts.Identifier[]>();
    for (const i of identifiers) {
      const s = refSymbol(i);
      if (!s) continue;
      const list = bySymbol.get(s);
      if (list) list.push(i);
      else bySymbol.set(s, [i]);
    }
    const refsOf = (name: ts.Identifier) => {
      const sym = symbolOf(name);
      return sym ? (bySymbol.get(sym) ?? []).filter((i) => i !== name) : [];
    };

    const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const offend = (n: ts.Node, why: string) =>
      out.offenders.push({
        file: sf.fileName.slice(1),
        line: line(n),
        site: siteOf(n),
        expr: n.getText().replace(/\s+/g, ' ').slice(0, 90),
        why,
      });

    /** The imported name a binding stands for, and where from, when it is an import. */
    const imported = (n: ts.Node): { name: string; from: string } | undefined => {
      const d = declOf(n);
      if (!d || !(ts.isImportSpecifier(d) || ts.isImportClause(d) || ts.isNamespaceImport(d))) {
        return undefined;
      }
      let decl: ts.Node = d;
      while (!ts.isImportDeclaration(decl)) decl = decl.parent;
      if (!ts.isStringLiteral(decl.moduleSpecifier)) return undefined;
      const name = ts.isImportSpecifier(d) ? (d.propertyName ?? d.name).text : '*';
      return { name, from: decl.moduleSpecifier.text };
    };

    // ── routes to a file the census cannot follow, refused outright ──
    // The name used as anything but a direct callee — `const r = readFileSync`, `.call`, a
    // property of an object — carries reads the census cannot see.
    for (const id of identifiers) {
      if (id.text !== 'readFileSync' || ts.isImportSpecifier(id.parent)) continue;
      if (!(ts.isCallExpression(id.parent) && id.parent.expression === id)) {
        offend(id, '`readFileSync` used as a value, so its reads cannot be followed');
      }
    }
    for (const s of sf.statements) {
      const spec =
        ts.isImportDeclaration(s) || ts.isExportDeclaration(s) ? s.moduleSpecifier : undefined;
      if (!spec || !ts.isStringLiteral(spec)) continue;
      const from = spec.text;
      if (QUERY.test(from))
        offend(s, 'a module named with a query, which Vite may hand back as text');
      if (FS_ELSEWHERE.has(from)) offend(s, 'reads through `fs/promises`');
      if ((from === 'module' || from === 'node:module') && /\bcreateRequire\b/.test(s.getText())) {
        offend(s, 'a `createRequire`, whose loads the census cannot follow');
      }
      if (!FS.has(from)) continue;
      if (ts.isExportDeclaration(s)) {
        offend(s, 'a re-export of `fs`, whose reads the census cannot follow');
        continue;
      }
      const clause = ts.isImportDeclaration(s) ? s.importClause : undefined;
      if (clause?.name) offend(s, 'a default import of `fs`');
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) offend(s, 'a namespace import of `fs`');
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const name = (el.propertyName ?? el.name).text;
          if (name === 'readFileSync' && el.propertyName) offend(el, 'a renamed `readFileSync`');
          if (name === 'default') offend(el, 'a default import of `fs`');
          if (OTHER_READS.has(name)) offend(el, `reads through \`${name}\``);
        }
      }
    }
    // A reader reached by a computed key, off whatever object carries it.
    const computed = (n: ts.Node) => {
      if (
        ts.isElementAccessExpression(n) &&
        ts.isStringLiteralLike(n.argumentExpression) &&
        (n.argumentExpression.text === 'readFileSync' || OTHER_READS.has(n.argumentExpression.text))
      ) {
        offend(n, 'an `fs` reader reached by a computed key');
      }
      ts.forEachChild(n, computed);
    };
    computed(sf);
    // `require`, `import()`, `createRequire(…)(…)` and `vi.importActual`; `vi.mock` loads nothing.
    const loader = (e: ts.Expression) =>
      e.kind === ts.SyntaxKind.ImportKeyword ||
      ts.isCallExpression(e) ||
      (ts.isIdentifier(e) && e.text === 'require') ||
      (ts.isPropertyAccessExpression(e) && /^import(Actual|Mock)$/.test(e.name.text));
    const loads = (n: ts.Node) => {
      if (ts.isCallExpression(n) && loader(n.expression)) {
        const [arg] = n.arguments;
        // A curried call — `it.each(…)(…)` — is no loader, so a name it takes is left alone.
        if (!arg || !ts.isStringLiteralLike(arg)) {
          if (!ts.isCallExpression(n.expression)) offend(n, 'loads a module it does not name');
        } else if (FS.has(arg.text) || FS_ELSEWHERE.has(arg.text)) {
          offend(n, 'loads `fs` at run time');
        } else if (QUERY.test(arg.text) && !ts.isCallExpression(n.expression)) {
          offend(n, 'loads a module named with a query, which Vite may hand back as text');
        }
      }
      // A glob's options decide whether it yields modules or their text; none is read here.
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === 'glob' &&
        ts.isMetaProperty(n.expression.expression)
      ) {
        offend(n, 'an `import.meta.glob`, whose text the census cannot follow');
      }
      ts.forEachChild(n, loads);
    };
    loads(sf);

    /** Where a raw use sits, as an exemption names it: the helper, the test, or the constant. */
    function siteOf(n: ts.Node): string {
      for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
        if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
        if (
          ts.isVariableDeclaration(p) &&
          ts.isIdentifier(p.name) &&
          p.initializer &&
          (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))
        ) {
          return p.name.text;
        }
        if (ts.isCallExpression(p) && isTestCall(p.expression)) {
          const [title] = p.arguments;
          if (title && ts.isStringLiteralLike(title)) return title.text;
        }
        if (
          ts.isVariableDeclaration(p) &&
          ts.isIdentifier(p.name) &&
          ts.isSourceFile(p.parent.parent.parent)
        ) {
          return p.name.text;
        }
      }
      return '(module)';
    }

    /** `it`, `test` and `describe`, bare or through `.each(…)`, `.skip` and the like. */
    function isTestCall(e: ts.Expression): boolean {
      if (ts.isIdentifier(e)) return ['it', 'test', 'describe'].includes(e.text);
      if (ts.isPropertyAccessExpression(e)) return isTestCall(e.expression);
      if (ts.isCallExpression(e)) return isTestCall(e.expression);
      return false;
    }

    // ── the sanitizer, and the parsers that make a read not TypeScript ──
    /** The argument a reader takes its source text in: a read passed in any other is not read. */
    const readerInput = (call: ts.CallExpression): ts.Expression | undefined => {
      const callee = call.expression;
      if (ts.isIdentifier(callee) && callee.text === 'stripTs') {
        const d = declOf(callee);
        const pinned = !!d && ts.isFunctionDeclaration(d) && readerText(d) === CANONICAL;
        return pinned && namesTypeScript(d) ? call.arguments[0] : undefined;
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'createSourceFile' &&
        ts.isIdentifier(callee.expression) &&
        imported(callee.expression)?.from === 'typescript'
      ) {
        return call.arguments[1];
      }
      return undefined;
    };
    /** The pinned text names `ts` freely, so it is the reader only while that name is TypeScript. */
    const namesTypeScript = (fn: ts.Node): boolean => {
      const names: ts.Identifier[] = [];
      const visit = (n: ts.Node) => {
        if (ts.isIdentifier(n) && n.text === 'ts') names.push(n);
        ts.forEachChild(n, visit);
      };
      visit(fn);
      return names.length > 0 && names.every((n) => imported(n)?.from === 'typescript');
    };
    const isParser = (call: ts.CallExpression): boolean => {
      const callee = call.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === 'JSON' &&
        callee.name.text === 'parse'
      ) {
        return true;
      }
      if (!ts.isIdentifier(callee)) return false;
      const from = imported(callee);
      // The SQL splitter, imported by the tests or called where it is declared.
      const d = declOf(callee);
      const splitterHere =
        !!d &&
        ts.isFunctionDeclaration(d) &&
        d.name?.text === 'statementsOf' &&
        sf.fileName === '/infra/src/migrate.ts';
      return (
        (from?.name === 'parseDocument' && from.from === 'yaml') ||
        (from?.name === 'statementsOf' && /(^|\/)migrate$/.test(from.from)) ||
        splitterHere
      );
    };

    // ── the path a read names, by its tail ──
    type Kind = 'ts' | 'other' | 'unknown';
    const kindOf = (tail: string): Kind => {
      // A URL's query and fragment name no file, and Windows reads `A.TS` as `a.ts`.
      const base = (tail.split(/[?#]/)[0].split(/[\\/]/).pop() ?? '').toLowerCase();
      if (/\.[cm]?tsx?$/.test(base)) return 'ts';
      if (extname(base) !== '' || base.startsWith('.')) return 'other';
      return 'unknown';
    };
    const worst = (kinds: Kind[]): Kind =>
      kinds.includes('ts') ? 'ts' : kinds.includes('unknown') ? 'unknown' : 'other';

    /** `chain` holds only the expressions above this one, so a cycle ends the walk while a helper
     *  reached twice, from two call sites, is judged both times. */
    function pathKind(
      e: ts.Expression | undefined,
      env: Env,
      chain: ReadonlySet<ts.Node> = new Set(),
    ): Kind {
      if (!e || chain.has(e)) return 'unknown';
      const next = new Set(chain).add(e);
      const go = (x: ts.Expression | undefined, at: Env = env) => pathKind(x, at, next);
      if (ts.isStringLiteralLike(e)) return kindOf(e.text);
      if (ts.isTemplateExpression(e)) {
        const last = e.templateSpans[e.templateSpans.length - 1];
        return last.literal.text !== '' ? kindOf(last.literal.text) : go(last.expression);
      }
      if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) {
        return go(e.expression);
      }
      if (ts.isConditionalExpression(e)) return worst([go(e.whenTrue), go(e.whenFalse)]);
      if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        return go(e.right);
      }
      if (
        ts.isBinaryExpression(e) &&
        e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        // An empty fallback names no file; any other is a path the read may take.
        const fallback =
          ts.isStringLiteralLike(e.right) && e.right.text === '' ? [] : [go(e.right)];
        return worst([go(e.left), ...fallback]);
      }
      if (ts.isNewExpression(e)) return go(e.arguments?.[0]);
      if (ts.isSpreadElement(e)) {
        const bound = ts.isIdentifier(e.expression) ? env.get(symbolOf(e.expression)!) : undefined;
        if (bound && 'list' in bound) return go(bound.list[bound.list.length - 1], bound.env);
        return 'unknown';
      }
      if (ts.isCallExpression(e)) {
        const callee = e.expression;
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : '';
        if (name === 'join' || name === 'resolve') return go(e.arguments[e.arguments.length - 1]);
        // `readdirSync(dir).find((f) => f.endsWith('.sql'))` names its file by the suffix.
        if (name === 'find' && e.arguments[0] && ts.isArrowFunction(e.arguments[0])) {
          const body = e.arguments[0].body;
          if (
            ts.isCallExpression(body) &&
            ts.isPropertyAccessExpression(body.expression) &&
            body.expression.name.text === 'endsWith'
          ) {
            return go(body.arguments[0] as ts.Expression);
          }
        }
        if (ts.isIdentifier(callee)) {
          const fn = functionOf(callee);
          if (fn) {
            const inner = paramsOf(fn, e.arguments, env);
            const all = returns(fn);
            return all.length ? worst(all.map((r) => go(r, inner))) : 'unknown';
          }
        }
        return 'unknown';
      }
      if (ts.isIdentifier(e)) {
        const sym = symbolOf(e);
        const bound = sym ? env.get(sym) : undefined;
        if (bound && 'expr' in bound) return go(bound.expr, bound.env);
        const d = sym?.declarations?.[0];
        // An initializer names the path only for a `const`: a `let` may be written by any
        // assignment form — plain, compound, destructuring or a loop head.
        if (
          d &&
          ts.isVariableDeclaration(d) &&
          d.initializer &&
          ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const
        ) {
          return go(d.initializer);
        }
        return 'unknown';
      }
      return 'unknown';
    }

    /** A function a name is bound to in this file, and what it returns. */
    function functionOf(name: ts.Identifier): ts.SignatureDeclaration | undefined {
      const d = declOf(name);
      if (d && ts.isFunctionDeclaration(d)) return d;
      if (
        d &&
        ts.isVariableDeclaration(d) &&
        d.initializer &&
        (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
      ) {
        return d.initializer;
      }
      return undefined;
    }
    /** Every value a function can return: the path it names is the worst of them. */
    function returns(fn: ts.SignatureDeclaration): ts.Expression[] {
      const body = (fn as ts.FunctionLikeDeclaration).body;
      if (!body) return [];
      if (!ts.isBlock(body)) return [body];
      const out: ts.Expression[] = [];
      const visit = (n: ts.Node) => {
        if (ts.isReturnStatement(n) && n.expression) out.push(n.expression);
        else if (!ts.isFunctionLike(n)) ts.forEachChild(n, visit);
      };
      ts.forEachChild(body, visit);
      return out;
    }
    function paramsOf(fn: ts.SignatureDeclaration, args: readonly ts.Expression[], env: Env): Env {
      const next: Env = new Map(env);
      fn.parameters.forEach((p, i) => {
        const sym = symbolOf(p.name);
        if (!sym) return;
        if (p.dotDotDotToken) next.set(sym, { list: args.slice(i), env });
        else if (args[i]) next.set(sym, { expr: args[i], env });
      });
      return next;
    }

    // ── following a read's text to where it lands ──
    /** `path` names the read's file given the bindings of the helpers it was reached through. */
    function follow(
      value: ts.Expression,
      path: (env: Env) => Kind,
      binary: boolean,
      seen = new Set<ts.Node>(),
    ): void {
      let node: ts.Node = value;
      while (
        ts.isParenthesizedExpression(node.parent) ||
        ts.isAsExpression(node.parent) ||
        ts.isNonNullExpression(node.parent) ||
        ts.isSatisfiesExpression(node.parent)
      ) {
        node = node.parent;
      }
      if (seen.has(node)) return;
      seen.add(node);
      const p = node.parent;

      if (ts.isCallExpression(p) && p.arguments.includes(node as ts.Expression)) {
        if (readerInput(p) === node) {
          // A parsed file read back whole is the raw source again, comments and all.
          const uses: ts.Node[] =
            ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)
              ? refsOf(p.parent.name)
              : [p];
          const rawAgain = uses.some(
            (u) =>
              ts.isPropertyAccessExpression(u.parent) &&
              u.parent.expression === u &&
              /^(text|getText|getFullText)$/.test(u.parent.name.text),
          );
          if (rawAgain) offend(p, 'a parsed source read back as its raw text');
          else out.cleaned++;
          return;
        }
        if (isParser(p)) {
          if (path(new Map()) === 'ts')
            offend(node, 'a TypeScript source handed to a parser of another language');
          else out.foreign++;
          return;
        }
        // Bytes handed on are foreign, unless they are TypeScript's or go to a text decoder.
        const toText =
          (ts.isIdentifier(p.expression) && p.expression.text === 'String') ||
          (ts.isPropertyAccessExpression(p.expression) &&
            /^(decode|from)$/.test(p.expression.name.text));
        if (binary && !toText && path(new Map()) !== 'ts') {
          out.foreign++;
          return;
        }
      }

      // A constant is followed to every use; one with no use here goes where the census cannot see,
      // and so does one exported, whatever its uses here — both are judged by their path below.
      const held =
        ts.isVariableDeclaration(p) && p.initializer === node && ts.isIdentifier(p.name)
          ? p.name
          : undefined;
      const refs = held && !isExported(held) ? refsOf(held) : [];
      if (refs.length > 0) {
        for (const ref of refs) follow(ref, path, binary, seen);
        return;
      }

      // A helper whose body IS the read: each call site is followed on its own arguments.
      const fn = ts.isArrowFunction(p) && p.body === node ? p : undefined;
      const named =
        fn && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)
          ? fn.parent.name
          : ts.isReturnStatement(p)
            ? enclosingName(p)
            : undefined;
      // An exported helper's callers are elsewhere: it is judged by its own path, as a use unseen.
      const calls = named && !isExported(named) ? refsOf(named) : [];
      if ((fn || ts.isReturnStatement(p)) && named && calls.length > 0) {
        const helper = functionOf(named);
        for (const ref of calls) {
          if (ts.isCallExpression(ref.parent) && ref.parent.expression === ref && helper) {
            const call = ref.parent;
            follow(call, (env) => path(paramsOf(helper, call.arguments, env)), binary, seen);
          } else {
            offend(ref, 'a reading helper passed on uncalled, so its reads cannot be followed');
          }
        }
        return;
      }

      const kind = path(new Map());
      if (kind === 'other') {
        out.foreign++;
        return;
      }
      offend(
        node,
        kind === 'ts'
          ? 'a TypeScript source read raw'
          : 'a read whose path the census cannot name, read raw',
      );
    }

    /** Whether the declaration a name belongs to carries `export`. */
    function isExported(name: ts.Identifier): boolean {
      const d = ts.isVariableDeclaration(name.parent) ? name.parent.parent.parent : name.parent;
      return (
        ts.canHaveModifiers(d) &&
        !!ts.getModifiers(d)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      );
    }

    /** The name of the function a `return` sits in, when it has one. */
    function enclosingName(ret: ts.ReturnStatement): ts.Identifier | undefined {
      for (let p: ts.Node | undefined = ret.parent; p; p = p.parent) {
        if (ts.isFunctionDeclaration(p)) return p.name;
        if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
          return ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)
            ? p.parent.name
            : undefined;
        }
      }
      return undefined;
    }
    for (const read of reads) {
      follow(read, (env) => pathKind(read.arguments[0], env), read.arguments.length < 2);
    }
  }
  return out;
}

/** One snippet, as a test file of its own. */
const offendersIn = (text: string) =>
  census([
    ts.createSourceFile(
      '/src/snippet.test.ts',
      text,
      ts.ScriptTarget.Latest,
      true,
      scriptKind('.ts'),
    ),
  ]).offenders.map((o) => o.why);

/* ─────────────────────────────── the suite ─────────────────────────────── */

// EACH A READER OF PROSE ON PURPOSE, or one with a scanner of its own, and each keyed to the one
// site that reads raw: a key that stops matching fails below, so the list can only shrink.
const EXEMPT: [file: string, site: string, reason: string][] = [
  [
    'infra/src/order-by-alias.test.ts',
    'sources',
    'its own `templateLiterals()` scanner skips `//`, `/* */` and quoted strings, and says why',
  ],
  [
    'infra/src/cognito-pool.test.ts',
    'hits',
    'a retired-prose sweep across docs, infra and src: comments are its subject',
  ],
  [
    'infra/src/cognito-pool.test.ts',
    'prose',
    'the same file’s compliance-claim sweep, which reads comment markers off as prose',
  ],
  [
    'src/palette-mirror.test.ts',
    'FILES',
    'the retired-hex sweep reads COMMENTS INCLUDED, DELIBERATELY; the CHROME arm reads its own copy stripped',
  ],
  [
    'infra/src/migration-trigger.test.ts',
    'sources',
    'a prose-claim sweep: a retired claim written in a comment is what it catches',
  ],
  [
    'infra/src/transaction-scope.test.ts',
    'sources',
    'a prose-claim sweep over every authored file, comments first among them',
  ],
  [
    'src/ui-face.test.ts',
    'leave no trace of the face that had them by default',
    'RAW, NOT STRIPPED: a comment naming the previous face is exactly what it catches',
  ],
  [
    'infra/src/stack-split.test.ts',
    'is the only file under .github that invokes the runner',
    'every file under `.github`, whatever its extension: an invoke in prose carries it too',
  ],
];

const SUITE_CENSUS = census(SUITE);
const exempted = (o: Offender) => EXEMPT.some(([file, site]) => o.file === file && o.site === site);

describe('every guard reads a TypeScript source through the quote-exact reader', () => {
  it('walks the suite, so an empty pass cannot look green', () => {
    expect(SUITE.length, 'the walk found almost no test files').toBeGreaterThanOrEqual(60);
    expect(SUITE_CENSUS.cleaned, 'almost no read went through the reader').toBeGreaterThanOrEqual(
      30,
    );
    expect(SUITE_CENSUS.foreign, 'almost no read was of another language').toBeGreaterThanOrEqual(
      30,
    );
  });

  it('finds no raw read outside the exemptions', () => {
    const raw = SUITE_CENSUS.offenders
      .filter((o) => !exempted(o))
      .map((o) => `${o.file}:${o.line} · ${o.site} · ${o.expr} — ${o.why}`);
    expect(raw).toEqual([]);
  });

  it.each(EXEMPT)('%s exempts exactly one read, at %s', (file, site) => {
    const hits = SUITE_CENSUS.offenders.filter((o) => o.file === file && o.site === site);
    expect(hits.map((o) => `${o.line} · ${o.expr}`)).toHaveLength(1);
  });

  // THE NAME IS THE READER ONLY WHILE EVERY COPY IS ONE TEXT: a naive stripper doing this job is
  // the defect this catches, and a census trusting a name would pass one wearing this one.
  it('holds every `stripTs` in the suite to the canonical text', () => {
    const drifted: string[] = [];
    for (const sf of SUITE) {
      const check = (n: ts.Node) => {
        if (
          ts.isFunctionDeclaration(n) &&
          n.name?.text === 'stripTs' &&
          readerText(n) !== CANONICAL
        ) {
          drifted.push(sf.fileName.slice(1));
        }
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'stripTs') {
          drifted.push(`${sf.fileName.slice(1)} (a const)`);
        }
        ts.forEachChild(n, check);
      };
      check(sf);
    }
    expect(drifted).toEqual([]);
  });
});

/* ───────────────────── the rules, on text written to test them ───────────────────── */

const READER = CANONICAL;

describe('the census refuses a raw read however it is written', () => {
  it.each([
    [
      'a literal `.ts` read',
      `import { readFileSync } from 'node:fs';\nexport const s = readFileSync('a.ts', 'utf8');`,
    ],
    [
      'a `.tsx` read through a helper',
      `import { readFileSync } from 'node:fs';\nconst read = (rel: string) => readFileSync(rel, 'utf8');\nexport const s = read('A.tsx');`,
    ],
    [
      'a constant used raw once beside a stripped use',
      `import { readFileSync } from 'node:fs';\nimport ts from 'typescript';\n${READER}\nconst RAW = readFileSync('a.ts', 'utf8');\nexport const a = stripTs(RAW, 'a.ts');\nexport const b = RAW.includes('x');`,
    ],
    [
      'one raw call site among clean ones, judged on its own arguments',
      `import { readFileSync } from 'node:fs';\nconst read = (rel: string) => readFileSync(rel, 'utf8');\nexport const css = read('index.css');\nexport const s = read('a.ts');`,
    ],
    [
      'a reading helper passed on uncalled',
      `import { readFileSync } from 'node:fs';\nconst read = (rel: string) => readFileSync(rel, 'utf8');\nexport const all = ['index.css'].map(read);`,
    ],
    [
      'a callback parameter that shares a name with a constant elsewhere',
      `import { readFileSync } from 'node:fs';\nconst file = 'x.yml';\nexport const all = (files: string[]) => files.map((file) => readFileSync(file, 'utf8'));\nexport const f = file;`,
    ],
    [
      'a path in a dotted directory',
      `import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nexport const f = (n: string) => readFileSync(join('.github', n), 'utf8');`,
    ],
    ['a `?raw` import', `import text from './a.ts?raw';\nexport const s = text;`],
    [
      'a namespace import of fs',
      `import * as fs from 'node:fs';\nexport const s = fs.readFileSync('a.ts', 'utf8');`,
    ],
    [
      'a default import of fs',
      `import fs from 'fs';\nexport const s = fs.readFileSync('a.ts', 'utf8');`,
    ],
    [
      'a renamed readFileSync',
      `import { readFileSync as rf } from 'node:fs';\nexport const s = rf('a.ts', 'utf8');`,
    ],
    [
      'fs/promises',
      `import { readFile } from 'node:fs/promises';\nexport const s = await readFile('a.ts', 'utf8');`,
    ],
    ['a require of fs', `export const s = require('fs').readFileSync('a.ts', 'utf8');`],
    [
      'a naive reader wearing the name',
      `import { readFileSync } from 'node:fs';\nfunction stripTs(s: string) { return s.replace(/\\/\\/.*$/gm, ''); }\nexport const s = stripTs(readFileSync('a.ts', 'utf8'));`,
    ],
    [
      'an imported reader',
      `import { readFileSync } from 'node:fs';\nimport { stripTs } from './strip';\nexport const s = stripTs(readFileSync('a.ts', 'utf8'));`,
    ],
    [
      'a Buffer turned into text',
      `import { readFileSync } from 'node:fs';\nexport const s = readFileSync('a.ts').toString();`,
    ],
    [
      'a TypeScript source handed to a parser',
      `import { readFileSync } from 'node:fs';\nimport { parseDocument } from 'yaml';\nexport const d = parseDocument(readFileSync('a.ts', 'utf8'));`,
    ],
    [
      'a path it cannot name',
      `import { readFileSync } from 'node:fs';\nexport const f = (p: string) => readFileSync(p, 'utf8').includes('x');`,
    ],
    [
      'the reader bound to another name',
      `import { readFileSync } from 'node:fs';\nconst r = readFileSync;\nexport const s = r('a.ts', 'utf8').includes('x');`,
    ],
    [
      'the reader called through `.call`',
      `import { readFileSync } from 'node:fs';\nexport const s = readFileSync.call(null, 'a.ts', 'utf8');`,
    ],
    [
      'the reader carried in an object',
      `import { readFileSync } from 'node:fs';\nconst io = { readFileSync };\nexport const s = io.readFileSync('a.ts', 'utf8');`,
    ],
    [
      'a parsed source read back as its text',
      `import { readFileSync } from 'node:fs';\nimport ts from 'typescript';\nexport const s = ts.createSourceFile('a.ts', readFileSync('a.ts', 'utf8'), ts.ScriptTarget.Latest).text.includes('x');`,
    ],
    [
      'a stripped constant also used as a shorthand property',
      `import { readFileSync } from 'node:fs';\nimport ts from 'typescript';\n${READER}\nconst text = readFileSync('a.ts', 'utf8');\nexport const a = stripTs(text, 'a.ts');\nexport const o = { text };`,
    ],
    [
      'a stripped constant also exported by name',
      `import { readFileSync } from 'node:fs';\nimport ts from 'typescript';\n${READER}\nconst text = readFileSync('a.ts', 'utf8');\nexport const a = stripTs(text, 'a.ts');\nexport { text };`,
    ],
    [
      'TypeScript bytes handed to a decoder',
      `import { readFileSync } from 'node:fs';\nexport const s = new TextDecoder().decode(readFileSync('a.ts')).includes('x');`,
    ],
    [
      'a fallback path that is TypeScript',
      `import { readFileSync } from 'node:fs';\nconst P = 'a.json';\nexport const s = readFileSync(P ?? 'a.ts', 'utf8').trim();`,
    ],
    [
      'a variable reassigned to a TypeScript path',
      `import { readFileSync } from 'node:fs';\nlet p = 'a.json';\np = 'a.ts';\nexport const s = readFileSync(p, 'utf8').trim();`,
    ],
    [
      'a `createRequire`',
      `import { createRequire } from 'node:module';\nconst req = createRequire(import.meta.url);\nexport const fs = req('node:fs');`,
    ],
    [
      'a module loaded by a name it does not spell',
      `declare const vi: { importActual(m: string): unknown };\nconst m = 'node:fs';\nexport const x = vi.importActual(m);`,
    ],
    [
      'a helper whose other return reads TypeScript',
      `import { readFileSync } from 'node:fs';\nfunction read(p: string) {\n  if (p.endsWith('.ts')) return readFileSync(p, 'utf8');\n  return readFileSync('a.json', 'utf8');\n}\nexport const s = read('a.ts').includes('x');`,
    ],
    [
      'bytes of an unnamed path handed to a text decoder',
      `import { readFileSync } from 'node:fs';\nexport const f = (p: string) => new TextDecoder().decode(readFileSync(p)).includes('x');`,
    ],
    [
      'bytes of an unnamed path wrapped by `Buffer.from`',
      `import { readFileSync } from 'node:fs';\nexport const f = (p: string) => Buffer.from(readFileSync(p)).toString('utf8');`,
    ],
    ['a dynamic import with a query', `export const m = await import('./a.ts?raw');`],
    ['a re-export with a query', `export { default as s } from './a.ts?raw';`],
    [
      'an `import.meta.glob`',
      `export const all = import.meta.glob('./*.ts', { query: '?raw', eager: true });`,
    ],
    [
      'a path written by destructuring',
      `import { readFileSync } from 'node:fs';\nlet p = 'a.json';\n[p] = ['a.ts'];\nexport const s = readFileSync(p, 'utf8').trim();`,
    ],
    [
      'a path written by a loop head',
      `import { readFileSync } from 'node:fs';\nlet p = 'a.json';\nfor (p of ['a.ts']) readFileSync(p, 'utf8').trim();`,
    ],
    [
      'an upper-case extension',
      `import { readFileSync } from 'node:fs';\nexport const s = readFileSync('A.TS', 'utf8').trim();`,
    ],
    [
      'a file URL with a query',
      `import { readFileSync } from 'node:fs';\nexport const s = readFileSync(new URL('./a.ts?v=1', import.meta.url), 'utf8').trim();`,
    ],
    ['a re-export of fs', `export * from 'node:fs';`],
    [
      'a default import of fs by name',
      `import { default as fs } from 'node:fs';\nexport const s = fs['readFileSync']('a.ts', 'utf8');`,
    ],
    [
      'a reader reached by a computed key',
      `declare const m: Record<string, (p: string, e: string) => string>;\nexport const s = m['readFileSync']('a.ts', 'utf8');`,
    ],
    [
      'an exported reading helper, whatever its local calls',
      `import { readFileSync } from 'node:fs';\nimport ts from 'typescript';\n${READER}\nexport const read = (rel: string) => readFileSync(rel, 'utf8');\nexport const s = stripTs(read('a.ts'), 'a.ts');`,
    ],
    [
      'an exported read, whatever its local uses',
      `import { readFileSync } from 'node:fs';\nimport ts from 'typescript';\n${READER}\nexport const RAW = readFileSync('a.ts', 'utf8');\nexport const code = stripTs(RAW, 'a.ts');`,
    ],
    [
      'a read handed to the reader as its file name',
      `import { readFileSync } from 'node:fs';\nimport ts from 'typescript';\n${READER}\nexport const s = stripTs('', readFileSync('a.ts', 'utf8'));`,
    ],
    [
      'a read handed to the parser as its file name',
      `import { readFileSync } from 'node:fs';\nimport ts from 'typescript';\nexport const sf = ts.createSourceFile(readFileSync('a.ts', 'utf8'), '', ts.ScriptTarget.Latest);`,
    ],
    [
      'the reader over a `ts` that is not TypeScript',
      `import { readFileSync } from 'node:fs';\nimport ts from './not-typescript';\n${READER}\nexport const s = stripTs(readFileSync('a.ts', 'utf8'), 'a.ts');`,
    ],
  ])('refuses %s', (_name, text) => {
    expect(offendersIn(text)).not.toEqual([]);
  });

  it.each([
    [
      'a stripped read',
      `import { readFileSync } from 'node:fs';\nimport ts from 'typescript';\n${READER}\nexport const s = stripTs(readFileSync('a.ts', 'utf8'), 'a.ts');`,
    ],
    [
      'a helper stripped at every call site',
      `import { readFileSync } from 'node:fs';\nimport ts from 'typescript';\n${READER}\nconst read = (rel: string) => readFileSync(rel, 'utf8');\nexport const s = stripTs(read('A.tsx'), 'A.tsx');\nexport const css = read('index.css');`,
    ],
    [
      'a constant stripped where it is used',
      `import { readFileSync } from 'node:fs';\nimport ts from 'typescript';\n${READER}\nconst RAW = readFileSync('a.tsx', 'utf8');\nexport const code = stripTs(RAW, 'a.tsx');`,
    ],
    [
      'a walk stripped inside its callback',
      `import { readFileSync } from 'node:fs';\nimport ts from 'typescript';\n${READER}\nexport const all = (files: string[]) => files.map((f) => stripTs(readFileSync(f, 'utf8'), f));`,
    ],
    [
      'a parse through TypeScript',
      `import { readFileSync } from 'node:fs';\nimport ts from 'typescript';\nexport const sf = ts.createSourceFile('a.ts', readFileSync('a.ts', 'utf8'), ts.ScriptTarget.Latest);`,
    ],
    [
      'YAML, JSON and SQL by their parsers',
      `import { readFileSync } from 'node:fs';\nimport { parseDocument } from 'yaml';\nimport { statementsOf as statements } from './migrate';\nexport const a = parseDocument(readFileSync('t.yaml', 'utf8'));\nexport const b = JSON.parse(readFileSync('p.json', 'utf8'));\nexport const c = (f: string) => statements(readFileSync(f, 'utf8'));`,
    ],
    [
      'a non-TypeScript file by its name, a dotfile included',
      `import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nexport const a = readFileSync(join('x', '.gitignore'), 'utf8').split('\\n');\nexport const b = readFileSync(new URL('../index.html', import.meta.url), 'utf8');`,
    ],
    [
      'a file named by the suffix it was found with',
      `import { readFileSync, readdirSync } from 'node:fs';\nconst g = readdirSync('.').find((f) => f.endsWith('.sql'));\nexport const s = readFileSync(g ?? '', 'utf8').trim();`,
    ],
    [
      'a binary read handed to its decoder',
      `import { readFileSync } from 'node:fs';\ndeclare const decode: (b: Buffer) => unknown;\nexport const x = decode(readFileSync('a.png'));`,
    ],
    [
      'bytes of an unnamed path handed to a binary decoder',
      `import { readFileSync } from 'node:fs';\ndeclare const readXlsx: (b: Buffer) => unknown;\nexport const f = (p: string) => readXlsx(readFileSync(p));`,
    ],
    [
      'a helper returning a read of a constant path',
      `import { readFileSync } from 'node:fs';\nconst P = 'a.json';\nconst read = () => readFileSync(P, 'utf8');\nexport const s = read().trim();`,
    ],
    [
      'a path helper reached from two call sites',
      `import { readFileSync } from 'node:fs';\nconst p = (n: string) => \`x/\${n}\`;\ndeclare const c: boolean;\nexport const s = readFileSync(c ? p('a.json') : p('b.json'), 'utf8').trim();`,
    ],
    [
      'a curried test call, which loads nothing',
      `declare const it: { each(r: number[]): (t: string, f: () => void) => void };\nconst title = '%s';\nit.each([1])(title, () => {});`,
    ],
  ])('allows %s', (_name, text) => {
    expect(offendersIn(text)).toEqual([]);
  });
});
