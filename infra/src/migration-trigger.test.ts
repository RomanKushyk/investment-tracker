// The deploy plans, rehearses and applies; a dispatch repairs and bootstraps. Three claims were
// true until it did, and each is written where a reader meets it long before the workflow: that a
// migration is started by hand alone, that `deploy-backend.yml` runs the handler never, and that
// the schema arrives on a dispatch and on nothing else. [*User schema and deletes*]
//
// ONE PATTERN PER CLAIM, AND NONE OF THEM A PARAPHRASE DETECTOR. Wide enough to catch every
// rewording is wide enough to fire on `capture.ts`'s "manual mode only" and on
// `dsql-constraints.md`'s "by hand into a throwaway schema", neither of which says anything about
// what starts a migration. Measured against the tree before the change: the three below matched
// five occurrences in four files, and nothing else.
//
// `src/` IS OUT OF SCOPE DELIBERATELY, and not for tidiness: two query hooks carry `manual only`
// about a user's click being the sole trigger — a different claim about a different thing, which is
// the trap `transaction-scope.test.ts` names around `one query per transaction`.
//
// TEST FILES ARE NOT SWEPT, and this file is why that rule has to hold: the fixtures below quote
// all three retired claims verbatim so the instruments can be shown to work at all, and a sweep
// blind to polarity reads its own calibration as a violation.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { REPO, skipped } from '../../src/repo-root';

/** The walk is `src/repo-root.ts`'s, so a background agent's worktree — a second checkout of this
 *  repository — is skipped by the same predicate everything else here uses. */
const walk = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return skipped(e.name) ? [] : walk(rel);
    if (e.name.endsWith('.test.ts') || e.name.endsWith('.test.tsx')) return [];
    return /\.(tsx?|md|ya?ml|sql)$/.test(e.name) ? [rel] : [];
  });

const sources = (): { file: string; text: string }[] =>
  ['.github', 'infra', 'docs']
    .flatMap(walk)
    .map((file) => ({ file, text: readFileSync(join(REPO, file), 'utf8') }));

/**
 * Comment markers stripped, emphasis dropped and whitespace collapsed, as `transaction-scope.test.ts`
 * does — a claim wraps, and `.` excludes `\r`, which this sweep meets in every file `.gitattributes`
 * does not pin to LF.
 *
 * AND A BLANK LINE BECOMES A BOUNDARY, which that file needs and this one does: a Markdown heading
 * ends in no punctuation, so joining `## 7. Watched by hand` to the paragraph under it produced
 * "by hand Amplify bills only" — a sentence that exists in no file, matched by a pattern looking for
 * exclusivity. Measured on `DEPLOYMENT.md`.
 */
const prose = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.replace(/^\s*(--|\/\/|#|\*\/|\/\*|\*)\s?/, ''))
    .map((line) => (line.trim() === '' ? '·' : line))
    .join(' ')
    .replace(/[*_]/g, '')
    .replace(/\s+/g, ' ');

/** ONE SENTENCE IS THE BOUND, and it cannot be `[^.]`: `migrate.yml` carries a dot, and the claim
 *  most worth catching is the one written about that file. A dot or a middot FOLLOWED BY A SPACE
 *  ends a sentence; a filename's dot is followed by a letter. */
const SAME_SENTENCE = '(?:(?![.·] ).)';

const CLAIMS = [
  {
    says: 'a migration is started by hand alone',
    pattern: new RegExp(
      `\\bmanual only\\b|\\bonly\\b${SAME_SENTENCE}{0,30}\\bby hand\\b|\\bby hand\\b${SAME_SENTENCE}{0,30}\\bonly\\b`,
      'gi',
    ),
    retired:
      'MANUAL ONLY, AND IT MUST STAY SO. · A migration started by the deploy: a migration must only ever be started by hand.',
    instead: 'the deploy applies it; a dispatch is the repair path and the bootstrap',
  },
  {
    says: 'the deploy ships the handler and runs it never',
    // `never runs FROM a deploy` is the second spelling, and it cost something: written with the
    // object arm alone, this pattern read `.github/WORKFLOWS.md` — which the walk reaches — and
    // stayed silent on "`migrate.yml` is `workflow_dispatch` only and never runs from a deploy".
    pattern: new RegExp(
      `\\bnever runs\\b${SAME_SENTENCE}{0,60}\\b(?:it|them|the handler|this handler|from a deploy|from the deploy)\\b`,
      'gi',
    ),
    retired:
      '`deploy-backend.yml` ships this handler and deliberately never runs it. · `migrate.yml` is `workflow_dispatch` only and never runs from a deploy.',
    instead: 'the deploy plans, rehearses and applies unattended; a failed apply opens an issue',
  },
  {
    says: 'a dispatch is the only way a schema reaches a cluster',
    pattern: new RegExp(`\\bschema arrives\\b${SAME_SENTENCE}{0,100}\\bdispatch`, 'gi'),
    retired:
      'A user cluster is created EMPTY: the schema arrives when `migrate.yml` is dispatched against it, not when the stack deploys.',
    instead: 'the schema arrives with the deploy that ships it',
  },
] as const;

/** `matchAll` rather than `test`: a `/g` regex carries `lastIndex` between calls, so a shared
 *  pattern asked twice answers the second question from where the first left off. */
const hits = (pattern: RegExp, text: string) => [...prose(text).matchAll(pattern)];

describe('nothing still says a migration is only ever started by hand', () => {
  // THE TWO WAYS A SWEEP PASSES WITHOUT CHECKING ANYTHING: a walk that returned nothing, and a
  // pattern that matches nothing. The first is caught by naming files the walk must reach; the
  // second cannot be caught against the tree here, because a green tree is one where all three
  // patterns are silent — so each is run against the sentence it retired instead.
  it('is actually looking, and all three instruments actually match', () => {
    const files = sources().map(({ file }) => file);
    expect(files).toEqual(
      expect.arrayContaining([
        '.github/workflows/migrate.yml',
        '.github/workflows/deploy-backend.yml',
        'infra/README.md',
        'docs/DECISIONS.md',
        'docs/reference/DEPLOYMENT.md',
      ]),
    );
    for (const claim of CLAIMS) {
      expect([claim.says, hits(claim.pattern, claim.retired).length > 0]).toEqual([
        claim.says,
        true,
      ]);
    }
  });

  it.each(CLAIMS)('no committed file says $says', (claim) => {
    const found = sources().flatMap(({ file, text }) =>
      hits(claim.pattern, text).map((m) => `${file}: ${m[0]}`),
    );
    expect(found, `say instead that ${claim.instead}`).toEqual([]);
  });
});
