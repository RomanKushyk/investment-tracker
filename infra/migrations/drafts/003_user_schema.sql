-- ============================================================================
-- DRAFT — W7's user schema. NOTHING APPLIES THIS FILE.
-- ============================================================================
--
-- Written by A51 (2026-08-26) so W7 starts from a reviewed draft instead of a
-- blank file. Reviewed once, and the review rewrote it: see REVIEW FINDINGS at
-- the foot of this header for the five things the first draft got wrong.
--
-- It is not wired to anything:
--
--   * `capture.ts`'s `ensureSchema` does NOT know these tables and must not
--     learn them. It owns the ARCHIVE (`price_capture`, `price_observation`,
--     `instrument`), which is provider data shared by every environment. This
--     file is USER data, which D63 splits dev from prod at W7.
--   * No code reads this path. Verified: `infra/migrations/*.sql` is cited only
--     from comments in `capture.ts`; the DDL that actually runs is inline in
--     `ensureSchema`.
--
-- PROMOTION PATH — how this stops being a draft, stated because without it
-- `drafts/` is just a third copy of the schema:
--
--   1. W7 adds an API Lambda with its own migration step. That step, not the
--      capture handler, applies this file. Two handlers, two schemas, one
--      cluster — the boundary is which handler owns which tables.
--   2. On promotion the file moves UP one directory, keeping its name — it is
--      already numbered `003` for that reason, and NOT `001`, which
--      `infra/migrations/001_price_capture.sql` owns. Two files under one number
--      is the ambiguity numbering exists to remove, and any tool globbing
--      `migrations/**/*.sql` in filename order would have sequenced the user
--      schema ahead of the archive tables. Every `CREATE INDEX` gains `ASYNC` on
--      the way (see DSQL DIVERGENCE), and this header is replaced by the
--      applied-contract header that 001 and 002 carry.
--   3. `infra/README.md`'s Layout table is corrected in the same commit.
--
-- DSQL DIVERGENCE — where "keep the schema inside the DSQL subset and the two
-- agree by construction" does NOT hold. Both cases are index DDL:
--
--   * `CREATE INDEX ASYNC` is DSQL-only and a syntax error on stock Postgres.
--     Every secondary index below is therefore plain `CREATE INDEX`, each
--     carrying an `ASYNC on DSQL` marker so promotion converts all of them and
--     not some of them.
--   * UNIQUE constraints are declared INLINE in `CREATE TABLE`, never as a
--     later `CREATE UNIQUE INDEX`. Inline `UNIQUE` is in the supported set for
--     both engines; adding a unique index to an already-created table is not
--     something this draft is willing to assume of DSQL, and the first draft
--     did assume it, twice, without noting it. Inline costs nothing and removes
--     the question.
--
-- AND THE LIST ABOVE IS NOT KNOWN TO BE COMPLETE. Neither applied migration nor
-- `ensureSchema` uses a single CHECK, UNIQUE or DEFAULT — they use only NOT NULL
-- and PRIMARY KEY — so this draft's 16 CHECKs, 3 inline UNIQUEs, one
-- `BIGINT DEFAULT 0` and one `SMALLINT` have NO precedent against the real
-- cluster. The cloud-stack spec does say `CHECK`, `UNIQUE`, `PRIMARY KEY` and
-- `GENERATED` are all supported, which is the basis for using them; DEFAULT and
-- SMALLINT rest on Postgres compatibility alone. First contact with DSQL is
-- the test, and it happens at promotion — deliberately, because that is the
-- first moment there is a handler entitled to run this DDL.
--
-- Local Postgres cannot catch a DSQL-only mistake — it is the subset, not the
-- superset — so this note plus the promotion step is the whole of that safety.
--
-- EXECUTED BY A COMMITTED TEST: `infra/src/user-schema.test.ts`, **42 tests**.
-- It applies this file to a fresh PGlite instance — Postgres compiled to WASM,
-- so the parser and every CHECK are Postgres's own — then exercises each
-- constraint in both directions and the OCC rowcount contract (1 on the
-- expected version, 0 on a stale one, 1 again after). PGlite is a
-- devDependency, so the "local Postgres for the inner loop" the cloud-stack
-- spec committed to needs no server, no daemon and no container. It runs in
-- `pnpm test` and in `deploy-backend.yml`, which is what stops this file from
-- drifting away from what its header claims about it.
--
-- WHAT IT CANNOT PROVE, stated because three reviews on the previous task were
-- spent on exactly this distinction:
--   * NOTHING about DSQL acceptance. Local Postgres is the subset; a DSQL-only
--     rejection is invisible here, which is why the divergence note above is
--     the whole of that safety.
--   * NOTHING about contract 3. The key-order argument is a reasoning about
--     DSQL's index-organized primary key; a query plan over a two-row table
--     says nothing either way, and it was not taken as evidence.
--   * NOTHING about the migration translations below. Those are data problems,
--     not schema ones.
--
-- Each statement must run in its OWN transaction. The governing rule is
-- `PLAN-NOW.md`'s cross-phase DDL rule and it has FIVE clauses; it is cited
-- rather than quoted here, because the first draft quoted two of the five while
-- claiming not to be restating it, which is the failure mode A51's own
-- checklist named.
--
-- ============================================================================
-- CONTRACTS, PINNED BEFORE THE FIRST ROW
--
-- DSQL primary keys are IMMUTABLE (D30). A wrong key is a DROP/CREATE of live
-- user data, not a migration — which is exactly why this is on paper first.
--
--   1. NO FOREIGN KEYS. `REFERENCES` is absent from the DSQL grammar. Every
--      reference below is application-enforced on write plus a nightly
--      integrity audit.
--
--      AND DELETION IS AN OPEN PROBLEM, not a solved one. The first draft said
--      "nothing is ever deleted, so there are no cascades". That is false of
--      the app today: `repository.ts`'s `deleteAsset` deletes the asset, then
--      deletes its transactions, then strips the asset out of every snapshot's
--      quotes — a hand-written cascade over exactly the three tables modelled
--      here — and `deleteTransaction`, `deleteSnapshot`, `replaceAll` and
--      `clearAll` are all live too. With no FKs and no `deleted_at` column,
--      W7 inherits a choice it must make explicitly: keep the hand-written
--      cascade in the API Lambda, or add tombstones. This draft adds NEITHER,
--      because inventing a column for an undecided question is how a schema
--      acquires a field nobody can explain. Phase 7's DB browser already
--      assumes delete-impact hints, so the question has a consumer.
--
--   2. `version` IS ONE COLUMN ON ONE ROW PER USER, and it lives on `app_user`.
--      The pinned API is `GET /state` (whole dataset + version) and
--      `POST /mutations` (one op, `If-Match`), so the version scopes the whole
--      of one user's data. A per-TABLE version cannot implement a
--      dataset-level `If-Match`. It sits on `app_user` rather than in a table
--      of its own because the API Lambda already loads that row on every
--      request — to scope by `user_id` and to check `status` — so the read is
--      free and there is one place where "what version am I acting on" is
--      answered.
--
--      TWO MECHANISMS, NOT ONE. `If-Match` is
--        UPDATE app_user SET data_version = data_version + 1
--         WHERE user_id = $1 AND data_version = $2
--      and the CONFLICT DETECTOR IS THE ROWCOUNT: 0 rows means someone else
--      moved first, which is a 412. Retrying SQLSTATE 40001 at COMMIT is
--      SERIALIZATION, a different failure, and retrying it is safe precisely
--      because the rowcount check is what makes the mutation conditional.
--
--   3. EVERY PER-USER TABLE LEADS ITS PRIMARY KEY WITH `user_id`.
--      DSQL's primary key is index-organized, so the key order IS the access
--      path. The dominant read is `GET /state` — one user's whole dataset —
--      so `(user_id, id)` makes that a contiguous range scan, while a bare
--      surrogate `(id)` would make it a secondary-index scan with a row fetch
--      per row. The first draft used the surrogate for `account`, `asset` and
--      `transaction`, which is the one decision D30 makes uncorrectable later.
--
--      This is the tension the two applied migrations sit on either side of,
--      and it resolves in one direction here. `001_price_capture.sql` keys on a
--      random UUID *to spread writes across the key range*, per DSQL's own
--      guidance; `002_price_observation.sql` keys naturally *because the read
--      contract serves whole years*. Leading with `user_id` gets both: a
--      Cognito `sub` is itself a random UUID, so writes still spread, while one
--      user's rows stay contiguous for the read that matters.
--
--   4. NO CHECK CONSTRAINT MAY ENUMERATE A VALUE NAMING A SPECIFIC HOLDING.
--      The spec's one explicit DDL rule. `TxSource`'s `reinvest_reit` /
--      `reinvest_6475` are gone — a reinvest target is an asset reference, not
--      an enum member — and `ColorKey`'s `reit | energy | ovdp8976 | ovdp6475`
--      becomes `color_slot`, an integer palette index. A CHECK that names a
--      holding turns "the user sold it" into a migration.
--
--      It does NOT exempt the closed vocabularies that name no holding:
--      `yield_type` and `payout_schedule` are constrained below, because the
--      first draft left them as free text while constraining four of their
--      peers, and a typo'd `'semi_annual'` falls through every consumer's
--      default branch in silence.
--
--   5. AMOUNTS AND QUANTITIES ARE ALWAYS POSITIVE. The sign of an amount is a
--      function of `type` and is never stored, so `free_cash(D) = Σ signed
--      amount up to D` reconciles by construction. A `quantity` is therefore
--      NOT redundant with the type: a negative one would flip a position
--      movement independently of it, and nothing else records units.
--
--   6. NUMERIC, NEVER float. Money, units and percentages alike.
--
-- ============================================================================
-- MIGRATING THE EXISTING DATA — six translations, not a copy
-- (the first draft said three and named three; (4)-(6) are what review found)
--
-- 1. IDS ARE SLUGS TODAY, AND THIS SCHEMA SAYS UUID.
--    `seed.ts` assigns `'reit'`, `'energy'`, `'ovdp8976'`, `'ovdp6475'` and
--    transaction ids `'d1'`…`'r3'`; every one of the 174 snapshots keys its
--    `quotes` map by those same asset slugs. A slug→UUID remap is needed across
--    `asset.id`, `transaction.id`, `transaction.asset_id`, `user_price.asset_id`
--    AND every snapshot quote key. This is the step that loses the 174
--    snapshots if it is skipped, and D33 says they cannot be regenerated.
--
-- 2. `assetId` IS `''` ON THE SEED's PORTFOLIO-LEVEL ROWS. In SQL that is NULL.
--    Empty string and NULL are different values; translate, do not copy. NOTE
--    this was measured against `seed.ts` alone and (6) below is the other half.
--
-- 3. `Asset.inzhur.units` IS THE ONLY PLACE UNIT COUNTS EXIST TODAY, and this
--    schema has no column for it — deliberately, because units become a
--    derivation (`units(a, D) = Σ quantity deltas`) rather than a stored total.
--    But that makes the existing value the ONLY seed for `transaction.quantity`,
--    which this header calls unrecoverable if not captured. It is exported in
--    the CSV today (`csv.ts`), so it exists outside the database as well. W7
--    must reconstruct per-transaction quantities from it, or accept that the
--    opening positions carry none.
--
-- 4. `Snapshot.cash` HAS NO COLUMN, and no home is decided. All 174 snapshots
--    store a cash balance (`types.ts`: `Snapshot.cash: number`), and the model's
--    answer is derivation — `free_cash(D) = Σ signed amount up to D` across
--    `account`. But A52's withdrawal MEASURED that today's ledger does not
--    reproduce today's figures, and D5 pins the ₴7,75 residue that every one of
--    those snapshots records. So the 174 recorded balances are either dropped or
--    they need somewhere to live, and that is not this draft's call: it is the
--    same ruling `PLAN-OPEN.md` O31 is waiting on.
--
-- 5. TIMESTAMPS ARE STORED IN THREE INCOMPATIBLE ENCODINGS, and `TIMESTAMPTZ`
--    resolves a zoneless literal against the session `TimeZone`. `asset-builder`
--    writes `toISOString()` (UTC, with `Z`); `repository.ts` writes
--    `toISOString().slice(0, 19)` — the same instant with the `Z` STRIPPED; the
--    seed writes zoneless Kyiv wall times. Migrating them as-is lands forms 2
--    and 3 two to three hours from their true instants, in opposite directions,
--    while form 1 is correct. `savedAt` is what renders the pinned
--    "Last saved 25.07, 21:14", so this changes displayed text. Normalize on
--    the way in; do not let the session zone decide.
--
-- 6. `deposit` / `withdrawal` ROWS CARRY A REAL `assetId` TODAY, not `''`.
--    `schemas.ts` declares `assetId` non-empty for all nine types and
--    `TransactionPanel` fills it with `assets[0].id`; `derive.ts` already calls
--    that value noise for a deposit. The migration must NULL it on those two
--    types — the constraint below enforces the target state, so an unconverted
--    row is rejected rather than absorbed.
--
-- THE OLD -> NEW `Transaction` MAPPING
--
--   id                         ->  id               SLUG TODAY — see (1) above
--   (none)                     ->  user_id          scope; no `portfolio` table
--   (none)                     ->  account_id       one row per provider/user
--   date                       ->  date             Kyiv calendar date
--   type                       ->  type             nine values; see below
--   assetId ('' = portfolio)   ->  asset_id         NULL, not '' — see (2)
--   amount                     ->  amount           positive, sign from type
--   (none)                     ->  quantity         REQUIRED on position-moving
--                                                   rows; unrecoverable if not
--                                                   captured — see (3)
--   (none)                     ->  unit_price       fees stay separate rows
--   (none)                     ->  settles_payout_id  `tax` rows ONLY; CANNOT
--                                                   be backfilled, which is why
--                                                   it goes in now
--   (none)                     ->  created_at
--   source                     ->  (NO COLUMN)      A REAL LOSS — see below
--
-- `source` IS NOT WRITE-ONLY, and the first draft claimed it was on a bad
-- measurement. Corrected 2026-08-26: `TransactionPanel.tsx` renders a `Select`
-- over `own | accrual | reinvest_reit | reinvest_6475` and writes the chosen
-- value on every recorded transaction, so a USER picks it; `csv.ts` exports it
-- as the sixth transaction column; and `json.ts` declares it a REQUIRED member
-- of a `z.strictObject`. What is true is narrower: no DERIVATION in `src/core/`
-- reads it. So dropping the column is a real decision with three consequences
-- W7 owns — a field leaves the form, the CSV header loses a column, and the
-- backup envelope's required member goes, which is a format-version question
-- and not an additive change. Seed rows `r1`–`r3` carry the two `reinvest_*`
-- values that contract 4 forbids, and they need a destination.
--
-- `dividend_accrual` (app) is the spec's `dividend_payout`. Same row, different
-- name; both lists are nine long. The type CHECK below spells the SPEC's names,
-- so the app's name is rejected until the migration maps it — which is the
-- behaviour wanted: a silent acceptance would split the vocabulary in two.
--
-- ============================================================================
-- REVIEW FINDINGS earlier drafts carried, kept so they are not re-made.
-- Round 1: surrogate `(id)` keys on three per-user tables (contract 3);
--   `source` declared write-only on a wrong measurement; "nothing is ever
--   deleted"; two `CREATE UNIQUE INDEX` outside the noted divergence; the
--   slug→UUID remap and `inzhur.units`, both unnamed.
-- Round 2: two CHECK constraints that REJECTED the app's real rows — the asset
--   biconditional against every recorded deposit, and a mandatory `quantity`
--   against all seven legacy position-moving rows; `UNIQUE
--   (settles_payout_id)` unscoped and therefore cross-tenant; `observed_at`
--   NOT NULL against 173 snapshots with no save time; a palette bound of 32
--   against a four-entry palette; `Snapshot.cash` and the timestamp encodings
--   absent from an inventory that claimed to be complete; and a completeness
--   claim about DSQL divergence with no precedent behind it.
-- Both rounds share one cause worth naming: every wrong claim came from
-- measuring against `seed.ts` and stopping there.
-- ============================================================================


