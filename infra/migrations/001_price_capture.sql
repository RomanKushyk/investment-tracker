-- The archive's capture journal: one row per run per source, with the payload
-- that run read. The live DDL is `ensureSchema` in infra/src/capture.ts; this
-- file records its keys and names, and archive-schema.test.ts holds the two to
-- the same ones.
--
-- DSQL constraints that shape this file (docs/superpowers/specs/2026-08-04-data-model.md,
-- infra/docs/dsql-constraints.md):
--   * one DDL statement per transaction, and DDL may not share a transaction with DML
--   * foreign keys exist, composite and enforced, and the archive declares none:
--     an instrument_ref is protected by being copied from the provider, never
--     generated — a rule the database never held
--   * no triggers, no PL/pgSQL, no TRUNCATE, no temp tables (AWS, https://docs.aws.amazon.com/aurora-dsql/latest/userguide/working-with-postgresql-compatibility-unsupported-features.html)
--   * the PRIMARY KEY is index-organized, carries every column, and is IMMUTABLE
--   * secondary indexes are created with CREATE INDEX ASYNC
--
-- Each statement below must be executed in its own transaction.

-- The run journal. Written on EVERY attempt, including failures — this table,
-- never the absence of a price row, says whether the job ran on day D. Whether
-- instrument X was quoted on day D is price_observation's question
-- (002_price_observation.sql). Keeping those two questions in two tables is
-- what stops either answer from being ambiguous.
CREATE TABLE IF NOT EXISTS price_capture (
  -- Random UUID rather than a sequence: DSQL distributes by key, and its own
  -- guidance is to spread writes across the key range.
  id              UUID        NOT NULL,

  -- When we asked. An instant, not a date.
  requested_at    TIMESTAMPTZ NOT NULL,

  -- Which feed this payload came from: 'inzhur' | 'nbu_fv'.
  --
  -- Not in the primary key: a capture is an EVENT, and two runs on the same day
  -- are legitimately two rows. Source is in price_observation's natural key —
  -- (as_of, instrument_ref, basis, source) — because there the two sources are
  -- different VALUES for the same instrument-day and would otherwise overwrite
  -- each other. They differ on the same ISIN the same day, because Inzhur
  -- publishes a dealer quote ("Базова ціна", cl. 1.4 of its services agreement)
  -- while NBU publishes a model fair value. They are not substitutes and must
  -- never be merged (*The price archive*).
  source          TEXT,

  -- The Kyiv calendar date these prices are FOR — and the rule is PER SOURCE
  -- (*The price archive*).
  --
  --   inzhur  as_of = the Kyiv date of the run. The endpoint is live and what
  --           it serves at 01:00 on day D is the price struck for day D.
  --   nbu_fv  as_of = the Kyiv date of the run - 1. Here the value is also the
  --           REQUEST parameter: the URL names a date's file, which NBU writes
  --           later on that date than the 01:00 run, so the file for D does not
  --           exist yet when the run asks.
  --
  -- Pinned in writing because a silent redefinition poisons the archive with no
  -- way to tell which rows used which rule.
  as_of           DATE        NOT NULL,

  -- Outcome. `ok` false still writes a row: a failed run is exactly the fact the
  -- liveness alarm exists to see.
  ok              BOOLEAN     NOT NULL,
  http_status     INT,
  error           TEXT,

  -- Parse metadata. Recorded now because it is free and because entry_count
  -- collapsing is the earliest signal of a feed shape change.
  entry_count     INT,
  skipped_refs    TEXT,       -- comma-joined; DSQL array support is unverified

  -- The payload itself, gzipped. This is the load-bearing column: whatever the
  -- provider publishes elsewhere, it does not republish what IT served US on a
  -- given day. So if the parser is ever wrong — unit drift, a renamed field, a
  -- percentage that becomes a fraction — this is still the ONLY thing that can
  -- regenerate our history (*The price archive*: premises are kept forever).
  payload_gzip    BYTEA       NOT NULL,
  payload_bytes   INT         NOT NULL,   -- decoded size, before compression
  payload_sha256  TEXT        NOT NULL,   -- over the DECODED body text, not the
                                          -- wire bytes: the server may negotiate
                                          -- gzip, and hashing the wire form would
                                          -- silently make every hash unique and
                                          -- disable change detection entirely

  -- Which code produced this row. If the parser was ever wrong, this is what
  -- identifies the affected rows.
  parser_version  TEXT        NOT NULL,

  -- THERE IS DELIBERATELY NO FX COLUMN HERE (*The price archive*): the
  -- provider's rate is a CONCLUSION, and both of its premises are in
  -- payload_gzip above, kept forever — `buyUAH / buyUSD` on any entry recovers
  -- it at any point in the archive's life.
  -- Two further facts a column could not carry honestly. It is not ONE rate:
  -- inside a single payload the funds and the bonds convert at different ones.
  -- And it is not exact: `buyUSD` is published to six decimals, so a rate
  -- recovered by division jitters in the fourth.
  -- Do not add it. Read *The price archive* before deciding otherwise.

  PRIMARY KEY (id)
);

-- Built to answer "did the job run on day D" and "show me the last N runs"
-- without a full scan. ASYNC because DSQL builds indexes non-blocking.
--
-- No DESC: DSQL rejects a sort direction in index keys ("specifying sort order
-- not supported for index keys"). Immaterial — the planner can walk an
-- ascending index backwards.
CREATE INDEX ASYNC IF NOT EXISTS price_capture_as_of
  ON price_capture (as_of, requested_at);

-- It leads with `source` because every query on this table that filters by
-- `as_of` filters by `source` too, and only an index leading with `source`
-- narrows by both. `requested_at`, the third key, stays: changing a live
-- index's keys is a schema change on production data.
CREATE INDEX ASYNC IF NOT EXISTS price_capture_source_as_of
  ON price_capture (source, as_of, requested_at);

-- So `price_capture_as_of` above narrows no query that this index does not. It
-- is left in place deliberately — dropping an index on the live archive is a
-- schema change on production data, not a doc fix, and at a few rows per
-- source per day the two indexes cost next to nothing. Whoever next changes
-- this DDL for a real reason should take it with them.
