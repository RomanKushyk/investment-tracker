// "DSQL runs one statement per transaction" is a real rule with its scope filed off. What was
// measured is DDL-shaped — `infra/README.md`: "One DDL statement per transaction, and DDL never
// shares a transaction with DML — a DSQL constraint, not a style choice." Dropped, the sentence
// forbids something the cluster demonstrably does: `infra/docs/dsql-constraints.md` records a DML
// transaction that committed on the dev cluster.
//
// A GUARD RATHER THAN A FIX, because the rule is written down in six files and one of them had
// lost the qualifier. A reader who meets that copy believes the runner's file-splitting convention
// is a prohibition of the cluster's. The escape is to say DDL.
//
// TEST FILES ARE NOT SWEPT, and this one is why: the pattern below matches a phrase rather than a
// meaning, so it is blind to polarity — a sentence QUOTING the unqualified claim in order to guard
// against it reads as a violation. Prose that must discuss the rule has the same escape as prose
// that states it, and takes it: `dsql-constraints.md` quotes the README's sentence in full, and
// passes because that sentence says DDL.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// THE WALK IS `src/repo-root.ts`'s, NOT A SECOND COPY. `skipped()` is one predicate for a reason
// `src/nested-checkouts.test.ts` spells out: a background agent's worktree is a second checkout of
// this repository, and a walk with its own name list is another surface that finds it. Its
// `.tmp-*` half is a pattern rather than a name, so an inlined `Set` silently drops it — and from
// the root, where a scratch checkout actually lands, that half is the one doing the work.
import { REPO, skipped } from '../../src/repo-root';

/**
 * Every authored file in the repository. FROM THE ROOT rather than from named trees: the claim is
 * already written in a workflow, a CloudFormation template, a drizzle config, a migration, a README
 * and this repository's DSQL notes, so a list of roots would be one move behind — and the criterion
 * this guard serves says "no committed file", which `CLAUDE.md` and the root `README.md` are.
 *
 * `tsx?` and not `ts`: `.tsx` is most of `src/` and the trailing x defeats a `\.ts$` anchor — the
 * same trap, and the same spelling, as `cognito-pool.test.ts`'s walk.
 */
const walk = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) return skipped(e.name) ? [] : walk(rel);
    if (e.name.endsWith('.test.ts') || e.name.endsWith('.test.tsx')) return [];
    return /\.(tsx?|md|ya?ml|sql)$/.test(e.name) ? [rel] : [];
  });

const sources = (): { file: string; text: string }[] =>
  walk('').map((file) => ({ file, text: readFileSync(join(REPO, file), 'utf8') }));

/**
 * Comment markers stripped and every run of whitespace collapsed to one space, because the claim
 * WRAPS: in `005_demo_user.sql` it read "since it runs\n-- one statement per transaction". A
 * pattern spanning lines with `.` would miss it twice over — the `--` sits mid-phrase, and `.`
 * excludes `\r`, which this sweep meets in the files `.gitattributes` does not pin to LF: the
 * TypeScript and the YAML, both CRLF here under `core.autocrlf`.
 *
 * MARKDOWN EMPHASIS GOES TOO, and it is not hypothetical: `infra/README.md` states this very rule
 * in bold. `**` inside the phrase rather than around it — `one **statement** per transaction` —
 * would slip a `\w+` pattern silently, which is the worst way for a guard to fail.
 */
const prose = (text: string): string =>
  text
    .split('\n')
    .map((line) => line.replace(/^\s*(--|\/\/|#|\*\/|\/\*|\*)\s?/, ''))
    .join(' ')
    .replace(/[*_]/g, '')
    .replace(/\s+/g, ' ');

/**
 * ONE SPELLING FAMILY: `one statement per transaction`, with at most one word before `statement`
 * and nothing between `per` and `transaction`. The rule's other live wording, `one DDL per
 * transaction`, is outside the pattern — it is written that way in `migrate.ts`, `capture.ts`,
 * `002_price_observation.sql` and a design spec, every one of them DDL-scoped and correct, which
 * is why the gap has cost nothing. Catching it too means naming `DDL` as an alternative to
 * `statement`; what must NOT be done is making `statement` optional, which would swallow `one
 * query per transaction`, a different claim about a different thing.
 */
const CLAIM = /one (?:(\w+) )?statements? per transaction/gi;

/** `matchAll` rather than `test`: a `/g` regex carries `lastIndex` between calls, so a shared
 *  pattern asked twice answers the second question from where the first left off. */
const claims = (text: string) => [...prose(text).matchAll(CLAIM)];

describe('the one-statement-per-transaction rule keeps its DDL scope', () => {
  // THE TWO WAYS THIS PASSES WITHOUT CHECKING ANYTHING, which is `cognito-pool.test.ts`'s rule: a
  // walk that returned nothing, and a pattern that matches nothing. Both are caught by naming the
  // files the rule is stated in — NOT by a file COUNT, which in a repository whose documentation
  // policy is "delete, never archive" would redden on the next branch that removes a document, in
  // a message about arithmetic. `.tsx` is asserted separately because its absence is the one way
  // the walk can look thorough and skip most of `src/`.
  //
  // `dsql-constraints.md` is deliberately not among the named files: it carries the phrase only
  // inside a quotation this branch wrote, so pinning it would pin a paragraph rather than a copy
  // of the rule.
  it('is actually looking, and the pattern actually matches', () => {
    const files = sources();
    expect(files.some(({ file }) => file.endsWith('.tsx'))).toBe(true);
    expect(files.filter(({ text }) => claims(text).length > 0).map(({ file }) => file)).toEqual(
      expect.arrayContaining([
        '.github/workflows/migrate.yml',
        'infra/README.md',
        'infra/drizzle.config.ts',
        'infra/template-user.yaml',
        'infra/migrations/001_price_capture.sql',
      ]),
    );
  });

  it('qualifies every copy with DDL', () => {
    const unscoped = sources().flatMap(({ file, text }) =>
      claims(text)
        .filter((m) => m[1]?.toUpperCase() !== 'DDL')
        .map((m) => `${file}: ${m[0]}`),
    );
    expect(unscoped, 'say "one DDL statement per transaction" — DML is not bound by it').toEqual(
      [],
    );
  });
});
