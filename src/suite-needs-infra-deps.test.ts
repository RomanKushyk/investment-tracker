import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { REPO } from './repo-root';

// BOTH WORKFLOWS RUN THE WHOLE SUITE, so both need what the whole suite imports.
//
// `vitest-scope.test.ts` guards that the runner still REACHES `infra/src`. This guards
// the other half, which is the half that broke: that a workflow running the suite can
// RUN what it reaches. Three test files import `infra/src/migrate.ts`, which imports
// `infra/src/dsql.ts`, which imports `@aws-sdk/dsql-signer` and `pg`. `deploy-frontend.yml`
// installed neither from the day the migration runner landed, and failed every run for five
// hours without anyone noticing, because a red deploy on `dev` is in nobody's path. v1.11.0
// shipped its backend and not its SPA.
//
// ONE INSTALL COVERS IT NOW, and that is exactly why the guard has to move with it: the
// second installer this used to watch for — `npm ci` in `infra/` — is gone, and a step that
// is gone cannot be out of order. What replaced it is membership, so that is what is checked:
// the root install runs before the suite, `infra` is in the workspace, and the lockfile that
// `--frozen-lockfile` reads has an importer for it. Drop any one and the suite loses `pg`
// again, in the same silence.

const read = (p: string) => readFileSync(join(REPO, p), 'utf8');

/** `dsql.ts` is read through this, so the anchor below is the import and not a comment naming
 *  the package.
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

const workflow = (file: string) =>
  parseDocument(read(join('.github/workflows', file))).toJS() as {
    jobs: Record<string, { steps?: { name?: string; run?: string }[] }>;
  };

const WORKFLOWS = [
  ['deploy-frontend.yml', 'deploy'],
  ['deploy-backend.yml', 'deploy'],
] as const;

describe('every workflow that runs the suite installs what the suite imports', () => {
  // An anchor: the import chain this exists for. If `infra/src` stops reaching the AWS
  // SDK the guards below are guarding nothing, and should be deleted rather than kept
  // green by accident.
  it('still has the import chain that makes infra deps a test-time dependency', () => {
    expect(stripTs(read('infra/src/dsql.ts'), 'infra/src/dsql.ts')).toContain(
      '@aws-sdk/dsql-signer',
    );
    const deps = JSON.parse(read('infra/package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(deps.dependencies ?? {})).toContain('@aws-sdk/dsql-signer');
  });

  it('keeps infra/ in the workspace, which is what makes one install enough', () => {
    const ws = parseDocument(read('pnpm-workspace.yaml')).toJS() as { packages?: string[] };
    expect(ws.packages ?? []).toContain('infra');
    // The lockfile, not just the glob: `--frozen-lockfile` fails rather than resolving, so a
    // member missing from here is a red CI install and not a quietly incomplete tree.
    const lock = parseDocument(read('pnpm-lock.yaml')).toJS() as {
      importers?: Record<string, unknown>;
    };
    expect(Object.keys(lock.importers ?? {})).toContain('infra');
  });

  // Asserted as ORDER, not presence: an install after the tests is the same failure.
  it.each(WORKFLOWS)('%s installs before it runs the suite', (file, job) => {
    const steps = workflow(file).jobs[job]?.steps ?? [];

    const install = steps.findIndex((s) => s.run?.includes('pnpm install --frozen-lockfile'));
    const test = steps.findIndex((s) => s.run?.trim() === 'pnpm test');

    expect(test).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThanOrEqual(0);
    expect(install).toBeLessThan(test);
  });

  // The second installer is gone; a step that reintroduces it would mean the workspace no
  // longer covers infra/, and this guard would be reading the wrong mechanism.
  it.each(WORKFLOWS)('%s installs infra deps exactly once', (file, job) => {
    const steps = workflow(file).jobs[job]?.steps ?? [];
    expect(steps.filter((s) => s.run?.includes('npm ci'))).toEqual([]);
  });
});
