import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isScalar, parseDocument, visit } from 'yaml';

import { REPO } from '../src/repo-root';
import {
  issue,
  main,
  MARKER,
  parseAudit,
  type Pin,
  pinsIn,
  readPins,
  type Run,
} from './advisories.ts';

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

  it('counts one advisory in the singular, and names both sources', () => {
    const [first] = parseAudit(REPORT);
    const one = issue([first!], [], 'abc1234');
    expect(one.title).toBe('Advisories: 1 in the lockfile, 0 against the action pins');
    expect(one.body).toContain('finds 1 advisory in the lockfile');
    expect(one.body).toContain('0 advisories against the action pins');
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
  // The lockfile's half alone: these cases carry no pin.
  const NONE: Pin[] = [];

  it('files nothing while an issue it opened is still open, whatever its labels', () => {
    const bot = { login: 'app/github-actions' };
    const open = JSON.stringify([
      { number: 12, body: 'unrelated', author: bot },
      // A person quoting the marker, say in a bug report about this lookup, is not its issue.
      { number: 30, body: `See ${MARKER} in the body`, author: { login: 'RomanKushyk' } },
      { number: 40, body: `> ${MARKER} quoted by triage`, author: bot },
    ]);
    const s = stub({ 'pnpm audit': audit(REPORT), 'gh issue': ok(open) });
    expect(main(s.run, env, NONE)).toBe('open #40');
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
    expect(main(s.run, env, NONE)).toBe('opened https://github.com/o/r/issues/41');
  });

  it('opens one issue, after updating within range and auditing again', () => {
    const s = stub({
      'pnpm audit': [audit(REPORT), audit(AFTER)],
      'pnpm update': ok(),
      'gh issue': [ok('[]'), ok('https://github.com/o/r/issues/41\n')],
    });
    expect(main(s.run, env, NONE)).toBe('opened https://github.com/o/r/issues/41');
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

  it('opens nothing on a dry run, looks up no issue, and returns what it would open', () => {
    // No `gh issue` answer at all: an open issue cannot hide the preview, and the stub throws on a call.
    const s = stub({
      'pnpm audit': [audit(REPORT), audit(AFTER)],
      'pnpm update': ok(),
      'git ls-remote': ok(RELEASED),
      'gh api': ok('[]'),
    });
    expect(main(s.run, { ...env, DRY_RUN: 'true' }, [pin('actions/checkout', 'v7.0.1')])).toContain(
      MARKER,
    );
    expect(s.calls.filter((c) => c.cmd === 'gh' && c.args[0] === 'issue')).toEqual([]);
  });

  it('says what pnpm wrote to stderr when the audit prints no report', () => {
    const s = stub({
      'pnpm audit': { status: 1, stdout: '', stderr: 'ERR_PNPM_AUDIT_BAD_RESPONSE 503' },
    });
    expect(() => main(s.run, env, NONE)).toThrow(/ERR_PNPM_AUDIT_BAD_RESPONSE 503/);
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
    expect(() => main(s.run, env, NONE)).toThrow();
    expect(s.made()).not.toContain('gh issue create');
  });
});

// A trimmed capture of the global advisories endpoint for `tj-actions/changed-files@v40`.
const ACTION_ADVISORIES = readFileSync(
  join(REPO, 'scripts/__fixtures__/actions-advisories.json'),
  'utf8',
);
const PINNED = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const ELSEWHERE = '1111111111111111111111111111111111111111';
const pin = (action: string, comment: string): Pin => ({
  file: '.github/workflows/x.yml',
  action,
  sha: PINNED,
  comment,
});
/** `git ls-remote --tags` lines: a lightweight tag names its commit, an annotated one its tag object
 *  and then, peeled with `^{}`, its commit. */
const tags = (...lines: [string, string][]) =>
  lines.map(([sha, ref]) => `${sha}\trefs/tags/${ref}\n`).join('');
// As actions/checkout has it: the release and its floating major on the pinned commit.
const RELEASED = tags([ELSEWHERE, 'v6'], [PINNED, 'v7'], [PINNED, 'v7.0.1']);

describe('main, on the action pins', () => {
  const env = { GITHUB_SHA: 'abc1234def' };
  const affects = (s: ReturnType<typeof stub>) =>
    s.calls
      .filter((c) => c.cmd === 'gh' && c.args[0] === 'api')
      .map((c) => c.args.find((a) => a.startsWith('affects=')));

  it('audits every pin when the lockfile is clean, and names each in the outcome', () => {
    const s = stub({
      'pnpm audit': audit(CLEAN),
      'git ls-remote': ok(RELEASED),
      'gh api': ok('[]'),
    });
    const outcome = main(s.run, env, [pin('actions/checkout', 'v7.0.1')]);
    expect(outcome).toMatch(/^clean/);
    expect(outcome).toContain('actions/checkout v7.0.1');
    expect(s.made()).toEqual(['pnpm audit --json', 'git ls-remote --tags', 'gh api -X']);
    expect(s.calls[1]!.args).toContain('https://github.com/actions/checkout');
  });

  it('files a pin an advisory covers, with its range and first patched version', () => {
    const TJ = tags([PINNED, 'v40'], [PINNED, 'v40.0.0']);
    const s = stub({
      'pnpm audit': audit(CLEAN),
      'git ls-remote': ok(TJ),
      'gh api': ok(ACTION_ADVISORIES),
      'gh issue': [ok('[]'), ok('https://github.com/o/r/issues/41\n')],
    });
    expect(main(s.run, env, [pin('tj-actions/changed-files', 'v40.0.0')])).toBe(
      'opened https://github.com/o/r/issues/41',
    );
    // A clean lockfile has nothing to update.
    expect(s.calls.filter((c) => c.args[0] === 'update')).toEqual([]);
    const body = s.calls.find((c) => c.args[1] === 'create')!.input!;
    expect(body).toContain(MARKER);
    const row = body.split('\n').find((l) => l.includes('GHSA-mrrh-fwg8-r2c3'))!;
    expect(row).toContain('tj-actions/changed-files');
    expect(row).toContain('`v40.0.0`');
    expect(row).toContain('`<= 45.0.7`');
    expect(row).toContain('`46.0.1`');
    expect(body).toContain('GHSA-mcph-m25j-8j63');
  });

  it('asks at the longest tag on the pinned commit, not at the comment', () => {
    const s = stub({
      'pnpm audit': audit(CLEAN),
      'git ls-remote': ok(RELEASED),
      'gh api': ok('[]'),
    });
    // `v7` points at the pin too, so the comment is true and nothing is filed.
    expect(main(s.run, env, [pin('actions/checkout', 'v7')])).toMatch(/^clean/);
    expect(affects(s)).toEqual(['affects=actions/checkout@v7.0.1']);
  });

  it('takes only a version for the tag, since the endpoint answers any other name with nothing', () => {
    const s = stub({
      'pnpm audit': audit(CLEAN),
      'git ls-remote': ok(
        tags([PINNED, 'v7'], [PINNED, 'v7.0.1'], [PINNED, 'latest'], [PINNED, 'releases/v7']),
      ),
      'gh api': ok('[]'),
    });
    main(s.run, env, [pin('actions/checkout', 'v7.0.1')]);
    expect(affects(s)).toEqual(['affects=actions/checkout@v7.0.1']);
  });

  it('asks once for pins of one commit whose comments differ, and lists it once', () => {
    const s = stub({
      'pnpm audit': audit(CLEAN),
      'git ls-remote': ok(RELEASED),
      'gh api': ok('[]'),
    });
    const outcome = main(s.run, env, [
      pin('actions/checkout', 'v7'),
      pin('actions/checkout', 'v7.0.1'),
    ]);
    expect(affects(s)).toEqual(['affects=actions/checkout@v7.0.1']);
    expect(outcome.split('\n').filter((l) => l.includes('actions/checkout'))).toHaveLength(1);
  });

  it('counts an advisory with two ranges for the action once, each range beside its own fix', () => {
    const [first] = JSON.parse(ACTION_ADVISORIES) as {
      vulnerabilities: Record<string, unknown>[];
    }[];
    const [range] = first!.vulnerabilities;
    const twoRanges = {
      ...first,
      vulnerabilities: [
        { ...range, vulnerable_version_range: '< 2.5.0', first_patched_version: null },
        { ...range, vulnerable_version_range: '>= 3.0.0, < 3.1.0', first_patched_version: '3.1.0' },
      ],
    };
    const s = stub({
      'pnpm audit': audit(CLEAN),
      'git ls-remote': ok(tags([PINNED, 'v40.0.0'])),
      'gh api': ok(JSON.stringify([twoRanges])),
      'gh issue': [ok('[]'), ok('https://github.com/o/r/issues/41')],
    });
    main(s.run, env, [pin('tj-actions/changed-files', 'v40.0.0')]);
    const create = s.calls.find((c) => c.args[1] === 'create')!;
    expect(create.args[create.args.indexOf('--title') + 1]).toContain('1 against the action pins');
    expect(create.input).toContain('finds 1 advisory against the action pins');
    const rows = create.input!.split('\n').filter((l) => l.includes('GHSA-mrrh-fwg8-r2c3'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('`< 2.5.0` → —; `>= 3.0.0, < 3.1.0` → `3.1.0` |');
    expect(create.input).toContain('the pinned version lies in one of them');
  });

  it('counts an advisory covering two pins of one action once', () => {
    const s = stub({
      'pnpm audit': audit(CLEAN),
      'git ls-remote': ok(tags([PINNED, 'v40.0.0'], [ELSEWHERE, 'v41.0.0'])),
      'gh api': [ok(ACTION_ADVISORIES), ok(ACTION_ADVISORIES)],
      'gh issue': [ok('[]'), ok('https://github.com/o/r/issues/41')],
    });
    main(s.run, env, [
      pin('tj-actions/changed-files', 'v40.0.0'),
      { ...pin('tj-actions/changed-files', 'v41.0.0'), sha: ELSEWHERE },
    ]);
    const create = s.calls.find((c) => c.args[1] === 'create')!;
    // Two advisories in the fixture, each covering both pins.
    expect(create.args[create.args.indexOf('--title') + 1]).toContain('2 against the action pins');
  });

  it('reads an annotated tag by the commit it peels to', () => {
    const s = stub({
      'pnpm audit': audit(CLEAN),
      'git ls-remote': ok(tags([ELSEWHERE, 'v6'], [PINNED, 'v6^{}'], [PINNED, 'v6.3.0'])),
      'gh api': ok('[]'),
    });
    expect(main(s.run, env, [pin('aws-actions/configure-aws-credentials', 'v6')])).toMatch(
      /^clean/,
    );
    expect(affects(s)).toEqual(['affects=aws-actions/configure-aws-credentials@v6.3.0']);
  });

  it.each([
    ['names a tag on another commit', 'v6', 'v7.0.1'],
    ['names a tag the action does not have', 'v7.0.0', 'v7.0.1'],
  ])('files a pin whose comment %s', (_, comment, asked) => {
    const s = stub({
      'pnpm audit': audit(CLEAN),
      'git ls-remote': ok(RELEASED),
      'gh api': ok('[]'),
      'gh issue': [ok('[]'), ok('https://github.com/o/r/issues/41')],
    });
    main(s.run, env, [pin('actions/checkout', comment)]);
    expect(affects(s)).toEqual([`affects=actions/checkout@${asked}`]);
    const body = s.calls.find((c) => c.args[1] === 'create')!.input!;
    const row = body.split('\n').find((l) => l.startsWith('| actions/checkout'))!;
    expect(row).toContain(`\`${comment}\``);
    expect(row).toContain('`v7.0.1`');
  });

  it('files a pin whose commit no release tag points at, asking at its comment', () => {
    // A floating major that moved on: setup-sam publishes `v3` alone.
    const s = stub({
      'pnpm audit': audit(CLEAN),
      'git ls-remote': ok(tags([ELSEWHERE, 'v3'])),
      'gh api': ok('[]'),
      'gh issue': [ok('[]'), ok('https://github.com/o/r/issues/41')],
    });
    expect(main(s.run, env, [pin('aws-actions/setup-sam', 'v3')])).toBe(
      'opened https://github.com/o/r/issues/41',
    );
    expect(affects(s)).toEqual(['affects=aws-actions/setup-sam@v3']);
    const body = s.calls.find((c) => c.args[1] === 'create')!.input!;
    const row = body.split('\n').find((l) => l.startsWith('| aws-actions/setup-sam'))!;
    expect(row).toContain(ELSEWHERE.slice(0, 8));
  });

  it.each([
    [
      'a tag lookup that fails',
      { 'git ls-remote': { status: 128, stdout: '', stderr: 'not found' } },
    ],
    [
      'an advisory lookup that fails',
      { 'git ls-remote': ok(RELEASED), 'gh api': { status: 1, stdout: '', stderr: 'HTTP 502' } },
    ],
    [
      'an advisory reply that is not a list',
      { 'git ls-remote': ok(RELEASED), 'gh api': ok('{"message":"Bad credentials"}') },
    ],
    [
      'an advisory with no GHSA',
      { 'git ls-remote': ok(RELEASED), 'gh api': ok('[{"severity":"high"}]') },
    ],
    [
      'an advisory giving no range for the action',
      {
        'git ls-remote': ok(RELEASED),
        'gh api': ok(
          '[{"ghsa_id":"GHSA-xxxx-yyyy-zzzz","vulnerabilities":[{"package":{"name":"other/action"}}]}]',
        ),
      },
    ],
  ])('fails, and files nothing, on %s', (_, answers) => {
    const s = stub({ 'pnpm audit': audit(CLEAN), 'gh issue': ok('[]'), ...answers });
    expect(() => main(s.run, env, [pin('actions/checkout', 'v7.0.1')])).toThrow();
    expect(s.made()).not.toContain('gh issue create');
  });
});

describe('readPins', () => {
  it('reads a pin with a subpath, and the run files it unaudited, the lockfile still audited', () => {
    const line = `      - uses: github/codeql-action/init@${PINNED} # v3.28.0`;
    const [sub] = pinsIn('.github/workflows/x.yml', line);
    expect(sub).toEqual({ ...pin('github/codeql-action', 'v3.28.0'), subpath: '/init' });
    const plain = `      - uses: actions/checkout@${PINNED} # v7.0.1`;
    expect(pinsIn('.github/workflows/x.yml', plain)).toEqual([pin('actions/checkout', 'v7.0.1')]);

    const s = stub({
      'pnpm audit': audit(CLEAN),
      'gh issue': [ok('[]'), ok('https://github.com/o/r/issues/41')],
    });
    expect(main(s.run, { GITHUB_SHA: 'abc1234def' }, [sub!])).toBe(
      'opened https://github.com/o/r/issues/41',
    );
    expect(s.made()[0]).toBe('pnpm audit --json');
    const body = s.calls.find((c) => c.args[1] === 'create')!.input!;
    expect(body).toContain('github/codeql-action/init');
    expect(body).toContain('not audited');
  });

  // The job installs nothing, so the script reads the pins by line; this holds that reading to a
  // YAML parse of the same files, in the workflows and the composite actions alike.
  it('finds exactly the third-party `uses:` a YAML parse finds', () => {
    const parsed: string[] = [];
    for (const entry of readdirSync(join(REPO, '.github'), {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !/\.ya?ml$/.test(entry.name)) continue;
      const file = `${entry.parentPath.replaceAll('\\', '/').slice(REPO.length + 1)}/${entry.name}`;
      visit(parseDocument(readFileSync(join(REPO, file), 'utf8')), {
        Pair(_, pair) {
          if (!isScalar(pair.key) || pair.key.value !== 'uses' || !isScalar(pair.value)) return;
          const ref = String(pair.value.value);
          if (!ref.startsWith('./') && !ref.startsWith('$/'))
            parsed.push(`${file} ${ref} ${(pair.value.comment ?? '').trim()}`);
        },
      });
    }
    const read = readPins(REPO).map(
      (p) => `${p.file} ${p.action}${p.subpath ?? ''}@${p.sha} ${p.comment}`,
    );
    expect(read.sort()).toEqual(parsed.sort());
    expect(read.some((r) => r.includes('actions/upload-artifact@'))).toBe(true);
    expect(read.some((r) => r.startsWith('.github/actions/'))).toBe(true);
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

  // Read-only at the top level, the write where the job needs it (*Deployment*).
  it('may read the code and write issues, and nothing else', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(Object.values(wf.jobs).map((job) => job.permissions)).toEqual([
      { contents: 'read', issues: 'write' },
    ]);
  });

  it('installs nothing and leaves no token in the checkout', () => {
    expect(steps.filter((s) => /\bpnpm\s+(install|i|add)\b/.test(s.run ?? ''))).toEqual([]);
    expect(steps.some((s) => s.run?.trim() === 'node scripts/advisories.ts')).toBe(true);
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });
});
