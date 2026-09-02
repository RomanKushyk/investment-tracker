-- 004 — bond_terms (W4)
--
-- FOUR, NOT THREE. `003` belongs to W7's user-schema draft and it keeps that
-- number on promotion — `migrations/drafts/README.md` reserves it in writing,
-- on the grounds that two files under one number is the ambiguity numbering
-- exists to remove.
--
-- REFERENCE DDL. NOTHING READS THIS FILE. The applied copy is inline in
-- `ensureSchema` (infra/src/capture.ts) and keeping the two in step is manual —
-- the same arrangement 001 and 002 describe, and the same hazard.
--
-- WHY THIS TABLE EXISTS, and it is the only reason. A bond's payment schedule
-- is reconstructable in principle: it is in every raw payload we have stored.
-- But the provider DELISTS an instrument after maturity, and at that moment the
-- live copy is gone for good. `src/core/inzhur/dcf.ts` cannot price a bond
-- without its schedule, W10 (2027-03-24) and W12 (2028-09-27) are the two dates
-- that will need one for an instrument the feed no longer lists, and no other
-- source publishes it. So the schedule is CAPTURED rather than derived, on
-- exactly the argument that keeps the raw payloads themselves.
--
-- CONTRACTS, PINNED BEFORE THE FIRST ROW
--
-- 1. KEY = (as_of, ref), and it is IMMUTABLE. Changing it on DSQL is a
--    DROP/CREATE of a live archive, not a migration — the same rule 002 states
--    for `price_observation`, and the reason this file exists before the table
--    does. `as_of` leads for the same reason it leads there: the read contract
--    serves whole years, and "this instrument over time" gets its own index
--    below rather than a different key.
--
-- 2. WRITTEN EVERY RUN, one row per bond per day, repeating unchanged terms.
--    This applies the owner's write-every-day ruling for `price_observation`
--    (W4, 2026-09-02) to this table rather than inventing a second policy one
--    table over. "Versioned and effective-dated" is therefore a property of the
--    SERIES: consecutive rows are the terms as they stood on each day.
--
--    A change-detecting key — (ref, terms_sha256), insert-if-new — was
--    considered and rejected twice over: it needs a read per bond per run, and
--    a schedule that changed and changed BACK would collide with its own
--    earlier digest and lose the second period entirely.
--
-- 3. `terms_sha256` IS THE REVISION DETECTOR. It digests ref + maturity +
--    schedule, so finding the day a schedule changed is one scan over a text
--    column rather than a JSON diff across 365 rows a year. The REF is inside
--    the digest deliberately: two bonds can share a schedule shape, and a
--    digest that collided across instruments would report a revision that never
--    happened.
--
-- 4. `payment_schedule` IS TEXT HOLDING JSON, NOT JSONB. A type change is one
--    of the two alterations DSQL cannot make later (D100) and nothing reads
--    this column yet, so the reversible choice is the plain one. A reader that
--    wants JSONB can cast; a table that guessed wrong cannot be migrated.
--
-- 5. NO DERIVED FACT IS STORED. `ScheduleFacts`, `couponRatePct`,
--    `payoutSchedule`, the DCF's own verdict — all read-time derivations over
--    these premises. The premises are captured forever; the conclusion never
--    is (D31/A6). Storing a judgment in an immutable column is the error the
--    whole archive design exists to avoid.
--
-- 6. FUNDS GET NO ROW, and neither does a bond whose schedule came back empty.
--    A fund has no terms; an empty-schedule row is indistinguishable from a
--    real zero-coupon instrument, and this table is the only surviving copy
--    after delisting. Writing nothing stays recoverable from the raw payload —
--    writing a false row does not, because the archive role holds
--    SELECT + INSERT and no DELETE.

CREATE TABLE IF NOT EXISTS bond_terms (
  as_of            DATE        NOT NULL,
  ref              TEXT        NOT NULL,
  terms_sha256     TEXT        NOT NULL,
  maturity         DATE,
  payment_schedule TEXT        NOT NULL,
  observed_at      TIMESTAMPTZ NOT NULL,
  parser_version   TEXT        NOT NULL,
  PRIMARY KEY (as_of, ref)
);

-- "The schedule of THIS bond, latest first" — the read W10/W12 make against a
-- delisted instrument, which the key above cannot serve.
--
-- ASYNC, and no `USING btree`. DSQL rejects a `CREATE INDEX` without the first
-- and rejects the second outright (D99, measured against the live cluster), so
-- promotion rewrites every index line twice if either is left in.
CREATE INDEX ASYNC IF NOT EXISTS bond_terms_ref_as_of
  ON bond_terms (ref, as_of);
