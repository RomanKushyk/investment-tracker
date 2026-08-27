import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from './facts/markdown-files';

// scripts/README.md missed scripts/decisions.ts — the same gap a pre-merge review found
// for scripts/facts.ts one branch earlier, recurring right after it was fixed. A rule a
// reviewer has to remember is the class this whole spec is about; this makes the gap a
// failing test instead.

describe('scripts/README.md documents every file in scripts/', () => {
  const scriptsDir = join(REPO, 'scripts');
  const readme = readFileSync(join(scriptsDir, 'README.md'), 'utf8');
  // withFileTypes + isFile(): a future scripts/lib/ subdirectory is not a
  // file this check can demand a documentation row for.
  const files = readdirSync(scriptsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name !== 'README.md')
    .map((e) => e.name);

  it('finds files to check — a silent empty read would pass the next assertion vacuously', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('mentions every file as a `filename` row, not merely as a substring', () => {
    // A plain readme.includes(f) would let "scripts/registry.ts" pass
    // because the README already mentions "src/facts/registry.ts" — a
    // different file with the same basename. Table rows backtick-wrap the
    // filename exactly (`` `decisions.ts` ``); that exact substring cannot
    // appear inside a LONGER backtick-wrapped path like `` `src/facts/
    // registry.ts` ``, whose opening backtick is followed by "src", not by
    // the filename itself.
    const undocumented = files.filter((f) => !readme.includes('`' + f + '`'));
    expect(undocumented).toEqual([]);
  });
});

// src/decisions/ had no README.md, though core/ and facts/ both do and CLAUDE.md requires
// one for every new folder; src/README.md's own structure table had a row for facts/ but
// none for decisions/. Both directions are checked below: a subdirectory README that
// src/README.md never names, and a name src/README.md gives that no file backs.

describe('src/README.md cross-references every subdirectory README.md', () => {
  const srcDir = join(REPO, 'src');
  const readme = readFileSync(join(srcDir, 'README.md'), 'utf8');
  const allDirs = readdirSync(srcDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'node_modules')
    .map((e) => e.name);
  const dirsWithReadme = allDirs.filter((name) => existsSync(join(srcDir, name, 'README.md')));

  it('finds the known mechanism folders — a silent empty scan would pass vacuously', () => {
    expect(dirsWithReadme).toEqual(expect.arrayContaining(['core', 'facts', 'decisions']));
  });

  it('every subdirectory with its own README.md is named in src/README.md', () => {
    const unreferenced = dirsWithReadme.filter((name) => !readme.includes(`${name}/README.md`));
    expect(unreferenced).toEqual([]);
  });

  it('no real src/ subdirectory is claimed to have a README.md it does not', () => {
    // Anchored to ACTUAL src/ subdirectory names, not to any path-shaped
    // string extracted from the text. A generic "X/README.md" regex over
    // the whole document also matches "docs/plans/README.md" (extracting
    // "plans", which is not a src/ subdirectory at all) and
    // "scripts/README.md" (a real file — just not nested under src/) —
    // neither is a claim about a src/ subdirectory. Checking only known
    // src/ names sidesteps both: "plans" and "scripts" are never even
    // candidates, so a legitimate mention of another folder's README
    // elsewhere in the prose cannot false-trigger this.
    const falselyClaimed = allDirs.filter(
      (name) =>
        readme.includes(`${name}/README.md`) && !existsSync(join(srcDir, name, 'README.md')),
    );
    expect(falselyClaimed).toEqual([]);
  });
});

// The coverage guard was itself the gap once: readme-coverage.test.ts, a new top-level
// src/*.ts file, was missing from src/README.md's table, and nothing above could have
// caught it — the checks so far only ever look at SUBDIRECTORIES.

describe('src/README.md documents every top-level src/*.ts(x) file', () => {
  const srcDir = join(REPO, 'src');
  const readme = readFileSync(join(srcDir, 'README.md'), 'utf8');
  // .d.ts excluded: a pure ambient type-declaration file (vite-env.d.ts)
  // has no behaviour to describe, unlike every other top-level module here.
  const files = readdirSync(srcDir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts'))
    .map((e) => e.name);

  it('finds files to check — a silent empty read would pass the next assertion vacuously', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('mentions every one as a `filename` row', () => {
    const undocumented = files.filter((f) => !readme.includes('`' + f + '`'));
    expect(undocumented).toEqual([]);
  });
});
