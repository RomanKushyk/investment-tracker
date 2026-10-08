import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

import { REPO } from '../src/repo-root';
import { issue, main, MARKER, parseAudit, type Run } from './advisories.ts';

// A trimmed `pnpm audit --json` capture of `dev`: one advisory on two brace-expansion lines, nanoid
// and source-map-js, all transitive, which Dependabot opens no pull request for.
const REPORT = readFileSync(join(REPO, 'scripts/__fixtures__/pnpm-audit.json'), 'utf8');
type Raw = { advisories: Record<string, { module_name: string; vulnerable_versions: string }> };
/** The report with only the advisories `keep` accepts, as the audit after an update prints it. */
const without = (keep: (a: Raw['advisories'][string]) => boolean) => {
  const raw = JSON.parse(REPORT) as Raw;
  raw.advisories = Object.fromEntries(Object.entries(raw.advisories).filter(([, a]) => keep(a)));
  return JSON.stringify(raw);
};
// brace-expansion's 5.x line left over, as where its parent's range stopped below the fix.
const AFTER = without(
  (a) => a.module_name === 'brace-expansion' && a.vulnerable_versions.startsWith('>='),
);
const CLEAN = without(() => false);

describe('parseAudit', () => {
  it('reads every advisory of the report', () => {
    expect(
      parseAudit(REPORT).map((a) => [a.module, a.ghsa, a.vulnerable, a.patched, a.severity]),
    ).toEqual([
      ['brace-expansion', 'GHSA-q2hr-2g5m-vwhr', '<1.1.21', '>=1.1.21', 'moderate'],
      ['brace-expansion', 'GHSA-q2hr-2g5m-vwhr', '>=4.0.0 <5.0.12', '>=5.0.12', 'moderate'],
      ['nanoid', 'GHSA-2v37-7h3g-55p8', '<3.3.18', '>=3.3.18', 'high'],
      ['source-map-js', 'GHSA-68fv-2mgg-jv7q', '>=1.0.0 <1.2.2', '>=1.2.2', 'high'],
    ]);
  });

  it('reads a clean report as no advisory', () => {
    expect(parseAudit(CLEAN)).toEqual([]);
  });

  it.each([
    ['text that is not JSON', 'ERR_PNPM_AUDIT_BAD_RESPONSE The audit endpoint responded with 503'],
    // With an advisories object beside it, so the error alone is what refuses it.
    [
      'a registry error',
      JSON.stringify({ error: { code: 'ERR_PNPM_AUDIT_BAD_RESPONSE' }, advisories: {} }),
    ],
    ['a report with no advisories', JSON.stringify({ metadata: {} })],
    ['an advisory with no package', JSON.stringify({ advisories: { 1: { severity: 'high' } } })],
  ])('refuses %s', (_, stdout) => {
    expect(() => parseAudit(stdout)).toThrow();
  });
});

