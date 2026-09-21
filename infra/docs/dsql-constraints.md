# infra — DSQL DDL constraints

Every fact below was sent to a live cluster in `eu-north-1`, most by hand into a throwaway schema
dropped `CASCADE` in a `finally`, never inferred from AWS's documentation. **Where that is not true
the line says so in its own words** — a claim measured on PGlite, on stock Postgres or read from AWS
is worth recording when code depends on it, but it is not an answer from a cluster and must never be
left looking like one. **"The cluster" is not one thing:** user data is one cluster per environment,
so a fact from `dev` does not automatically hold for `prod` and the line names which where it
matters; the `006` facts below were taken on `public` itself, a constraint applied by the runner
being no probe that cleans up after itself.

## Indexes

- **`USING btree` is REFUSED**, with or without `ASYNC` — `0A000 USING not supported for CREATE
  INDEX`.
- **A `CREATE INDEX` without `ASYNC` is REFUSED** — `0A000 unsupported mode. please use CREATE INDEX
  ASYNC.`
- **`USING` is accepted with DSQL's own access-method name, `btree_index`** — and `pg_am` holds all
  nine of `brin, btree, btree_index, btree_table, gin, gist, hash, heap, spgist`, so `btree` exists
  as a catalog row and is still refused as an index method: the rejection is a whitelist of one, not
  an unknown identifier. Promotion omits the clause rather than switching to `btree_index`, which is
  DSQL-only and breaks the PGlite test the generated file also has to satisfy.
- **`DESC` in an index key is refused** — "specifying sort order not supported for index keys".
- **Promoting a generated migration rewrites every index line TWICE — insert `ASYNC`, strip `USING
  btree` — uniformly or not at all.** Neither edit can live in the generated file: `ASYNC` is a
  syntax error on stock Postgres, and `USING btree` is what the PGlite test applies. So `CREATE
  INDEX "x" ON "t" USING btree ("a","b")` is sent as `CREATE INDEX ASYNC "x" ON "t" ("a","b")`.
- **An accepted `CREATE INDEX ASYNC` is not a built index.** It returns a `job_id`;
  `sys.wait_for_job` is a PROCEDURE (`CALL sys.wait_for_job(job_id)`, not `SELECT`, which fails
  `42809`), after which `sys.jobs.status` reads `completed` and `pg_index.indisvalid` turns true. A
  job that ends `failed` leaves the definition behind `INVALID`, and AWS does not clean it up —
  `DROP INDEX` on a failed async index is what removes it.
- **`CREATE UNIQUE INDEX ASYNC` on an already-populated table builds and enforces** — `23505` on a
  duplicate insert once it completes. Over data that already holds duplicates the job ends `failed`,
  leaving an `INVALID` definition; `DROP INDEX` clears it. So uniqueness enforcement CAN be added
  after creation — as an index, never as a `CONSTRAINT` (see the matrix below) — and only if the
  data is already unique.
- **No index is created per foreign key.** `pg_get_indexdef` on an FK-carrying table shows only its
  primary key.
- **A primary key reads back `INCLUDE`-ing every non-key column** (`pg_get_indexdef`) — DSQL's
  index-organized storage. Observed on two tables, not asserted as universal.

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

**Genuinely create-time-only, each probed in every spelling this page could think of:** `NOT NULL`
(droppable via `DROP NOT NULL`, never addable), a column's TYPE, `UNIQUE` as a constraint object (an
index substitutes for the enforcement, not for the constraint), `PRIMARY KEY` (refused plain and
refused `NOT VALID`), and a `GENERATED … STORED` column. **`DEFAULT` is NOT on this list** — `ALTER
COLUMN … SET DEFAULT` is supported. This list is what was probed, not a closed set: `EXCLUDE`
constraints, `SET SCHEMA`, `SET STORAGE`, deferrability changes and identity-column changes have no
answer here.

## What `NOT VALID` actually buys

A constraint added this way **enforces every new row and does not scan the ones already there** — a
child row violating a future key was inserted first, the key was added `NOT VALID` and accepted, and
a new violating insert was then refused `23503` while a satisfying one went through. **It can never
be promoted to validated**: `VALIDATE CONSTRAINT` is refused, and `pg_constraint.convalidated` stays
`false` for the life of the constraint, read back as `false` on `app_user_email_lower_ck` right
after `006` applied, on both clusters. That reading is one instant; the refusal is what leaves
nothing that could flip it.

