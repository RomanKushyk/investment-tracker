# infra — DSQL DDL constraints

Every fact below was sent to the live `eu-north-1` cluster, inside a throwaway
schema dropped `CASCADE` in a `finally` — never inferred from AWS's own
documentation, which the "reason is not the one the grammar suggested" note
below exists to explain.

## Indexes

- **`USING btree` is REFUSED**, with or without `ASYNC` —
  `0A000 USING not supported for CREATE INDEX`.
- **A `CREATE INDEX` without `ASYNC` is REFUSED** —
  `0A000 unsupported mode. please use CREATE INDEX ASYNC.`
- **`USING` is accepted with DSQL's own access-method name, `btree_index`** —
  and `pg_am` holds all nine of `brin, btree, btree_index, btree_table, gin,
  gist, hash, heap, spgist`, so `btree` exists as a catalog row and is still
  refused as an index method: the rejection is a whitelist of one, not an
  unknown identifier. Promotion omits the clause rather than switching to
  `btree_index`, which is DSQL-only and breaks the PGlite test the generated
  file also has to satisfy.
- **`DESC` in an index key is refused** — "specifying sort order not
  supported for index keys".
- **Promoting a generated migration rewrites every index line TWICE — insert
  `ASYNC`, strip `USING btree` — uniformly or not at all.** Neither edit can
  live in the generated file: `ASYNC` is a syntax error on stock Postgres,
  and `USING btree` is what the PGlite test applies. So
  `CREATE INDEX "x" ON "t" USING btree ("a","b")` is sent as
  `CREATE INDEX ASYNC "x" ON "t" ("a","b")`.
- **An accepted `CREATE INDEX ASYNC` is not a built index.** It returns a
  `job_id`; `sys.wait_for_job` is a PROCEDURE (`CALL sys.wait_for_job(job_id)`,
  not `SELECT`, which fails `42809`), after which `sys.jobs.status` reads
  `completed` and `pg_index.indisvalid` turns true. A job that ends `failed`
  leaves the definition behind `INVALID`, and AWS does not clean it up —
  `DROP INDEX` on a failed async index is what removes it.
- **`CREATE UNIQUE INDEX ASYNC` on an already-populated table builds and
  enforces** — `23505` on a duplicate insert once it completes. Over data
  that already holds duplicates the job ends `failed`, leaving an `INVALID`
  definition; `DROP INDEX` clears it. So uniqueness enforcement CAN be added
  after creation — as an index, never as a `CONSTRAINT` (see the matrix
  below) — and only if the data is already unique.
- **No index is created per foreign key.** `pg_get_indexdef` on an
  FK-carrying table shows only its primary key.
- **A primary key reads back `INCLUDE`-ing every non-key column**
  (`pg_get_indexdef`) — DSQL's index-organized storage. Observed on two
  tables, not asserted as universal.

## `ALTER TABLE` — the create-time-only matrix

Each row was executed; nothing here is inferred from a neighbouring row.

| Statement | DSQL |
|---|---|
| `ADD CONSTRAINT … FOREIGN KEY … NOT VALID` | **supported** |
| `ADD CONSTRAINT … CHECK … NOT VALID` | **supported** |
| `ADD CONSTRAINT …` **without** `NOT VALID` | refused — `0A000 unsupported ALTER TABLE ADD CONSTRAINT statement` |
| `ADD CONSTRAINT … UNIQUE … NOT VALID` | refused — `0A000 UNIQUE constraints cannot be marked NOT VALID` |
| `ADD CONSTRAINT … PRIMARY KEY` | refused — plain, and `NOT VALID` too: `0A000 PRIMARY KEY constraints cannot be marked NOT VALID` |
| `VALIDATE CONSTRAINT` | refused — `0A000 unsupported ALTER TABLE VALIDATE CONSTRAINT statement` |
| `DROP CONSTRAINT` (CHECK, UNIQUE, FOREIGN KEY) | supported |
| `ADD COLUMN`, plain and nullable | supported |
| `ADD COLUMN … DEFAULT 0` / `NOT NULL` / `CHECK (…)` / `GENERATED … STORED` | refused — `0A000 ALTER TABLE ADD COLUMN with constraint not supported` |
| `ALTER COLUMN … SET DEFAULT` | **supported** — and it takes effect: a row inserted afterwards got the new default, a row already there kept its `NULL` |
| `ALTER COLUMN … DROP DEFAULT` | supported |
| `ALTER COLUMN … SET NOT NULL` | refused — `0A000 unsupported ALTER TABLE ALTER COLUMN … SET NOT NULL statement` |
| `ALTER COLUMN … DROP NOT NULL` | supported |
| `ALTER COLUMN … TYPE` | refused — `0A000 unsupported ALTER TABLE ALTER COLUMN … SET DATA TYPE statement` |
| `DROP COLUMN`, `RENAME COLUMN`, `RENAME TO` | supported |
| `CREATE UNIQUE INDEX ASYNC` on a populated table | **supported, and it builds** — see Indexes above |
| `DROP INDEX` on a FAILED async index | **supported** — see Indexes above |

