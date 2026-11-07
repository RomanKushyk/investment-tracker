import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

import { REPO } from '../src/repo-root';
import {
  BACKEND_PATHS,
  type BackendRun,
  backendRange,
  decide,
  main,
  MAX_FAILED_POLLS,
  POLL_SECONDS,
  type Run,
} from './await-backend.ts';

// A trimmed `gh run list` capture of dev's backend runs, newest first: ten pushes ending in
// `c2e69b4f`'s failure, and `49a438a9`'s successful push with a failed dispatch on it.
const RUNS = JSON.parse(
  readFileSync(join(REPO, 'scripts/__fixtures__/backend-runs-dev.json'), 'utf8'),
) as BackendRun[];
const sha = (prefix: string) => {
  const run = RUNS.find((r) => r.headSha.startsWith(prefix));
  if (!run) throw new Error(`no run on ${prefix} in the fixture`);
  return run.headSha;
};
const S5624 = sha('5624bb7d');
const C2E = sha('c2e69b4f');
const S49A = sha('49a438a9');
// `dev`'s src-only commit on top of 5624bb7d: no backend run was started for it.
const SRC_ONLY = '4c995c786beb85cf0da0401caa35b9859a93147b';
const NOT_RUN = 'f'.repeat(40);

const inFlight = (headSha: string, status = 'in_progress'): BackendRun => ({
  databaseId: 1,
  headSha,
  status,
  conclusion: '',
  event: 'push',
  createdAt: '2026-11-07T20:00:00Z',
  url: 'https://github.com/RomanKushyk/investment-tracker/actions/runs/1',
});
const ended = (run: BackendRun, conclusion: string): BackendRun => ({
  ...run,
  status: 'completed',
  conclusion,
});

describe('decide', () => {
  it('deploys once the backend run of its SHA has succeeded', () => {
    expect(decide([S5624], RUNS)).toMatchObject({ kind: 'deploy', run: { headSha: S5624 } });
  });

  it.each(['queued', 'in_progress', 'waiting', 'pending', 'requested'])(
    'waits while the backend run of its SHA is %s',
    (status) => {
      expect(decide([NOT_RUN], [inFlight(NOT_RUN, status), ...RUNS]).kind).toBe('wait');
    },
  );

  it.each(['failure', 'cancelled', 'timed_out'])(
    'refuses when the backend run of its SHA ended %s, naming that run',
    (conclusion) => {
      const run = ended(inFlight(NOT_RUN), conclusion);
      expect(decide([NOT_RUN], [run, ...RUNS])).toEqual({ kind: 'refuse', run });
    },
  );

  it('refuses on the recorded failure, naming its run', () => {
    expect(decide([C2E], RUNS)).toMatchObject({
      kind: 'refuse',
      run: { databaseId: 41650209744, conclusion: 'failure' },
    });
  });

  // The pair on 49a438a9 is real: a later failed dispatch rolled back to what the push deployed.
  it('deploys when any run of the range succeeded, a later failure on it included', () => {
    expect(decide([S49A], RUNS)).toMatchObject({
      kind: 'deploy',
      run: { headSha: S49A, event: 'push' },
    });
  });

  it('deploys a push the backend filter skipped without waiting, off its backend commit', () => {
    expect(decide([SRC_ONLY, S5624], RUNS)).toMatchObject({
      kind: 'deploy',
      run: { headSha: S5624 },
    });
  });

  it('deploys off a descendant of the backend commit whose run succeeded', () => {
    const repaired = { ...ended(inFlight(NOT_RUN), 'success'), event: 'workflow_dispatch' };
    expect(decide([NOT_RUN, SRC_ONLY, C2E], [repaired, ...RUNS])).toEqual({
      kind: 'deploy',
      run: repaired,
    });
  });

  it('refuses a stale backend: no run of the range succeeded and none is going', () => {
    expect(decide([SRC_ONLY, C2E], RUNS)).toMatchObject({
      kind: 'refuse',
      run: { databaseId: 41650209744 },
    });
  });

  it('refuses a backend commit no run ever started for, naming no run', () => {
    expect(decide([SRC_ONLY, NOT_RUN], RUNS)).toEqual({ kind: 'refuse' });
  });

  it('waits on a run still going in the range rather than calling it stale', () => {
    expect(decide([SRC_ONLY, C2E], [inFlight(SRC_ONLY), ...RUNS]).kind).toBe('wait');
  });
});

/** A fake `git` and `gh`, answering by the command's first two words and recording every call;
 *  `null` in a queue answers that call with a failure, as a 502 from the API does. */
const fake = (answers: Record<string, (string | null)[]>) => {
  const calls: string[][] = [];
  const run: Run = (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = `${cmd} ${args[0]}`;
    const queue = answers[key];
    const answer = !queue?.length ? null : queue.length > 1 ? queue.shift()! : queue[0];
    return answer === null
      ? { status: 1, stdout: '', stderr: `HTTP 502 on ${key}` }
      : { status: 0, stdout: answer, stderr: '' };
  };
  return { run, calls };
};

