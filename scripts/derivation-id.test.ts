import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, matchesGlob } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

import { REPO } from '../src/repo-root';
import viteConfig from '../vite.config';
import vitestConfig from '../vitest.config';
import { derivationId } from './derivation-id.ts';

// The SPA and the Lambdas are built by two workflows, and both must define one value for one
// commit; throwaway repositories ask what moves it.

type Step = { run?: string };
type Workflow = {
  on: { push: { branches?: string[]; paths?: string[]; 'paths-ignore'?: string[] } };
  jobs: Record<string, { steps?: Step[] }>;
};
const workflow = (file: string) =>
  parseDocument(readFileSync(join(REPO, '.github/workflows', file), 'utf8')).toJS() as Workflow;

/** A git call that reads no git configuration and no `GIT_` variable of this machine: identity,
 *  object format and line endings come from the arguments alone. */
const GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: 'pipe', env: GIT_ENV },
  ).trim();

const init = (dir: string) => {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '--object-format=sha1', '--initial-branch=main');
  git(dir, 'config', 'core.autocrlf', 'false');
};

const write = (dir: string, rel: string, text: string) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

const commit = (dir: string) => {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'x');
};

/** A scratch directory that is removed whatever the body throws. */
const scratch = (body: (root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), 'derivation-'));
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const CORE = ['packages/core/src/a.ts', 'packages/core/src/b.ts'];
const ELSEWHERE = ['README.md', 'packages/core/README.md', 'infra/x.ts', 'src/y.ts'];
const SHA = /^[0-9a-f]{40}$/;

// From PowerShell, `bash` on win32 is WSL's launcher; Git's own MSYS bash is the one to run.
const BASH =
  process.platform === 'win32'
    ? join(
        execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(),
        '../../../usr/bin/bash.exe',
      )
    : 'bash';

