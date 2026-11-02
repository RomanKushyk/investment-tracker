-- 019 — a scheduled deletion, two nullable columns on the user row and the rule that pairs them
-- (#576)
--
-- APPLIED BY `infra/src/migrate.ts`, which names its files rather than globbing
-- them, so this one is enlisted by `MIGRATIONS` and by nothing else.
--
-- THE EXPAND HALF: nothing reads or writes the columns yet, the code being live before the schema
-- (*User schema and deletes*).
--
-- `deletion_due` is the last Kyiv day the deletion can be cancelled, a `date` because it is a
-- calendar day and not an instant; `deletion_requested_at` is when it was asked for, which a
-- sign-in must follow to cancel it. NULL in both is an account no deletion waits on.
--
-- PLAIN AND NULLABLE, because DSQL adds no column with a constraint. `IF NOT EXISTS` because the
-- runner re-sends a statement a crash left open, and `42701` is not a code it absorbs (`010`).
--
-- HAND-WRITTEN, as `018` is: `003` is generated and frozen, and declaring these in
-- `infra/schema/user.ts` would regenerate a different `003`.
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "deletion_due" date;
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "deletion_requested_at" timestamp with time zone;
--> statement-breakpoint
-- A day with no request, or a request with no day, is no scheduled deletion. Added apart from the
-- columns, `NOT VALID` appended by the runner (`006`). Every row already there is NULL in both,
-- so a later UPDATE of one, which stock Postgres re-checks, passes (`infra/docs/dsql-constraints.md`).
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_deletion_ck" CHECK (("deletion_due" IS NULL) = ("deletion_requested_at" IS NULL));