describe('issue', () => {
  const { title, body } = issue(parseAudit(REPORT), parseAudit(AFTER), 'abc1234');

  it('carries the marker a later run finds it by', () => {
    expect(body).toContain(MARKER);
    expect(title).toContain('4');
  });

  it('names every advisory and whether the update clears it', () => {
    const rows = body.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Package'));
    expect(
      rows.map((r) => r.split('|').map((c) => c.trim())[1] + ' ' + r.trim().endsWith('yes |')),
    ).toEqual([
      'brace-expansion true',
      'brace-expansion false',
      'nanoid true',
      'source-map-js true',
    ]);
    expect(rows[1]).toContain('>=4.0.0 <5.0.12');
  });

  it('gives the update this run tried, and how many it clears', () => {
    expect(body).toContain('`pnpm update brace-expansion nanoid source-map-js -r`');
    expect(body).toContain('It clears 3 of them');
  });

  it('gives the command it tried even for a package whose advisory stays', () => {
    const left = without((a) => a.module_name !== 'brace-expansion');
    const partial = issue(parseAudit(REPORT), parseAudit(left), 'abc1234').body;
    expect(partial).toContain('`pnpm update brace-expansion nanoid source-map-js -r`');
    expect(partial).toContain('It clears 2 of them');
  });

  it('says it clears none where it clears none', () => {
    expect(issue(parseAudit(REPORT), parseAudit(REPORT), 'abc1234').body).toContain(
      'It clears none of them',
    );
  });

  it('sends an advisory it leaves to the runbook, and invents no remedy', () => {
    expect(body).toContain('docs/reference/DEPENDABOT.md');
    expect(body).not.toMatch(/newer parent|fixes it/);
  });

  it('counts one advisory in the singular', () => {
    const [first] = parseAudit(REPORT);
    const one = issue([first!], [], 'abc1234');
    expect(one.title).toBe('pnpm audit: 1 advisory in the lockfile');
    expect(one.body).toContain('finds 1 advisory in the lockfile');
  });

  it('shows a dash where the report lists no patched version, never undefined', () => {
    const raw = JSON.parse(REPORT) as { advisories: Record<string, Record<string, unknown>> };
    for (const a of Object.values(raw.advisories)) delete a.patched_versions;
    const unlisted = issue(parseAudit(JSON.stringify(raw)), [], 'abc1234').body;
    expect(unlisted).not.toContain('undefined');
    expect(unlisted).toContain('| — |');
  });

  it('escapes a range carrying a pipe, which would split the row', () => {
    const BS = String.fromCharCode(92);
    const [first] = parseAudit(REPORT);
    const split = { ...first!, vulnerable: '<5.7.2 || >=6.0.0 <6.3.1' };
    const row = issue([split], [], 'abc1234')
      .body.split(String.fromCharCode(10))
      .find((l) => l.includes('<5.7.2'))!;
    // Six cells between the outer pipes once every escaped pipe is set aside.
    expect(row.replaceAll(BS + '|', '').split('|')).toHaveLength(8);
    expect(row).toContain('<5.7.2 ' + BS + '|' + BS + '| >=6.0.0 <6.3.1');
  });

  it('names an advisory the update would bring in, against the command it tried', () => {
    const [first] = parseAudit(REPORT);
    const brought = { ...first!, module: 'picomatch', ghsa: 'GHSA-xxxx-yyyy-zzzz' };
    // Nothing cleared: the paragraph must still have a command to refer to.
    const { body: withNew } = issue(
      parseAudit(REPORT),
      [...parseAudit(REPORT), brought],
      'abc1234',
    );
    expect(withNew).toContain('GHSA-xxxx-yyyy-zzzz');
    expect(withNew).toContain('brings in 1 advisory');
    expect(withNew).toContain('This run tried `pnpm update');
  });
});

/** A stub of the commands the run makes, answering from `answers` by command and first argument. */
function stub(answers: Record<string, ReturnType<Run> | ReturnType<Run>[]>) {
  const calls: { cmd: string; args: string[]; input?: string }[] = [];
  const run: Run = (cmd, args, input) => {
    calls.push({ cmd, args, input });
    const key = `${cmd} ${args[0]}`;
    const answer = answers[key];
    if (answer === undefined) throw new Error(`unexpected ${key}`);
    return Array.isArray(answer) ? answer.shift()! : answer;
  };
  return { run, calls, made: () => calls.map((c) => `${c.cmd} ${c.args[0]} ${c.args[1] ?? ''}`) };
}
const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
// `pnpm audit` exits 1 whenever it finds an advisory, so its status says nothing.
const audit = (stdout: string) => ({ status: 1, stdout, stderr: '' });