describe('the derivation identifier', () => {
  it('is the same for one commit under a CRLF checkout and an LF one', () => {
    scratch((root) => {
      const origin = join(root, 'origin');
      init(origin);
      for (const rel of CORE) write(origin, rel, 'export const one = 1;\nexport const two = 2;\n');
      commit(origin);
      git(root, 'clone', '-q', '-c', 'core.autocrlf=true', 'origin', 'crlf');
      git(root, 'clone', '-q', '-c', 'core.autocrlf=false', 'origin', 'lf');
      // Git's own census of the two checkouts, the anchor that they differ.
      expect(git(join(root, 'crlf'), 'ls-files', '--eol', CORE[0])).toMatch(/\bw\/crlf\b/);
      expect(git(join(root, 'lf'), 'ls-files', '--eol', CORE[0])).toMatch(/\bw\/lf\b/);
      expect(derivationId(join(root, 'crlf'))).toMatch(SHA);
      expect(derivationId(join(root, 'crlf'))).toBe(derivationId(join(root, 'lf')));
    });
  }, 20_000);

  it('moves with packages/core/src and with nothing else in the repository', () => {
    scratch((dir) => {
      init(dir);
      for (const rel of [...CORE, ...ELSEWHERE]) write(dir, rel, `// ${rel}\n`);
      commit(dir);
      const before = derivationId(dir);
      expect(before).toMatch(SHA);
      for (const rel of ELSEWHERE) {
        write(dir, rel, `// ${rel} changed\n`);
        commit(dir);
        expect([rel, derivationId(dir)]).toEqual([rel, before]);
      }
      write(dir, CORE[0], '// changed\n');
      commit(dir);
      expect(derivationId(dir)).not.toBe(before);
    });
  }, 20_000);

  // THE PROPERTY THE CHOICE OF TREE RESTS ON: a commit touching only a file under it, or the
  // script that hashes it, must run both workflows, or one side builds a new value alone.
  it('runs both deploy workflows on a change to any file under packages/core/src, or to the script', () => {
    const files = execFileSync(
      'git',
      ['ls-files', '-z', 'packages/core/src', 'scripts/derivation-id.ts'],
      { cwd: REPO, encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
    expect(files).toContain('scripts/derivation-id.ts');
    expect(files.length).toBeGreaterThan(1);
    const front = workflow('deploy-frontend.yml').on.push;
    const back = workflow('deploy-backend.yml').on.push;
    expect([front.paths, back['paths-ignore']]).toEqual([undefined, undefined]);
    expect(front.branches).toEqual(back.branches);
    const ignore = front['paths-ignore'] ?? [];
    const paths = back.paths ?? [];
    // `matchesGlob` reads a filter as GitHub does only for names, `.`, `-`, `/`, `*` and a
    // whole-segment `**`, over paths with no dot-named segment; anything else is refused.
    const modelled = (p: string) => /^[\w./*-]+$/.test(p) && !/[^/]\*\*|\*\*[^/]/.test(p);
    expect([...ignore, ...paths].filter((p) => !modelled(p))).toEqual([]);
    expect(files.filter((f) => f.split('/').some((s) => s.startsWith('.')))).toEqual([]);
    expect(files.filter((f) => ignore.some((p) => matchesGlob(f, p)))).toEqual([]);
    expect(files.filter((f) => !paths.some((p) => matchesGlob(f, p)))).toEqual([]);
  });

  // RUN, NOT READ: the bundle step itself, under `bash -e` as the runner runs a step with no
  // `shell:`, with npx, pnpm and esbuild printing each call on a line, so every esbuild call is checked.
  it('is defined by the SPA build, every Lambda bundle and the test config from one function', () => {
    const id = derivationId(REPO);
    expect(id).toMatch(SHA);
    const spa = viteConfig.define?.__DERIVATION_ID__;
    expect(spa).toBe(JSON.stringify(id));
    expect(vitestConfig.define?.__DERIVATION_ID__).toBe(spa);

    const step = workflow('deploy-backend.yml').jobs.deploy.steps?.find((s) =>
      s.run?.includes('esbuild'),
    );
    const stubs =
      'call() { printf "%s\\n" "$*"; }; npx() { call npx "$@"; }; pnpm() { call pnpm "$@"; }; ' +
      'esbuild() { call esbuild "$@"; }; mkdir() { :; }; cp() { :; }; ls() { :; }\n';
    const calls = execFileSync(
      BASH,
      ['--noprofile', '--norc', '-e', '-c', stubs + (step?.run ?? '')],
      { cwd: join(REPO, 'infra'), encoding: 'utf8' },
    )
      .split('\n')
      .filter((call) => call.includes('esbuild'));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls)
      expect([call, call.split(' ').filter((a) => a.startsWith('--define:'))]).toEqual([
        call,
        [`--define:__DERIVATION_ID__=${spa}`],
      ]);
  }, 20_000);

  it('is named by the script for its own repository, wherever it is run from', () => {
    const printed = execFileSync(process.execPath, [join(REPO, 'scripts/derivation-id.ts')], {
      cwd: tmpdir(),
      encoding: 'utf8',
    });
    expect(printed).toBe(JSON.stringify(derivationId(REPO)));
  }, 20_000);

  // Node resolves the main module's URL through a link and leaves the link in `process.argv[1]`,
  // so a script that compared the two unresolved would print nothing and exit 0.
  it('is printed by the script when it is run through a link', () => {
    scratch((root) => {
      const real = join(root, 'real');
      init(real);
      write(real, CORE[0], '// a\n');
      commit(real);
      write(real, 'package.json', '{ "type": "module" }\n');
      mkdirSync(join(real, 'scripts'));
      copyFileSync(join(REPO, 'scripts/derivation-id.ts'), join(real, 'scripts/derivation-id.ts'));
      symlinkSync(join(real, 'scripts'), join(root, 'link'), 'junction');
      const printed = execFileSync(process.execPath, [join(root, 'link/derivation-id.ts')], {
        cwd: root,
        encoding: 'utf8',
        env: GIT_ENV,
      });
      expect(printed).toBe(JSON.stringify(derivationId(real)));
    });
  }, 20_000);

  // Imported, the module may see an `argv[1]` that is no file: `node -e` takes it from the args.
  it('prints nothing and throws nothing when it is imported', () => {
    const url = pathToFileURL(join(REPO, 'scripts/derivation-id.ts')).href;
    const printed = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`, 'no-such-file'],
      { cwd: tmpdir(), encoding: 'utf8' },
    );
    expect(printed).toBe('');
  }, 20_000);

  // `rebase --exec` in a linked worktree exports an absolute `GIT_DIR`, which would outrank `repo`.
  it('reads the repository it is given, whatever GIT_DIR names', () => {
    scratch((root) => {
      const [a, b] = [join(root, 'a'), join(root, 'b')];
      for (const dir of [a, b]) {
        init(dir);
        write(dir, CORE[0], `// ${dir}\n`);
        commit(dir);
      }
      const own = git(b, 'rev-parse', 'HEAD:packages/core/src');
      expect(git(a, 'rev-parse', 'HEAD:packages/core/src')).not.toBe(own);
      const before = process.env.GIT_DIR;
      process.env.GIT_DIR = join(a, '.git');
      try {
        expect(derivationId(b)).toBe(own);
      } finally {
        if (before === undefined) delete process.env.GIT_DIR;
        else process.env.GIT_DIR = before;
      }
    });
  }, 20_000);

  it('is defined for a test run', () => {
    expect(__DERIVATION_ID__).toBe(derivationId(REPO));
  });
});
