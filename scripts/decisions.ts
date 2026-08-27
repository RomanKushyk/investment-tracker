import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDecisions, validateDecisions, DECISIONS_DIR } from '../src/decisions/records';
import { lineCapDiagnostic, spliceGeneratedRows } from '../src/decisions/render';

// Validate before writing anything — an amends target with no file, or a
// decision that amends itself, aborts with README.md untouched.
const records = readDecisions();
const problems = validateDecisions(records);
if (problems.length > 0) {
  for (const p of problems) console.error(`${p.id}: ${p.problem}`);
  throw new Error(`${problems.length} decision(s) failed validation`);
}

const readmePath = join(DECISIONS_DIR, 'README.md');
const before = readFileSync(readmePath, 'utf8');
// Throws if any marker block failed to fill or any decision landed in none —
// "nothing to update" and "nothing was attempted" must never look alike.
const { text: after, blocksFilled, rowsRendered } = spliceGeneratedRows(before, records);
const summary = `${rowsRendered} row(s) across ${blocksFilled} block(s)`;

if (after === before) {
  console.log(`the decision index was already current: ${summary}`);
} else {
  writeFileSync(readmePath, after);
  console.log(`updated docs/decisions/README.md: ${summary}`);
  // Only on the path that wrote. Reported, not fatal — D98's cap is a
  // diagnostic and the length is held by the ratchet in
  // `src/docs-line-cap.test.ts`, not by refusing to write here. On the no-op
  // path the message would be two lies at once: nothing was written, and the
  // length it asks to record is already recorded.
  const diagnostic = lineCapDiagnostic(after, 'docs/decisions/README.md');
  if (diagnostic !== null) console.error(diagnostic);
}
