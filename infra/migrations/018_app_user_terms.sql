-- 018 — the terms an account accepted, two nullable columns on the user row and the rule that
-- pairs them (#515)
--
-- APPLIED BY `infra/src/migrate.ts`, which names its files rather than globbing
-- them, so this one is enlisted by `MIGRATIONS` and by nothing else.
--
-- THE EXPAND HALF: nothing reads or writes the columns yet, the code being live before the schema
-- (*User schema and deletes*).
--
-- `date`, NOT `text`: the version is the terms' effective date, and a column's type is an
-- alteration DSQL cannot make later. NULL is an account that accepted no version.
--
-- PLAIN AND NULLABLE, because DSQL adds no column with a constraint. `IF NOT EXISTS` because the
-- runner re-sends a statement a crash left open, and `42701` is not a code it absorbs (`010`).
--
-- HAND-WRITTEN, as `016` is: `003` is generated and frozen, and declaring these in
-- `infra/schema/user.ts` would regenerate a different `003`.
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "terms_version" date;
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamp with time zone;
--> statement-breakpoint
-- A version with no time, or a time with no version, is no record of acceptance. Added apart from
-- the columns, `NOT VALID` appended by the runner (`006`). Every row already there is NULL in both,
-- so a later UPDATE of one, which stock Postgres re-checks, passes (`infra/docs/dsql-constraints.md`).
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_terms_ck" CHECK (("terms_version" IS NULL) = ("terms_accepted_at" IS NULL));
