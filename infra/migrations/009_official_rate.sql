-- 009 — the official rate, one row per day (W7)
--
-- APPLIED BY `infra/src/migrate.ts`, which names its files rather than globbing
-- them, so this one is enlisted by `MIGRATIONS` and by nothing else.
--
-- NBU's official rate, one final row per Kyiv day, written by `rate-ahead.ts` and
-- read by `official-rate.ts` (*External sources* says why it is a row, and here).
-- The primary key is the conflict target `infra/docs/dsql-constraints.md` measured.
CREATE TABLE "official_rate" (
	"rate_date" date NOT NULL,
	"currency" text NOT NULL,
	"rate" numeric NOT NULL,
	CONSTRAINT "official_rate_rate_date_currency_pk" PRIMARY KEY("rate_date","currency"),
	CONSTRAINT "official_rate_positive_ck" CHECK ("official_rate"."rate" > 0)
);
