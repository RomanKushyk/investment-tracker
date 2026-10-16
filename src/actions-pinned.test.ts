import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMap, isScalar, isSeq, parseDocument, type YAMLMap } from 'yaml';
import { REPO } from './repo-root';

// A tag is a mutable reference, and the jobs that use these actions mint AWS credentials, so
// every third-party action is pinned to a full commit SHA — GitHub's hardening guide calls that
// the only immutable way to use one. The release the SHA was taken from rides in a trailing
// comment, `# vX.Y.Z`: Dependabot creates no alert for a SHA-pinned action, so that comment is
// the manifest an audit of the pins reads (*Dependabot*, `docs/reference/DEPENDABOT.md`).

/** The self-repository prefix resolves an action from this repository at the run's own commit. */
const SELF = '$/';

/** Every YAML file under `.github/`: the workflows AND the composite actions, since a pin can sit
 *  in either and a workflows-only sweep has missed one before. */
const files = readdirSync(join(REPO, '.github'), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
  .map((entry) => `${entry.parentPath.replaceAll('\\', '/').slice(REPO.length + 1)}/${entry.name}`);

/** A workflow's jobs, as parsed nodes: a node keeps the comment on its line, which is where the
 *  release lives. */
const jobs = (file: string): YAMLMap[] => {
  const all = parseDocument(readFileSync(join(REPO, file), 'utf8')).get('jobs');
  return isMap(all) ? all.items.map((job) => job.value).filter(isMap) : [];
};

/** The steps of a workflow's jobs, or of a composite action's `runs`. */
const steps = (file: string): YAMLMap[] => {
  const runs = parseDocument(readFileSync(join(REPO, file), 'utf8')).getIn(['runs', 'steps']);
  return [...jobs(file).map((job) => job.get('steps')), runs]
    .filter(isSeq)
    .flatMap((seq) => seq.items)
    .filter(isMap);
};

// A job-level `uses:` calls a reusable workflow, which can be handed the job's secrets: it is
// pinned the same way.
const uses = files.flatMap((file) =>
  [...steps(file), ...jobs(file)]
    .map((node) => node.get('uses', true))
    .filter(isScalar)
    .map((node) => ({ file, ref: String(node.value), comment: node.comment ?? '' }))
    .filter(({ ref }) => !ref.startsWith(SELF) && !ref.startsWith('./')),
);

describe('every third-party action is pinned to a commit', () => {
  // The anchor: a sweep that found nothing would pass every assertion below.
  it('finds the actions in the workflows and in the composite action', () => {
    const names = uses.map(({ file, ref }) => `${file} ${ref.split('@')[0]}`);
    expect(names).toContain('.github/workflows/deploy-backend.yml actions/checkout');
    expect(names).toContain('.github/workflows/deploy-backend.yml actions/download-artifact');
    expect(names).toContain('.github/actions/invoke-migration/action.yml actions/upload-artifact');
  });

  it('by a full 40-hex SHA, never a tag or a branch', () => {
    for (const { file, ref } of uses) {
      expect([file, ref, /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/.test(ref)]).toEqual([
        file,
        ref,
        true,
      ]);
    }
  });

  it('names the release the SHA was taken from in a comment on the same line', () => {
    for (const { file, ref, comment } of uses) {
      expect([file, ref, /^ v\d/.test(comment)]).toEqual([file, ref, true]);
    }
  });
});

describe('a workflow step fetches no package from outside the lockfile', () => {
  // `npx <pkg>` fetches whatever the registry serves at run time, outside `--frozen-lockfile`;
  // `pnpm exec` resolves the workspace's installed copy. Comment lines dropped, or a sentence
  // naming the rule reads as a use.
  it('runs no npx in a step', () => {
    for (const file of files) {
      const commands = steps(file)
        .flatMap((step) => String(step.get('run') ?? '').split(/\r?\n/))
        .filter((line) => !/^\s*#/.test(line))
        .join('\n');
      expect([file, /\bnpx\b/.test(commands)]).toEqual([file, false]);
    }
  });
});