const backendWorkflow = parseDocument(
  readFileSync(join(REPO, '.github/workflows/deploy-backend.yml'), 'utf8'),
).toJS() as {
  on: { push: { paths: string[] } };
  jobs: Record<string, { 'timeout-minutes'?: number }>;
};

describe('backendRange', () => {
  // The two must match pattern for pattern: a path the backend deploys on and this misses would
  // read a stale backend as current.
  it('reads the backend filter as written in deploy-backend.yml', () => {
    expect([...BACKEND_PATHS]).toEqual(backendWorkflow.on.push.paths);
  });

  it('asks git for the newest backend-path commit with glob pathspecs', () => {
    const { run, calls } = fake({ 'git log': [`${S5624}\n`], 'git rev-list': [`${SRC_ONLY}\n`] });
    expect(backendRange(run, SRC_ONLY)).toEqual([SRC_ONLY, S5624]);
    const log = calls.find((c) => c[1] === 'log') ?? [];
    expect(log.slice(log.indexOf('--') + 1)).toEqual(BACKEND_PATHS.map((p) => `:(glob)${p}`));
    expect(log).toContain(SRC_ONLY);
    expect(calls.find((c) => c[1] === 'rev-list')).toEqual([
      'git',
      'rev-list',
      '--ancestry-path',
      `${S5624}..${SRC_ONLY}`,
    ]);
  });

  it('is the commit alone when it touches a backend path itself', () => {
    const { run } = fake({ 'git log': [`${S5624}\n`], 'git rev-list': [''] });
    expect(backendRange(run, S5624)).toEqual([S5624]);
  });

  it('throws when git fails, rather than reading no range', () => {
    const { run } = fake({});
    expect(() => backendRange(run, S5624)).toThrow(/git log/);
  });
});

describe('main', () => {
  const env = {
    GITHUB_SHA: SRC_ONLY,
    GITHUB_REF_NAME: 'dev',
    GH_TOKEN: 'token-sentinel',
  };
  const gitAnswers = { 'git log': [`${S5624}\n`], 'git rev-list': [`${SRC_ONLY}\n`] };
  const runOf = (runs: BackendRun[]) => JSON.stringify(runs);

  it("reads the backend's runs on its own branch alone, by the fields it decides on", async () => {
    const { run, calls } = fake({ ...gitAnswers, 'gh run': [runOf(RUNS)] });
    const out: string[] = [];
    expect(
      await main(
        run,
        env,
        async () => {},
        (l) => out.push(l),
      ),
    ).toBe(0);
    const gh = calls.find((c) => c[0] === 'gh') ?? [];
    expect(gh.slice(0, 2)).toEqual(['gh', 'run']);
    expect(gh[gh.indexOf('--workflow') + 1]).toBe('deploy-backend.yml');
    expect(gh[gh.indexOf('--branch') + 1]).toBe('dev');
    expect(gh[gh.indexOf('--json') + 1].split(',').sort()).toEqual(
      ['conclusion', 'createdAt', 'databaseId', 'event', 'headSha', 'status', 'url'].sort(),
    );
    expect(out.join('\n')).toContain('42380675787');
  });

  it('polls every interval until the run concludes, then deploys', async () => {
    const going = inFlight(SRC_ONLY);
    const { run, calls } = fake({
      ...gitAnswers,
      'gh run': [runOf([going]), runOf([going]), runOf([ended(going, 'success')])],
    });
    const slept: number[] = [];
    expect(
      await main(
        run,
        env,
        async (s) => void slept.push(s),
        () => {},
      ),
    ).toBe(0);
    expect(slept).toEqual([POLL_SECONDS, POLL_SECONDS]);
    expect(calls.filter((c) => c[0] === 'gh')).toHaveLength(3);
  });

  it('fails before the deploy, naming the backend run by its URL, and prints no token', async () => {
    const failed = ended(inFlight(SRC_ONLY), 'failure');
    const { run } = fake({ ...gitAnswers, 'gh run': [runOf([failed])] });
    const out: string[] = [];
    expect(
      await main(
        run,
        env,
        async () => {},
        (l) => out.push(l),
      ),
    ).toBe(1);
    const text = out.join('\n');
    expect(text).toMatch(/^::error::/m);
    expect(text).toContain(failed.url);
    expect(text).not.toContain('token-sentinel');
    // A re-run keeps this commit's range, which a backend fix pushed later is outside; a dispatch
    // runs on the head and rebuilds the one-day artifact.
    expect(text).toContain('dispatch deploy-frontend.yml on dev');
    expect(text).not.toMatch(/re-run this run/i);
  });

  it('fails naming the backend commit when no run covers it', async () => {
    const { run } = fake({ ...gitAnswers, 'gh run': [runOf([])] });
    const out: string[] = [];
    expect(
      await main(
        run,
        env,
        async () => {},
        (l) => out.push(l),
      ),
    ).toBe(1);
    expect(out.join('\n')).toMatch(new RegExp(`^::error::.*${S5624}`, 'm'));
    expect(out.join('\n')).toContain('dispatch deploy-frontend.yml on dev');
    expect(out.join('\n')).not.toMatch(/re-run this run/i);
  });

  // Spaced by the interval, and counted per streak: a good poll between two blips resets it.
  it('rides out failed polls while it waits, one interval apart', async () => {
    const going = inFlight(SRC_ONLY);
    const blips = Array<null>(MAX_FAILED_POLLS - 1).fill(null);
    const { run } = fake({
      ...gitAnswers,
      'gh run': [...blips, runOf([going]), ...blips, runOf([ended(going, 'success')])],
    });
    const slept: number[] = [];
    expect(
      await main(
        run,
        env,
        async (s) => void slept.push(s),
        () => {},
      ),
    ).toBe(0);
    expect(slept).toEqual(Array<number>(2 * blips.length + 1).fill(POLL_SECONDS));
  });

  it('throws when gh keeps failing, rather than reading no runs as a stale backend', async () => {
    const { run, calls } = fake(gitAnswers);
    await expect(
      main(
        run,
        env,
        async () => {},
        () => {},
      ),
    ).rejects.toThrow(/gh run list/);
    expect(MAX_FAILED_POLLS).toBe(3);
    expect(calls.filter((c) => c[0] === 'gh')).toHaveLength(MAX_FAILED_POLLS);
  });
});

