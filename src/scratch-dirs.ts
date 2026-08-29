/** The directories `.gitignore`, `eslint.config.js` and `vitest.config.ts` must ALL
 *  name. They cannot import a TypeScript module, so each restates the list — and they
 *  kept drifting one entry at a time, each divergence found by a different review
 *  round: `.claude` (all four tools), `.superpowers` (eslint was measured
 *  linting a live `verify.ts` there, and vitest collected a probe test),
 *  `.vite`/`.turbo` (absent from `.gitignore` alone), `coverage` — named by NONE
 *  of the three, so one `vitest --coverage` run would have reproduced the whole bug
 *  against a directory nothing guarded — and finally `.vscode` and `.tmp-*`, hidden
 *  from git and prettier for years but linted and collected by the other two.
 *
 *  This is deliberately NOT `SKIP` itself. `SKIP` answers "not ours to measure" and
 *  drives the Markdown, claim and distillation walks; this answers "not ours to
 *  track", and the two only overlap. `SKIP` holds `.claude` whole — correct for
 *  measurement — while only `worktrees/` under it is untrackable. Conflating them
 *  would push a future session to gitignore a directory the repo commits (`design/`
 *  is the obvious candidate: `.prettierignore` already exempts it for the same
 *  "not ours" reason). The one direction that does hold is asserted below. */
export const PARITY = [
  '.claude',
  '.superpowers',
  '.vite',
  '.turbo',
  '.idea',
  '.playwright-mcp',
  'coverage',
  'dist',
  '.vscode',
  '.tmp-*',
] as const;

/** Root and nested. A git pattern containing a slash is ROOT-ANCHORED, while the
 *  eslint and vitest spellings match at any depth, so depth is a second axis on
 *  which the three configs can silently disagree — and did. */
export const probesFor = (dir: string) => {
  // `.tmp-*` is a WILDCARD rule, not a directory name — substituted here so one
  // concrete path exercises it. `.tmp-x` matches `.tmp-*` for git, eslint and vitest
  // alike; without this the probe would ask about a literal directory named `.tmp-*`
  // and every tool would answer "not ignored" for a repository that is correct.
  const concrete = dir.replace('*', 'x');
  return [`${concrete}/probe.ts`, `infra/${concrete}/probe.ts`];
};
