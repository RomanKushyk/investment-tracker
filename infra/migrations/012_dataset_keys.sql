-- 012 — the data tables are keyed by a dataset generation (W7, #390)
--
-- APPLIED BY `infra/src/migrate.ts`, which names its files rather than globbing
-- them, so this one is enlisted by `MIGRATIONS` and by nothing else.
--
-- THE SWITCH. DSQL refuses a changed primary key, so `asset`, `transaction` and
-- `user_price` are dropped and created again with `dataset_id` leading every primary
-- key, and every composite key between them carries it, so no row reaches another
-- generation (*User schema and deletes*). Their CHECKs are `003`'s, unchanged.
-- `transaction` keeps `user_id` for its account, which stays the user's, and a
-- key ties that `user_id` to the dataset's owner.
--
-- REFUSED, BEFORE THE FIRST DROP, WHILE ONE OF THE THREE HOLDS A ROW: no deployed
-- code writes them, and this guard checks it once, on whichever cluster runs it. The
-- text cast fails `22P02` naming the reason.
SELECT (CASE WHEN EXISTS (SELECT 1 FROM "asset") OR EXISTS (SELECT 1 FROM "transaction") OR EXISTS (SELECT 1 FROM "user_price") THEN 'a table 012 drops holds rows' ELSE '0' END)::int;
--> statement-breakpoint
-- Child first, as the keys require. `IF EXISTS` so a re-send after a crash passes.
DROP TABLE IF EXISTS "user_price";
--> statement-breakpoint
DROP TABLE IF EXISTS "transaction";
--> statement-breakpoint
DROP TABLE IF EXISTS "asset";
--> statement-breakpoint
CREATE TABLE "asset" (
	"dataset_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"color_slot" smallint NOT NULL,
	"yield_type" text NOT NULL,
	"expected_pct" numeric NOT NULL,
	"target_pct" numeric NOT NULL,
	"payout_schedule" text NOT NULL,
	"first_purchase" date NOT NULL,
	"maturity" date,
	"coupon_amount" numeric,
	"coupon_rate_pct" numeric,
	"next_coupon" date,
	"provider_kind" text,
	"provider_ref" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "asset_dataset_id_id_pk" PRIMARY KEY("dataset_id","id"),
	CONSTRAINT "asset_color_slot_ck" CHECK ("asset"."color_slot" >= 0 AND "asset"."color_slot" < 4),
	CONSTRAINT "asset_code_ck" CHECK (length("asset"."code") = 2),
	CONSTRAINT "asset_expected_pct_ck" CHECK ("asset"."expected_pct" >= 0),
	CONSTRAINT "asset_target_pct_ck" CHECK ("asset"."target_pct" >= 0 AND "asset"."target_pct" <= 100),
	CONSTRAINT "asset_coupon_rate_pct_ck" CHECK ("asset"."coupon_rate_pct" IS NULL OR ("asset"."coupon_rate_pct" > 0 AND "asset"."coupon_rate_pct" <= 100)),
	CONSTRAINT "asset_yield_type_ck" CHECK ("asset"."yield_type" IN ('fixed_coupon', 'dividends', 'capitalization', 'div_cap')),
	CONSTRAINT "asset_payout_schedule_ck" CHECK ("asset"."payout_schedule" IN ('maturity', 'monthly', 'quarterly', 'semiannual', 'none')),
	CONSTRAINT "asset_provider_kind_ck" CHECK ("asset"."provider_kind" IN ('fund', 'bond')),
	CONSTRAINT "asset_provider_pair_ck" CHECK (("asset"."provider_kind" IS NULL) = ("asset"."provider_ref" IS NULL)),
	CONSTRAINT "asset_dataset_fk" FOREIGN KEY ("dataset_id") REFERENCES "dataset"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"dataset_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"type" text NOT NULL,
	"amount" numeric NOT NULL,
	"asset_id" uuid,
	"quantity" numeric,
	"unit_price" numeric,
	"tax_withheld" numeric,
	"note" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "transaction_dataset_id_id_pk" PRIMARY KEY("dataset_id","id"),
	CONSTRAINT "transaction_type_ck" CHECK ("transaction"."type" IN ('deposit', 'withdrawal', 'buy', 'sell', 'dividend_payout',
        'interest_payout', 'reinvest', 'redemption')),
	CONSTRAINT "transaction_amount_ck" CHECK ("transaction"."amount" > 0),
	CONSTRAINT "transaction_quantity_sign_ck" CHECK ("transaction"."quantity" IS NULL OR "transaction"."quantity" > 0),
	CONSTRAINT "transaction_unit_price_ck" CHECK ("transaction"."unit_price" IS NULL OR "transaction"."unit_price" > 0),
	CONSTRAINT "transaction_quantity_absent_ck" CHECK ("transaction"."type" IN ('buy', 'sell', 'reinvest', 'redemption') OR "transaction"."quantity" IS NULL),
	CONSTRAINT "transaction_quantity_required_ck" CHECK ("transaction"."type" NOT IN ('buy', 'sell', 'reinvest', 'redemption') OR "transaction"."quantity" IS NOT NULL),
	CONSTRAINT "transaction_unit_price_absent_ck" CHECK ("transaction"."type" IN ('buy', 'sell', 'reinvest', 'redemption') OR "transaction"."unit_price" IS NULL),
	CONSTRAINT "transaction_tax_absent_ck" CHECK ("transaction"."type" IN ('dividend_payout', 'interest_payout') OR "transaction"."tax_withheld" IS NULL),
	CONSTRAINT "transaction_tax_sign_ck" CHECK ("transaction"."tax_withheld" IS NULL OR "transaction"."tax_withheld" > 0),
	CONSTRAINT "transaction_tax_bound_ck" CHECK ("transaction"."tax_withheld" IS NULL OR "transaction"."tax_withheld" < "transaction"."amount"),
	CONSTRAINT "transaction_note_ck" CHECK ("transaction"."note" IS NULL OR ("transaction"."note" !~ '^[[:space:]]*$' AND length("transaction"."note") <= 100)),
	CONSTRAINT "transaction_asset_absent_ck" CHECK ("transaction"."type" NOT IN ('deposit', 'withdrawal') OR "transaction"."asset_id" IS NULL),
	CONSTRAINT "transaction_asset_present_ck" CHECK ("transaction"."type" NOT IN ('buy', 'sell', 'reinvest', 'redemption', 'dividend_payout',
        'interest_payout') OR "transaction"."asset_id" IS NOT NULL),
	CONSTRAINT "transaction_dataset_fk" FOREIGN KEY ("user_id","dataset_id") REFERENCES "dataset"("user_id","id") ON DELETE restrict,
	CONSTRAINT "transaction_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "account"("user_id","id") ON DELETE restrict,
	CONSTRAINT "transaction_asset_fk" FOREIGN KEY ("dataset_id","asset_id") REFERENCES "asset"("dataset_id","id") ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE "user_price" (
	"dataset_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"price" numeric NOT NULL,
	"observed_at" timestamp with time zone,
	CONSTRAINT "user_price_dataset_id_asset_id_as_of_pk" PRIMARY KEY("dataset_id","asset_id","as_of"),
	CONSTRAINT "user_price_price_ck" CHECK ("user_price"."price" > 0),
	CONSTRAINT "user_price_asset_fk" FOREIGN KEY ("dataset_id","asset_id") REFERENCES "asset"("dataset_id","id") ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX "asset_dataset_created" ON "asset" USING btree ("dataset_id","created_at");
--> statement-breakpoint
CREATE INDEX "transaction_dataset_date" ON "transaction" USING btree ("dataset_id","date");
