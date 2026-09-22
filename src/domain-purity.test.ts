import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';
import { REPO } from './repo-root';

// THE PURITY ZONE IS PATH-KEYED — `files: ['packages/core/**/*.{ts,tsx}']` in `eslint.config.js`.
// A
// selector that stops matching does not fail: the config still parses, the rule is still written
// down, and nothing at all is linted by it. So asserting the rule is PRESENT in the config proves
// only that someone typed it. These assertions lint TEXT AT a package path through the ESLint JS
// API — the instrument `nested-checkouts.test.ts` already uses — which is the only form that goes
// red when the zone stops applying to the package it names.
const PKG = 'packages/core/src';

const eslint = new ESLint({ cwd: REPO });

/** What `no-restricted-imports` says about one specifier, as seen from one file. */
const restricted = async (file: string, specifier: string) => {
  const [result] = await eslint.lintText(`import * as x from '${specifier}';\nexport { x };\n`, {
    filePath: join(REPO, file),
  });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-imports').map((m) => m.message);
};

describe('the domain package is held pure by lint, not by convention', () => {
  // RESOLVING THE REAL FLAT CONFIG IS THE WHOLE COST — typescript-eslint, two react plugins and
  // eslint-config-prettier — and it lands inside whichever case runs first: measured 736 ms there
  // against 2-10 ms for every other. Left there it misses vitest's 5 s default under a parallel
  // run and reddens a deploy gate on an unchanged repo, which is why `nested-checkouts.test.ts`
  // carries 20_000 on its own ESLint case. Paid once, in the open, rather than by an arbitrary
  // `it`.
  beforeAll(async () => {
    await restricted(`${PKG}/derive.ts`, 'react');
  }, 20_000);

  it('has package modules to hold in the first place', () => {
    // VACUITY ANCHOR: every assertion below lints text rather than a file, so all of them would
    // pass just as well against a directory that does not exist.
    expect(existsSync(join(REPO, PKG))).toBe(true);
    expect(readdirSync(join(REPO, PKG)).filter((f) => f.endsWith('.ts'))).not.toHaveLength(0);
  });

  it.each(['react', 'react-dom', 'dexie', 'zustand'])('refuses `%s`', async (specifier) => {
    expect((await restricted(`${PKG}/derive.ts`, specifier)).join(' ')).toContain(
      'the domain package',
    );
  });

  it.each([
    ['../../../src/lib/repository'],
    ['../../../src/state/settings'],
    ['../../../src/components/ui/Tag'],
    ['../../../src/screens/Overview'],
    ['../../../infra/schema/user'],
  ])('refuses a reach back into `%s`', async (specifier) => {
    expect((await restricted(`${PKG}/derive.ts`, specifier)).join(' ')).toContain(
      'the domain package',
    );
  });

  it('holds a .tsx under the package, though none exists yet', async () => {
    // Nothing tracked under `packages/` is `.tsx` — a pure module needs no JSX — so narrowing the
    // selector back to `*.ts` would leave every other assertion here green. `lintText` resolves a
    // PATH, not a file on disk, so probing one that does not exist costs nothing and pins the half
    // of the selector no real file covers.
    expect((await restricted(`${PKG}/Widget.tsx`, 'react')).join(' ')).toContain(
      'the domain package',
    );
  });

  it('leaves a sibling module alone', async () => {
    expect(await restricted(`${PKG}/derive.ts`, './types')).toEqual([]);
  });

  // THE CONTROL. Without it, a `no-restricted-imports` block written for every file in the repo
  // would satisfy every assertion above while the package's own zone matched nothing. BOTH
  // EXTENSIONS, because that is one probe per way the selector can decay: a broadening to
  // `**/*.{ts,tsx}` only the `.tsx` probe sees, one to `**/*.ts` only the `.ts` probe sees.
  it.each(['src/screens/Overview.tsx', 'src/hooks/useFormat.ts'])(
    'restricts the package and not %s, so it is the zone being read',
    async (file) => {
      expect(await restricted(file, 'react')).toEqual([]);
    },
  );
});
