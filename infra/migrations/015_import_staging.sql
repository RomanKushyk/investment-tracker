-- 015 — what a staged import records beside its generation (W7, #391)
--
-- APPLIED BY `infra/src/migrate.ts`, which names its files rather than globbing
-- them, so this one is enlisted by `MIGRATIONS` and by nothing else.
--
-- THE EXPAND HALF: nothing writes either table yet, the code being live before the schema
-- (*User schema and deletes*).
--
-- `import_manifest` is the begin's promise: the rows each table will hold and the digest of the
-- parts, and when the import last took a part. `import_part` is one staged part's number and the
-- digest of its body, keyed to its manifest, so no part outlives or precedes the begin.
--
-- EVERY RULE IS HERE: DSQL takes a NOT NULL only at create time, and a later CHECK or key only
-- `NOT VALID`. A digest is a SHA-256 in canonical base64, as `Content-Digest` carries it: 32 bytes
-- end in a character whose two spare bits are zero. Part numbers run from 1 to 10,000, as S3's do.
--
-- HAND-WRITTEN, as `010` is: `003` is generated and frozen.
CREATE TABLE "import_manifest" (
	"dataset_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"assets" integer NOT NULL,
	"transactions" integer NOT NULL,
	"prices" integer NOT NULL,
	"staged_at" timestamp with time zone NOT NULL,
	CONSTRAINT "import_manifest_dataset_id_pk" PRIMARY KEY("dataset_id"),
	CONSTRAINT "import_manifest_digest_ck" CHECK ("import_manifest"."digest" ~ '^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$'),
	CONSTRAINT "import_manifest_counts_ck" CHECK ("import_manifest"."assets" >= 0 AND "import_manifest"."transactions" >= 0 AND "import_manifest"."prices" >= 0),
	CONSTRAINT "import_manifest_dataset_fk" FOREIGN KEY ("dataset_id") REFERENCES "dataset"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "import_part" (
	"dataset_id" uuid NOT NULL,
	"part" integer NOT NULL,
	"digest" text NOT NULL,
	CONSTRAINT "import_part_dataset_id_part_pk" PRIMARY KEY("dataset_id","part"),
	CONSTRAINT "import_part_part_ck" CHECK ("import_part"."part" BETWEEN 1 AND 10000),
	CONSTRAINT "import_part_digest_ck" CHECK ("import_part"."digest" ~ '^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$'),
	CONSTRAINT "import_part_manifest_fk" FOREIGN KEY ("dataset_id") REFERENCES "import_manifest"("dataset_id") ON DELETE restrict
);
