-- 014 — the idempotency keys of `POST /mutations` (W7, #190)
--
-- APPLIED BY `infra/src/migrate.ts`, which names its files rather than globbing
-- them, so this one is enlisted by `MIGRATIONS` and by nothing else.
--
-- THE EXPAND HALF: nothing writes it yet, the code being live before the schema
-- (*User schema and deletes*).
--
-- EVERY RULE IS HERE: DSQL takes a NOT NULL only at create time, and a later CHECK or key only
-- `NOT VALID`. No second index: the sweep reads one user's keys, a range of the primary key.
--
-- HAND-WRITTEN, as `010` is: `003` is generated and frozen.
CREATE TABLE "mutation_key" (
	"user_id" uuid NOT NULL,
	"key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"token" uuid NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"in_progress_until" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"response_status" smallint,
	"response_body" text,
	CONSTRAINT "mutation_key_user_id_key_pk" PRIMARY KEY("user_id","key"),
	CONSTRAINT "mutation_key_fingerprint_ck" CHECK ("mutation_key"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mutation_key_window_ck" CHECK ("mutation_key"."claimed_at" < "mutation_key"."in_progress_until" AND "mutation_key"."in_progress_until" <= "mutation_key"."expires_at"),
	CONSTRAINT "mutation_key_response_ck" CHECK (("mutation_key"."response_status" IS NULL) = ("mutation_key"."response_body" IS NULL)),
	CONSTRAINT "mutation_key_response_status_ck" CHECK ("mutation_key"."response_status" BETWEEN 200 AND 299),
	CONSTRAINT "mutation_key_user_fk" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE restrict
);
