import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { configDefaults } from 'vitest/config';
import { describe, expect, it } from 'vitest';
import { REPO } from './repo-root';
import vitestConfig from '../vitest.config';
import { PARITY } from './scratch-dirs';

// Both workflows run the WHOLE suite as bare `pnpm test`. The backend one dropped
// its explicit `infra/src` argument, which is right — the suite covers strictly
// more — but it put all five backend tests on vitest's include, so what this file
// guards is that the runner's scope still reaches them.
//
// It reads the CONFIG OBJECT, not the file's text. An earlier version grepped for
// an `include:`/`exclude:` key and failed the moment `exclude` was legitimately
// needed, which told the next session nothing about whether infra/src still ran.
//
// The `.claude` exclusion itself belongs to `nested-checkouts.test.ts`, which owns
// that bug across all four tools. This file owns the opposite risk: that some future
// exclusion, added for any reason, quietly takes the backend tests with it.
// Named `cfg`, not `test`: at module scope `test` is vitest's own case-declaring
// API, and shadowing it turns a future idiomatic `test('...', ...)` here into a
// type error rather than a new test.
const cfg = vitestConfig.test ?? {};

describe('the suite still reaches infra/src', () => {
  it('has backend tests to lose in the first place', () => {
    const tests = readdirSync(join(REPO, 'infra/src')).filter((f) => f.endsWith('.test.ts'));
    expect(tests.length).toBeGreaterThan(0);
  });

  it('leaves `include` unset, so the default pattern still collects infra/src', () => {
    expect(cfg.include).toBeUndefined();
  });

  it('declares no `dir`, `root` or `projects` — each narrows collection without either key', () => {
    // The ways to lose `infra/src` WITHOUT touching include/exclude. `dir: 'src'`
    // added to speed the suite up, or a `projects` entry scoping it, leaves every
    // other assertion in this file green while all five backend tests silently stop
    // running in both workflows — the precise gap `deploy-backend.yml` carries a
    // comment about after dropping its explicit `infra/src` argument.
    expect(cfg.dir).toBeUndefined();
    expect(cfg.projects).toBeUndefined();
    // `root` twice: vitest reads `test.root`, and Vite's TOP-LEVEL `root` moves the
    // whole project. Either one set to `src` has the same effect as `dir`.
    expect(cfg.root).toBeUndefined();
    expect(vitestConfig.root).toBeUndefined();
  });

  it('SPREADS the defaults rather than replacing them', () => {
    // `exclude` overwrites, it does not merge. Writing `exclude: ['**/.claude/**']`
    // would silently re-admit `**/node_modules/**` — every dependency's own tests.
    expect(cfg.exclude).toEqual(expect.arrayContaining([...configDefaults.exclude]));
  });

  it('excludes only the parity directories, so no exclusion can reach infra/src', () => {
    // Tied to the SAME list `nested-checkouts.test.ts` holds the three configs to,
    // rather than to a shape. An earlier version required every added pattern to be
    // a DOT-directory, which was a proxy for "cannot match infra/src" — and it
    // rejected `**/dist/**` and `**/coverage/**`, both correct, the first time the
    // exclusions were completed. This states the real invariant instead: an
    // exclusion may only name a directory the repo already treats as untrackable
    // scratch, and neither `infra` nor `src` is one, so none can ever swallow the
    // backend tests. Checked structurally because no glob engine — picomatch,
    // tinyglobby, minimatch — is resolvable at the root under pnpm's strict layout.
    const added = (cfg.exclude ?? []).filter((p) => !configDefaults.exclude.includes(p));
    const allowed = new Set(PARITY.map((dir) => `**/${dir}/**`));
    expect(added.filter((p) => !allowed.has(p))).toEqual([]);
    // Widened to `readonly string[]` on purpose: against `PARITY`'s literal union
    // TypeScript rejects the comparison outright (TS2367, "no overlap") — the
    // invariant is already proved at COMPILE time, and this keeps it visible at
    // runtime for a reader who never runs tsc.
    const parity: readonly string[] = PARITY;
    expect(parity.filter((dir) => dir === 'infra' || dir === 'src')).toEqual([]);
  });
});
