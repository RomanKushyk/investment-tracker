# infra/migrations/drafts — schema written before anything may apply it

**Nothing in this directory is applied by any code.** That is the point of the
folder: DSQL primary keys are immutable (D30), so a key is decided on paper,
reviewed, and only then promoted.

| File | What | The rule |
|---|---|---|
| [`003_user_schema.sql`](003_user_schema.sql) | W7's user schema — `app_user`, `account`, `asset`, `transaction`, `user_price` | **Generated from [`../../schema/user.ts`](../../schema/user.ts) — never hand-edit it**, a hand edit fails `schema-generated.test.ts`. The pinned contracts live beside the code they govern there; the migration translations are `docs/reference/w7-migration-translations.md`; DSQL environment facts and the promotion rule stay in this README |

## Local rules

- **`ensureSchema` (`../../src/capture.ts`) does NOT know these tables, and
  must not learn them.** It owns the ARCHIVE — `price_capture`,
  `price_observation`, `instrument` — provider data shared by every
  environment. This file is USER data, which **D63** splits dev from prod at
  W7.
- **Numbering continues `../`.** `001` and `002` are taken by the applied
  archive migrations, so the draft is `003` — the number it keeps on promotion.
  Two files under one number is the ambiguity numbering exists to remove, and a
  tool globbing `migrations/**/*.sql` by filename would have run the user schema
  before the archive tables.
- **DSQL has no foreign keys** — `REFERENCES` is absent from the grammar, and
  none is declared in `../../schema/user.ts`. Every reference among these
  tables is application-enforced on write plus a nightly integrity audit; the
  database itself will not catch a dangling one.
- **Promotion converts every `CREATE INDEX` to `CREATE INDEX ASYNC`, or none —
  a RULE over the generated file, not a per-line marker.** `ASYNC` is
  DSQL-only and a syntax error on stock Postgres, so the generated SQL cannot
  carry it and drizzle-kit gives every index the same plain `CREATE INDEX`
  either way. The `// … ASYNC on DSQL` comments above `asset_user_created` and
  `transaction_user_date` in [`../../schema/user.ts`](../../schema/user.ts)
  are the only place that conversion is still recorded; promotion applies it
  uniformly to all of them, never to some.
- **UNIQUE constraints are declared INLINE in `CREATE TABLE`, never as a
  later `CREATE UNIQUE INDEX`** — adding a unique index to an
  already-created table is not something to assume of DSQL. Drizzle's
  `unique()` table builder, used throughout
  [`../../schema/user.ts`](../../schema/user.ts), emits inline `UNIQUE` this
  way; its sibling `uniqueIndex()` emits a separate `CREATE UNIQUE INDEX`
  instead, and nothing in `infra/` currently warns against reaching for it.
- **A change here must keep `../../src/user-schema.test.ts` green.** It applies
  this DDL to a real Postgres (PGlite, in WASM) and exercises every constraint
  in both directions. `pnpm test` runs it locally and
  `.github/workflows/deploy-backend.yml` runs it in CI
  (`pnpm vitest run src/core/inzhur infra/src`) — together the reason a
  schema change cannot drift from what `../../schema/user.ts` claims, before
  W7 gives this folder any other consumer.
- **Local Postgres proves nothing about DSQL.** It is the subset. The DSQL
  facts on this page plus first contact at promotion are the whole of that
  safety, and anything found to diverge belongs here.
- **Open risk: does DSQL accept `USING btree`?** The generated index DDL reads
  `CREATE INDEX name ON table USING btree (cols)`; DSQL's documented form is
  `CREATE INDEX ASYNC name ON table (cols)`, with no method clause either way.
  Nobody has confirmed DSQL accepts `USING btree` — tracked as a
  pre-condition on W7's row in
  [`../../../docs/plans/phase-w-i-ii-iii.md`](../../../docs/plans/phase-w-i-ii-iii.md), verify
  before promotion.
- **And that list is not known to be complete.** Neither
  `001_price_capture.sql`/`002_price_observation.sql` nor `ensureSchema` uses
  a single `CHECK`, `UNIQUE` or `DEFAULT` — only `NOT NULL` and
  `PRIMARY KEY` — so this schema's CHECKs, UNIQUEs and one `DEFAULT` have NO
  precedent against the real cluster; the cloud-stack spec's line that
  `CHECK`, `UNIQUE`, `PRIMARY KEY` and `GENERATED` are all supported is the
  only basis for using them. First contact is this schema's promotion — see
  W7's row in [`../../../docs/plans/phase-w-i-ii-iii.md`](../../../docs/plans/phase-w-i-ii-iii.md)
  for the gate date. Contract 3's key-order argument is reasoning about DSQL's
  index-organized primary key, not evidence — a query plan over a two-row
  table was not taken as one.
- **The generated DDL is NOT replayable.** The hand-written file used
  `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`; drizzle-kit
  can emit neither, so every statement here is a bare `CREATE`. DSQL runs one
  DDL statement per transaction with no cross-statement rollback, so a W7
  application that fails partway through cannot simply be re-run — the retry
  dies on the first statement, which already exists. The migration runner
  must either skip a statement whose object already exists, or track which
  statements already applied.
- **Promotion is a move, not a copy.** The file leaves this folder in the commit
  that gives it a handler entitled to run it, and `../../README.md`'s Layout
  table is corrected in the same commit. Promoted, `003_user_schema.sql` will
  be the only applied migration carrying no contract header of its own —
  `001` and `002` carry theirs inline as comments; `003` is generated, so its
  contracts live in [`../../schema/user.ts`](../../schema/user.ts) instead,
  beside the code they govern.
- **Measure against the app, not against the seed.** Both review rounds on the
  draft found the same cause: a claim checked against `src/lib/seed.ts` and
  nowhere else. `schemas.ts`, `TransactionPanel.tsx`, `repository.ts` and
  `core/backup/` all constrain what the migration will actually meet.
