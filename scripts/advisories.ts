import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Dependabot opens no pull request for a transitive pnpm advisory its parent's range admits a fix
// for, nor an alert for a SHA-pinned action: this files what both audits find (*Dependabot*).
// For CI: run locally, its probe rewrites pnpm-lock.yaml.

const HERE = fileURLToPath(import.meta.url);

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

/** A third-party `uses:` in the shape `src/actions-pinned.test.ts` holds: a full SHA, its release
 *  in a trailing comment. */
export interface Pin {
  file: string;
  action: string;
  sha: string;
  comment: string;
  /** Filed unaudited: whether the Advisory Database names it by repository or path is unchecked,
   *  and a wrong name answers clean. */
  subpath?: string;
}

const USES = /^\s*(?:-\s+)?uses:\s*([\w.-]+\/[\w.-]+)(\/[\w./-]+)?@([0-9a-f]{40})\s+#\s*(\S+)/;

/** The pins of one file's text. */
export function pinsIn(file: string, text: string): Pin[] {
  return text
    .split('\n')
    .map((line) => USES.exec(line))
    .filter((m) => m !== null)
    .map(([, action, subpath, sha, comment]) => ({
      file,
      action: action!,
      sha: sha!,
      comment: comment!,
      ...(subpath ? { subpath } : {}),
    }));
}

/** Every pin under `.github/`, workflows and composite actions. Read by line: the job installs no
 *  YAML parser, and the test holds this reading to one. */
