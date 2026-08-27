import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Paths resolve from THIS file, never from `process.cwd()` — a cwd-relative walk
// silently checks nothing when vitest is given a different root.
export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Not ours to measure: dependencies, build output, and git's own store. */
const SKIP = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.vite',
  '.turbo',
  '.superpowers', // Git-ignored scratch written by tooling; the cap governs the repository's documentation.
]);

export function markdownFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      found.push(...markdownFiles(join(dir, entry.name)));
    } else if (entry.name.endsWith('.md')) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}
