# infra — what `ALTER TABLE` can and cannot do on DSQL, 2026-08-28

> The working behind **D100**. Sibling to
> [`dsql-ddl-first-contact.md`](dsql-ddl-first-contact.md), which measured
> whether the W7 schema *applies*; this one measures whether it can be
> *changed* afterwards. Same method: throwaway schemas on the live cluster,
> dropped `CASCADE` in a `finally`, `public` never on the `search_path`.
>
> Run because **O34** asked whether the user schema should declare foreign
> keys, and that cannot be weighed without knowing whether the answer can be
> revisited. It can — and O34 was ruled on 2026-08-28 (**D101**): W7 ships
> none, and adoption folded into O33 — **which ruled on 2026-09-03 (D137,
> amending D101): the keys ARE adopted, `ON DELETE NO ACTION`.** None of what is
> measured here expires, and this page is what D137 read.
>
> **This page was wrong twice and is corrected below**, both times the same
> way: one spelling probed, the general case asserted. See "How this page was
> wrong". Every row of the matrix is now a statement that was actually sent.

## The matrix

Each row was executed. Nothing here is inferred from a neighbouring row.

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
| `CREATE UNIQUE INDEX ASYNC` on a populated table | **supported, and it builds** — see below |
| `DROP INDEX` on a FAILED async index | **supported** — measured, not assumed; see below |

## What `NOT VALID` actually buys, measured

A constraint added this way **enforces every new row and never checks the ones
already there**. Directly measured: a child row violating the future key was
inserted first, the key was added `NOT VALID` and accepted, and then a *new*
violating insert was refused `23503` while a satisfying one went through.

**And it can never be promoted to validated**, because `VALIDATE CONSTRAINT` is
refused. `pg_constraint.convalidated` reads `false` and stays `false` for the
life of the constraint.

A late foreign key **still carries its referential action**: one added
`ON DELETE CASCADE … NOT VALID` deleted its children when the parent went.

`ALTER COLUMN … SET DEFAULT` behaves the same way without needing the clause:
the default applies to rows inserted after it and leaves existing rows alone.

## What is genuinely create-time-only

Five things, each probed in every spelling this page could think of:

- **`NOT NULL`** — no `ADD COLUMN … NOT NULL` and no `SET NOT NULL`. It can be
  **dropped** (`DROP NOT NULL` works), so the ratchet runs one way.
- **column TYPE** — no `SET DATA TYPE`.
- **`UNIQUE` as a constraint object** — an index substitutes for the
  enforcement, not for the constraint.
- **`PRIMARY KEY`** — refused plain and refused `NOT VALID`. This is the one
  **D30** rests on, and it is now measured rather than taken from the
  cloud-stack spec.
- **a `GENERATED … STORED` column**.

**`DEFAULT` is NOT on this list**, though two earlier rounds of this page and
six other files said it was. See below.

**This list is what was probed, not a closed set.** Untested and therefore
unknown: `EXCLUDE` constraints, `SET SCHEMA`, `SET STORAGE`, changing a
constraint's deferrability, and identity-column changes. A statement absent
from the matrix has no answer here, and "everything else can arrive later"
would be the same overreach this page was written to retract.

## Uniqueness after the fact — the folder's oldest unmeasured caution

`infra/migrations/drafts/README.md` has said since the folder was created that
"adding a unique index to an already-created table is not something to assume
of DSQL." Measured now, on a table already holding rows:

- `CREATE UNIQUE INDEX ASYNC` → job `completed`, `indisvalid = true`, and a
  duplicate insert is then refused `23505`.
- Over data that **already** contains duplicates → job `failed`,
  `details: found duplicate key(s) while validating index uniqueness`, the
  definition is really left behind (`indisvalid = false`), and **`DROP INDEX`
  clears it** — executed, and `pg_class` then holds no such relation. D99
  recorded that recovery as documentation because no job had been made to fail;
  one has now.

So uniqueness IS available after creation — as an index, never as a
`CONSTRAINT`, and only if the data is already unique.

## Foreign keys, measured for the shape THIS schema would need

Recorded so O33 decides on evidence rather than on a summary of it — **it did, on
2026-09-03 (D137), and chose `NO ACTION`**. From D99's
round 3 and this page's rounds 6–7:

- **A composite key on a NULLABLE column behaves as `transaction` needs.** Under
  `MATCH SIMPLE` (the default) a row with `asset_id IS NULL` is not checked, so
  deposits and withdrawals pass while a `buy` pointing at no asset is refused
  `23503`.
- **Self-referential keys work** — `settles_payout_id → transaction(user_id, id)`
  accepted a tax row settling a real payout and refused one pointing at nothing.
- **`ON DELETE CASCADE` deletes**, including on a key added late as `NOT VALID`;
  **`ON DELETE RESTRICT` refuses** (D99 round 3).
- **No index is created per foreign key** — `pg_get_indexdef` on the
  FK-carrying table showed only its primary key.
- **The referenced table must already exist**: `42P01` otherwise.

## The one thing this changes for W7's schema

Drizzle does **not** put foreign keys inside `CREATE TABLE`. Generated from a
scratch copy of `../schema/user.ts` carrying two references, the output is five
`CREATE TABLE`s, then:

```sql
ALTER TABLE "account" ADD CONSTRAINT "account_user_fk" FOREIGN KEY ("user_id")
  REFERENCES "public"."app_user"("user_id") ON DELETE no action ON UPDATE no action;
```

then the `CREATE INDEX` lines. Three consequences:

1. **Promotion would need a THIRD rewrite rule** — append `NOT VALID` to every
   generated `ALTER TABLE … ADD CONSTRAINT`, or DSQL refuses it. (The other two
   are D99's: insert `ASYNC`, strip `USING btree`.)
2. **A drizzle-generated foreign key is `NOT VALID` whether it is declared at
   W7 or years later.** Declaring it now buys no stronger guarantee, because
   the statement is an `ALTER` either way. That removed the only argument for
   answering O34 before promotion — and D101 then answered it the other way, on
   grounds that had nothing to do with a deadline.
3. **The `CREATE TABLE` ordering worry was unfounded.** An earlier round said
   drizzle-kit's alphabetical order puts `account` before `app_user` and would
   break the reference. It does not: the keys are separate statements issued
   after every table exists. Retracted.

The reference is also emitted schema-qualified as `"public"."app_user"`. **That
statement was read, never executed** — the generation was a file-level
experiment, and every probe on this page runs with `public` off the
`search_path`, which is exactly the setup under which a hard-coded `public.`
would resolve somewhere else. So whether it is harmless is UNKNOWN here; it is
recorded as a hard-coded schema name in a generated file, and promotion into
any schema but `public` should treat it as a defect until measured.

## How this page was wrong, twice, the same way

**First** (the round that ran `ALTER TABLE … ADD CONSTRAINT` bare): it sent one
spelling, got `0A000`, tried the same bare spelling for `CHECK` and `UNIQUE`,
got the same error three times, and concluded that **no constraint can ever be
added**. That was published as a rule and as a decision entry before anyone read
the release notes, which had said otherwise for two days: **foreign key
constraints shipped 2026-08-26**, with the `NOT VALID` route named in the same
sentence.

**Second**, in the correction itself: `DEFAULT` was probed only as
`ADD COLUMN … DEFAULT 0` and declared create-time-only on that basis, while
`NOT NULL` was deliberately probed in two spellings and column TYPE in its own.
The conclusion was copied into six files. A code review caught it, and
`ALTER COLUMN … SET DEFAULT` turns out to be **supported** — so a column default
was never create-time-only, and W3/O5 had been told a default was undeferrable
when it is not.

A third claim of the same shape — the `CREATE TABLE` ordering — was retracted
above, inferred from alphabetical output rather than generated and read.

Three instances, one failure: **one spelling measured, the general case
asserted.** Each correction cost a single probe. The matrix above is now
organised by statement rather than by conclusion for that reason — a row exists
only if that exact statement was sent.

**Where to check first, next time:** the DSQL **release notes** page. Twice it
has been ahead of everything else — the FK support this repository recorded as
absent, and the `NOT VALID` route this page recorded as impossible. Two AWS
*blog* posts still say foreign keys are unsupported and show application-level
workarounds; they are behind the release notes, and the migration guide's own
tone lags too.