export function readPins(root: string): Pin[] {
  return readdirSync(join(root, '.github'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yml'))
    .flatMap((entry) => {
      // Ends in its extension so the reader census sees YAML read, not TypeScript; the test's
      // sweep takes `.yaml` too, so a file this skips fails it.
      const path = join(entry.parentPath, `${entry.name.slice(0, -'.yml'.length)}.yml`);
      const file = relative(root, path).replaceAll('\\', '/');
      return pinsIn(file, readFileSync(path, 'utf8'));
    });
}

/** One advisory against one pin. GitHub matched the version against `ranges`; which one it fell
 *  in, the reply does not say. */
export interface PinAdvisory {
  action: string;
  version: string;
  ghsa: string;
  severity: string;
  ranges: { vulnerable: string; patched: string }[];
  url: string;
}

/** A pin whose comment's tag no longer points at its commit, zizmor's `ref-version-mismatch`. */
export interface StalePin {
  action: string;
  sha: string;
  comment: string;
  /** The commit the comment's tag points at now, if the action has that tag at all. */
  points: string | undefined;
  /** The longest release tag on the pinned commit, if any is on it. */
  tagged: string | undefined;
}

export interface PinAudit {
  checked: { action: string; version: string }[];
  advisories: PinAdvisory[];
  stale: StalePin[];
  unaudited: Pin[];
}

/** Each tag's commit, from `git ls-remote --tags`: an annotated tag's peeled `^{}` line names it. */
function parseTags(stdout: string): Map<string, string> {
  const commits = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const m = /^([0-9a-f]{40})\trefs\/tags\/(.+?)(\^\{\})?$/.exec(line.trim());
    if (m && (m[3] || !commits.has(m[2]!))) commits.set(m[2]!, m[1]!);
  }
  return commits;
}

/** The global advisories endpoint's reply, as rows for `action`. Anything else is no reply, never a
 *  clean one. */
function parseActionAdvisories(stdout: string, action: string, version: string): PinAdvisory[] {
  let list: unknown;
  try {
    list = JSON.parse(stdout);
  } catch {
    throw new Error(`the advisories endpoint printed no JSON: ${stdout.slice(0, 300)}`);
  }
  if (!Array.isArray(list)) {
    throw new Error(`the advisories endpoint returned no list: ${stdout.slice(0, 300)}`);
  }
  return (list as Record<string, unknown>[]).map((a) => {
    if (typeof a.ghsa_id !== 'string') {
      throw new Error(`an advisory names no GHSA: ${JSON.stringify(a)}`);
    }
    const ranges = ((a.vulnerabilities ?? []) as Record<string, unknown>[]).filter(
      (v) =>
        String((v.package as { name?: unknown } | undefined)?.name).toLowerCase() ===
        action.toLowerCase(),
    );
    if (ranges.length === 0) throw new Error(`${a.ghsa_id} gives no range for ${action}`);
    return {
      action,
      version,
      ghsa: a.ghsa_id,
      severity: String(a.severity),
      ranges: ranges.map((v) => ({
        vulnerable:
          typeof v.vulnerable_version_range === 'string' ? v.vulnerable_version_range : '',
        patched: typeof v.first_patched_version === 'string' ? v.first_patched_version : '',
      })),
      url: String(a.html_url),
    };
  });
}

/** A release name: the endpoint answers any other, `latest` or `releases/v3`, with no advisory. */
const VERSION = /^v?\d+(\.\d+)*$/;

/** Every pin against the Advisory Database, at the version its commit's tags give. */
function auditPins(run: Run, pins: Pin[]): PinAudit {
  const result: PinAudit = {
    checked: [],
    advisories: [],
    stale: [],
    unaudited: pins.filter((p) => p.subpath),
  };
  const tagsOf = new Map<string, Map<string, string>>();
  const asked = new Set<string>();
  const unique = new Map(
    pins.filter((p) => !p.subpath).map((p) => [`${p.action}@${p.sha} ${p.comment}`, p]),
  );
  for (const id of [...unique.keys()].sort()) {
    const { action, sha, comment } = unique.get(id)!;
    let tags = tagsOf.get(action);
    if (!tags) {
      const url = `https://github.com/${action}`;
      tags = parseTags(must(run('git', ['ls-remote', '--tags', url]), `git ls-remote ${url}`));
      tagsOf.set(action, tags);
    }
    // The longest version on the commit, as zizmor reads it, so a floating `v7` gives `v7.0.1`.
    const tagged = [...tags]
      .filter(([name, commit]) => commit === sha && VERSION.test(name))
      .map(([name]) => name)
      .sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
    // A commit no release tag is on, as a floating major leaves behind, is asked at its comment,
    // which the server's range match takes as a bare major too.
    const version = tagged ?? comment;
    if (tags.get(comment) !== sha) {
      result.stale.push({ action, sha, comment, points: tags.get(comment), tagged });
    }
    const ref = `${action}@${version}`;
    if (asked.has(ref)) continue;
    asked.add(ref);
    result.checked.push({ action, version });
    const reply = must(
      run('gh', [
        'api',
        '-X',
        'GET',
        'advisories',
        '-f',
        'ecosystem=actions',
        '-f',
        `affects=${ref}`,
        '-f',
        'per_page=100',
      ]),
      `gh api advisories ${ref}`,
    );
    result.advisories.push(...parseActionAdvisories(reply, action, version));
  }
  return result;
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
const pinRow = (a: PinAdvisory) =>
  `| ${a.action} | ${code(a.version)} | ${a.severity} | [${a.ghsa}](${a.url}) | ${a.ranges.map((r) => `${code(r.vulnerable)} → ${code(r.patched)}`).join('; ')} |`;
const staleRow = (s: StalePin) =>
  `| ${s.action} | \`${s.sha.slice(0, 8)}\` | ${code(s.comment)} | ${s.points ? `\`${s.points.slice(0, 8)}\`` : 'no such tag'} | ${code(s.tagged ?? '')} |`;

const NO_PINS: PinAudit = { checked: [], advisories: [], stale: [], unaudited: [] };

/** The issue for the advisories `before` the in-range update, marking those gone `after` it, and
 *  for the pins' audit: what the run measured, leaving the remedy to the runbook. */
export function issue(before: Advisory[], after: Advisory[], sha: string, pins = NO_PINS) {
  const was = new Set(before.map(key));
  const left = new Set(after.map(key));
  const cleared = before.filter((a) => !left.has(key(a))).length;
  const brought = after.filter((a) => !was.has(key(a)));
  // An advisory covering two pins of one action is one advisory, in two rows.
  const pinned = new Set(pins.advisories.map((a) => `${a.action} ${a.ghsa}`)).size;
  const findings = pins.advisories.length + pins.stale.length + pins.unaudited.length;
  const parts = [
    MARKER,
    `On \`${sha.slice(0, 8)}\`, \`pnpm audit\` finds ${advisories(before.length)} in the lockfile and the Advisory Database finds ${advisories(pinned)} against the action pins. Dependabot opens no pull request for a transitive pnpm advisory whose fix its parent's range admits, and creates no alert for an action pinned to a SHA, so this issue is where both enter the task list.`,
  ];
  if (before.length > 0) {
    parts.push(
      table(before.map((a) => row(a, left.has(key(a)) ? 'no' : 'yes'))),
      `This run tried \`pnpm update ${modulesOf(before).join(' ')} -r\`, inside the parents' ranges and with no override. ${cleared === 0 ? 'It clears none of them.' : `It clears ${cleared} of them, the ones marked yes.`} pnpm takes no version less than a day old while an older one fits the range, as the locked one does, so run locally it takes a fix published within the last day only once that day has passed.`,
    );
  }
  if (brought.length > 0) {
    parts.push(
      `It also brings in ${advisories(brought.length)} the lockfile does not carry now:\n\n${table(brought.map((a) => row(a, 'brought in')))}`,
    );
  }
  if (pins.advisories.length > 0) {
    parts.push(
      `Against the action pins, at the version the pinned commit's tags give. GitHub matched that version, and the reply lists every range of the advisory; where it lists several, the pinned version lies in one of them:\n\n| Action | Pinned at | Severity | Advisory | Vulnerable → first patched |\n|---|---|---|---|---|\n${pins.advisories.map(pinRow).join('\n')}`,
    );
  }
  if (pins.stale.length > 0) {
    parts.push(
      `${pins.stale.length === 1 ? 'One pin comment no longer names its' : `${pins.stale.length} pin comments no longer name their`} pinned commit. The comment is what a person edits, so a stale one misleads the next re-pin; a commit no release tag is on was asked at its comment's version.\n\n| Action | Pinned commit | Comment | The comment's tag points at | Release tag on the pinned commit |\n|---|---|---|---|---|\n${pins.stale.map(staleRow).join('\n')}`,
    );
  }
  if (pins.unaudited.length > 0) {
    parts.push(
      `A subpath action is not audited: its name in the Advisory Database is unchecked.\n\n| Action | File |\n|---|---|\n${pins.unaudited.map((p) => `| ${p.action}${p.subpath} | ${p.file} |`).join('\n')}`,
    );
  }
  if (cleared < before.length || findings > 0) {
    parts.push(
      'For one marked no, or a pin, `docs/reference/DEPENDABOT.md` says what to do. Closing this issue alone files it again the next day.',
    );
  }
  const stale = pins.stale.length;
  return {
    title: `Advisories: ${before.length} in the lockfile, ${pinned} against the action pins${stale > 0 ? `, ${stale} pin ${stale === 1 ? 'comment' : 'comments'} out of date` : ''}`,
    body: `${parts.join('\n\n')}\n`,
  };
}

