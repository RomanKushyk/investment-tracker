import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // vitest's default exclude is ONLY `**/node_modules/**` and `**/.git/**`.
    // `.claude/worktrees/<name>/` is a second checkout of this repository nested
    // inside it, so without this the suite collects every test file once per open
    // worktree: measured 225 collected files against a real suite of 75 — exactly
    // three copies, one per checkout, with two worktrees open.
    // That is not merely slow — it makes `pnpm test` answer a different question
    // depending on whether a background agent happens to be running, and a gate
    // whose verdict depends on that is not a gate.
    //
    // `.claude` WHOLE, including the half git commits: a vendored skill or agent is
    // configuration, not this repository's source, and a `*.test.ts` shipped under
    // `.claude/skills/` was measured being collected into this suite. The
    // scratch directories beside it are here for the same measured reason — eslint
    // was linting a live `verify.ts` inside `.superpowers/`, and nothing at all
    // covered `coverage/`. `src/nested-checkouts.test.ts` holds all three configs
    // to one list.
    exclude: [
      ...configDefaults.exclude,
      '**/.claude/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.superpowers/**',
      '**/.vite/**',
      '**/.turbo/**',
      '**/.idea/**',
      '**/.playwright-mcp/**',
      '**/.vscode/**',
      '**/.tmp-*/**',
    ],
  },
});
