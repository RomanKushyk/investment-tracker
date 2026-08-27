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
--     RETRACTED 2026-08-27 (D99): DSQL DOES have foreign keys, composite and
--     enforced, measured on the live cluster. The line was true when this file
--     was written and shaped it; it is kept because an applied migration is a
--     record of what was applied, not a live rule. Whether the user schema
--     adopts them is docs/plans/PLAN-OPEN.md O34. The rest of the list is
--     unchecked since — do not read any of it as current.
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

  -- Which feed this payload came from: 'inzhur' | 'nbu_fv'.
  --
  -- Not in the primary key: a capture is an EVENT, and two runs on the same day
  -- are legitimately two rows. Source belongs in the natural key of the future
  -- observation table — (as_of, ref, basis, source) — because there the two
  -- sources are different VALUES for the same instrument-day and would
  -- otherwise overwrite each other. Measured divergence: ~0.9% same-day on the
  -- same ISIN, because Inzhur publishes a dealer quote ("Базова ціна", cl. 1.4
  -- of its services agreement) while NBU publishes a model fair value. They are
  -- not substitutes and must never be merged.
  source          TEXT,

  -- The Kyiv calendar date these prices are FOR — and the rule is PER SOURCE,
  -- which it was not until 2026-08-18 (D71).
  --
  --   inzhur  as_of = the Kyiv date of the run. The endpoint is live and what
  --           it serves at 01:00 on day D is the price struck for day D.
  --   nbu_fv  as_of = the Kyiv date of the run - 1. Here the value is also the
  --           REQUEST parameter: the URL names a date's file, and at 01:00 on D
  --           the file for D does not exist yet (NBU publishes ~09:30).
  --
  -- This comment used to read "as_of = capture date - 1" for both, on the
  -- premise that the 01:00 run reads prices published ~13:00 the previous day.
  -- False for inzhur, true for nbu_fv — so one rule had to be wrong for one of
  -- them, and it was wrong for 14 inzhur rows before inverting the DCF caught
  -- it. Those rows were migrated +1 day on 2026-08-18; nbu_fv was never touched.
  --
  -- Still pinned in writing, and now with a decision behind it, because a
  -- silent redefinition poisons the archive with no way to tell which rows used
  -- which rule. That is exactly what happened, and it was only repairable
  -- because the offset turned out to be uniform.
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
  -- This is the load-bearing column, and the argument survives D72 narrowing
  -- the premise around it: whatever the provider publishes elsewhere, it does
  -- not republish what IT served US on a given day. So if the parser is ever
  -- wrong — unit drift, a renamed field, a percentage that becomes a fraction —
  -- this is still the ONLY thing that can regenerate our history. W1 and D71
  -- both read it to answer questions nobody anticipated storing an answer to.
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

  -- THERE IS DELIBERATELY NO FX COLUMN HERE, and D30 reads as though there
  -- should be. D69 settles it: the provider's rate is a CONCLUSION, and both of
  -- its premises are in payload_gzip above, kept forever — `buyUAH / buyUSD` on
  -- any entry recovers it at any point in the archive's life.
  -- Two further facts a column could not carry honestly. It is not ONE rate:
  -- inside a single payload the funds and the bonds convert at different ones
  -- (D31 measured 44.7579 against 44.8305; re-measured 2026-08-17, 44.8086
  -- against 44.8568). And it is not exact: `buyUSD` is published to six
  -- decimals, so a rate recovered by division jitters in the fourth.
  -- Do not add it. Read D69 before deciding otherwise.

  PRIMARY KEY (id)
);

-- Answers "did the job run on day D" and "show me the last N runs" without a
-- full scan. ASYNC because DSQL builds indexes non-blocking.
--
-- No DESC: DSQL rejects a sort direction in index keys ("specifying sort order
-- not supported for index keys"). Immaterial — the planner can walk an
-- ascending index backwards, and at ~365 rows/year direction never decides a
-- plan.
CREATE INDEX ASYNC IF NOT EXISTS price_capture_as_of
  ON price_capture (as_of, requested_at);

-- Added 2026-08-11 by D48, and MISSING FROM THIS FILE until 2026-08-14 — the
-- handler created it while this reference still described the schema without
-- it, which is the drift this file exists to prevent.
--
-- It leads with `source` because that is what both operational queries filter
-- on, and neither could use the index above: an index is only usable from its
-- leading column. Measured before adding it, both queries scanned all 6,628
-- rows to return 3, at ~730 ms each (`Rows Removed by Filter: 6625`).
-- `requested_at` was the third key so the streak query's ORDER BY was served by
-- the same index. That query is gone (A20, D70) and the key stays: the backfill
-- completeness check still leads with `source`, and dropping a key from a live
-- index buys nothing at ~365 rows a year.
CREATE INDEX ASYNC IF NOT EXISTS price_capture_source_as_of
  ON price_capture (source, as_of, requested_at);

-- D48 also found `price_capture_as_of` above to be dead weight: no query leads
-- with `as_of`. It is left in place deliberately — dropping an index on the
-- live archive is a schema change on production data, not a doc fix, and the
-- two indexes together cost nothing at ~365 rows a year. Whoever next changes
-- this DDL for a real reason should take it with them.
