import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { getFileInfo } from 'prettier';
import { describe, expect, it } from 'vitest';
import { REPO, skipped } from './facts/markdown-files';
import vitestConfig from '../vitest.config';
import { PARITY, probesFor } from './scratch-dirs';

// A background agent's worktree is a SECOND CHECKOUT of this repository, nested at
// `.claude/worktrees/<name>/`. Every tool that walks the tree found it, and each
// failed differently — which is why they are guarded together rather than one per
// config file: it is ONE bug with four surfaces, and fixing three reads as fixed.
//
// Measured with two worktrees open, before the fix:
//   git        `git add -A` staged two EMBEDDED REPOSITORIES into the index
//   eslint     456 files linted of 685 — two thirds of the run
//   vitest     225 test files collected against a real suite of 75
//   prettier   `format:check` RED on a fixture it is told to ignore in the real tree
//
// The sharp edge is not the waste, it is that `pnpm lint` and `pnpm test` answered a
// different question depending on whether an agent happened to be running. A gate
// whose verdict depends on background state is not a gate — and every green run
// recorded while a worktree was open proved less than it appeared to.
//
// `src/facts/markdown-files.ts` is the one that got it right: its SKIP set has held
// `.claude` all along, with a comment about this exact double-count. The TS walk
// knew; the four config-driven tools did not.

