import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { REPO } from './repo-root';

// BOTH WORKFLOWS RUN THE WHOLE SUITE, so both need what the whole suite imports.
//
// `vitest-scope.test.ts` guards that the runner still REACHES `infra/src`. This guards
// the other half, which is the half that broke: that a workflow running the suite can
// RUN what it reaches. Three test files import `infra/src/migrate.ts`, which imports
// `infra/src/dsql.ts`, which imports `@aws-sdk/dsql-signer` and `pg` — declared in
// `infra/package.json` and installed by `npm ci` in `infra/`, not by the root
// `pnpm install`. `deploy-frontend.yml` had no such step from the day the migration
// runner landed, and failed every run for five hours without anyone noticing, because
// a red deploy on `dev` is in nobody's path. v1.11.0 shipped its backend and not its
// SPA.
//
// Asserted as ORDER, not presence: an install after the tests is the same failure.

const workflow = (file: string) =>
  parseDocument(readFileSync(join(REPO, '.github/workflows', file), 'utf8')).toJS() as {
    jobs: Record<
      string,
      { steps?: { name?: string; run?: string; 'working-directory'?: string }[] }
    >;
  };

const WORKFLOWS = [
  ['deploy-frontend.yml', 'deploy'],
  ['deploy-backend.yml', 'deploy'],
] as const;

describe('every workflow that runs the suite installs what the suite imports', () => {
  // An anchor: the import chain this exists for. If `infra/src` stops reaching the AWS
  // SDK the guard below is guarding nothing, and should be deleted rather than kept
  // green by accident.
  it('still has the import chain that makes infra deps a test-time dependency', () => {
    const dsql = readFileSync(join(REPO, 'infra/src/dsql.ts'), 'utf8');
    expect(dsql).toContain('@aws-sdk/dsql-signer');
    const deps = JSON.parse(readFileSync(join(REPO, 'infra/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(deps.dependencies ?? {})).toContain('@aws-sdk/dsql-signer');
  });

  it.each(WORKFLOWS)('%s installs infra deps before it runs the suite', (file, job) => {
    const steps = workflow(file).jobs[job]?.steps ?? [];

    const install = steps.findIndex(
      (s) => s['working-directory'] === 'infra' && s.run?.includes('npm ci'),
    );
    const test = steps.findIndex((s) => s.run?.trim() === 'pnpm test');

    expect(test).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThanOrEqual(0);
    expect(install).toBeLessThan(test);
  });
});
