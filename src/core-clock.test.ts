import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPO } from './repo-root';

// Core reads no clock for a figure, so the server can pass the Kyiv date. A census: a composer
// reaching for `new Date()` passes every test of the others. Here, as it needs `typescript`.

const ROOT = 'packages/core/src';
const MODULE = /\.ts$/;
const TEST = /\.test\.ts$/;

const walk = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return walk(rel);
    return MODULE.test(e.name) && !TEST.test(e.name) ? [rel] : [];
  });

const SOURCES = walk(ROOT).map((rel) => {
  const sf = ts.createSourceFile(
    rel,
    readFileSync(join(REPO, rel), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  return { rel, sf };
});

/** The function a node sits in, by the name a reader would search for. */
function owner(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) {
      return n.name.getText();
    }
    if (
      (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
      ts.isVariableDeclaration(n.parent)
    ) {
      return n.parent.name.getText();
    }
  }
  return '<module>';
}

const isDate = (e: ts.Expression) => ts.isIdentifier(e) && e.text === 'Date';

/** `new Date()` with no argument, `Date()`, `Date.now()` and `performance.now()`: the spellings
 *  the package uses for the instant it runs. */
function readsClock(node: ts.Node): boolean {
  if (ts.isNewExpression(node)) return isDate(node.expression) && !node.arguments?.length;
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (isDate(callee)) return true;
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === 'now' &&
    ts.isIdentifier(callee.expression) &&
    ['Date', 'performance'].includes(callee.expression.text)
  );
}

const findings = (pick: (n: ts.Node) => boolean) =>
  SOURCES.flatMap(({ rel, sf }) => {
    const out: string[] = [];
    const visit = (n: ts.Node) => {
      if (pick(n)) out.push(`${rel}:${owner(n)}`);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }).sort();

describe('the clock under packages/core/src', () => {
  it('parses every module it censuses', () => {
    expect(SOURCES.length).toBeGreaterThan(20);
    for (const { rel, sf } of SOURCES) {
      // Not in the public typings; `stripTs` reads the same field.
      const diagnostics = (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics;
      expect(diagnostics, `${rel} does not parse`).toEqual([]);
    }
  });

  it('is read in two places, and neither is a figure', () => {
    expect(findings(readsClock)).toEqual([
      // A row's creation stamp, which orders the list and is never shown as a figure.
      'packages/core/src/asset-builder.ts:buildNewAsset',
      // The SPA's own date, defined here as the single source and called only from src/.
      'packages/core/src/dates.ts:todayIso',
    ]);
  });

  it('`todayIso` has no caller inside the package', () => {
    const calls = (n: ts.Node) =>
      ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'todayIso';
    const imports = (n: ts.Node) =>
      ts.isImportSpecifier(n) && (n.propertyName ?? n.name).text === 'todayIso';
    expect(findings((n) => calls(n) || imports(n))).toEqual([]);
  });
});