// The SHARED half of a Claude Code config — `settings.json`, `commands/`, `agents/`,
// `skills/` — is committed, and GIT must not hide it. `**/.claude/*` WITHOUT the four
// negations hid all of it: `/update-config` would write a permission allowlist and
// `git add -A` would skip it in silence.
//
// The tools are asymmetric on purpose, and both directions are asserted below. Git
// commits these; eslint and vitest exclude `.claude` WHOLE, because a vendored skill
// or agent is configuration rather than this repository's source — measured, a
// `*.test.ts` under `.claude/skills/` was collected into this very suite. Prettier
// follows git, so `.claude/settings.json` carries a `.prettierignore` line of its
// own: `/update-config` writes it with `JSON.stringify(obj, null, 2)`, no trailing
// newline, and `format:check` went RED on a file nobody edited.
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
      // `-c core.excludesFile=` because `check-ignore` merges the user's GLOBAL
      // excludes with the repo's own, and this machine's `~/.config/git/ignore`
      // already carries a `.claude` rule — measured: with the repo rule deleted, git
      // still answered "ignored", citing that file. Unpinned, a developer whose
      // global ignore holds these could delete a rule here and keep both a green
      // suite AND a green local `/code-review`. D109's own thesis is that a verdict
      // which moves with background state is not a verdict; that applies here first.
      execFileSync('git', ['-c', 'core.excludesFile=', 'check-ignore', '-q', '--no-index', path], {
        cwd: REPO,
      });
      return true;
    } catch (error) {
      // Exit 1 is "not ignored"; 128 is a real failure — git missing, dubious
      // ownership, or not a checkout at all (a tarball export, a Docker build
      // context). Reporting 128 as "not ignored" would fail this test pointing at
      // `.gitignore` for an environment problem, while the negative anchors below
      // passed for the wrong reason.
      if ((error as { status?: unknown }).status === 1) return false;
      throw error;
    }
  };

  it('git hides every scratch directory, at the root and nested', () => {
    expect(PARITY.flatMap(probesFor).filter((p) => !ignoredByGit(p))).toEqual([]);
    // The anchor: a guard that only asserts "ignored" passes just as well when git
    // is answering about the wrong repository, or ignoring everything.
    expect(ignoredByGit('package.json')).toBe(false);
  });

  it('git keeps the SHARED Claude config committable, and hides the rest', () => {
    expect(SHARED.filter(ignoredByGit)).toEqual([]);
    expect(ignoredByGit(PERSONAL)).toBe(true);
    // Not just the personal file: everything else Claude Code writes there —
    // `todos/`, `/loop` and `/schedule` state — stays hidden, because anything left
    // untracked AND unignored also reaches prettier.
    expect(ignoredByGit('.claude/todos/t.json')).toBe(true);
  });

  it('prettier skips the shared half too — it is committed, not ours to format', async () => {
    // The four negated entries are NOT gitignored, so prettier reads them, and with
    // eslint and vitest excluding `.claude` whole it is the only gate that does —
    // failing on files nobody edited. Narrowing `.prettierignore` to `settings.json`
    // was tried and covered one file of four: `/update-config` writes that one
    // without a trailing newline, and a skill ships `scripts/*.js`,
    // `references/*.json` and `*.yaml` beside its Markdown. Measured, four RED.
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
      expect(await ignored(path)).toBe(true);
    }
  });

  it('prettier hides them too, by riding on .gitignore rather than a second rule', async () => {
    // `ignorePath` REPRODUCES prettier's CLI default rather than observing it —
    // `getFileInfo` with no `ignorePath` ignores nothing at all (measured), so there
    // is no way to ask the library what its CLI would do. If a prettier major drops
    // `.gitignore` from that default, `format:check` goes red on scratch while this
    // test stays green. Exercised anyway, because "prettier honours .gitignore" is
    // the load-bearing reason `.prettierignore` gains no entry, and a reason that is
    // only ever asserted in prose is the one that turns out wrong.
    //
    // Absolute paths, because `getFileInfo` resolves the probe path and the
    // `ignorePath` entries against `process.cwd()` and takes no cwd of its own —
    // unlike the git and eslint probes, which pin `cwd: REPO`.
    const ignored = async (path: string) =>
      (
        await getFileInfo(join(REPO, path), {
          ignorePath: [join(REPO, '.gitignore'), join(REPO, '.prettierignore')],
        })
      ).ignored;
    for (const path of PARITY.flatMap(probesFor)) expect(await ignored(path)).toBe(true);
    expect(await ignored('package.json')).toBe(false);
  });

  it('eslint hides them — flat config does NOT read .gitignore', async () => {
    // Asked of ESLint itself, like the git check above: `isPathIgnored` resolves the
    // real flat config, so this survives the ignore moving between config objects or
    // changing spelling. Importing `eslint.config.js` to read its `ignores` array was
    // the first attempt and does not typecheck — that file is outside the root
    // tsconfig program, so TS7016 fires on the import before any assertion runs.
    //
    // The probes end in `.ts`, and THE EXTENSION IS LOAD-BEARING: `isPathIgnored`
    // returns true for any path no config's `files` pattern claims, and the only one
    // here is `**/*.{ts,tsx}` — so a `.json` probe reported "ignored" with no ignore
    // rule at all, and this whole suite stayed green while the rules were narrowed.
    // The anchor is `src/main.tsx` for the same reason: `package.json` reports
    // "ignored" under any config, so it would anchor nothing.
    const eslint = new ESLint({ cwd: REPO });
    for (const path of PARITY.flatMap(probesFor))
      expect(await eslint.isPathIgnored(path)).toBe(true);
    expect(await eslint.isPathIgnored('src/main.tsx')).toBe(false);
    // The shared half is ignored HERE and committed by git — the asymmetry is the
    // decision, so it is pinned rather than left to be rediscovered.
    for (const path of SHARED) expect(await eslint.isPathIgnored(path)).toBe(true);
  });

  it('vitest hides them — nor does vitest read .gitignore', () => {
    // Its default exclude is only `**/node_modules/**` and `**/.git/**`; everything
    // else a repo wants hidden it has to say. That the defaults are SPREAD rather
    // than replaced is `vitest-scope.test.ts`'s assertion, not repeated here.
    const exclude = vitestConfig.test?.exclude ?? [];
    expect(PARITY.filter((dir) => !exclude.includes(`**/${dir}/**`))).toEqual([]);
  });

  it('the rules live in the COMMITTED .gitignore, not in a local excludes file', () => {
    // `check-ignore` above pins `core.excludesFile`, but it still consults
    // `.git/info/exclude` — the conventional place for a machine-local ignore, and
    // one no flag can switch off. So the behavioural probe is paired with a textual
    // one: whatever hides these, the repository's own file names them.
    //
    // COMMENTS STRIPPED FIRST, and that is what makes the pairing real. A raw
    // substring match over the file could not fail for `.claude`: it appears there
    // many times over, nearly all inside the comment block explaining the rule.
    // Measured — delete the rule, keep its comment, put `.claude/` in
    // `.git/info/exclude`, and both this check and the behavioural one stayed green.
    // WHOLE RULES, not substrings. `includes('dist')` was satisfied by the unrelated
    // `infra/dist/` line, so deleting the root `dist/` rule left this green — and
    // paired with the `.git/info/exclude` hole this test exists to cover, a developer
    // whose local exclude named `dist` would have kept both halves green with the
    // repo rule gone. Each rule is normalised to the directory it names.
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
    // First segment: `.claude/worktrees` is covered by the `**/.claude/*` rule and
    // its negations, which is the whole point of that form. The personal file is
    // covered behaviourally above; it has no rule of its own any more.
    expect(PARITY.filter((dir) => !rules.includes(dir.split('/')[0]))).toEqual([]);
  });

  it('nothing hidden from the tools is measured either — the one direction that holds', () => {
    // Every directory the tools hide is also outside the Markdown/claim/distillation
    // walks. The converse is NOT asserted, and must not be — see the note on PARITY.
    // Asked through `skipped()` rather than `SKIP` directly, because `SKIP` holds
    // exact names and `.tmp-*` is a pattern; the predicate is what the walk itself
    // calls, so this cannot pass against a rule the walk does not actually apply.
    expect(PARITY.filter((dir) => !skipped(dir.replace('*', 'x').split('/')[0]))).toEqual([]);
  });
});
