import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { REPO } from '../facts/markdown-files';
import { claimTargetFiles } from './target-files';

describe('claimTargetFiles', () => {
  it('includes a real tracked .ts file with a target extension', () => {
    expect(claimTargetFiles()).toContain('src/claims/scan.ts');
  });

  it('includes .md and .sql files too', () => {
    const files = claimTargetFiles();
    expect(files.some((f) => f.endsWith('.md'))).toBe(true);
    expect(files.some((f) => f.endsWith('.sql'))).toBe(true);
  });

  it('never returns a file git itself does not track', () => {
    // Read-only, no filesystem mutation: an earlier version of this test
    // wrote a real untracked probe file INSIDE the repo tree to prove
    // exclusion — a real risk in itself, since other test files walk that
    // same tree in parallel workers, and an aborted run before the
    // cleanup ran would leak the scratch directory into the user's actual
    // working tree. A fresh, independent `git ls-files` call proves the
    // same property (every returned path is one git considers tracked)
    // without creating anything to leak or race.
    const out = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    const tracked = new Set(out.split('\0').filter((line) => line.length > 0));
    for (const file of claimTargetFiles()) {
      expect(tracked.has(file), `${file} was returned but git does not track it`).toBe(true);
    }
  });
});
