import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Paths resolve from THIS file, never from `process.cwd()` — a cwd-relative walk
// silently checks nothing when vitest is given a different root.
export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories not ours to measure. The ignore-parity list is `src/scratch-dirs.ts`'s
 *  `PARITY`; they overlap without coinciding. `.claude` is skipped whole because
 *  `worktrees/<name>/` is a second checkout of this repository. */
export const SKIP = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.vite',
  '.turbo',
  '.superpowers',
  '.claude',
  '.idea',
  '.playwright-mcp',
  '.vscode',
]);

/** `SKIP` holds exact names, `.tmp-*` is a pattern; one predicate so `PARITY` can be checked against it. */
export const skipped = (name: string) => SKIP.has(name) || name.startsWith('.tmp-');
