import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPO, skipped } from './repo-root';

// THE APP READS AND WRITES OVER THE API ALONE (#407): the device's database, its lock, its channel
// and its test double are gone, and nothing brings one back. Read through TypeScript, so what counts
// is a specifier a module imports, requires or loads, never a word in a comment.

const MODULE = /\.[cm]?tsx?$/;
const GONE = /^(?:dexie|dexie-react-hooks|fake-indexeddb)(?:\/|$)/;

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

/** Every module specifier a file spells: an import, a re-export, `import()` and `require()`. */
function specifiersOf(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteralLike(n.moduleSpecifier)
    ) {
      out.push(n.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(n) &&
      n.arguments.length > 0 &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      const callee = n.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) out.push(n.arguments[0].text);
      if (ts.isIdentifier(callee) && callee.text === 'require') out.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('no module imports the device’s database', () => {
  it('imports nothing of Dexie, its React hooks or the fake of IndexedDB, anywhere in the repository', () => {
    const importers = SOURCES.filter(({ sf }) => specifiersOf(sf).some((s) => GONE.test(s)));
    expect(importers.map(({ rel }) => rel)).toEqual([]);
  });

  it('keeps none of them as a dependency', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((n) => GONE.test(n))).toEqual([]);
  });

  it('has no database module, no lock-and-channel module and no hook that listens to the channel', () => {
    for (const rel of ['src/lib/db.ts', 'src/lib/sync.ts', 'src/hooks/useDbSync.ts']) {
      expect(existsSync(join(REPO, rel)), rel).toBe(false);
    }
  });

  it('the guard sees an import when there is one', () => {
    const found = specifiersOf(
      parse(
        'planted.ts',
        "import { Dexie } from 'dexie';\nconst later = await import('fake-indexeddb/auto');\nconst x = require('dexie-react-hooks');\n",
      ),
    );
    expect(found.filter((s) => GONE.test(s))).toEqual([
      'dexie',
      'fake-indexeddb/auto',
      'dexie-react-hooks',
    ]);
    expect(specifiersOf(parse('quiet.ts', "// import 'dexie'\nconst s = 'dexie';\n"))).toEqual([]);
  });
});
