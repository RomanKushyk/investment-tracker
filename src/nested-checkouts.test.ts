import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { getFileInfo } from 'prettier';
import { describe, expect, it } from 'vitest';
import { REPO, skipped } from './repo-root';
import vitestConfig from '../vitest.config';
import { PARITY, probesFor } from './scratch-dirs';

// A background agent's worktree is a SECOND CHECKOUT of this repository, nested at
// `.claude/worktrees/<name>/`. Every tool that walks the tree found it and each failed
// differently, which is why they are guarded together rather than one per config file: it is
// ONE BUG WITH FOUR SURFACES, and fixing three reads as fixed. The sharp edge is not the
// waste — it is that `pnpm lint` and `pnpm test` answered a different question depending on
// whether an agent happened to be running, and a gate whose verdict moves with background
// state is not a gate.
//
// THE TOOLS ARE ASYMMETRIC ON PURPOSE and both directions are asserted below. Git commits
// the SHARED half of a Claude Code config — `settings.json`, `commands/`, `agents/`,
// `skills/` — while eslint and vitest exclude `.claude` WHOLE, because a vendored skill is
// configuration rather than this repository's source. Prettier follows git, and those four
// are the entries git does NOT ignore, so prettier is the one tool that reads them and they
// need a `.prettierignore` line of their own.
const SHARED = [
  '.claude/settings.json',
  '.claude/agents/helper.ts',
  '.claude/commands/x.md',
  '.claude/skills/s/SKILL.md',
];
const PERSONAL = '.claude/settings.local.json';

