import { writeFileSync } from 'node:fs';
import {
  BASELINE_PATH,
  serializeBaseline,
  loadBaseline,
  type DistillationBaseline,
} from '../src/distillation/baseline';
import { scanRepo } from '../src/distillation/repo-scan';

// Rewrites distillation-baseline.json to the repo's current, honest
// figures for all three ratchets (repeated sentences, comment volume,
// history-in-the-artifact phrases) — the same "accept new growth" / "lower
// it after a fix" role scripts/claim-baseline.ts plays for the claim lint.
// src/distillation/distillation-lint.test.ts is the read-only check this
// pairs with; running that immediately after this script must always pass,
// and running this script again immediately after must produce
// byte-identical output (serializeBaseline's determinism).

const EMPTY: DistillationBaseline = { repeatedSentences: {}, commentChars: {}, historyPhrases: {} };

// `before` is ONLY for the "N changed" line below and the refuse-to-write
// guard just below it — never for what gets written, which always comes
// from a fresh scan regardless. A corrupt or hand-mangled committed file
// must not block the one command that repairs it, so a load failure here
// falls back to an empty baseline instead of propagating.
let before: DistillationBaseline;
try {
  before = loadBaseline(BASELINE_PATH);
} catch {
  before = EMPTY;
}

const scan = scanRepo();
const after: DistillationBaseline = {
  repeatedSentences: scan.repeatedSentences,
  commentChars: scan.commentChars,
  historyPhrases: scan.historyPhrases,
};

// A file that HAD a nonzero entry in ANY section and just went unparseable
// or erroring contributes zero to every section of `after`, so writing
// unconditionally would silently remove its ratchet entries — the exact
// "stale baseline" failure mode this whole mechanism exists to catch,
// running in reverse, with only a log line as the signal.
// scripts/claim-baseline.ts carries the identical guard for its own single
// section; this checks all three rather than only the first that happens
// to be nonzero. Refuse to write at all when that would happen; nothing
// here is lost by refusing, since the committed file is untouched either
// way.
const hadEntry = (f: string) =>
  (before.repeatedSentences[f] ?? 0) > 0 ||
  (before.commentChars[f] ?? 0) > 0 ||
  (before.historyPhrases[f] ?? 0) > 0;
const newlyBroken = [...scan.unparseable, ...scan.errors.map((e) => e.file)].filter(hadEntry);
if (newlyBroken.length > 0) {
  console.error(
    'refusing to write distillation-baseline.json: the following file(s) had a baseline ' +
      'entry and are now unparseable or erroring — fix them, or decide by hand that the ' +
      'ratchet entry should go, before running this again:',
  );
  for (const f of newlyBroken) console.error(`  ${f}`);
  process.exit(1);
}

const text = serializeBaseline(after);
writeFileSync(BASELINE_PATH, text);

let changed = 0;
for (const section of ['repeatedSentences', 'commentChars', 'historyPhrases'] as const) {
  const files = new Set([...Object.keys(before[section]), ...Object.keys(after[section])]);
  for (const f of files) {
    if ((before[section][f] ?? 0) !== (after[section][f] ?? 0)) changed += 1;
  }
}

console.log(
  changed === 0
    ? 'distillation-baseline.json was already current'
    : `updated distillation-baseline.json: ${changed} entr${changed === 1 ? 'y' : 'ies'} changed`,
);
if (scan.unparseable.length > 0) {
  console.log(`${scan.unparseable.length} file(s) skipped as unparseable:`, scan.unparseable);
}
if (scan.errors.length > 0) {
  console.error(`${scan.errors.length} file(s) had an unexpected scan error:`);
  for (const e of scan.errors) console.error(`  ${e.file}: ${e.message}`);
  process.exitCode = 1;
}