function must(result: ReturnType<Run>, what: string) {
  if (result.status !== 0) throw new Error(`${what} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
}

/** One run: what it did, or with `DRY_RUN=true` the issue it would open. */
export function main(
  run: Run,
  env: Record<string, string | undefined>,
  pins = readPins(join(dirname(HERE), '..')),
): string {
  const audit = () => {
    const result = run('pnpm', ['audit', '--json']);
    try {
      return parseAudit(result.stdout);
    } catch (error) {
      throw new Error(`${(error as Error).message}\n${result.stderr}`);
    }
  };
  const before = audit();
  // Audited whatever the lockfile holds: a clean lockfile says nothing about the pins.
  const actions = auditPins(run, pins);
  const pinFindings = actions.advisories.length + actions.stale.length + actions.unaudited.length;
  if (before.length === 0 && pinFindings === 0) {
    return [
      'clean: no advisory in the lockfile or against the action pins',
      ...actions.checked.map((c) => `- ${c.action} ${c.version}`),
    ].join('\n');
  }

  // A dry run previews the issue whatever is open, so it looks up no issue.
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
  let after: Advisory[] = [];
  if (before.length > 0) {
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
    after = audit();
  }
  const { title, body } = issue(before, after, env.GITHUB_SHA ?? 'HEAD', actions);
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

const script = process.argv[1];
if (script && existsSync(script) && realpathSync(script) === realpathSync(HERE)) {
  // An unknown action's repository asks git for credentials: none of git's credential prompts.
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    GCM_INTERACTIVE: 'never',
  };
  const run: Run = (cmd, args, input) => {
    const r = spawnSync(cmd, args, { input, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw r.error;
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const outcome = main(run, process.env);
  process.stdout.write(`${outcome}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${outcome}\n`);
}
