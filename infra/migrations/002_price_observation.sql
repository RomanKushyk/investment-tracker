-- Phase 2, NBU half only: raw captures become queryable observations.
--
-- The Inzhur half is deliberately NOT here. Its evidence is still accumulating
-- (PLAN-WAITING W1) and the two must not be coupled — but the columns it will
-- need exist from row one, because a column added to a live archive leaves the
-- old rows null forever with no way to tell "absent" from "not collected yet".
--
-- Each statement below must be executed in its own transaction: DSQL allows one
-- DDL per transaction and forbids mixing DDL with DML.
--
-- ============================================================================
-- CONTRACTS, PINNED BEFORE THE FIRST ROW
--
-- These are written down because DSQL primary keys are IMMUTABLE. A wrong key
-- is a DROP/CREATE of a live archive, not a migration, and a rule that is
-- silently redefined later poisons the archive with no way to tell which rows
-- used which version.
--
--   1. NATURAL KEY = (as_of, instrument_ref, basis, source).
--      Order matters, not just membership: `as_of` leads because the pinned
--      read contract serves whole YEARS (`/v1/prices/{YYYY}.ndjson`) and the
--      key is index-organized. Per-instrument access is served by the
--      secondary index below, not by the key.
--
--   2. as_of = capture_date - 1, unchanged from `price_capture`.
--      The 01:00 Europe/Kyiv run reads the file published the previous day.
--      The file's OWN `calc_date` must agree; a row whose `calc_date` differs
--      from the capture's `as_of` is SKIPPED and counted, never coerced.
--      Verified 14/14 on sampled dates across 2016-2026 before this was relied
--      on.
--
--   3. basis vocabulary = 'buy' | 'sell' | 'nav' | 'fair'. All four are legal
--      from row one even though NBU only ever writes 'fair'. Adding a value to
--      a key column later splits the archive in two (D30).
--
--   4. instrument_ref = ISIN for bonds, provider slug for funds. The feed's own
--      numeric `id` is rejected. Measured trap: all 31 bonds in the Inzhur feed
--      share `slug: "ovdp"`, so a slug-only key would collapse the entire bond
--      universe into a single row.
--
--   5. NO currency dimension. The USD figures are a serve-time conversion
--      (D31), so they belong to presentation, not to the observation. The
--      `currency` on `instrument` is the instrument's own denomination, which
--      is a property of the thing, not of the measurement.
--
--   6. observation_kind is NOT stored. `published | carried | computed |
--      frozen` are derived at read time. Storing a judgment in an immutable
--      column is the specific error this whole investigation exists to avoid.
-- ============================================================================

-- Exactly what the provider served, per instrument per day.
CREATE TABLE IF NOT EXISTS price_observation (
  -- The Kyiv calendar date these prices are FOR (contract 2).
  as_of             DATE        NOT NULL,

  -- ISIN for bonds, slug for funds (contract 4). Permanently allocated, never
  -- reused, never renamed. No foreign key protects this — DSQL has none — so
  -- it is protected by never generating it, only copying it from the provider.
  -- "DSQL has none" is RETRACTED 2026-08-27 (D99): it does, composite and
  -- enforced. The protection this column actually relies on is unchanged and
  -- was never the database's — see 001_price_capture.sql's header note.
  instrument_ref    TEXT        NOT NULL,

  -- What the number MEANS: 'buy' | 'sell' | 'nav' | 'fair' (contract 3).
  -- In the key so that a dealer bid and a model valuation for one
  -- instrument-day can coexist instead of overwriting each other.
  basis             TEXT        NOT NULL,

  -- 'nbu_fv' | 'inzhur'. In the key because the two measured ~0.9% apart on the
  -- same ISIN the same day: one is a dealer quote, the other a model fair
  -- value. Merging them would present one as the other.
  source            TEXT        NOT NULL,

  -- The number this table exists for, in the instrument's own currency.
  price             NUMERIC     NOT NULL,

  -- When the cron WITNESSED it, as distinct from the day it is for. Eight bytes
  -- that tell "the price was flat" apart from "this was backfilled late".
  observed_at       TIMESTAMPTZ NOT NULL,

  -- Which code produced this row. If the parser was ever wrong, this is the
  -- only thing that identifies the affected rows.
  parser_version    TEXT        NOT NULL,

  -- NBU: yield to maturity and clean price, both percent. Free to store and
  -- impossible to recover for a day nobody captured.
  ytm               NUMERIC,
  clean_rate        NUMERIC,

  -- Inzhur, from row one though nothing writes them yet (see the header).
  -- `returnRates.{buy,sell}` is the only genuinely new information a bond row
  -- carries and the only way to detect a yield revision; `status` flips without
  -- the price changing and the flip date is gone forever if not captured that
  -- day. Both are currently discarded by the parser.
  return_rate_buy   NUMERIC,
  return_rate_sell  NUMERIC,
  status            TEXT,

  PRIMARY KEY (as_of, instrument_ref, basis, source)
);

-- "This instrument over time" — the chart query. It needs its own index because
-- the primary key leads with `as_of`, and an index is only usable from its
-- leading column. Measured on `price_capture` in A2: the wrong leading column
-- cost a full scan of 6,628 rows to return 3, at ~730 ms (D48).
--
-- No DESC: DSQL rejects a sort direction in index keys.
CREATE INDEX ASYNC IF NOT EXISTS price_observation_ref_as_of
  ON price_observation (instrument_ref, as_of);

-- What a ref IS, and — the load-bearing part — when it existed.
--
-- Without the date bounds, a missing observation cannot be told apart from an
-- instrument that had not been issued yet. That is not hypothetical: it is
-- exactly the defect of D43, where the backfill flagged every pre-issuance date
-- as a failure and four other explanations were investigated first.
CREATE TABLE IF NOT EXISTS instrument (
  ref           TEXT NOT NULL,

  -- 'bond' | 'fund'.
  kind          TEXT NOT NULL,

  -- The instrument's own denomination, e.g. 'UAH' (contract 5).
  currency      TEXT,

  -- NBU's own classification, 'ОВДП' / 'ОВМП'. Absent from files before 2022.
  cp_type       TEXT,

  maturity      DATE,

  -- FACTS, both of them: the first and last as_of on which a published file
  -- actually carried this ref.
  --
  -- `retired_at` is deliberately NOT stored, and this is a considered deviation
  -- from the spec's wording rather than an omission. "Retired" is a judgment;
  -- "last seen on" is what the cron witnessed. The judgment is derived at read
  -- time by comparing `last_seen_on` against the archive's latest published
  -- date, which answers the same question — before `listed_from` it did not
  -- exist, after `last_seen_on` it is gone, in between a gap is a real gap.
  -- Neither column is in a key, so a later decision to store the judgment as
  -- well costs one ALTER TABLE.
  listed_from   DATE,
  last_seen_on  DATE,

  PRIMARY KEY (ref)
);
