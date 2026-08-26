import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// `out` is a FRESH OS temp directory, never `infra/migrations/drafts` — on
// purpose. `drizzle-kit generate` writes a stateful `meta/_journal.json` into
// `out` and reads it back to decide whether the next run emits a full schema
// (`0000_…`) or an incremental diff (`0001_…`). Pointing `out` at the drafts
// folder would commit that journal, ride every `infra/**` deploy trigger, and
// make a second regeneration silently emit a diff instead of the full
// snapshot W7 needs to apply once. `mkdtempSync` also means every invocation
// of this config starts from an empty directory, so `generate` always sees no
// prior history and always emits `0000_…` — a full schema snapshot.
//
// `DRIZZLE_OUT`, when set, is used instead of minting a new directory — the
// schema-generated guard test passes its own, so it can read the result
// without parsing `generate`'s stdout.
//
// Generation procedure: run `drizzle-kit generate` against this config, then
// copy ONLY the emitted `.sql` file to `infra/migrations/drafts/003_user_schema.sql`.
// No `meta/` directory is ever committed.
export default defineConfig({
  dialect: 'postgresql',
  schema: './infra/schema/user.ts',
  out: process.env.DRIZZLE_OUT ?? mkdtempSync(join(tmpdir(), 'quirenote-drizzle-')),
  // DSQL allows one DDL statement per transaction. Drizzle emits
  // `--> statement-breakpoint` between statements for exactly this.
  breakpoints: true,
});
