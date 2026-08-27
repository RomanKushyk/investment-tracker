import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { markdownFiles } from './markdown-files';

/** Builds a scratch tree with one real `.md` file and one inside each of
 *  `dirs`, and returns what `markdownFiles` finds there. */
function walk(dirs: string[]): string[] {
  const root = mkdtempSync(join(tmpdir(), 'markdown-files-test-'));
  try {
    writeFileSync(join(root, 'real.md'), 'x\n');
    for (const dir of dirs) {
      const nested = join(root, dir);
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, 'skipped.md'), 'x\n');
    }
    return markdownFiles(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('markdownFiles SKIP set', () => {
  it('still finds an ordinary file, so the walk itself is not the thing being skipped', () => {
    const found = walk([]);
    expect(found).toHaveLength(1);
  });

  it.each(['.claude', '.idea', '.playwright-mcp'])('skips a %s/ directory entirely', (dir) => {
    // `real.md` at the root is still found — only the file inside `dir` is skipped.
    const found = walk([dir]);
    expect(found).toHaveLength(1);
  });

  it('skips `.claude/worktrees/<name>/` specifically — a nested checkout of this repository', () => {
    const found = walk([join('.claude', 'worktrees', 'some-task')]);
    expect(found).toHaveLength(1);
  });
});