describe('a nested checkout is invisible to every tool that walks the repo', () => {
  const ignoredByGit = (path: string) => {
    try {
      // `-c core.excludesFile=` because `check-ignore` merges the user's GLOBAL excludes
      // with the repo's own, and this machine's already carries a `.claude` rule. Unpinned,
      // a developer whose global ignore holds these could delete a rule here and keep both a
      // green suite AND a green local `/code-review`.
      execFileSync('git', ['-c', 'core.excludesFile=', 'check-ignore', '-q', '--no-index', path], {
        cwd: REPO,
      });
      return true;
    } catch (error) {
      // Exit 1 is "not ignored"; 128 is a real failure — git missing, dubious ownership, or
      // not a checkout at all. Reporting 128 as "not ignored" would fail this test pointing
      // at `.gitignore` for an environment problem, while the anchors below passed.
      if ((error as { status?: unknown }).status === 1) return false;
      throw error;
    }
  };

  // A TIMEOUT OF ITS OWN, because this case's cost is a process count rather than work in
  // the assertion: one `git check-ignore` per probe, two probes per entry. Against vitest's
  // 5s default it began failing roughly every other full run while passing in isolation —
  // nothing about the guard changed, the suite grew around it, and process spawning does not
  // get faster under load. 20s is the right cap for a test whose duration is the OS's to
  // decide, and it still catches a genuine hang.
  it('git hides every scratch directory, at the root and nested', () => {
    expect(PARITY.flatMap(probesFor).filter((p) => !ignoredByGit(p))).toEqual([]);
    expect(
      ignoredByGit('package.json'),
      'git calls a real tracked file ignored, so it is answering about the wrong repository ' +
        'or ignoring everything — the anchor a one-sided "ignored" check cannot provide',
    ).toBe(false);
  }, 20_000);

  it('git keeps the SHARED Claude config committable, and hides the rest', () => {
    expect(
      SHARED.filter(ignoredByGit),
      '`**/.claude/*` without its four negations hides the committed half — `/update-config` ' +
        'writes a permission allowlist and `git add -A` skips it in silence',
    ).toEqual([]);
    expect(ignoredByGit(PERSONAL)).toBe(true);
    // Not just the personal file: everything else Claude Code writes there — `todos/`,
    // `/loop` and `/schedule` state — stays hidden, because anything left untracked AND
    // unignored also reaches prettier.
    expect(ignoredByGit('.claude/todos/t.json')).toBe(true);
    // FOURTH TEST IN THIS REPO TO CARRY A TIMEOUT, all with one cause: a test that spawns
    // child processes loses the CPU race in a parallel run and blows the 5000ms default on
    // an unchanged repo. If a FIFTH appears, the answer stops being a number here — give the
    // spawning tests their own vitest project, or keep them off the contended pool.
  }, 20_000);

  it('prettier skips the shared half too — it is committed, not ours to format', async () => {
    // The four negated entries are NOT gitignored, so prettier reads them, and with eslint
    // and vitest excluding `.claude` whole it is the only gate that does. Narrowing
    // `.prettierignore` to `settings.json` was tried and covered one file of four: a skill
    // ships `scripts/*.js`, `references/*.json` and `*.yaml` beside its Markdown.
    const ignored = async (path: string) =>
      (
        await getFileInfo(join(REPO, path), {
          ignorePath: [join(REPO, '.gitignore'), join(REPO, '.prettierignore')],
        })
      ).ignored;
    for (const path of [
      '.claude/settings.json',
      '.claude/skills/s/script.json',
      '.claude/skills/s/config.yaml',
      '.claude/agents/helper.ts',
    ]) {
      expect(await ignored(path), `${path} reaches prettier, which does not own it`).toBe(true);
    }
  });

  it('prettier hides them too, by riding on .gitignore rather than a second rule', async () => {
    // `ignorePath` REPRODUCES prettier's CLI default rather than observing it: `getFileInfo`
    // with no `ignorePath` ignores nothing at all, so there is no way to ask the library what
    // its CLI would do. If a prettier major drops `.gitignore` from that default,
    // `format:check` goes red on scratch while this test stays green. Exercised anyway,
    // because "prettier honours .gitignore" is the load-bearing reason `.prettierignore`
    // gains no entry, and a reason only ever asserted in prose is the one that turns out wrong.
    //
    // Absolute paths, because `getFileInfo` resolves the probe and the `ignorePath` entries
    // against `process.cwd()` and takes no cwd of its own — unlike the git and eslint probes.
    const ignored = async (path: string) =>
      (
        await getFileInfo(join(REPO, path), {
          ignorePath: [join(REPO, '.gitignore'), join(REPO, '.prettierignore')],
        })
      ).ignored;
    for (const path of PARITY.flatMap(probesFor)) expect(await ignored(path)).toBe(true);
    expect(await ignored('package.json'), 'prettier now ignores the whole repo').toBe(false);
  });

  it('eslint hides them — flat config does NOT read .gitignore', async () => {
    // Asked of ESLint itself: `isPathIgnored` resolves the real flat config, so this survives
    // the ignore moving between config objects or changing spelling. Importing
    // `eslint.config.js` to read its `ignores` array does not typecheck — that file is
    // outside the root tsconfig program.
    //
    // The probes end in `.ts`, and THE EXTENSION IS LOAD-BEARING: `isPathIgnored` returns
    // true for any path no config's `files` pattern claims, and the only one here is
    // `**/*.{ts,tsx}` — so a `.json` probe reports "ignored" with no ignore rule at all. The
    // anchor is `src/main.tsx` for the same reason: `package.json` would anchor nothing.
    const eslint = new ESLint({ cwd: REPO });
    for (const path of PARITY.flatMap(probesFor))
      expect(await eslint.isPathIgnored(path)).toBe(true);
    expect(await eslint.isPathIgnored('src/main.tsx'), 'eslint now ignores real source').toBe(
      false,
    );
    // The shared half is ignored HERE and committed by git — the asymmetry is the decision,
    // so it is pinned rather than left to be rediscovered.
    for (const path of SHARED) expect(await eslint.isPathIgnored(path)).toBe(true);
    // Carries 20_000 for the reason its sibling above does: resolving the real flat config is
    // expensive, and under a full parallel run it misses the default often enough to redden
    // the gate on an unchanged repo.
  }, 20_000);

  it('vitest hides them — nor does vitest read .gitignore', () => {
    // Its default exclude is only `**/node_modules/**` and `**/.git/**`; everything else a
    // repo wants hidden it has to say. That the defaults are SPREAD rather than replaced is
    // `vitest-scope.test.ts`'s assertion, not repeated here.
    const exclude = vitestConfig.test?.exclude ?? [];
    expect(PARITY.filter((dir) => !exclude.includes(`**/${dir}/**`))).toEqual([]);
  });

  it('the rules live in the COMMITTED .gitignore, not in a local excludes file', () => {
    // `check-ignore` above pins `core.excludesFile`, but it still consults
    // `.git/info/exclude` — the conventional machine-local ignore, and one no flag switches
    // off. So the behavioural probe is paired with a textual one.
    //
    // COMMENTS STRIPPED FIRST, and that is what makes the pairing real: a raw substring match
    // could not fail for `.claude`, which appears many times over inside the comment block
    // explaining the rule. WHOLE RULES, not substrings — `includes('dist')` was satisfied by
    // the unrelated `infra/dist/` line, so deleting the root `dist/` rule left this green.
    const rules = readFileSync(join(REPO, '.gitignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) =>
        line
          .replace(/^\*\*\//, '')
          .replace(/\/\*$/, '')
          .replace(/\/$/, ''),
      );
    // First segment: `.claude/worktrees` is covered by the `**/.claude/*` rule and its
    // negations, which is the whole point of that form.
    expect(
      PARITY.filter((dir) => !rules.includes(dir.split('/')[0])),
      'a scratch directory is hidden by something other than the repository’s own file',
    ).toEqual([]);
  });

  it('nothing hidden from the tools is measured either — the one direction that holds', () => {
    // The converse is NOT asserted, and must not be — see the note on PARITY. Asked through
    // `skipped()` rather than `SKIP` directly, because `SKIP` holds exact names and `.tmp-*`
    // is a pattern; the predicate is what the walk itself calls, so this cannot pass against
    // a rule the walk does not apply.
    expect(PARITY.filter((dir) => !skipped(dir.replace('*', 'x').split('/')[0]))).toEqual([]);
  });
});
