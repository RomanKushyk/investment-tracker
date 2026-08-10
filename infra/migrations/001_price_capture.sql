-- Phase 1: raw capture only.
--
-- The observation schema is deliberately NOT defined yet. The cron runs for ~3
-- weeks writing only raw payloads, which settles what a schema decision would
-- otherwise have to guess: whether the feed refreshes on Saturdays, how holidays
-- behave, whether returnRates is stable, fund NAV cadence, payload byte
-- stability, and the shape of an outage. Raw payloads regenerate any schema
-- retroactively, so deferring costs nothing and deciding now would be a guess.
--
-- DSQL constraints that shape this file (docs/superpowers/specs/2026-08-04-data-model.md):
--   * one DDL statement per transaction, and DDL may not share a transaction with DML
--   * no foreign keys, no triggers, no PL/pgSQL, no TRUNCATE, no temp tables
--   * the PRIMARY KEY is index-organized, carries every column, and is IMMUTABLE
--   * secondary indexes are created with CREATE INDEX ASYNC
--
-- Each statement below must be executed in its own transaction.

-- The run journal. Written on EVERY attempt, including failures — this table,
-- never the absence of a price row, is the liveness signal. "Did the job run on
-- day D" is answered here; "was instrument X quoted on day D" will be answered
-- by the observation table when it exists. Keeping those two questions in two
-- tables is what stops either answer from being ambiguous.
CREATE TABLE IF NOT EXISTS price_capture (
  -- Random UUID rather than a sequence: DSQL distributes by key, and its own
  -- guidance is to spread writes across the key range.
  id              UUID        NOT NULL,

  -- When we asked. An instant, not a date.
  requested_at    TIMESTAMPTZ NOT NULL,

  -- The Kyiv calendar date these prices are FOR. The 01:00 Europe/Kyiv run reads
  -- prices published ~13:00 the previous day, so as_of = capture date - 1.
  -- Pinned in writing because a silent redefinition later poisons the archive
  -- with no way to tell which rows used which rule.
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

  -- The payload itself, gzipped. ~165 KB raw, ~8 MB/year gzipped.
  -- This is the load-bearing column: the provider publishes no history, so if
  -- the parser is ever wrong — unit drift, a renamed field, a percentage that
  -- becomes a fraction — this is the ONLY thing that can regenerate history.
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

  PRIMARY KEY (id)
);

-- Answers "did the job run on day D" and "show me the last N runs" without a
-- full scan. ASYNC because DSQL builds indexes non-blocking.
CREATE INDEX ASYNC IF NOT EXISTS price_capture_as_of
  ON price_capture (as_of DESC, requested_at DESC);
