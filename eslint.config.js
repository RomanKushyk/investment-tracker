import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // `src/scratch-dirs.ts`'s PARITY: the directories this file, `.gitignore` and
  // `vitest.config.ts` must ALL name, because flat config does NOT read `.gitignore`
  // and neither does vitest. `src/nested-checkouts.test.ts` fails if any of the three
  // drifts from that list, and D109 records why each entry is on it.
  //
  // `**/dist`, matched at any depth: `'dist'` alone is root-anchored and did not cover
  // infra's, so a local lint after the bundle step parsed a multi-hundred-KB file.
  //
  // `**/.claude` WHOLE, including the half git commits: a vendored skill or agent is
  // configuration, not this repository's source, and a `*.test.ts` shipped under
  // `.claude/skills/` was measured being collected into `pnpm test`. Without any
  // `.claude` entry, eslint linted 456 files of 685 inside a background agent's
  // worktrees — two thirds of the run, and a lint error there reddens this tree's gate.
  {
    ignores: [
      '**/dist',
      '**/coverage',
      '**/.claude',
      '**/.superpowers',
      '**/.vite',
      '**/.turbo',
      '**/.idea',
      '**/.playwright-mcp',
      '**/.vscode',
      '**/.tmp-*',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
  // Import zones (docs/plans/NEXT-PHASE-PLAN.md G1 / DECISIONS D2+D8).
  // Everywhere: lib/db.ts is imported ONLY by lib/repository.ts — plus its
  // colocated test, which needs db.delete()/open() for per-test isolation.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/repository.ts', 'src/lib/repository.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/lib/db', './db'],
              message: 'lib/db.ts is imported only by lib/repository.ts (D2).',
            },
          ],
        },
      ],
    },
  },
  // src/core is the pure domain layer: no react/dexie/zustand, no lib/.
  // (This block REPLACES the rule above for core files, so it restates the
  // db restriction via the lib/** pattern.)
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'src/core is the pure domain layer — no React (G1).' },
            { name: 'react-dom', message: 'src/core is the pure domain layer — no React (G1).' },
            {
              name: 'dexie',
              message: 'src/core never touches persistence — that is src/lib (G1).',
            },
            { name: 'zustand', message: 'src/core never touches stores — that is src/state (G1).' },
          ],
          patterns: [
            {
              group: ['**/lib/**', '**/lib'],
              message: 'src/core must not import src/lib — core imports only core (G1).',
            },
            {
              group: [
                '**/screens/**',
                '**/components/**',
                '**/hooks/**',
                '**/state/**',
                '**/app/**',
              ],
              message: 'src/core must not import UI layers — core imports only core (G1).',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