-- One row per approved user. Also the OCC anchor (contract 2) and the
-- authorization record: the API Lambda checks `status` and `role` here on every
-- request, never `cognito:groups`, because group membership is stamped into a
-- token at issue time and a revocation would not take effect until refresh.
CREATE TABLE IF NOT EXISTS app_user (
  user_id       UUID        NOT NULL,   -- Cognito `sub`
  email         TEXT        NOT NULL,
  status        TEXT        NOT NULL,
  role          TEXT        NOT NULL,
  -- The dataset version. Contract 2: one counter for the whole of this user's
  -- data, bumped by every accepted mutation.
  data_version  BIGINT      NOT NULL DEFAULT 0,
  applied_at    TIMESTAMPTZ NOT NULL,
  decided_at    TIMESTAMPTZ,
  decided_by    UUID,                   -- the super-admin who ruled
  -- The three the W7 checklist pins. REVOCATION reuses `rejected` plus
  -- `AdminDisableUser`, per that checklist — so `rejected` covers both "the
  -- application was declined" and "an approved account was revoked", and
  -- `decided_at`/`decided_by` cannot tell them apart. Named because the table's
  -- comment above justifies the per-request status read by revocation needing to
  -- take effect before a token refresh, and a reader is entitled to ask which
  -- value carries it.
  CONSTRAINT app_user_status_ck CHECK (status IN ('pending', 'active', 'rejected')),
  CONSTRAINT app_user_role_ck   CHECK (role   IN ('user', 'super_admin')),
  -- A decision is recorded or it is not: `pending` has no decision, and
  -- anything else has both halves of one. The same shape as
  -- `asset_provider_pair_ck`, applied to the row the API Lambda reads for
  -- authorization on every request.
  CONSTRAINT app_user_decided_ck CHECK (
    (status = 'pending') = (decided_at IS NULL AND decided_by IS NULL)
  ),
  -- Inline, per the divergence note. It is BYTE-EXACT, which is worth knowing
  -- before crediting it with more than it does: `Roman@x.com` and
  -- `roman@x.com` are two values here, so this alone does not absorb a flood
  -- of case permutations. Cognito's own duplicate refusal (D36) normalizes the
  -- address and is what actually holds that line; this constraint stops a
  -- second DB row for an address Cognito already considers taken. If the API
  -- ever accepts an address Cognito has not seen, it must lower-case on write.
  CONSTRAINT app_user_email_uq UNIQUE (email),
  PRIMARY KEY (user_id)
);


