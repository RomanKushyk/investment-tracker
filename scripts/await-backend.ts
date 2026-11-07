import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { setTimeout as sleepMs } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

// The frontend goes live only after its commit's backend has deployed (*Deployment*): run by
// `deploy-frontend.yml`'s `backend` job, which holds no OIDC token, so it imports `node:` alone.

const HERE = fileURLToPath(import.meta.url);

/** `deploy-backend.yml`'s push `paths`, pattern for pattern; the test holds the two equal. */
export const BACKEND_PATHS = [
  'infra/**',
  'packages/core/**',
  'packages/email/**',
  'scripts/derivation-id.ts',
  'package.json',
  'pnpm-lock.yaml',
  '.github/**',
] as const;

/** Under the `GITHUB_TOKEN`'s 1,000 requests an hour, which every workflow of the repository shares. */
export const POLL_SECONDS = 30;
export const MAX_FAILED_POLLS = 3;

const FIELDS = 'databaseId,headSha,status,conclusion,event,createdAt,url';

/** One row of `gh run list --json` with {@link FIELDS}. */
export interface BackendRun {
  databaseId: number;
  headSha: string;
  status: string;
  conclusion: string;
  event: string;
  createdAt: string;
  url: string;
}

export type Run = (
  cmd: string,
  args: string[],
) => { status: number | null; stdout: string; stderr: string };

export type Verdict =
  | { kind: 'deploy'; run: BackendRun }
  | { kind: 'wait'; runs: BackendRun[] }
  | { kind: 'refuse'; run?: BackendRun };

const newest = (runs: BackendRun[]) =>
  runs.reduce<BackendRun | undefined>(
    (a, r) => (!a || r.createdAt > a.createdAt ? r : a),
    undefined,
  );

/**
 * `range` is every commit whose backend is the one this commit runs against: the newest commit at or
 * before it that touches a backend path, and its descendants up to this commit. They share their
 * backend code, so a run of any of them that succeeded deployed this commit's backend.
 */
export function decide(range: readonly string[], runs: readonly BackendRun[]): Verdict {
  const mine = runs.filter((r) => range.includes(r.headSha));
  const done = newest(mine.filter((r) => r.status === 'completed' && r.conclusion === 'success'));
  if (done) return { kind: 'deploy', run: done };
  const going = mine.filter((r) => r.status !== 'completed');
  if (going.length > 0) return { kind: 'wait', runs: going };
  const last = newest(mine);
  return last ? { kind: 'refuse', run: last } : { kind: 'refuse' };
}

const call = (run: Run, cmd: string, args: string[]) => {
  const r = run(cmd, args);
  if (r.status !== 0)
    throw new Error(`${cmd} ${args.slice(0, 2).join(' ')} failed: ${r.stderr.trim()}`);
  return r.stdout;
};

/** The commits from `sha` back to the newest one touching a backend path, newest first. */
export function backendRange(run: Run, sha: string): string[] {
  const pathspecs = BACKEND_PATHS.map((p) => `:(glob)${p}`);
  const base = call(run, 'git', ['log', '-1', '--format=%H', sha, '--', ...pathspecs]).trim();
  if (!base) return [];
  const after = call(run, 'git', ['rev-list', '--ancestry-path', `${base}..${sha}`]);
  return [...after.split(/\r?\n/).filter(Boolean), base];
}

export async function main(
  run: Run,
  env: Record<string, string | undefined>,
  sleep: (seconds: number) => Promise<void>,
  log: (line: string) => void,
): Promise<number> {
  const sha = env.GITHUB_SHA ?? '';
  const branch = env.GITHUB_REF_NAME ?? '';
  const range = backendRange(run, sha);
  const base = range.at(-1) ?? sha;
  let failed = 0;
  for (;;) {
    let runs: BackendRun[];
    try {
      runs = JSON.parse(
        call(run, 'gh', [
          'run',
          'list',
          '--workflow',
          'deploy-backend.yml',
          '--branch',
          branch,
          '--limit',
          '100',
          '--json',
          FIELDS,
        ]),
      ) as BackendRun[];
      failed = 0;
    } catch (error) {
      // One API blip must not end a wait that can last hours; a run of them is a real failure.
      if (++failed >= MAX_FAILED_POLLS) throw error;
      log(`poll failed (${failed} of ${MAX_FAILED_POLLS}): ${(error as Error).message}`);
      await sleep(POLL_SECONDS);
      continue;
    }
    const verdict = decide(range, runs);
    if (verdict.kind === 'deploy') {
      log(
        `backend run ${verdict.run.databaseId} on ${verdict.run.headSha} succeeded: ${verdict.run.url}`,
      );
      return 0;
    }
    if (verdict.kind === 'refuse') {
      log(
        verdict.run
          ? `::error::backend run ${verdict.run.databaseId} on ${verdict.run.headSha} ended ${verdict.run.conclusion}: ${verdict.run.url}. Repair the backend, then dispatch deploy-frontend.yml on ${branch}.`
          : `::error::no Deploy backend run on ${branch} covers ${base}, the newest backend commit at or before ${sha}. Dispatch deploy-backend.yml on ${branch}, then dispatch deploy-frontend.yml on ${branch}.`,
      );
      return 1;
    }
    log(`waiting for ${verdict.runs.map((r) => `${r.databaseId} (${r.status})`).join(', ')}`);
    await sleep(POLL_SECONDS);
  }
}

const script = process.argv[1];
if (script && existsSync(script) && realpathSync(script) === realpathSync(HERE)) {
  const run: Run = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw r.error;
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  process.exitCode = await main(
    run,
    process.env,
    (s) => sleepMs(s * 1000),
    (line) => process.stdout.write(`${line}\n`),
  );
}
