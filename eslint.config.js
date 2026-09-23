import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const PGLITE_HELPER = ['infra/src/__fixtures__/pglite.ts', 'infra/src/__fixtures__/pglite.test.ts'];
const EVERY_SOURCE = '**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}';
// esquery refuses a `/` inside a regex, so `.` stands for it.
const PGLITE_PACKAGE = '/^(@electric-sql.pglite|drizzle-orm.pglite(.*)?)$/';
const PGLITE_MESSAGE =
  'only infra/src/__fixtures__/pglite.ts builds a PGlite; take one from freshDb.';
const loadsPGlite = [
  `CallExpression[arguments.0.value=${PGLITE_PACKAGE}]`,
  `CallExpression[arguments.0.quasis.0.value.cooked=${PGLITE_PACKAGE}]`,
  `ImportExpression[source.value=${PGLITE_PACKAGE}]`,
  `ImportExpression[source.quasis.0.value.cooked=${PGLITE_PACKAGE}]`,
].map((selector) => ({ selector, message: PGLITE_MESSAGE }));
const runsConcurrently = [
  `MemberExpression[property.name='concurrent']`,
  `MemberExpression[property.value='concurrent']`,
  `Property[key.name='concurrent']`,
  `Property[key.value='concurrent']`,
].map((selector) => ({
  selector,
  message: 'tests share one PGlite per worker, so they run one at a time.',
}));

export default tseslint.config(
  // `src/scratch-dirs.ts`'s PARITY: the directories this file, `.gitignore` and
  // `vitest.config.ts` must ALL name, because flat config does NOT read `.gitignore`
  // and neither does vitest. `src/nested-checkouts.test.ts` fails if any of the three
  // drifts from that list, and D109 records why each entry is on it.
  //
  // `**/dist`, matched at any depth: `'dist'` alone is root-anchored and did not cover
  // infra's, so a local lint after the bundle step parsed the bundle.
  //
  // `**/.claude` WHOLE, including the half git commits: a vendored skill or agent is
  // configuration, not this repository's source, and a `*.test.ts` shipped under
  // `.claude/skills/` was collected into `pnpm test`. Without it eslint lints a background
  // agent's worktrees, and a lint error there reddens this tree's gate.
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
  // Import zones (*Core is pure*).
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
  // packages/core is the pure domain layer: no react/dexie/zustand, no reach back into the app
  // or the backend. THE SELECTOR IS THE WHOLE MECHANISM and it fails silently — a config whose
  // `files` matches nothing still parses green — so `src/domain-purity.test.ts` lints text AT a
  // package path rather than reading this block.
  // (It REPLACES the rule above rather than merging with it, so it restates the db restriction
  // via the lib/** pattern.)
  {
    files: ['packages/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message: 'the domain package is pure — no React (*Core is pure*).',
            },
            {
              name: 'react-dom',
              message: 'the domain package is pure — no React (*Core is pure*).',
            },
            {
              name: 'dexie',
              message:
                'the domain package never touches persistence — that is src/lib (*Core is pure*).',
            },
            {
              name: 'zustand',
              message:
                'the domain package never touches stores — that is src/state (*Core is pure*).',
            },
          ],
          patterns: [
            {
              group: ['**/lib/**', '**/lib'],
              message:
                'the domain package must not import src/lib — it imports only itself (*Core is pure*).',
            },
            {
              group: [
                '**/screens/**',
                '**/components/**',
                '**/hooks/**',
                '**/state/**',
                '**/app/**',
              ],
              message:
                'the domain package must not import UI layers — it imports only itself (*Core is pure*).',
            },
            {
              // The two trees it now sits BESIDE rather than inside. Without this a package module
              // could climb out with ../../../src or ../../../infra and match none of the above.
              group: ['**/src/**', '**/infra/**'],
              message:
                'the domain package never reaches back into the app or the backend (*Core is pure*).',
            },
          ],
        },
      ],
    },
  },
  // Only the shared helper builds a PGlite, since an instance keeps its memory after `close()`.
  // `infra/src/__fixtures__/pglite.test.ts` lints text at paths: a dead selector parses green.
  {
    files: [EVERY_SOURCE],
    ignores: PGLITE_HELPER,
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: { parser: tseslint.parser },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@electric-sql/pglite',
              importNames: ['PGlite'],
              allowTypeImports: true,
              message: PGLITE_MESSAGE,
            },
          ],
          patterns: [
            {
              group: ['drizzle-orm/pglite', 'drizzle-orm/pglite/*'],
              allowTypeImports: true,
              message: PGLITE_MESSAGE,
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...loadsPGlite],
    },
  },
  // The same rule restated with concurrency added, for tests and the configs that run them only.
  {
    files: [
      '**/*.test.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
      '**/__fixtures__/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
      '**/vit{e,est}.config.*',
    ],
    ignores: PGLITE_HELPER,
    rules: { 'no-restricted-syntax': ['error', ...loadsPGlite, ...runsConcurrently] },
  },
  prettier,
);
