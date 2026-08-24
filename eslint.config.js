import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist'] },
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
