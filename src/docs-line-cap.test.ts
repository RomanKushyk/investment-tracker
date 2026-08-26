import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// D95 makes "no documentation file exceeds 200 lines" a repo-wide invariant, and
// D96 removes the range files that made it impossible to hold in the decision log.
// Neither was enforced by anything: `.prettierignore` excludes Markdown at every
// depth (hand-formatted tables carrying measured figures), so the gate never reads
// a documentation file, and the rule lived only as a sentence restated in six
// places. D95's own measured figures went stale inside three commits, which is the
// drift this pins — the same reason `app/mark.test.ts` pins the favicon it cannot
// see rendered.
//
// It lives in `src/` because that is where the toolchain runs; it governs the whole
// repository, which is the one exception to src/README's structure table.
//
// Paths resolve from THIS file, never from `process.cwd()` — a cwd-relative walk
// silently checks nothing when vitest is given a different root.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Not ours to measure: dependencies, build output, and git's own store. */
const SKIP = new Set(['node_modules', 'dist', 'coverage', '.git', '.vite', '.turbo']);

const LIMIT = 200;

function markdownFiles(dir: string): string[] {
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

/** `wc -l` semantics: newline count, so a file with no trailing newline is not over-counted. */
function lineCount(path: string): number {
  const text = readFileSync(path, 'utf8');
  let n = 0;
  for (const ch of text) if (ch === '\n') n += 1;
  return n;
}

const FILES = markdownFiles(REPO).map((p) => relative(REPO, p).split(sep).join('/'));

describe('documentation line cap (D95)', () => {
  it('finds the documentation to measure', () => {
    // A walk that quietly matches nothing would pass every assertion below.
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES).toContain('CLAUDE.md');
    expect(FILES).toContain('docs/plans/PLAN-NOW.md');
  });

  it('keeps every Markdown file at 200 lines or fewer', () => {
    const over = FILES.map((f) => [f, lineCount(join(REPO, f))] as const)
      .filter(([, n]) => n > LIMIT)
      .sort((a, b) => b[1] - a[1])
      .map(([f, n]) => `${n} ${f}`);

    // Split it before the next entry lands, not after: the index's range table is
    // updated in the same commit, bodies move VERBATIM, and IDs never change.
    expect(over).toEqual([]);
  });
});

describe('the decision log is one file per decision (D96)', () => {
  const decisions = FILES.filter(
    (f) => f.startsWith('docs/decisions/') && f !== 'docs/decisions/README.md',
  );

  it('has no range files left, and none may come back', () => {
    // `D41-D50.md` held D41-D60 and `D61-D80.md` held D81-D83: a filename asserting
    // a range it does not hold. Appending is creating a file now, so this is dead.
    expect(decisions.filter((f) => /\/D\d+-D\d+\.md$/.test(f))).toEqual([]);
  });

  it('names every entry exactly as it is cited', () => {
    // Bare-number citations across `src/` and `docs/` must keep resolving forever.
    expect(decisions.filter((f) => !/\/D\d+\.md$/.test(f))).toEqual([]);
  });

  it('has no gap in the sequence', () => {
    const numbers = decisions
      .map((f) => Number(/\/D(\d+)\.md$/.exec(f)?.[1]))
      .sort((a, b) => a - b);
    expect(numbers[0]).toBe(1);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
  });
});