**Genuinely create-time-only, each probed in every spelling this page could
think of:** `NOT NULL` (droppable via `DROP NOT NULL`, never addable), a
column's TYPE, `UNIQUE` as a constraint object (an index substitutes for the
enforcement, not for the constraint), `PRIMARY KEY` (refused plain and
refused `NOT VALID`), and a `GENERATED … STORED` column. **`DEFAULT` is NOT on
this list** — `ALTER COLUMN … SET DEFAULT` is supported. This list is what was
probed, not a closed set: `EXCLUDE` constraints, `SET SCHEMA`, `SET STORAGE`,
deferrability changes and identity-column changes have no answer here.

## What `NOT VALID` actually buys

A constraint added this way **enforces every new row and never checks the
ones already there** — a child row violating a future key was inserted
first, the key was added `NOT VALID` and accepted, and a new violating insert
was then refused `23503` while a satisfying one went through. **It can never
be promoted to validated**: `VALIDATE CONSTRAINT` is refused, and
`pg_constraint.convalidated` stays `false` for the life of the constraint. A
late foreign key still carries its referential action — one added
`ON DELETE CASCADE … NOT VALID` deletes its children when the parent goes.
`ALTER COLUMN … SET DEFAULT` behaves the same way without needing the
clause: it applies to rows inserted after it and leaves existing rows alone.

## Foreign keys

DSQL has foreign keys. A composite key — the shape this schema needs, since
every table here is keyed `(user_id, id)` — is written:

```sql
CONSTRAINT "child_parent_fk" FOREIGN KEY ("user_id","parent_id")
  REFERENCES "parent" ("user_id","id") ON DELETE RESTRICT
```

Accepted, and enforced in both directions: a child row pointing at nothing
gives `23503`, and deleting a referenced parent gives `23503` naming the
child table. `pg_get_constraintdef` reads it back unchanged.

- **The referenced table must already exist** — `42P01` otherwise.
- **A composite key on a NULLABLE column is not checked when that column is
  NULL**, under `MATCH SIMPLE` (the default).
- **Self-referential keys work**, enforced both ways.
- **`ON DELETE CASCADE` deletes**, including on a key added late as
  `NOT VALID`; **`ON DELETE RESTRICT` refuses** — measured INLINE, inside a
  `CREATE TABLE`, not yet in the post-hoc `ALTER TABLE … ADD CONSTRAINT` form
  drizzle emits.
- **Drizzle emits a foreign key as a post-hoc `ALTER TABLE … ADD CONSTRAINT`,
  never inside `CREATE TABLE`.** Promotion must append `NOT VALID` to every
  one of these, or DSQL refuses it — a third rewrite rule, alongside `ASYNC`
  and stripping `USING btree` above.
- This schema's keys are declared `ON DELETE RESTRICT`, never cascading —
  see `docs/DECISIONS.md`, **User schema and deletes**.

## `003_user_schema.sql` against the live cluster

All seven statements, verbatim except the two index lines, ran clean:
5 tables with one primary key each, 4 composite (`app_user` keys on
`user_id` alone), named `CONSTRAINT`s throughout, 3 `UNIQUE`s, 23 `CHECK`s,
one `DEFAULT 0`, and the types `uuid`, `text`, `numeric` (unqualified),
`smallint`, `bigint`, `date`, `timestamptz`.

The constraints are enforced, not merely accepted:

| Attempted | Result |
|---|---|
| `status = 'bogus'` | `23514` — `app_user_status_ck` |
| `role = 'root'` | `23514` — `app_user_role_ck` |
| `status = 'pending'` with `decided_at` set | `23514` — `app_user_decided_ck` |
| a second row with an existing `email` | `23505` — `app_user_email_uq` |
| a row omitting `data_version` | `DEFAULT 0` landed |
