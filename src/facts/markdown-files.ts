import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Paths resolve from THIS file, never from `process.cwd()` — a cwd-relative walk
// silently checks nothing when vitest is given a different root.
export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Not ours to measure: dependencies, build output, git's own store, and
 *  tooling scratch. `.claude/worktrees/<name>/` in particular is a SECOND
 *  checkout of this repository nested inside it — a walk that did not skip
 *  it would double-count (or triple-, with more than one worktree open)
 *  every Markdown file for as long as the worktree exists, and regenerating
 *  a baseline in that state would write the worktree's own paths into the
 *  committed file. */
const SKIP = new Set([
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
]);

/** The same repo walk and `SKIP` set as `markdownFiles`, generalised to any
 *  set of extensions — added for `src/claims/` (`.md`, `.sql`, `.ts`,
 *  `.tsx`), which needs the identical walk over a wider file set rather
 *  than a second, drifting copy of it. `markdownFiles` below is now a thin
 *  wrapper over this. */
export function repoFiles(dir: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
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
