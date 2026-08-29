import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from './facts/markdown-files';

// Both workflows run the WHOLE suite as bare `pnpm test`. The backend one used to
// name `infra/src` explicitly; dropping that argument was right — the whole suite
// covers strictly more — but it moved the backend's CI coverage onto vitest's
// DEFAULT `include`, which `vitest.config.ts` does not state.
//
// That default is not a contract this repo controls. A session adding an `include`
// (to scope the suite) or an `exclude` (to skip `.claude/worktrees/`, which the
// default does NOT exclude) would silently drop every `infra/src` test from BOTH
// workflows — recreating the green-but-never-executed gap that A50's
// `order-by-alias` guard exists to close, and that `deploy-backend.yml` carries a
// comment about.
//
// What this pins: that the default is still in force. It does NOT prove the backend
// tests ran — a test cannot observe the runner's own file list. If a future config
// genuinely needs `include`/`exclude`, that is fine: widen this guard to assert the
// patterns still cover `infra/src`, rather than deleting it.
describe('the suite still reaches infra/src', () => {
  it('has backend tests to lose in the first place', () => {
    const tests = readdirSync(join(REPO, 'infra/src')).filter((f) => f.endsWith('.test.ts'));
    expect(tests.length).toBeGreaterThan(0);
  });

  it('leaves vitest include/exclude unset, so the default keeps covering infra/src', () => {
    const config = readFileSync(join(REPO, 'vitest.config.ts'), 'utf8');
    // Key position, not a bare word: `include` also appears in prose and in other
    // option names (`includeSource`, `includeTaskLocation`), and matching those
    // would fail the guard for a config that is perfectly fine.
    const keys = [...config.matchAll(/^\s*(include|exclude)\s*:/gm)].map((m) => m[1]);
    expect(keys).toEqual([]);
  });
});