**Both probes above cover INSERT, and a row already there is not the same as a row left alone.**
Nothing above says what happens on a later UPDATE of a row that predates the constraint. On stock
Postgres it is re-checked, whichever column is written, which would make such a row unupdatable
rather than tolerated — measured on PGlite, never sent to a cluster.
`migrations/006_email_lower.sql` records the same gap and is written so the answer cannot change it:
the only row it meets is `005`'s, already lower-cased — which is reasoning from what writes this
table, not a cluster reading.

A late foreign key still carries its referential action — one added `ON DELETE CASCADE … NOT VALID`
deletes its children when the parent goes. `ALTER COLUMN … SET DEFAULT` behaves the same way without
needing the clause: it applies to rows inserted after it and leaves existing rows alone.

## Foreign keys

**A `NOT VALID` foreign key still blocks a `DROP TABLE` on its target.** Not being validated buys
nothing here: the dependency is what the drop refuses on, so a table another table references cannot
go until the referencing table has. Dropping the user schema by hand therefore runs child-first —
`user_price`, `transaction`, `asset`, `account`, `app_user` — which is the same order
`src/asset-delete.ts` walks for the same reason, and the reverse of the order `003_user_schema.sql`
creates them in.

DSQL has foreign keys. A composite key — the shape this schema needs, since every table here is
keyed `(user_id, id)` — is written:

```sql
CONSTRAINT "child_parent_fk" FOREIGN KEY ("user_id","parent_id")
  REFERENCES "parent" ("user_id","id") ON DELETE RESTRICT
```

Accepted, and enforced in both directions: a child row pointing at nothing gives `23503`, and
deleting a referenced parent gives `23503` naming the child table. `pg_get_constraintdef` reads it
back unchanged.

- **The referenced table must already exist** — `42P01` otherwise.
- **A composite key on a NULLABLE column is not checked when that column is NULL**, under `MATCH
  SIMPLE` (the default).
- **Self-referential keys work**, enforced both ways.
- **`ON DELETE CASCADE` deletes**, including on a key added late as `NOT VALID`; **`ON DELETE
  RESTRICT` refuses** — and now measured in the shape this schema actually ships, not only inline
  inside a `CREATE TABLE`. Sent as `ALTER TABLE child ADD CONSTRAINT … FOREIGN KEY (user_id,
  parent_id) REFERENCES parent (user_id, id) ON DELETE restrict ON UPDATE no action NOT VALID`, it
  is accepted, reads back `ON DELETE RESTRICT NOT VALID` with `convalidated = false`, and **enforces
  both directions anyway**: an orphan insert is `23503` and deleting the referenced parent is
  `23503`. `NOT VALID` buys exemption for rows already there, never for the constraint's behaviour.
- **A NULL member is unchecked**, MATCH SIMPLE — which is what makes `transaction.asset_id` nullable
  and the `deposit`/`withdrawal` pair legal under `transaction_asset_fk`.
- **Drizzle emits a foreign key as a post-hoc `ALTER TABLE … ADD CONSTRAINT`, never inside `CREATE
  TABLE`.** Promotion must append `NOT VALID` to every one of these, or DSQL refuses it — a third
  rewrite rule, alongside `ASYNC` and stripping `USING btree` above.
- **AND IT HARD-CODES THE TARGET'S SCHEMA — `REFERENCES "public"."app_user"(…)` — which is a FOURTH
  rewrite rule, not a cosmetic one.** A qualified name ignores `search_path`. Sent from inside a
  throwaway schema the cluster answers `42P01 relation "public.parent" does not exist`; on a cluster
  where `public` IS populated the same statement succeeds and silently builds the constraint against
  the real table, which a rehearsal then drops the referencing side out from under. Promotion strips
  the qualifier, so the key resolves through `search_path` and the file can be applied into any
  schema.
- **The key-set batching form is accepted**: `DELETE FROM child WHERE (user_id, id) IN (SELECT
  user_id, id FROM child WHERE user_id = $1 LIMIT $2)` deletes exactly the limit. That is the shape
  the application cascade needs, since Postgres accepts no `LIMIT` on a `DELETE`.
- This schema's keys are declared `ON DELETE RESTRICT`, never cascading — see `docs/DECISIONS.md`,
  **User schema and deletes**.

## `003_user_schema.sql` against the live cluster

Every statement ran clean, verbatim except the index lines. What that establishes is the SHAPE the
file uses, each element of which DSQL accepted: composite primary keys, named `CONSTRAINT`s
throughout, `UNIQUE` and `CHECK` inline in `CREATE TABLE`, a column `DEFAULT`, and the types `uuid`,
`text`, `numeric` (unqualified), `smallint`, `bigint`, `date`, `timestamptz`.

