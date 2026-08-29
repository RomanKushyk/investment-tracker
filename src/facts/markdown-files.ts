import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Paths resolve from THIS file, never from `process.cwd()` — a cwd-relative walk
// silently checks nothing when vitest is given a different root.
export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Not ours to MEASURE — and only that. The ignore-parity list is
 *  `src/scratch-dirs.ts`'s `PARITY` ("not ours to TRACK"); they overlap without
 *  coinciding, and D109 carries the argument. Read it before changing either.
 *
 *  `.claude` is here whole because `worktrees/<name>/` is a second checkout of this
 *  repository: a walk that did not skip it would double-count every Markdown file
 *  per open worktree, and a baseline regenerated then records the worktree's paths.
 */
export const SKIP = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.vite',
  '.turbo',
  '.superpowers', // Git-ignored scratch written by tooling; the cap governs the repository's documentation.
  '.claude',
  '.idea',
  '.playwright-mcp',
  '.vscode',
]);

/** `SKIP` holds exact names, `.tmp-*` is a pattern, and the walk must honour both —
 *  a `.tmp-<x>/` directory of Markdown would otherwise be measured and ratcheted into
 *  a baseline. One predicate, so `PARITY` can be checked against what the walk
 *  actually applies. */
export const skipped = (name: string) => SKIP.has(name) || name.startsWith('.tmp-');

/** The same repo walk and `SKIP` set as `markdownFiles`, generalised to any
 *  set of extensions — added for `src/claims/` (`.md`, `.sql`, `.ts`,
 *  `.tsx`), which needs the identical walk over a wider file set rather
 *  than a second, drifting copy of it. `markdownFiles` below is now a thin
 *  wrapper over this. */
export function repoFiles(dir: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (skipped(entry.name)) continue;
      found.push(...repoFiles(join(dir, entry.name), extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

export function markdownFiles(dir: string): string[] {
  return repoFiles(dir, ['.md']);
}
