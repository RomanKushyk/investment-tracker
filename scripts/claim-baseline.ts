import { writeFileSync } from 'node:fs';
import { FACTS } from '../src/facts/facts';
import {
  BASELINE_PATH,
  countsFromClaims,
  serializeBaseline,
  loadBaseline,
} from '../src/claims/baseline';
import { scanRepo } from '../src/claims/repo-scan';

// Rewrites claim-baseline.json to the repo's current, honest claim counts —
// the ratchet's "accept new claims" / "lower it after a fix" tool, the same
// role scripts/facts.ts and scripts/decisions.ts play for their own
// generated files. `src/claims/claim-lint.test.ts` is the read-only check
// this pairs with; running that immediately after this script must always
// pass, and running this script again immediately after must produce
// byte-identical output (serializeBaseline's determinism).

// `before` is ONLY for the "N file(s) changed" line below — never for what
// gets written, which always comes from a fresh scan regardless. A corrupt
// or hand-mangled committed file must not be able to block the one command
// that repairs it: `loadBaseline` validates and throws on exactly that, so
// a failure here falls back to treating "before" as empty rather than
// propagating and leaving the repo stuck with no documented way out but
// deleting the file by hand.
let before: Record<string, number>;
try {
  before = loadBaseline(BASELINE_PATH);
} catch {
  before = {};
}

const { claims, unparseable, errors } = scanRepo(new Set(Object.keys(FACTS)));
const after = countsFromClaims(claims);

// A file that HAD a nonzero baseline entry and just went unparseable or
// erroring contributes zero claims to `after`, so writing unconditionally
// would silently remove its ratchet entry — the exact "stale baseline"
// failure mode this whole mechanism exists to catch, running in reverse,
// with only a log line as the signal. Refuse to write at all when that
// would happen; nothing here is lost by refusing, since the committed
// file is untouched either way.
const newlyBroken = [...unparseable, ...errors.map((e) => e.file)].filter(
  (f) => (before[f] ?? 0) > 0,
);
if (newlyBroken.length > 0) {
  console.error(
    'refusing to write claim-baseline.json: the following file(s) had a baseline entry ' +
      'and are now unparseable or erroring — fix them, or decide by hand that the ' +
      'ratchet entry should go, before running this again:',
  );
  for (const f of newlyBroken) console.error(`  ${f}`);
  process.exit(1);
}

const text = serializeBaseline(after);
writeFileSync(BASELINE_PATH, text);

const files = new Set([...Object.keys(before), ...Object.keys(after)]);
let changed = 0;
for (const f of files) if ((before[f] ?? 0) !== (after[f] ?? 0)) changed += 1;

console.log(
  changed === 0
    ? `claim-baseline.json was already current: ${Object.keys(after).length} file(s)`
    : `updated claim-baseline.json: ${changed} file(s) changed, ${Object.keys(after).length} total`,
);
if (unparseable.length > 0) {
  console.log(`${unparseable.length} file(s) skipped as unparseable:`, unparseable);
}
if (errors.length > 0) {
  console.error(`${errors.length} file(s) had an unexpected scan error:`);
  for (const e of errors) console.error(`  ${e.file}: ${e.message}`);
  process.exitCode = 1;
}
