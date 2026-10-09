-- 010 — a user's data is a dataset, and the user row points at it (W7, #390)
--
-- APPLIED BY `infra/src/migrate.ts`, which names its files rather than globbing
-- them, so this one is enlisted by `MIGRATIONS` and by nothing else.
--
-- THE EXPAND HALF: nothing reads these yet, the code being live before the schema
-- (*User schema and deletes*).
--
-- `(user_id, id)` IS THE KEY, contract 3, and the two pointers name it, so a user
-- can point only at a dataset of their own. `id` ALONE IS UNIQUE as well: DSQL adds
-- a UNIQUE constraint only at create time, and the switch's data tables may name
-- their dataset by its id alone.
--
-- HAND-WRITTEN, as `009` is: `003` is generated and frozen, and declaring this in
-- `infra/schema/user.ts` would regenerate a different `003`.
CREATE TABLE "dataset" (
	"user_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dataset_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "dataset_id_uq" UNIQUE("id"),
	CONSTRAINT "dataset_user_fk" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE restrict
);
--> statement-breakpoint
-- Nullable because DSQL adds no column with a constraint; NULL is a user given no
-- dataset yet. `IF NOT EXISTS` because the runner re-sends a statement a crash
-- left open, and `42701` is not a code it absorbs (`007`'s reasoning); it also
-- silences the runner's refusal of a column this ledger never created.
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "dataset_id" uuid;
--> statement-breakpoint
-- The dataset an import is staging, NULL while none is open (#391).
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "import_dataset_id" uuid;
--> statement-breakpoint
-- RESTRICT, so a dataset a pointer names cannot be collected from under it.
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_dataset_fk" FOREIGN KEY ("user_id","dataset_id") REFERENCES "dataset"("user_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_import_dataset_fk" FOREIGN KEY ("user_id","import_dataset_id") REFERENCES "dataset"("user_id","id") ON DELETE restrict;