// THE WAIT JOB'S CENSUS. It runs before the job that holds the OIDC token and needs none itself:
// reading runs takes `actions: read`, the history `contents: read`, and nothing else.
type Step = { uses?: string; run?: string; with?: Record<string, unknown>; env?: unknown };
type Job = {
  needs?: string | string[];
  permissions?: Record<string, string>;
  environment?: unknown;
  concurrency?: unknown;
  'timeout-minutes'?: number;
  steps: Step[];
};
const frontendText = readFileSync(join(REPO, '.github/workflows/deploy-frontend.yml'), 'utf8');
const frontend = parseDocument(frontendText).toJS() as {
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
};
const waits = () => frontend.jobs.backend;

describe('the frontend waits for its backend', () => {
  it('runs between build and deploy', () => {
    expect(waits().needs).toBe('build');
    expect([frontend.jobs.deploy.needs].flat().sort()).toEqual(['backend', 'build']);
  });

  it('holds actions: read and contents: read alone, no environment and no secret', () => {
    expect(waits().permissions).toEqual({ actions: 'read', contents: 'read' });
    expect(waits().environment).toBeUndefined();
    const text = JSON.stringify(waits());
    expect(text.match(/\b(secrets|vars)\.[\w.]+/g) ?? []).toEqual([]);
    expect(text.match(/\$\{\{\s*github\.token\s*\}\}/g)).toHaveLength(1);
  });

  it('runs no dependency code: checkout, node and the script, which imports only node:', () => {
    const steps = waits().steps;
    expect(steps.map((s) => s.uses?.split('@')[0] ?? s.run)).toEqual([
      'actions/checkout',
      'actions/setup-node',
      'node scripts/await-backend.ts',
    ]);
    // The whole history, for `git log` over the backend paths; no token left in .git/config.
    expect(steps[0].with).toEqual({ 'fetch-depth': 0, 'persist-credentials': false });
    // Through the parser: a static import, a dynamic `import()` and a `require` alike.
    const source = ts.createSourceFile(
      'await-backend.ts',
      readFileSync(join(REPO, 'scripts/await-backend.ts'), 'utf8'),
      ts.ScriptTarget.Latest,
    );
    const imports: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push(node.moduleSpecifier.text);
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        const [arg] = node.arguments;
        imports.push(arg && ts.isStringLiteral(arg) ? arg.text : '<computed>');
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((m) => !m.startsWith('node:'))).toEqual([]);
  });

  // Pending time counts against no job's timeout, so a queued backend run can outlast their sum:
  // the wait takes the hosted runner's ceiling, which the sum must stay under.
  it("outlasts the backend run's jobs, at the hosted runner's ceiling", () => {
    const budgets = Object.values(backendWorkflow.jobs).map((j) => j['timeout-minutes']);
    expect(budgets.every((m) => typeof m === 'number')).toBe(true);
    const sum = budgets.reduce<number>((a, m) => a + (m ?? 0), 0);
    expect(waits()['timeout-minutes']).toBe(360);
    expect(sum).toBeLessThan(360);
  });

  it('is cancelled by a newer push on its branch, as the rest of the run is', () => {
    expect(waits().concurrency).toBeUndefined();
    expect(frontend.concurrency['cancel-in-progress']).toBe(true);
    expect(frontend.concurrency.group).toContain('${{ github.ref_name }}');
  });
});