-- One row per provider per user. Free cash is Σ across accounts and the
-- per-provider breakdown is a GROUP BY. Modelled from day one although Inzhur
-- is the only provider — cheap now, expensive to retrofit.
CREATE TABLE IF NOT EXISTS account (
  user_id     UUID        NOT NULL,
  id          UUID        NOT NULL,
  provider    TEXT        NOT NULL,
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL,
  -- "One row per provider per user" as a constraint, not a convention.
  CONSTRAINT account_user_provider_uq UNIQUE (user_id, provider),
  PRIMARY KEY (user_id, id)   -- contract 3
);


-- Per-user. Joins the GLOBAL price archive by provider ref — fund slug or bond
-- ISIN — which is why `provider_ref` mirrors `price_observation.instrument_ref`
-- exactly: ISIN for bonds, slug for funds, never the feed's numeric id.
CREATE TABLE IF NOT EXISTS asset (
  user_id         UUID        NOT NULL,
  id              UUID        NOT NULL,
  name            TEXT        NOT NULL,
  code            TEXT        NOT NULL,   -- 2 letters for the avatar
  -- Contract 4: a palette INDEX, not a holding name. Bounded so a typo cannot
  -- silently point past the palette.
  color_slot      SMALLINT    NOT NULL,
  -- NOT NULL because the app's `Asset` declares all four required. The first
  -- draft left them nullable, which would accept a row `/yield` and the
  -- rebalance target both read as a number.
  yield_type      TEXT        NOT NULL,
  expected_pct    NUMERIC     NOT NULL,
  target_pct      NUMERIC     NOT NULL,
  payout_schedule TEXT        NOT NULL,
  first_purchase  DATE        NOT NULL,
  -- Genuinely optional in the app, and optional here.
  maturity        DATE,
  coupon_amount   NUMERIC,
  next_coupon     DATE,
  reinvest_policy TEXT,
  -- The archive link. NULL = a hand-valued asset, which is not a lesser kind:
  -- D75 settled that whether a price can come from the archive is decided by
  -- whether this is set, never by a flag someone toggles.
  provider_kind   TEXT,
  provider_ref    TEXT,
  created_at      TIMESTAMPTZ NOT NULL,
  -- The REAL palette size. `COLOR_KEYS` in `src/core/colors.ts` has four
  -- entries and new assets cycle `% 4`, so a bound of 32 (the first draft)
  -- permitted 4..31 — every one of them an unpainted chart series, silently,
  -- which is what this constraint was added to prevent. Growing the palette
  -- moves this number; a CHECK is not a key, so that is an ALTER and not a
  -- DROP/CREATE.
  CONSTRAINT asset_color_slot_ck CHECK (color_slot >= 0 AND color_slot < 4),
  -- Two letters, because that is what the avatar circle renders.
  CONSTRAINT asset_code_ck CHECK (length(code) = 2),
  -- Percentages are percentages. Not bounded ABOVE at 100: a target may
  -- legitimately be small and an expected yield is not capped, but neither is
  -- negative.
  CONSTRAINT asset_expected_pct_ck CHECK (expected_pct >= 0),
  CONSTRAINT asset_target_pct_ck   CHECK (target_pct   >= 0 AND target_pct <= 100),
  CONSTRAINT asset_yield_type_ck CHECK (yield_type IN (
    'fixed_coupon', 'dividends', 'capitalization', 'div_cap'
  )),
  CONSTRAINT asset_payout_schedule_ck CHECK (payout_schedule IN (
    'maturity', 'monthly', 'quarterly', 'semiannual', 'none'
  )),
  CONSTRAINT asset_provider_kind_ck CHECK (provider_kind IN ('fund', 'bond')),
  -- Either both link columns or neither; a ref with no kind cannot be resolved.
  CONSTRAINT asset_provider_pair_ck CHECK (
    (provider_kind IS NULL) = (provider_ref IS NULL)
  ),
  PRIMARY KEY (user_id, id)   -- contract 3
);