No constraint counts here: the file is `infra/migrations/003_user_schema.sql` and its statement
count is pinned in `infra/src/migrate.test.ts`, which is where a figure belongs.

The constraints are enforced, not merely accepted:

| Attempted | Result |
|---|---|
| `status = 'bogus'` | `23514` — `app_user_status_ck` |
| `role = 'root'` | `23514` — `app_user_role_ck` |
| `status = 'pending'` with `decided_at` set | `23514` — `app_user_decided_ck` |
| a second row with an existing `email` | `23505` — `app_user_email_uq` |
| a row omitting `data_version` | `DEFAULT 0` landed |

## The migration runner against the live cluster

Throwaway schemas on a user cluster, dropped `CASCADE` when the run ends — when the drop goes
through, which is not every time. The runner does that cleanup outside any `finally`, so a drop that
fails cannot replace the statement failure a rehearsal was run to find.

**`006_email_lower.sql` is the first `ADD CONSTRAINT … CHECK` the `NOT VALID` rewrite has sent, and
both clusters took it.** Applied to `public` on dev and then prod, `pg_constraint` held
`app_user_email_lower_ck` with `convalidated` `false`, and an address with a capital in it was
refused `23514` naming that constraint while the lower-cased form went through. So the third rewrite
rule is exercised end to end against a CHECK; the fourth is untouched, `006` having no `REFERENCES`.

