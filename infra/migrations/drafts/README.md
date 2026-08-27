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
- **DSQL HAS foreign keys, and this schema declares none.** Measured
  2026-08-27 (**D99**, working in [`../../docs/dsql-ddl-first-contact.md`](../../docs/dsql-ddl-first-contact.md)):
  a composite `FOREIGN KEY (…) REFERENCES (…) ON DELETE RESTRICT` is accepted
  and enforced both ways. The rule that stood here said `REFERENCES` was absent
  from the grammar — true when written, false now. Nothing in
  `../../schema/user.ts` declares one, so **today** every reference among these
  tables is still application-enforced on write plus a nightly integrity audit,
  and the database will not catch a dangling one. Whether to adopt them is
  [`../../../docs/plans/PLAN-OPEN.md`](../../../docs/plans/PLAN-OPEN.md) O34 —
  a question, not a plan.
- **Promotion rewrites every index line TWICE — insert `ASYNC`, strip
  `USING btree` — uniformly or not at all. A RULE over the generated file, not
  a per-line marker.** Measured 2026-08-27 (**D99**): DSQL rejects `USING btree`
  with `0A000 USING not supported for CREATE INDEX` whether or not `ASYNC` is
  present, and rejects a `CREATE INDEX` without `ASYNC` with
  `0A000 unsupported mode`. Inserting `ASYNC` alone — all this rule used to say
  — still produces a statement the cluster refuses. Neither edit can live in the
  generated file: `ASYNC` is a syntax error on stock Postgres, and `USING btree`
  is what drizzle-kit emits and what `../../src/user-schema.test.ts` applies to
  PGlite. So the generated
  `CREATE INDEX "asset_user_created" ON "asset" USING btree ("user_id","created_at")`
  is sent as
  `CREATE INDEX ASYNC "asset_user_created" ON "asset" ("user_id","created_at")`.
  Two places record this conversion next to the code, and both name both
  halves: the comments above `asset_user_created` and `transaction_user_date`
  in [`../../schema/user.ts`](../../schema/user.ts), and the "what this cannot
  prove" header of [`../../src/user-schema.test.ts`](../../src/user-schema.test.ts)
  — which is load-bearing here, because that suite is the reason `USING btree`
  stays in the generated file at all.
- **An accepted `CREATE INDEX ASYNC` is not an index.** It returns a `job_id`
  and nothing more. `sys.wait_for_job` is a PROCEDURE — `CALL
  sys.wait_for_job(job_id)`, not `SELECT`, which fails `42809` — after which
  `sys.jobs.status` reads `completed` and `indisvalid` turns true. A runner that
  fires and moves on has not created an index, and a job that ends `failed`
  leaves the definition behind `INVALID`. **The recovery is DOCUMENTED, not
  measured** — AWS says a failed build's definition is not removed and must be
  dropped by hand; no job was made to fail here, so that `DROP INDEX` works on
  an INVALID async index is untested on this cluster. **D48** found the timing
  half of this from the outside; **D99** has the mechanism.
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
  facts on this page, plus what a throwaway schema on the real cluster can be
  made to answer, are the whole of that safety — and anything found to diverge
  belongs here. **A question about DSQL is cheap to ask and expensive to
  assume, and the two halves of that were both visible here.** This page's own
  open risks were written 2026-08-26 and 2026-08-27 and settled by one
  connection on the 27th — a day old, so nothing was lost, and the one that
  mattered had a cause the documentation would have got wrong. The foreign-key
  claim is the other half: it came from the cloud-stack spec of **2026-08-04**,
  was never re-checked, and had become false at some point nobody can now
  date — filed against the schema for three weeks as a constraint.
- **`USING btree`: asked and answered — no** (2026-08-27, D99). It is the
  promotion rule above, and the reason is not the one the grammar suggested.
  `USING` is *not* banned: `USING btree_index` is accepted, and it is what
  `pg_get_indexdef` prints back for every index, primary keys included. `pg_am`
  holds `btree` next to `btree_index`, so the refusal is a whitelist of one
  name, not a missing one. Omitting the clause is still the right promotion —
  `btree_index` is a DSQL-only spelling that buys nothing and costs the PGlite
  test.
- **First contact already happened, and it was not the promotion (D99).** All
  seven statements of `003_user_schema.sql` ran against the live cluster on
  2026-08-27 inside a throwaway schema dropped `CASCADE` —
  <!--f:userSchema.tables-->5<!--/f--> primary keys,
  <!--f:userSchema.compositeKeys-->4<!--/f--> of them composite,
  <!--f:userSchema.checks-->20<!--/f--> `CHECK`s,
  <!--f:userSchema.uniques-->3<!--/f--> `UNIQUE`s, one `DEFAULT`, `numeric`
  with no precision. (Fenced — `pnpm facts` derives all four from the DDL,
  because the first draft of this bullet typed three of them wrong.)
  The `CHECK`s, `UNIQUE`s and `DEFAULT` that had **no precedent against the
  real cluster** now have one, and they are enforced, not merely
  accepted: `app_user_status_ck`, `app_user_role_ck`, `app_user_decided_ck` and
  `app_user_email_uq` each rejected a row aimed at it. Contract 3's key-order
  argument gains partial evidence — `pg_get_indexdef` read `account`'s key back
  as `USING btree_index (user_id, id) INCLUDE (provider, name, created_at)`,
  its three non-key columns, and a probe table the same way. TWO tables: the
  index-organized primary key is observed, "every table, every column" is still
  documentation. **What promotion is still first contact for is the RUNNER**,
  not the DDL: see the not-replayable rule below.
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
