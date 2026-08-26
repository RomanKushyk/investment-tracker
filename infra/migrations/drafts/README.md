# infra/migrations/drafts — schema written before anything may apply it

**Nothing in this directory is applied by any code.** That is the point of the
folder: DSQL primary keys are immutable (D30), so a key is decided on paper,
reviewed, and only then promoted.

| File | What | The rule |
|---|---|---|
| [`003_user_schema.sql`](003_user_schema.sql) | W7's user schema — `app_user`, `account`, `asset`, `transaction`, `user_price` | Read its header before editing a line of it. The pinned contracts, the old→new `Transaction` mapping and the six migration translations are all in there |

## Local rules

- **Numbering continues `../`.** `001` and `002` are taken by the applied
  archive migrations, so the draft is `003` — the number it keeps on promotion.
  Two files under one number is the ambiguity numbering exists to remove, and a
  tool globbing `migrations/**/*.sql` by filename would have run the user schema
  before the archive tables.
- **Every `CREATE INDEX` is plain here and gains `ASYNC` on promotion.**
  `CREATE INDEX ASYNC` is DSQL-only and a syntax error on stock Postgres, so it
  cannot be written while the file still has to run locally. Each statement
  carries an `ASYNC on DSQL` marker so promotion converts all of them rather
  than some.
- **UNIQUE constraints go INLINE in `CREATE TABLE`**, never as a later
  `CREATE UNIQUE INDEX`. Both engines accept inline; a unique index added to an
  already-created table is not something to assume of DSQL.
- **A change here must keep `../../src/user-schema.test.ts` green.** It applies
  this DDL to a real Postgres (PGlite, in WASM) and exercises every constraint
  in both directions — the only consumer this folder has before W7, and the
  reason an edit cannot drift from what the header claims.
- **Local Postgres proves nothing about DSQL.** It is the subset. The header's
  DSQL DIVERGENCE note plus first contact at promotion is the whole of that
  safety, and anything found to diverge belongs in that note.
- **Open risk: does DSQL accept `USING btree`?** The generated index DDL reads
  `CREATE INDEX name ON table USING btree (cols)`; DSQL's documented form is
  `CREATE INDEX ASYNC name ON table (cols)`, with no method clause either way.
  Nobody has confirmed DSQL accepts `USING btree` — verify before 2026-09-02.
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
  table is corrected in the same commit.
- **Measure against the app, not against the seed.** Both review rounds on the
  draft found the same cause: a claim checked against `src/lib/seed.ts` and
  nowhere else. `schemas.ts`, `TransactionPanel.tsx`, `repository.ts` and
  `core/backup/` all constrain what the migration will actually meet.