-- Display order within one user (`listAssets`). The key already serves
-- "everything for this user"; this serves it SORTED.
CREATE INDEX IF NOT EXISTS asset_user_created
  ON asset (user_id, created_at);   -- ASYNC on DSQL


-- One signed movement on one provider account. The sign is a function of `type`
-- and is never stored (contract 5).
CREATE TABLE IF NOT EXISTS transaction (
  user_id           UUID        NOT NULL,
  id                UUID        NOT NULL,
  account_id        UUID        NOT NULL,
  date              DATE        NOT NULL,
  type              TEXT        NOT NULL,
  amount            NUMERIC     NOT NULL,
  -- NULL for portfolio-level rows (deposit / withdrawal), never ''. Enforced
  -- below, in both directions.
  asset_id          UUID,
  -- Required on position-moving rows, enforced below. Unrecoverable if not
  -- captured on the day; see migration note (3) for where the first values
  -- have to come from.
  quantity          NUMERIC,
  unit_price        NUMERIC,
  -- `tax` rows only, enforced below, and UNIQUE — which is what actually makes
  -- double counting structurally impossible. The first draft claimed that of a
  -- plain index, which two tax rows on one payout walk straight through.
  -- Postgres permits many NULLs in a UNIQUE, so non-tax rows are unaffected.
  settles_payout_id UUID,
  created_at        TIMESTAMPTZ NOT NULL,
  -- The SPEC's nine names. The app's `dividend_accrual` is rejected on purpose
  -- until the migration maps it to `dividend_payout`.
  CONSTRAINT transaction_type_ck CHECK (type IN (
    'deposit', 'withdrawal', 'buy', 'sell', 'dividend_payout',
    'interest_payout', 'tax', 'reinvest', 'redemption'
  )),
  CONSTRAINT transaction_amount_ck CHECK (amount > 0),
  -- Contract 5: a quantity is not redundant with the type, so it is bounded too.
  CONSTRAINT transaction_quantity_sign_ck CHECK (quantity IS NULL OR quantity > 0),
  CONSTRAINT transaction_unit_price_ck    CHECK (unit_price IS NULL OR unit_price > 0),
  -- ONE WAY ONLY: a row that moves no position must not invent a quantity.
  -- The converse is NOT a CHECK, and that is forced rather than chosen.
  -- `Transaction` has no quantity field at all today, so the 4 `buy` and 3
  -- `reinvest` rows in the seed carry none and none can be reconstructed —
  -- `Asset.inzhur.units` is a CURRENT TOTAL per asset and does not decompose
  -- into per-transaction quantities. A hard CHECK would reject every legacy
  -- position-moving row, i.e. the whole buy history and the reinvest chain. So
  -- the requirement is APPLICATION-ENFORCED on new rows, and the asymmetry —
  -- legacy rows with no quantity, new rows with one — is permanent and is why
  -- the spec calls the value unrecoverable if not captured on the day.
  CONSTRAINT transaction_quantity_absent_ck CHECK (
    type IN ('buy', 'sell', 'reinvest', 'redemption') OR quantity IS NULL
  ),
  -- TWO ONE-WAY RULES, not a biconditional. The first draft used
  -- `(type IN ('deposit','withdrawal')) = (asset_id IS NULL)` and it was wrong
  -- in both directions: it rejected every deposit the app actually records
  -- (`schemas.ts` declares `assetId` non-empty for ALL nine types and
  -- `TransactionPanel` fills it with `assets[0].id`), and it FORCED an asset
  -- onto every `tax` row, while the spec says an asset is required on a tax row
  -- only when the tax relates to a payout.
  CONSTRAINT transaction_asset_absent_ck CHECK (
    type NOT IN ('deposit', 'withdrawal') OR asset_id IS NULL
  ),
  CONSTRAINT transaction_asset_present_ck CHECK (
    type NOT IN ('buy', 'sell', 'reinvest', 'redemption') OR asset_id IS NOT NULL
  ),
  CONSTRAINT transaction_settles_ck CHECK (
    settles_payout_id IS NULL OR type = 'tax'
  ),
  -- USER-SCOPED. An unqualified `UNIQUE (settles_payout_id)` constrains half a
  -- key — `transaction`'s identity here is `(user_id, id)` — so one user's tax
  -- row would block another's, and on DSQL it would be one global index every
  -- tax insert contends on, which is the write-distribution problem contract 3
  -- exists to avoid.
  CONSTRAINT transaction_settles_uq UNIQUE (user_id, settles_payout_id),
  PRIMARY KEY (user_id, id)   -- contract 3
);

