import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COLOR_KEYS } from '../core/colors';
import { countUncheckedMarkers } from '../claims/repo-scan';
import { SEED_ASSETS, SEED_TRANSACTIONS, buildSeedSnapshots } from '../lib/seed';
import { REPO } from './markdown-files';
import { derived, measured, type Fact } from './registry';

const countRows = (p: string, re: RegExp) =>
  readFileSync(join(REPO, p), 'utf8')
    .split('\n')
    .filter((l) => re.test(l)).length;

const USER_SCHEMA = 'infra/migrations/drafts/003_user_schema.sql';

export const FACTS: Record<string, Fact> = {
  // Cited in three live indexes. It read 51 in one and 53 in two until 2026-08-26.
  'plan.closedTasks': derived(() => countRows('docs/archive/plan-a/README.md', /^\| [A-Z]\d+ \|/)),

  // `4/174/18`, cited in six live files.
  'seed.assets': derived(() => SEED_ASSETS.length),
  // A function, not an array — so the count follows the builder.
  'seed.snapshots': derived(() => buildSeedSnapshots().length),
  'seed.transactions': derived(() => SEED_TRANSACTIONS.length),

  'app.colorSlots': derived(() => COLOR_KEYS.length),

  // The claim lint's escape hatch (src/claims/README.md) is greppable by
  // design, which is what lets its own count be a fact instead of a hand
  // count going stale the way the numbers it replaces did. Counts LINES
  // carrying a well-formed marker, not claims the rules happened to
  // suppress — a marker on a line with no claim to suppress still carries
  // the marker, and the README's own sentence says "lines", not "claims".
  // A plain per-line regex test (`countUncheckedMarkers`) — no TypeScript
  // parse, no git subprocess, so `pnpm facts` keeps working without git on
  // PATH and this fence costs nothing worth memoizing.
  'claims.unchecked': derived(() => countUncheckedMarkers()),

  // W7's user schema, counted from the generated DDL rather than typed. D99
  // is why these exist: its first draft stated "sixteen CHECKs, two UNIQUEs,
  // five composite primary keys" in three files each, and all three numbers
  // were wrong — the same drift `plan.closedTasks` above was added for, in a
  // file that is itself generated and will keep changing until promotion.
  //
  // The path is the DRAFT's. Promotion moves the file up one directory, and
  // these derivations break loudly in the same commit rather than reporting
  // a stale count — which is the behaviour wanted: `infra/migrations/drafts/README.md`
  // says promotion is a move, so a fact that survived it silently would be
  // reading a file nobody promoted.
  'userSchema.tables': derived(() => countRows(USER_SCHEMA, /^CREATE TABLE /)),
  // Four of the five: `app_user` keys on `user_id` alone. Matches a key list
  // with a comma inside it.
  'userSchema.compositeKeys': derived(() => countRows(USER_SCHEMA, /PRIMARY KEY\("[^)]*","/)),
  'userSchema.checks': derived(() => countRows(USER_SCHEMA, /CONSTRAINT "[a-z_]+_ck"/)),
  'userSchema.uniques': derived(() => countRows(USER_SCHEMA, /CONSTRAINT "[a-z_]+_uq"/)),

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
