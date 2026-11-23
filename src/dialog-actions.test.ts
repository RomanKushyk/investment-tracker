import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { REPO, skipped } from './repo-root';

// The drawn order is the focus order (W1, WCAG 2.4.3): buttons swap in the DOM through
// `DialogActions` and switch at md, never by CSS order or a container width.

const walk = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return skipped(e.name) || e.name === '__fixtures__' ? [] : walk(rel);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
  });

const parse = (rel: string) =>
  ts.createSourceFile(
    rel,
    readFileSync(join(REPO, rel), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

function nodes(root: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node) => {
    out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(root);
  return out;
}

/** Every whitespace-separated token of every string or template literal under `root`. */
const tokens = (root: ts.Node) =>
  nodes(root).flatMap((n) =>
    ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateLiteralToken(n)
      ? n.text.split(/\s+/).filter(Boolean)
      : [],
  );

const tagOf = (n: ts.Node) =>
  ts.isJsxElement(n)
    ? n.openingElement.tagName.getText()
    : ts.isJsxSelfClosingElement(n)
      ? n.tagName.getText()
      : undefined;

/** A file that renders a dialog: a value import of the Dialog module or of re-authentication's parts. */
const rendersDialog = (sf: ts.SourceFile) =>
  sf.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      !s.importClause?.isTypeOnly &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      /(^|\/)(Dialog|Reauthentication)$/.test(s.moduleSpecifier.text),
  );

const DIALOG = 'src/components/ui/Dialog.tsx';
const FILES = [DIALOG, ...walk('src').filter((rel) => rendersDialog(parse(rel)))].sort();

// The footers W1 moves onto `DialogActions`, and how many each file draws.
const FOOTERS: Record<string, number> = {
  'src/components/forms/AssetForm.tsx': 1,
  'src/components/ui/EditActions.tsx': 1,
  'src/screens/admin-users/ConfirmRuling.tsx': 1,
  'src/screens/archive/Repairs.tsx': 1,
  'src/screens/portfolio/AssetDialogs.tsx': 1,
  'src/screens/settings/DangerZone.tsx': 1,
  'src/screens/settings/ImportDialog.tsx': 2,
};

describe('dialog actions', () => {
  // An allow-list, so a renamed import cannot empty the walk unnoticed.
  it('reads every dialog file', () => {
    expect(FILES).toEqual(
      [
        DIALOG,
        ...Object.keys(FOOTERS),
        'src/screens/profile/DeleteAccount.tsx',
        'src/screens/profile/Reauthentication.tsx',
        'src/screens/profile/SignOutEverywhere.tsx',
      ].sort(),
    );
  });

  it.each(FILES)('%s reorders nothing by CSS', (rel) => {
    expect(tokens(parse(rel)).filter((t) => /-reverse\b|(^|:)-?order-/.test(t))).toEqual([]);
  });

  it.each(Object.entries(FOOTERS))('%s draws its footers with DialogActions', (rel, count) => {
    expect(nodes(parse(rel)).filter((n) => tagOf(n) === 'DialogActions')).toHaveLength(count);
  });

  // Each row a caller draws, and the component's own body, where the switching row lives.
  it.each(FILES)('%s switches no button row at a container width', (rel) => {
    const rows = nodes(parse(rel)).filter(
      (n) =>
        tagOf(n) === 'DialogActions' ||
        (ts.isFunctionDeclaration(n) && n.name?.text === 'DialogActions'),
    );
    expect(rows.flatMap(tokens).filter((t) => t.startsWith('@'))).toEqual([]);
  });

  it('reads DialogActions itself', () => {
    const own = nodes(parse(DIALOG)).filter(
      (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'DialogActions',
    );
    expect(own.flatMap(tokens)).toContain('md:flex-row');
  });
});
