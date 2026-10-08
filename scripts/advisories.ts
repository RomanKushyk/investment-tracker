import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Dependabot opens no pull request for a transitive pnpm advisory, and GitHub auto-dismisses the
// development-only ones, so this files what `pnpm audit` finds into the task list (*Dependabot*).
// For CI: run locally, its probe rewrites pnpm-lock.yaml.

/** Invisible in the rendered body, and kept when triage quotes the body under `## Original`. */
export const MARKER = '<!-- pnpm-audit -->';

export interface Advisory {
  module: string;
  ghsa: string;
  severity: string;
  vulnerable: string;
  patched: string;
  url: string;
}

/** One command the run makes; `pnpm audit` exits 1 on any advisory, so the caller reads `status`. */
export type Run = (
  cmd: string,
  args: string[],
  input?: string,
) => { status: number | null; stdout: string; stderr: string };

const key = (a: Advisory) => `${a.module} ${a.ghsa} ${a.vulnerable}`;

/** The advisories of a `pnpm audit --json` report. A registry error is no report, never a clean one. */
export function parseAudit(stdout: string): Advisory[] {
  let report: unknown;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new Error(`pnpm audit printed no JSON report: ${stdout.slice(0, 300)}`);
  }
  const advisories =
    report !== null && typeof report === 'object' && !('error' in report)
      ? (report as { advisories?: unknown }).advisories
      : undefined;
  if (advisories === null || typeof advisories !== 'object') {
    throw new Error(`pnpm audit printed no advisories: ${stdout.slice(0, 300)}`);
  }
  return Object.values(advisories as Record<string, Record<string, unknown>>)
    .map((a) => {
      if (typeof a.module_name !== 'string' || typeof a.github_advisory_id !== 'string') {
        throw new Error(`an advisory names no package or no GHSA: ${JSON.stringify(a)}`);
      }
      return {
        module: a.module_name,
        ghsa: a.github_advisory_id,
        severity: String(a.severity),
        vulnerable: String(a.vulnerable_versions),
        // pnpm infers it from the vulnerable range and leaves it out where it cannot.
        patched: typeof a.patched_versions === 'string' ? a.patched_versions : '',
        url: String(a.url),
      };
    })
    .sort((a, b) => key(a).localeCompare(key(b)));
}

/** The packages the run updates within range: every one the audit names. */
export const modulesOf = (advisories: Advisory[]) =>
  [...new Set(advisories.map((a) => a.module))].sort();

const advisories = (n: number) => `${n} ${n === 1 ? 'advisory' : 'advisories'}`;
/** GFM splits a table row on a bare `|`, inside a code span too. */
const code = (text: string) => (text ? `\`${text.replaceAll('|', '\\|')}\`` : '—');
const table = (rows: string[]) =>
  '| Package | Severity | Advisory | Vulnerable | Patched | Cleared by the update |\n|---|---|---|---|---|---|\n' +
  rows.join('\n');
const row = (a: Advisory, cleared: string) =>
  `| ${a.module} | ${a.severity} | [${a.ghsa}](${a.url}) | ${code(a.vulnerable)} | ${code(a.patched)} | ${cleared} |`;

/** The issue for the advisories `before` the in-range update, marking those gone `after` it. It
 *  states what the run measured; what to do with an advisory it leaves is the runbook's. */
export function issue(before: Advisory[], after: Advisory[], sha: string) {
  const was = new Set(before.map(key));
  const left = new Set(after.map(key));
  const cleared = before.filter((a) => !left.has(key(a))).length;
  const brought = after.filter((a) => !was.has(key(a)));
  const parts = [
    MARKER,
    `\`pnpm audit\` on \`${sha.slice(0, 8)}\` finds ${advisories(before.length)} in the lockfile. Dependabot opens no pull request for a transitive pnpm advisory whose fix its parent's range admits, so this issue is where they enter the task list.`,
    table(before.map((a) => row(a, left.has(key(a)) ? 'no' : 'yes'))),
    `This run tried \`pnpm update ${modulesOf(before).join(' ')} -r\`, inside the parents' ranges and with no override. ${cleared === 0 ? 'It clears none of them.' : `It clears ${cleared} of them, the ones marked yes.`} pnpm takes no version less than a day old while an older one fits the range, as the locked one does, so run locally it takes a fix published within the last day only once that day has passed.`,
  ];
  if (brought.length > 0) {
    parts.push(
      `It also brings in ${advisories(brought.length)} the lockfile does not carry now:\n\n${table(brought.map((a) => row(a, 'brought in')))}`,
    );
  }
  if (cleared < before.length) {
    parts.push(
      'For one marked no, `docs/reference/DEPENDABOT.md` says what to do. Closing this issue alone files it again the next day.',
    );
  }
  return {
    title: `pnpm audit: ${advisories(before.length)} in the lockfile`,
    body: `${parts.join('\n\n')}\n`,
  };
}

function must(result: ReturnType<Run>, what: string) {
  if (result.status !== 0) throw new Error(`${what} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}

/** One run: what it did, or with `DRY_RUN=true` the issue it would open. */
export function main(run: Run, env: Record<string, string | undefined>): string {
  const audit = () => {
    const result = run('pnpm', ['audit', '--json']);
    try {
      return parseAudit(result.stdout);
    } catch (error) {
      throw new Error(`${(error as Error).message}\n${result.stderr}`);
    }
  };
  const before = audit();
  if (before.length === 0) return 'clean';

  // A dry run previews the issue whatever is open, so it asks GitHub nothing.
  const dry = env.DRY_RUN === 'true';
  if (!dry) {
    // `--author` alone keeps gh on the list API (a label switches it to search, which lags a new
    // issue); it takes the bot as `github-actions[bot]` and reports it as `app/github-actions`.
    const open = JSON.parse(
      must(
        run('gh', [
          'issue',
          'list',
          '--state',
          'open',
          '--author',
          'github-actions[bot]',
          '--limit',
          '100',
          '--json',
          'number,body,author',
        ]),
        'gh issue list',
      ),
    ) as { number: number; body: string; author: { login: string } }[];
    const mine = open.find(
      (i) => i.author.login === 'app/github-actions' && i.body.includes(MARKER),
    );
    // Its fix audits afresh; a failed lookup has already failed the run rather than risk a duplicate.
    if (mine) return `open #${mine.number}`;
  }

  // Installs nothing, so no package code runs; release age 0 asks the range alone, since at pnpm's
  // default day a fix published within it would read as outside the range.
  must(
    run('pnpm', [
      'update',
      ...modulesOf(before),
      '-r',
      '--lockfile-only',
      '--config.minimum-release-age=0',
    ]),
    'pnpm update',
  );
  const { title, body } = issue(before, audit(), env.GITHUB_SHA ?? 'HEAD');
  if (dry) return `${title}\n\n${body}`;

  const created = must(
    run(
      'gh',
      [
        'issue',
        'create',
        '--title',
        title,
        '--label',
        'bug',
        '--label',
        'area:infra',
        '--label',
        'dependencies',
        '--body-file',
        '-',
      ],
      body,
    ),
    'gh issue create',
  );
  return `opened ${created.trim()}`;
}

const HERE = fileURLToPath(import.meta.url);
const script = process.argv[1];
if (script && existsSync(script) && realpathSync(script) === realpathSync(HERE)) {
  const run: Run = (cmd, args, input) => {
    const r = spawnSync(cmd, args, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw r.error;
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const outcome = main(run, process.env);
  process.stdout.write(`${outcome}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${outcome}\n`);
}