-- The ledger in date order for one user. The key already serves "everything for
-- this user"; this serves it sorted, which is what every screen shows.
CREATE INDEX IF NOT EXISTS transaction_user_date
  ON transaction (user_id, date);   -- ASYNC on DSQL


-- The user's own price observations, left-joined at read time:
--   value(a, D) = units(a, D) × coalesce(user_price(a, D), archive(a, D))
-- D33. The global archive stays provider-only, so prices remain a single source
-- of truth, while a hand-entered value stays the account's own data — which is
-- what the 174 existing snapshots always were. The W7 migration MUST carry them
-- here; discarding them deletes five months no source can regenerate.
CREATE TABLE IF NOT EXISTS user_price (
  user_id     UUID        NOT NULL,
  asset_id    UUID        NOT NULL,
  as_of       DATE        NOT NULL,
  price       NUMERIC     NOT NULL,
  -- NULLABLE, and forced rather than chosen: `Snapshot.savedAt` is optional and
  -- the seed sets it on exactly ONE of the 174 dates (2026-07-25). NOT NULL
  -- would either reject 173 rows or make the migration invent a witness time
  -- that never happened — the poisoning the archive's own contracts exist to
  -- prevent. A NULL here means "carried from a snapshot that recorded no save
  -- time", which is the truth.
  observed_at TIMESTAMPTZ,
  CONSTRAINT user_price_price_ck CHECK (price > 0),
  -- Contract 3, and the natural key needs no surrogate: the read is "this
  -- asset over time" for one user, so user -> asset -> date IS the access path.
  PRIMARY KEY (user_id, asset_id, as_of)
);
