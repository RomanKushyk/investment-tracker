// The Drizzle source for `infra/migrations/drafts/003_user_schema.sql`.
//
// This file is the schema; the SQL is generated from it and must never be
// hand-edited (see `infra/drizzle.config.ts` for the generate procedure).
// Keep this file's constraint names identical to the generated SQL's so the
// two stay comparable statement for statement. **This schema declares no
// FOREIGN KEY, and that is a ruling, not an omission (D101):** DSQL has had
// them since 2026-08-26 and they can be added later, so W7 ships without and
// O33 decides whether they are ever adopted. Do not add one here to "fix" a
// dangling reference — that is the application's job until O33 says otherwise.
// **Adding one later is not free, and neither is adding one here.** Later: it
// arrives `NOT VALID` permanently — every subsequent write is guarded, the rows
// already present never are, and `VALIDATE CONSTRAINT` is refused — so adopt
// only behind a clean integrity audit. Here: drizzle emits a `references()` as
// a bare `ALTER TABLE … ADD CONSTRAINT`, which DSQL refuses outright unless
// promotion appends `NOT VALID` — a third rewrite rule that does not exist yet
// (D100). DSQL environment facts (the two-step index promotion,
// what ALTER TABLE can and cannot do, replay behaviour) live in
// `infra/migrations/drafts/README.md`; W7's data-migration notes live in
// `docs/reference/w7-migration-translations.md`. The PGlite suite this file's
// constraints run against (`infra/src/user-schema.test.ts`) proves nothing
// about those translations — they are data problems, not schema ones.
//
// EVERY PER-USER TABLE LEADS ITS PRIMARY KEY WITH `user_id` (contract 3).
// DSQL's primary key is index-organized, so key order IS the access path,
// and it is immutable once applied (D30). Partly observed 2026-08-27 rather
// than only documented: the cluster read `account`'s key back as `USING
// btree_index (user_id, id) INCLUDE (provider, name, created_at)` — its three
// non-key columns — and a 3-column probe table the same way. TWO tables, so
// "every table carries every non-key column" stays documentation (D99);
// `asset`, at 17 columns, was not read back.
// The dominant read is `GET /state`
// — one user's whole dataset — so `(user_id, id)` makes that a contiguous
// range scan, while a bare surrogate `(id)` would be a secondary-index scan
// with a row fetch per row. This resolves the tension the two applied
// migrations sit on either side of: `001_price_capture.sql` keys on a random
// UUID to spread writes across the key range, per DSQL's own guidance;
// `002_price_observation.sql` keys naturally because its read contract
// serves whole years. Leading with `user_id` gets both — a Cognito `sub` is
// itself a random UUID, so writes still spread, while one user's rows stay
// contiguous for the read that matters.
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  bigint,
} from 'drizzle-orm/pg-core';

// One row per approved user. Also the OCC anchor (see `dataVersion` below)
// and the authorization record: the API Lambda checks `status` and `role`
// here on every request, never `cognito:groups`.
export const appUser = pgTable(
  'app_user',
  {
    userId: uuid('user_id').notNull(), // Cognito `sub`
    email: text().notNull(),
    status: text().notNull(),
    role: text().notNull(),
    // One counter for the whole of this user's data, bumped by every
    // accepted mutation. A per-TABLE version cannot implement a
    // dataset-level `If-Match`, which is why there is one column here rather
    // than one per table. It lives here, not in a table of its own, because
    // the API Lambda already loads this row on every request — to scope by
    // `user_id` and check `status` — so the read is free. `If-Match` is
    //   UPDATE app_user SET data_version = data_version + 1
    //    WHERE user_id = $1 AND data_version = $2
    // and the CONFLICT DETECTOR IS THE ROWCOUNT: 0 rows means someone else
    // moved first, which is a 412. Retrying SQLSTATE 40001 at COMMIT is
    // SERIALIZATION, a different failure — retrying it is safe precisely
    // because the rowcount check is what makes the mutation conditional.
    dataVersion: bigint('data_version', { mode: 'number' }).notNull().default(0),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by'), // the super-admin who ruled
  },
  (t) => [
    check('app_user_status_ck', sql`${t.status} IN ('pending', 'active', 'rejected')`),
    check('app_user_role_ck', sql`${t.role} IN ('user', 'super_admin')`),
    // A decision is recorded or it is not: `pending` has no decision, and
    // anything else has both halves of one.
    check(
      'app_user_decided_ck',
      sql`(${t.status} = 'pending') = (${t.decidedAt} IS NULL AND ${t.decidedBy} IS NULL)`,
    ),
    // Byte-exact: Cognito's own duplicate refusal (D36) is what actually
    // holds the "one address, one account" line; this stops a second DB row
    // for an address Cognito already considers taken.
    unique('app_user_email_uq').on(t.email),
    primaryKey({ columns: [t.userId] }),
  ],
);

