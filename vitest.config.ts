import { availableParallelism } from 'node:os';
import { configDefaults, defineConfig } from 'vitest/config';

// `vitest run`'s default, one worker fewer than the cores, capped at four, in watch mode too:
// a worker's memory does not shrink with more cores, and one main-thread Vite server serves all.
export function maxWorkersFor(cores: number): number {
  return Math.max(1, Math.min(cores - 1, 4));
}

export default defineConfig({
  test: {
    environment: 'node',
    maxWorkers: maxWorkersFor(availableParallelism()),
    // Nested worktrees and vendored skills hold tests that are not this suite, and the scratch
    // directories keep parity with git and eslint; `src/nested-checkouts.test.ts` checks all three.
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
