import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from './facts/markdown-files';

// D104 §2 declined routine version-bump PRs. GitHub's own UI COMMITS the config
// when version updates are switched on, so the ruling could be reversed by a
// button. BOTH extensions are checked because GitHub honours `.yaml` as well —
// asserting only `.yml` would leave the hole exactly where a generator puts it.
describe('the Dependabot config stays absent (D104 §2)', () => {
  // Same anchor as its sibling: an absence assertion cannot tell 'nothing is there'
  // from 'I am not looking at the right tree'.
  it('is looking at the real .github/ — without this it could pass vacuously', () => {
    expect(existsSync(join(REPO, '.github/workflows/deploy-backend.yml'))).toBe(true);
  });

  it.each(['.github/dependabot.yml', '.github/dependabot.yaml'])(
    '%s does not exist — version updates are declined; security updates are a repo SETTING',
    (path) => {
      expect(existsSync(join(REPO, path))).toBe(false);
    },
  );
});