// One row per provider per user. Free cash is Σ across accounts and the
// per-provider breakdown is a GROUP BY.
export const account = pgTable(
  'account',
  {
    userId: uuid('user_id').notNull(),
    id: uuid().notNull(),
    provider: text().notNull(),
    name: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    // "One row per provider per user" as a constraint, not a convention.
    unique('account_user_provider_uq').on(t.userId, t.provider),
    primaryKey({ columns: [t.userId, t.id] }), // contract 3
  ],
);

// Per-user. Joins the GLOBAL price archive by provider ref — fund slug or bond
// ISIN — which is why `providerRef` mirrors `price_observation.instrument_ref`
// exactly.
export const asset = pgTable(
  'asset',
  {
    userId: uuid('user_id').notNull(),
    id: uuid().notNull(),
    name: text().notNull(),
    code: text().notNull(), // 2 letters for the avatar
    colorSlot: smallint('color_slot').notNull(),
    yieldType: text('yield_type').notNull(),
    expectedPct: numeric('expected_pct').notNull(),
    targetPct: numeric('target_pct').notNull(),
    payoutSchedule: text('payout_schedule').notNull(),
    firstPurchase: date('first_purchase').notNull(),
    // Genuinely optional in the app, and optional here.
    maturity: date(),
    couponAmount: numeric('coupon_amount'),
    nextCoupon: date('next_coupon'),
    reinvestPolicy: text('reinvest_policy'),
    // The archive link. NULL = a hand-valued asset (D75).
    providerKind: text('provider_kind'),
    providerRef: text('provider_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    // NO CHECK IN THIS FILE MAY ENUMERATE A VALUE NAMING A SPECIFIC HOLDING —
    // the spec's one explicit DDL rule, for any table, not only this one.
    // `color_slot` is a palette INDEX rather than a `reit | energy | ovdp...`
    // enum for exactly this reason: a CHECK that names a holding turns "the
    // user sold it" into a migration. It does not exempt a closed
    // vocabulary that names no holding — `yield_type` and `payout_schedule`
    // below are constrained for exactly that reason.
    //
    // The REAL palette size: `COLOR_KEYS` in `src/core/colors.ts` has four
    // entries and new assets cycle `% 4`.
    check('asset_color_slot_ck', sql`${t.colorSlot} >= 0 AND ${t.colorSlot} < 4`),
    // Two letters, because that is what the avatar circle renders.
    check('asset_code_ck', sql`length(${t.code}) = 2`),
    // Percentages are percentages. Not bounded ABOVE at 100: a target may
    // legitimately be small and an expected yield is not capped, but neither
    // is negative.
    check('asset_expected_pct_ck', sql`${t.expectedPct} >= 0`),
    check('asset_target_pct_ck', sql`${t.targetPct} >= 0 AND ${t.targetPct} <= 100`),
    check(
      'asset_yield_type_ck',
      sql`${t.yieldType} IN ('fixed_coupon', 'dividends', 'capitalization', 'div_cap')`,
    ),
    check(
      'asset_payout_schedule_ck',
      sql`${t.payoutSchedule} IN ('maturity', 'monthly', 'quarterly', 'semiannual', 'none')`,
    ),
    check('asset_provider_kind_ck', sql`${t.providerKind} IN ('fund', 'bond')`),
    // Either both link columns or neither; a ref with no kind cannot be
    // resolved.
    check('asset_provider_pair_ck', sql`(${t.providerKind} IS NULL) = (${t.providerRef} IS NULL)`),
    primaryKey({ columns: [t.userId, t.id] }), // contract 3
    // Display order within one user (`listAssets`). The key already serves
    // "everything for this user"; this serves it SORTED. On DSQL, promotion
    // adds ASYNC and strips `USING btree` — both, or the statement fails (D99).
    index('asset_user_created').on(t.userId, t.createdAt),
  ],
);

// One signed movement on one provider account. The sign of `amount` is a
// function of `type` and is never stored — it lives in application code,
// not in this schema.
export const transaction = pgTable(
  'transaction',
  {
    userId: uuid('user_id').notNull(),
    id: uuid().notNull(),
    accountId: uuid('account_id').notNull(),
    date: date().notNull(),
    type: text().notNull(),
    amount: numeric().notNull(),
    // NULL for portfolio-level rows (deposit / withdrawal), never ''.
    // Enforced below, in both directions.
    assetId: uuid('asset_id'),
    // Required on position-moving rows, enforced below.
    quantity: numeric(),
    unitPrice: numeric('unit_price'),
    // `tax` rows only, enforced below, and UNIQUE — which is what actually
    // makes double counting structurally impossible.
    settlesPayoutId: uuid('settles_payout_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    // The SPEC's nine names. The app's `dividend_accrual` is rejected on
    // purpose until the migration maps it to `dividend_payout`.
    check(
      'transaction_type_ck',
      sql`${t.type} IN ('deposit', 'withdrawal', 'buy', 'sell', 'dividend_payout',
        'interest_payout', 'tax', 'reinvest', 'redemption')`,
    ),
    check('transaction_amount_ck', sql`${t.amount} > 0`),
    // A negative quantity would flip a position movement independently of
    // `type`, and nothing else records units.
    check('transaction_quantity_sign_ck', sql`${t.quantity} IS NULL OR ${t.quantity} > 0`),
    check('transaction_unit_price_ck', sql`${t.unitPrice} IS NULL OR ${t.unitPrice} > 0`),
    // ONE WAY ONLY: a row that moves no position must not invent a quantity.
    // The converse is application-enforced, not a CHECK — legacy rows carry
    // no quantity and cannot be reconstructed.
    check(
      'transaction_quantity_absent_ck',
      sql`${t.type} IN ('buy', 'sell', 'reinvest', 'redemption') OR ${t.quantity} IS NULL`,
    ),
    // THE PRICE TAKES THE SAME RULE AS THE COUNT. It is the other half of one
    // fact — what a position movement cost per unit — and the app enforces both
    // at all three of its doors (the form, the derivation, the backup importer).
    // A schema that governs only the count leaves the store the app mirrors
    // weaker than the app, so a `unit_price` on a payout survives a migration
    // the application would have refused.
    check(
      'transaction_unit_price_absent_ck',
      sql`${t.type} IN ('buy', 'sell', 'reinvest', 'redemption') OR ${t.unitPrice} IS NULL`,
    ),
    // TWO ONE-WAY RULES, not a biconditional: `(type IN ('deposit',
    // 'withdrawal')) = (asset_id IS NULL)` would reject every deposit the
    // app records today (`schemas.ts` fills `assetId` for all nine
    // transaction types) and force an asset onto every `tax` row, when the
    // spec requires one only when the tax relates to a payout.
    check(
      'transaction_asset_absent_ck',
      sql`${t.type} NOT IN ('deposit', 'withdrawal') OR ${t.assetId} IS NULL`,
    ),
    check(
      'transaction_asset_present_ck',
      sql`${t.type} NOT IN ('buy', 'sell', 'reinvest', 'redemption') OR ${t.assetId} IS NOT NULL`,
    ),
    check('transaction_settles_ck', sql`${t.settlesPayoutId} IS NULL OR ${t.type} = 'tax'`),
    // USER-SCOPED. An unqualified UNIQUE(settles_payout_id) would constrain
    // half a key and, on DSQL, contend as one global index on every tax
    // insert.
    unique('transaction_settles_uq').on(t.userId, t.settlesPayoutId),
    primaryKey({ columns: [t.userId, t.id] }), // contract 3
    // The ledger in date order for one user. On DSQL, promotion adds ASYNC and
    // strips `USING btree` — both, or the statement fails (D99).
    index('transaction_user_date').on(t.userId, t.date),
  ],
);

// The user's own price observations, left-joined at read time:
//   value(a, D) = units(a, D) × coalesce(user_price(a, D), archive(a, D))
// The global archive stays provider-only; a hand-entered value stays the
// account's own data.
export const userPrice = pgTable(
  'user_price',
  {
    userId: uuid('user_id').notNull(),
    assetId: uuid('asset_id').notNull(),
    asOf: date('as_of').notNull(),
    price: numeric().notNull(),
    // NULLABLE: `Snapshot.savedAt` is optional and most carried-forward rows
    // record no witness time.
    observedAt: timestamp('observed_at', { withTimezone: true }),
  },
  (t) => [
    check('user_price_price_ck', sql`${t.price} > 0`),
    // Contract 3, and the natural key needs no surrogate: the read is "this
    // asset over time" for one user, so user -> asset -> date IS the access
    // path.
    primaryKey({ columns: [t.userId, t.assetId, t.asOf] }),
  ],
);