**A rehearsal can apply every statement and still fail in the teardown.** A dev rehearsal did, where
prod's completed: every statement applied inside its `migrate_rehearsal_…` schema, then `DROP SCHEMA
… CASCADE` answered `change conflicts with another transaction (OC000)`, SQLSTATE **`40001`** — the
serialization class rather than a refusal, which the hand drop then confirmed by succeeding on the
first attempt. A plausible source of the conflict is that `003` ends with two `CREATE INDEX ASYNC`
jobs and a waited-for job is not the same as a settled catalog; that was not isolated, and prod did
not reproduce it.

`DROP SCHEMA IF EXISTS … CASCADE` is **supported**, on a schema that is there and on one that is not
— both executed against the dev cluster, neither leaving anything behind. The runner's teardown uses
it, because a conflict is the client's view and not the cluster's: an attempt can commit and still
answer `40001`, and a bare `DROP SCHEMA` on the retry then answers `3F000`, which is a refusal
rather than contention and would be reported as a schema still to drop.

**The runner retries that drop on `40001` with a bounded backoff, and reports rather than raises
when it still will not go.** A statement that was refused is what a rehearsal is run to find and
still raises; a teardown that failed is not a finding, and a raise would read as one. So a rehearsal
that applied cleanly and could not drop its schema RESOLVES carrying a `teardown` key — the schema's
name, whether it went, the attempt count, the driver's message, and the SQLSTATE where the server
gave one — and `.github/actions/invoke-migration`, which both the deploy and a dispatch go through, fails the run on that key and echoes the name. A schema orphaned by a
run that raises for another reason is named in the raised message instead, a Lambda error payload
carrying `errorType`, `errorMessage` and `trace` and no more. Either way the name reaches the run
page without opening CloudWatch.

`003_user_schema.sql` and `005_demo_user.sql` applied clean through the runner, rewrite rules and
all, with both `CREATE INDEX ASYNC` jobs waited on via `CALL sys.wait_for_job` and both indexes
present in `pg_indexes` afterwards. A second pass over the same schema applied nothing and skipped
everything — the property #47 depends on, since it appends `ALTER TABLE … ADD CONSTRAINT` statements
to a file already applied.

**`INSERT … ON CONFLICT (col) DO NOTHING` is supported**, and a conflicting insert reports
`rowCount: 0` rather than raising. A violation of a DIFFERENT unique constraint still raises
`23505`, and the error carries `constraint` with the offending name — which is what lets `005` be
re-runnable without the runner having to absorb a code that could have come from anywhere.

**That clause does not exempt an insert from adjudication** — READ FROM AWS, not measured here.
Aurora DSQL's optimistic concurrency control marks INSERT × INSERT on the same row as conflicting
and reports it as `40001` at COMMIT, and AWS's own advice is that OCC makes an application exercise
retry logic MORE often, not less
(https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-concurrency-control.html).
So the clause prevents a duplicate ROW and not a serialization failure. Whether the suppressed path
skips adjudication is unconfirmed in either direction, which is why `infra/src/provision.ts` wraps
its transaction in a bounded retry regardless.

**The conflict target that provisions an account is UNMEASURED.** The suppression above was probed
on a PRIMARY KEY; `ON CONFLICT (user_id, provider)` names the secondary unique index
`account_user_provider_uq`, which no probe has covered. So the RAISED `23505` is kept as a live
branch there, matched on the constraint name, exactly as `applications.ts` keeps one for
`app_user_email_uq`. `008_demo_account.sql` avoids the doubt instead of carrying it: its account id
is a literal, so it conflicts on the primary key — the target this file did measure.

**`RETURNING` ON A SUPPRESSED `ON CONFLICT` IS UNMEASURED, and nothing here depends on it.**
`RETURNING` on its own IS sent to the cluster — `asset-delete.ts` on every child batch, `approve.ts`
on the reject — but no probe has asked what an insert a conflict swallowed returns, and `migrate.ts`
keeps the clause off `BOOTSTRAP_ROW` saying so. That it is a Postgres guarantee is not an answer
from a cluster. So `infra/src/provision.ts` tells a performed insert from a suppressed one with a
`SELECT` inside the same transaction rather than with the returned rows. That does not make the
transaction fully measured — the conflict target above is still one no probe has covered, which is
why the raised `23505` branch stays — but it removes a SECOND unmeasured thing from the path, at the
price of one statement. Both are worth probing when a cluster is next open by hand.

`pg_index.indisvalid` is readable and true for a built index. It is **not** enough on its own: it is
false for a build that FAILED and false for one still RUNNING, and those want opposite advice — one
wants `DROP INDEX`, the other wants waiting.

**`sys.jobs` separates them, and can be found without the job id**, which is what a crashed run
takes with it. Columns: `job_id, status, details, job_type, class_id, object_id, object_name,
start_time, update_time`. A `CREATE INDEX ASYNC` writes `job_type = 'INDEX_BUILD'` with
`object_name` set to `schema.index` — so the job is reachable by name — and `status` moves
`submitted` → `completed`. `CALL sys.wait_for_job(job_id)` on a job found that way resumes exactly
what the killed invocation was waiting for.

**The SQLSTATEs for a statement whose object is already there**, which is what the runner's
crash-window absorption turns on and which local Postgres could not be trusted to answer (`RESTRICT`
already differs by engine, above):

| Re-sent | DSQL |
|---|---|
| `CREATE TABLE` on an existing table | `42P07` |
| `CREATE INDEX ASYNC` on an existing index | `42P07` — a *relation*, not `42710` |
| `INSERT` re-inserting a primary key | `23505` |

The index case is the one worth knowing: an already-built index reports as a duplicate RELATION, so
a runner that only absorbed `42710` there would fail on exactly the retry it exists to serve.

## Transactions

**A multi-statement DML transaction is accepted and commits.** `infra/src/provision.ts` wraps three
DML statements in one transaction — `BEGIN`, the caller's own `INSERT … ON CONFLICT DO NOTHING`, a
`SELECT`, its own `INSERT … ON CONFLICT DO NOTHING`, `COMMIT` — and it ran against the **dev**
cluster through `migrate.yml` in `bootstrap` mode.

**[Run 35599249065] is the evidence, and it is one run, not two.** It reported
`{"identity":"existing","row":"existing","account":"created"}`, and `created` is reachable only
after `COMMIT` resolved, so that transaction committed and the account row was there afterwards.
[Run 35599318279] reported `account: existing` on the re-run, which proves nothing about committing:
`existing` is returned both after a `COMMIT` and after a `ROLLBACK` in the caught-duplicate arm.

**So the one-statement rule is about DDL and only DDL.** `infra/README.md` states it with the scope
in it — "One DDL statement per transaction, and DDL never shares a transaction with DML" — and that
is the form to repeat. Dropped, the sentence forbids what the run above did.
`infra/src/transaction-scope.test.ts` walks `.github`, `docs`, `infra` and `src` and holds every
copy of that spelling to the qualified form. It matches one spelling family, and the comment on the
pattern says which — the rule's other live wording here, `one DDL per transaction`, is outside it.

**What those runs did NOT separate, and must not be read as measuring.** A `bootstrap` re-run
answers `account: existing` whether the `ON CONFLICT (user_id, provider) DO NOTHING` suppressed
cleanly or raised `23505` and `provision.ts`'s constraint-named branch caught it — both arms return
the same word, and neither is logged. The secondary-index conflict target above therefore stays
UNMEASURED, as does `RETURNING` on a suppressed insert. Separating them needs a hand-run against a
cluster, not another dispatch.

[run 35599249065]: https://github.com/RomanKushyk/investment-tracker/actions/runs/35599249065
[run 35599318279]: https://github.com/RomanKushyk/investment-tracker/actions/runs/35599318279
