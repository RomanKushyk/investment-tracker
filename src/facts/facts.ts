import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COLOR_KEYS } from '../core/colors';
import { SEED_ASSETS, SEED_TRANSACTIONS, buildSeedSnapshots } from '../lib/seed';
import { REPO } from './markdown-files';
import { derived, measured, type Fact } from './registry';

const countRows = (p: string, re: RegExp) =>
  readFileSync(join(REPO, p), 'utf8')
    .split('\n')
    .filter((l) => re.test(l)).length;

export const FACTS: Record<string, Fact> = {
  // Cited in three live indexes. It read 51 in one and 53 in two until 2026-08-26.
  'plan.closedTasks': derived(() => countRows('docs/archive/plan-a/README.md', /^\| [A-Z]\d+ \|/)),

  // `4/174/18`, cited in six live files.
  'seed.assets': derived(() => SEED_ASSETS.length),
  // A function, not an array — so the count follows the builder.
  'seed.snapshots': derived(() => buildSeedSnapshots().length),
  'seed.transactions': derived(() => SEED_TRANSACTIONS.length),

  'app.colorSlots': derived(() => COLOR_KEYS.length),

  'dpu.observeNbu.window': measured({
    value: 0.25594,
    unit: 'DPU',
    at: '2026-08-26',
    method:
      'EXPLAIN (ANALYZE, VERBOSE) on the 7-day window, warm, 4 runs with the order alternated against the qualified form, median of the aliased form',
    samples: 4,
    reproduce: 'D97; working in infra/docs/replan-a50.md round 2',
  }),
};