describe('main', () => {
  const env = { GITHUB_SHA: 'abc1234def' };

  it('files nothing on a clean audit, and asks nothing else', () => {
    const s = stub({ 'pnpm audit': audit(CLEAN) });
    expect(main(s.run, env)).toBe('clean');
    expect(s.made()).toEqual(['pnpm audit --json']);
  });

  it('files nothing while an issue it opened is still open, whatever its labels', () => {
    const bot = { login: 'app/github-actions' };
    const open = JSON.stringify([
      { number: 12, body: 'unrelated', author: bot },
      // A person quoting the marker, say in a bug report about this lookup, is not its issue.
      { number: 30, body: `See ${MARKER} in the body`, author: { login: 'RomanKushyk' } },
      { number: 40, body: `> ${MARKER} quoted by triage`, author: bot },
    ]);
    const s = stub({ 'pnpm audit': audit(REPORT), 'gh issue': ok(open) });
    expect(main(s.run, env)).toBe('open #40');
    expect(s.made()).toEqual(['pnpm audit --json', 'gh issue list']);
    // gh's list API takes the bot as `github-actions[bot]` and reports it as `app/github-actions`;
    // `--author app/github-actions` matches nothing there, measured on a repository with such issues.
    expect(s.calls[1]!.args).toEqual(expect.arrayContaining(['--author', 'github-actions[bot]']));
    expect(s.calls[1]!.args).not.toContain('--label');
  });

  it('opens one when only a person has quoted the marker', () => {
    const quoted = JSON.stringify([{ number: 30, body: MARKER, author: { login: 'RomanKushyk' } }]);
    const s = stub({
      'pnpm audit': [audit(REPORT), audit(AFTER)],
      'pnpm update': ok(),
      'gh issue': [ok(quoted), ok('https://github.com/o/r/issues/41')],
    });
    expect(main(s.run, env)).toBe('opened https://github.com/o/r/issues/41');
  });

  it('opens one issue, after updating within range and auditing again', () => {
    const s = stub({
      'pnpm audit': [audit(REPORT), audit(AFTER)],
      'pnpm update': ok(),
      'gh issue': [ok('[]'), ok('https://github.com/o/r/issues/41\n')],
    });
    expect(main(s.run, env)).toBe('opened https://github.com/o/r/issues/41');
    expect(s.made()).toEqual([
      'pnpm audit --json',
      'gh issue list',
      'pnpm update brace-expansion',
      'pnpm audit --json',
      'gh issue create',
    ]);
    const update = s.calls[2]!.args;
    expect(update).toEqual([
      'update',
      'brace-expansion',
      'nanoid',
      'source-map-js',
      '-r',
      '--lockfile-only',
      // The range alone: a fix inside pnpm's default day of release age would read as outside it.
      '--config.minimum-release-age=0',
    ]);
    expect(s.calls[1]!.args).toEqual(expect.arrayContaining(['--author', 'github-actions[bot]']));
    const create = s.calls[4]!;
    expect(create.args).toEqual(expect.arrayContaining(['--body-file', '-', '--label', 'bug']));
    expect(create.input).toContain(MARKER);
    expect(create.input).toContain('pnpm update brace-expansion nanoid source-map-js -r');
  });

  it('opens nothing on a dry run, asks GitHub nothing, and returns what it would open', () => {
    // No `gh` answer at all: an open issue cannot hide the preview, and the stub throws on a call.
    const s = stub({ 'pnpm audit': [audit(REPORT), audit(AFTER)], 'pnpm update': ok() });
    expect(main(s.run, { ...env, DRY_RUN: 'true' })).toContain(MARKER);
    expect(s.calls.filter((c) => c.cmd === 'gh')).toEqual([]);
  });

  it('says what pnpm wrote to stderr when the audit prints no report', () => {
    const s = stub({
      'pnpm audit': { status: 1, stdout: '', stderr: 'ERR_PNPM_AUDIT_BAD_RESPONSE 503' },
    });
    expect(() => main(s.run, env)).toThrow(/ERR_PNPM_AUDIT_BAD_RESPONSE 503/);
  });

  it.each([
    ['an audit it cannot read', { 'pnpm audit': audit('ERR_PNPM_AUDIT_BAD_RESPONSE 503') }],
    [
      'a lookup that fails',
      { 'pnpm audit': audit(REPORT), 'gh issue': { status: 1, stdout: '', stderr: 'HTTP 502' } },
    ],
    [
      'an update that fails',
      {
        'pnpm audit': audit(REPORT),
        'gh issue': ok('[]'),
        'pnpm update': { status: 1, stdout: '', stderr: 'ERR_PNPM_FETCH_503' },
      },
    ],
  ])('fails, and files nothing, on %s', (_, answers) => {
    const s = stub(answers);
    expect(() => main(s.run, env)).toThrow();
    expect(s.made()).not.toContain('gh issue create');
  });
});

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Workflow = {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, { permissions?: unknown; steps?: Step[] }>;
};
describe('the advisories workflow', () => {
  const wf = parseDocument(
    readFileSync(join(REPO, '.github/workflows/advisories.yml'), 'utf8'),
  ).toJS() as Workflow;
  const steps = Object.values(wf.jobs).flatMap((j) => j.steps ?? []);

  it('runs on a daily schedule and on dispatch', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    const crons = (wf.on.schedule as { cron: string }[]).map((s) => s.cron);
    expect(crons).toHaveLength(1);
    expect(crons[0]).toMatch(/^\d+ \d+ \* \* \*$/);
  });

  it('may read the code and write issues, and nothing else', () => {
    expect(wf.permissions).toEqual({ contents: 'read', issues: 'write' });
    for (const job of Object.values(wf.jobs)) expect(job.permissions).toBeUndefined();
  });

  it('installs nothing and leaves no token in the checkout', () => {
    expect(steps.filter((s) => /\bpnpm\s+(install|i|add)\b/.test(s.run ?? ''))).toEqual([]);
    expect(steps.some((s) => s.run?.trim() === 'node scripts/advisories.ts')).toBe(true);
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });
});
