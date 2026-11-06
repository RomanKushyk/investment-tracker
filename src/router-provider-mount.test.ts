import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPO, skipped } from './repo-root';

// A test's router gets React DOM's `flushSync`, as `main.tsx`'s does, or a `{ flushSync: true }`
// navigation commits in a transition production never renders. Parsed, so a comment never counts.

const FIXTURE = 'src/__fixtures__/router.tsx';
// JavaScript too: vitest collects a `.test.jsx`, and TypeScript's parser reads it.
const MODULE = /\.[cm]?[jt]sx?$/;
const ROUTER = /^react-router(?:\/|$)/;

/** Every file that mounts a client router, through the fixture. */
const MOUNTS = [
  'src/app/Layout.test.tsx',
  'src/app/deletion-gate.test.tsx',
  'src/app/privacy-first-load.test.tsx',
  'src/app/privacy-ways-in.test.tsx',
  'src/app/profile-ways-in.test.tsx',
  'src/app/session-gate.test.tsx',
  'src/app/terms-step.test.tsx',
  'src/app/terms-ways-in.test.tsx',
  'src/hooks/useSignOut.test.tsx',
  'src/screens/admin-users.test.tsx',
  'src/screens/archive-admin.test.tsx',
  'src/screens/archive-repairs.test.tsx',
  'src/screens/daily-quotes/coupon-confirm.test.tsx',
  'src/screens/ledger-delete-coupon.test.tsx',
  'src/screens/overview-figures-mark.test.tsx',
  'src/screens/overview-rate.test.tsx',
  'src/screens/profile.test.tsx',
  'src/screens/quotes-save-busy.test.tsx',
  'src/screens/routes-read-the-view.test.tsx',
  'src/screens/sign-in/Apply.test.tsx',
  'src/screens/sign-in/GoogleCallback.test.tsx',
  'src/screens/sign-in/SignIn.test.tsx',
  'src/screens/sign-in/answer.test.tsx',
  'src/screens/sign-in/self-xss-warning.test.tsx',
  'src/screens/stale-write-toast.test.tsx',
  'src/super-admin-shell.test.tsx',
];

const scriptKind = (name: string) => (/x$/.test(name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

const walk = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = dir === '' ? e.name : `${dir}/${e.name}`;
    if (e.isDirectory()) return skipped(e.name) ? [] : walk(rel);
    return MODULE.test(e.name) ? [rel] : [];
  });

const parse = (rel: string, text: string) =>
  ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind(rel));

// Read straight into the parser, as the reader census asks of a guard that parses.
const SOURCES = walk('').map((rel) => ({
  rel,
  sf: ts.createSourceFile(
    rel,
    readFileSync(join(REPO, rel), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(rel),
  ),
}));

const { options: OPTIONS } = ts.convertCompilerOptionsFromJson(
  ts.readConfigFile(join(REPO, 'tsconfig.json'), ts.sys.readFile).config.compilerOptions,
  REPO,
);
// Paths compare in one case where the file system ignores it.
const canon = (path: string) => (ts.sys.useCaseSensitiveFileNames ? path : path.toLowerCase());
const RESOLUTIONS = ts.createModuleResolutionCache(REPO, (f) => f, OPTIONS);
/** A package by its specifier, so `react-router/dom` is not `react-router`; a repo file by its path. */
const target = (spec: string, rel: string): string => {
  if (!/^[./]/.test(spec)) return spec;
  const r = ts.resolveModuleName(spec, join(REPO, rel), OPTIONS, ts.sys, RESOLUTIONS);
  if (!r.resolvedModule) throw new Error(`${rel} imports ${spec}, which TypeScript cannot resolve`);
  return canon(relative(REPO, r.resolvedModule.resolvedFileName).split(sep).join('/'));
};

/** Where a file takes a `RouterProvider` from. Whatever of React Router's it reads by namespace,
 *  `export *` or `import()` is `<specifier>#*`: what it then mounts cannot be told, so it counts. */
function providersOf(sf: ts.SourceFile, rel: string): string[] {
  const out: string[] = [];
  const named = (spec: string, elements: readonly (ts.ImportSpecifier | ts.ExportSpecifier)[]) => {
    for (const e of elements) {
      if (!e.isTypeOnly && (e.propertyName ?? e.name).text === 'RouterProvider') {
        out.push(target(spec, rel));
      }
    }
  };
  const whole = (spec: string) => {
    if (ROUTER.test(spec)) out.push(`${spec}#*`);
  };
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteralLike(n.moduleSpecifier)) {
      const spec = n.moduleSpecifier.text;
      const bindings = n.importClause?.isTypeOnly ? undefined : n.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) named(spec, bindings.elements);
      if (bindings && ts.isNamespaceImport(bindings)) whole(spec);
    }
    if (
      ts.isExportDeclaration(n) &&
      !n.isTypeOnly &&
      n.moduleSpecifier &&
      ts.isStringLiteralLike(n.moduleSpecifier)
    ) {
      const spec = n.moduleSpecifier.text;
      if (n.exportClause && ts.isNamedExports(n.exportClause)) named(spec, n.exportClause.elements);
      else whole(spec);
    }
    if (
      ts.isCallExpression(n) &&
      n.arguments.length > 0 &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      const callee = n.expression;
      const loads =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === 'require');
      if (loads) whole(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('every test mounts its client router as main.tsx does', () => {
  it('takes RouterProvider from the fixture, and only the fixture takes the core one', () => {
    const byProvider: Record<string, string[]> = {};
    for (const { rel, sf } of SOURCES) {
      for (const from of new Set(providersOf(sf, rel))) (byProvider[from] ??= []).push(rel);
    }
    for (const files of Object.values(byProvider)) files.sort();
    expect(byProvider).toEqual({
      'react-router': [FIXTURE],
      'react-router/dom': ['src/main.tsx'],
      [canon(FIXTURE)]: [...MOUNTS].sort(),
    });
  });

  it('the census sees a provider when there is one', () => {
    const planted = [
      "import { RouterProvider } from 'react-router';",
      "import { RouterProvider as Mount } from 'react-router';",
      "import * as Router from 'react-router';",
      "export { RouterProvider } from 'react-router';",
      "export * from 'react-router';",
      "const later = await import('react-router/dom');",
    ].join('\n');
    expect(providersOf(parse('src/planted.test.tsx', planted), 'src/planted.test.tsx')).toEqual([
      'react-router',
      'react-router',
      'react-router#*',
      'react-router',
      'react-router#*',
      'react-router/dom#*',
    ]);
    // A relative specifier resolves to the key the tree's mounts are counted under.
    const nested = 'src/screens/sign-in/planted.test.tsx';
    const fixture = "import { RouterProvider } from '../../__fixtures__/router';";
    expect(providersOf(parse(nested, fixture), nested)).toEqual([canon(FIXTURE)]);
    const quiet = [
      "// import { RouterProvider } from 'react-router';",
      'const s = "import { RouterProvider } from \'react-router\'";',
      "import { createMemoryRouter } from 'react-router';",
      "import type { RouterProvider as Props } from 'react-router';",
    ].join('\n');
    expect(providersOf(parse('src/quiet.test.tsx', quiet), 'src/quiet.test.tsx')).toEqual([]);
  });
});
