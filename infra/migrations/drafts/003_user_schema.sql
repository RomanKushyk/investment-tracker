CREATE TABLE "account" (
	"user_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "account_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "account_user_provider_uq" UNIQUE("user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"status" text NOT NULL,
	"role" text NOT NULL,
	"data_version" bigint DEFAULT 0 NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	CONSTRAINT "app_user_user_id_pk" PRIMARY KEY("user_id"),
	CONSTRAINT "app_user_email_uq" UNIQUE("email"),
	CONSTRAINT "app_user_status_ck" CHECK ("app_user"."status" IN ('pending', 'active', 'rejected')),
	CONSTRAINT "app_user_role_ck" CHECK ("app_user"."role" IN ('user', 'super_admin')),
	CONSTRAINT "app_user_decided_ck" CHECK (("app_user"."status" = 'pending') = ("app_user"."decided_at" IS NULL AND "app_user"."decided_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "asset" (
	"user_id" uuid NOT NULL,
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
	"reinvest_policy" text,
	"provider_kind" text,
	"provider_ref" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "asset_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "asset_color_slot_ck" CHECK ("asset"."color_slot" >= 0 AND "asset"."color_slot" < 4),
	CONSTRAINT "asset_code_ck" CHECK (length("asset"."code") = 2),
	CONSTRAINT "asset_expected_pct_ck" CHECK ("asset"."expected_pct" >= 0),
	CONSTRAINT "asset_target_pct_ck" CHECK ("asset"."target_pct" >= 0 AND "asset"."target_pct" <= 100),
	CONSTRAINT "asset_coupon_rate_pct_ck" CHECK ("asset"."coupon_rate_pct" IS NULL OR ("asset"."coupon_rate_pct" > 0 AND "asset"."coupon_rate_pct" <= 100)),
	CONSTRAINT "asset_yield_type_ck" CHECK ("asset"."yield_type" IN ('fixed_coupon', 'dividends', 'capitalization', 'div_cap')),
	CONSTRAINT "asset_payout_schedule_ck" CHECK ("asset"."payout_schedule" IN ('maturity', 'monthly', 'quarterly', 'semiannual', 'none')),
	CONSTRAINT "asset_provider_kind_ck" CHECK ("asset"."provider_kind" IN ('fund', 'bond')),
	CONSTRAINT "asset_provider_pair_ck" CHECK (("asset"."provider_kind" IS NULL) = ("asset"."provider_ref" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"user_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"type" text NOT NULL,
	"amount" numeric NOT NULL,
	"asset_id" uuid,
	"quantity" numeric,
	"unit_price" numeric,
	"settles_payout_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "transaction_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "transaction_settles_uq" UNIQUE("user_id","settles_payout_id"),
	CONSTRAINT "transaction_type_ck" CHECK ("transaction"."type" IN ('deposit', 'withdrawal', 'buy', 'sell', 'dividend_payout',
        'interest_payout', 'tax', 'reinvest', 'redemption')),
	CONSTRAINT "transaction_amount_ck" CHECK ("transaction"."amount" > 0),
	CONSTRAINT "transaction_quantity_sign_ck" CHECK ("transaction"."quantity" IS NULL OR "transaction"."quantity" > 0),
	CONSTRAINT "transaction_unit_price_ck" CHECK ("transaction"."unit_price" IS NULL OR "transaction"."unit_price" > 0),
	CONSTRAINT "transaction_quantity_absent_ck" CHECK ("transaction"."type" IN ('buy', 'sell', 'reinvest', 'redemption') OR "transaction"."quantity" IS NULL),
	CONSTRAINT "transaction_quantity_required_ck" CHECK ("transaction"."type" NOT IN ('buy', 'sell', 'reinvest', 'redemption') OR "transaction"."quantity" IS NOT NULL),
	CONSTRAINT "transaction_unit_price_absent_ck" CHECK ("transaction"."type" IN ('buy', 'sell', 'reinvest', 'redemption') OR "transaction"."unit_price" IS NULL),
	CONSTRAINT "transaction_asset_absent_ck" CHECK ("transaction"."type" NOT IN ('deposit', 'withdrawal') OR "transaction"."asset_id" IS NULL),
	CONSTRAINT "transaction_asset_present_ck" CHECK ("transaction"."type" NOT IN ('buy', 'sell', 'reinvest', 'redemption') OR "transaction"."asset_id" IS NOT NULL),
	CONSTRAINT "transaction_settles_ck" CHECK ("transaction"."settles_payout_id" IS NULL OR "transaction"."type" = 'tax')
);
--> statement-breakpoint
CREATE TABLE "user_price" (
	"user_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"price" numeric NOT NULL,
	"observed_at" timestamp with time zone,
	CONSTRAINT "user_price_user_id_asset_id_as_of_pk" PRIMARY KEY("user_id","asset_id","as_of"),
	CONSTRAINT "user_price_price_ck" CHECK ("user_price"."price" > 0)
);
--> statement-breakpoint
CREATE INDEX "asset_user_created" ON "asset" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "transaction_user_date" ON "transaction" USING btree ("user_id","date");