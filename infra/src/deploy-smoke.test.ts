import { execFile, execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { REPO } from '../../src/repo-root';

// The deploy's "Smoke-test the bundle" holds each route's behaviour in `node -e` snippets, and only
// the post-merge deploy ran them. RUN, NOT READ: both build steps under `bash -e`, as the runner runs
// a step with no `shell:`, so the suite runs the snippets the deploy runs, on the bundles it ships.

type Step = { name?: string; run?: string };
type Workflow = { jobs: Record<string, { steps?: Step[] }> };
const built = (
  parseDocument(
    readFileSync(join(REPO, '.github/workflows/deploy-backend.yml'), 'utf8'),
  ).toJS() as Workflow
).jobs.build.steps;
const stepRun = (name: string) => {
  const run = built?.find((s) => s.name === name)?.run;
  if (run === undefined) throw new Error(`deploy-backend.yml has no build step "${name}"`);
  return run;
};

/** Every handler a template declares, by its bundle's name. */
const handlers = ['template.yaml', 'template-user.yaml'].flatMap((file) =>
  Object.values(
    (
      parseDocument(readFileSync(join(REPO, 'infra', file), 'utf8')).toJS() as {
        Resources: Record<string, { Properties?: { Handler?: string } }>;
      }
    ).Resources,
  )
    .map((r) => r.Properties?.Handler)
    .filter((h): h is string => h !== undefined)
    .map((h) => h.replace(/\.handler$/, '')),
);

// From PowerShell, `bash` on win32 is WSL's launcher; Git's own MSYS bash is the one to run.
const BASH =
  process.platform === 'win32'
    ? join(
        execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(),
        '../../../usr/bin/bash.exe',
      )
    : 'bash';

/** The argv of each call a step makes to `command`, in order: the step runs with `command`
 *  recording and each of `inert` doing nothing. */
const calls = (run: string, command: string, inert: string[], cwd: string) => {
  const rec = mkdtempSync(join(tmpdir(), 'deploy-smoke-calls-'));
  try {
    const stubs =
      'n=0; ' +
      `${command}() { n=$((n+1)); printf '%s\\0' "$@" > "$REC/$n.argv"; ` +
      `printf '%s' "\${LAMBDA_TASK_ROOT+set}" > "$REC/$n.root"; }; ` +
      inert.map((c) => `${c}() { :; }; `).join('') +
      '\n';
    const env: Record<string, string | undefined> = {
      ...process.env,
      REC: rec.replaceAll('\\', '/'),
    };
    delete env.LAMBDA_TASK_ROOT;
    // A FILE, as the runner hands it (`bash -e {0}`): on win32 a `\"` in an argument is re-quoted
    // on its way through the command line, and the snippets are full of them.
    const script = join(rec, 'step.sh');
    writeFileSync(script, stubs + run);
    execFileSync(BASH, ['--noprofile', '--norc', '-e', script.replaceAll('\\', '/')], {
      cwd,
      env,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    const count = readdirSync(rec).filter((f) => f.endsWith('.argv')).length;
    return Array.from({ length: count }, (_, i) => ({
      argv: readFileSync(join(rec, `${i + 1}.argv`), 'utf8')
        .split('\0')
        .slice(0, -1),
      // The migrate snippet finds its SQL by LAMBDA_TASK_ROOT, which the step sets on that call.
      root: readFileSync(join(rec, `${i + 1}.root`), 'utf8') === 'set',
    }));
  } finally {
    rmSync(rec, { recursive: true, force: true });
  }
};

const snippets = calls(stepRun('Smoke-test the bundle'), 'node', ['mkdir', 'cp', 'cd'], REPO).map(
  (call) => ({
    ...call,
    handlers: [...(call.argv[1] ?? '').matchAll(/require\('\.\/([\w-]+)\.js'\)/g)].map((m) => m[1]),
  }),
);

describe('the deploy’s smoke snippets', () => {
  // The suite keeps no list of its own, so a snippet the suite cannot run is one it does not run.
  it('are each a `node -e` script that loads a handler, and every handler is loaded', () => {
    for (const { argv } of snippets)
      expect([argv.length, argv[0]], argv.join(' ').slice(0, 200)).toEqual([2, '-e']);
    expect(snippets.filter((s) => s.handlers.length === 0)).toEqual([]);
    const loaded = new Set(snippets.flatMap((s) => s.handlers));
    expect(handlers.filter((h) => !loaded.has(h))).toEqual([]);
  });

  let bundles = '';
  // THE WORKFLOW'S OWN ESBUILD CALLS, each replayed with its output moved out of the tree: the
  // pnpm shim runs `esbuild/bin/esbuild`, which hands the arguments to the binary unchanged.
  beforeAll(async () => {
    const infra = join(REPO, 'infra');
    const builds = calls(stepRun('Bundle the handlers'), 'pnpm', ['mkdir', 'cp', 'ls'], infra);
    expect(builds.length).toBe(handlers.length);
    bundles = mkdtempSync(join(tmpdir(), 'deploy-smoke-bundle-'));
    const esbuild = join(infra, 'node_modules/esbuild/bin/esbuild');
    await Promise.all(
      builds.map(({ argv }) => {
        const [exec, tool, ...args] = argv;
        expect([exec, tool, args.filter((a) => a.startsWith('--outfile=dist/')).length]).toEqual([
          'exec',
          'esbuild',
          1,
        ]);
        const moved = args.map((a) => a.replace(/^--outfile=dist\//, `--outfile=${bundles}/`));
        // A JS shim on win32 always; elsewhere an allowed postinstall swaps in the native binary.
        return process.platform === 'win32'
          ? promisify(execFile)(process.execPath, [esbuild, ...moved], { cwd: infra })
          : promisify(execFile)(esbuild, moved, { cwd: infra });
      }),
    );
    // The SQL is data the step copies beside the bundles.
    mkdirSync(join(bundles, 'migrations'));
    for (const sql of readdirSync(join(infra, 'migrations')).filter((f) => f.endsWith('.sql')))
      copyFileSync(join(infra, 'migrations', sql), join(bundles, 'migrations', sql));
  }, 180_000);

  afterAll(() => {
    if (bundles) rmSync(bundles, { recursive: true, force: true });
  });

  it.each(snippets.map((s) => [s.handlers.join(' + ') || 'no', s] as const))(
    'pass on the %s bundle',
    async (_, { argv, root }) => {
      // The platform's variables alone: the runner sets none the handlers read, and a developer's
      // exported AWS_REGION or USER_POOL_ID would otherwise reach the bundle.
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([k]) =>
          ['PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'HOME'].includes(k.toUpperCase()),
        ),
      );
      if (root) env.LAMBDA_TASK_ROOT = bundles;
      const run = promisify(execFile)(process.execPath, argv, { cwd: bundles, env });
      await expect(run.then(({ stdout }) => stdout)).resolves.toMatch(/\S/);
    },
    60_000,
  );
});
