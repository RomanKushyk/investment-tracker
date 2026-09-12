// The Drizzle source for `infra/migrations/drafts/003_user_schema.sql`.
//
// This file is the schema; the SQL is generated from it and must never be
// hand-edited (see `infra/drizzle.config.ts` for the generate procedure).
// Keep this file's constraint names identical to the generated SQL's so the
// two stay comparable statement for statement. **O33 RULED 2026-09-03 (D137,
// amending D101, and D138 for the action): this schema IS RULED to take foreign
// keys with `ON DELETE RESTRICT`, and it DECLARES NONE YET.** There is no
// foreign key below, so the generated SQL carries no `ADD CONSTRAINT` — that is
// W7's work, not a broken generator.
// The instruction here used to be the opposite and is retracted, not softened —
// "declares no FOREIGN KEY … do not add one here to 'fix' a dangling reference"
// was D101's ruling and D101 is amended.
//
// **`ON DELETE RESTRICT`, never `CASCADE`** (D137 for the shape, **D138 for the
// action** — D137 said `NO ACTION` and was superseded). **`CASCADE` is out**
// because AWS's `CREATE TABLE` guidance says cascading actions count towards the
// transaction modification limit, and DSQL's is 3 000 mutated rows against a
// `user_price` grain of one row per asset per date — so it would not have
// removed the batching it appears to replace.
//
// **USE `foreignKey({ name, columns, foreignColumns }).onDelete('restrict')`
// FOR ALL FIVE — including the two single-column ones.** A draft of this comment
// prescribed the column-level `references(ref, { onDelete: 'restrict' })` for
// those two; it works, but it **cannot carry a NAME** (only `foreignKey()`'s
// config has a `name` slot), so drizzle derives one —
// `account_user_id_app_user_user_id_fk`. This file's own header requires
// constraint names identical to the generated SQL's, and
// `infra/docs/dsql-constraints.md` already records the intended shape as
// `account_user_fk`. **One form for all five keeps the names ours and the rule
// unbroken.** Three API facts, all checked against the installed drizzle:
//
//   1. Column-level `references(ref, actions?)` is SINGLE-COLUMN, so it could
//      not express three of these five anyway. They are composite because
//      contract 3 leads each per-user PK with `user_id`:
//        - `transaction.(user_id, asset_id)          -> asset.(user_id, id)`
//        - `transaction.(user_id, account_id)        -> account.(user_id, id)`
//        - `user_price.(user_id, asset_id)           -> asset.(user_id, id)`
//      Writing `references(() => asset.id, ...)` emits a single-column reference
//      to `asset("id")`, which has no unique constraint, and the cluster rejects
//      it `42830`. **TWO of the five are single-column** — `app_user`'s PK is
//      `(user_id)` alone — and they take the same table-level builder, for the
//      naming reason above:
//        - `account.user_id -> app_user.user_id`
//        - `asset.user_id   -> app_user.user_id`
//      The second was missing from a first draft of this list. `transaction`
//      reaches `app_user` through `account` and `user_price` through `asset`,
//      but **`asset`'s own `user_id` anchors to nothing**, so without it an
//      asset row for a nonexistent user stays possible after W7 ships.
//   2. `foreignKey()`'s config takes `name`/`columns`/`foreignColumns` —
//      **the action is a chained method, not a config field.**
//   3. A column-level `references()` has no `name` slot at all, which is what
//      rules it out here even for the two keys it could express.
//
// **`no action` IS DRIZZLE'S DEFAULT**, so omitting `.onDelete('restrict')`
// silently emits `ON DELETE no action`, the action D138 supersedes.
//
// **`schema-generated.test.ts` IS NOT A GUARD HERE** — it regenerates the SQL
// FROM THIS FILE and compares it to the committed `003_user_schema.sql`, which
// is regenerated whenever the schema changes: omit the action and BOTH sides say
// `no action`, and it is green. It catches a hand edit of the artifact, never a
// wrong action in the source.
//
// **THE GUARD IS A TEXT ASSERTION OVER THE GENERATED SQL** — assert each of the
// five keys carries `ON DELETE restrict`. Cheap, deterministic, and it catches
// exactly the omission above.
//
// **DO NOT REACH FOR A BEHAVIOURAL TEST ON THE ASSET/TRANSACTION PAIR.** Three drafts
// of this comment went wrong here in three directions — the last claimed
// `RESTRICT` and `no action` are distinguishable by one
// `DELETE FROM transaction WHERE asset_id = $1`. **Measured in PGlite: that
// statement SUCCEEDS under both.** Postgres fires `RESTRICT` as a
// non-deferrable AFTER-ROW trigger at end of STATEMENT, exactly like
// `NO ACTION`; what separates them is deferrability ACROSS statements. A test
// asserting a difference there fails, and the natural fix is to weaken it into
// one that proves nothing — the `D43`/`D89` shape `RULES.md` catalogues.
//
// **And the refusal's SQLSTATE differs by engine:** PGlite/Postgres gives
// `23001` for `RESTRICT`, while DSQL gives `23503`
// (`infra/docs/dsql-constraints.md`). Anything branching on the code
// matches on the cluster and misses locally.
//
// **`NO ACTION` is out because this repository has never probed it, in any
// shape.** `RESTRICT`, the action chosen over it, is probed — but only INLINE,
// inside a `CREATE TABLE`, and **not** in the post-hoc
// `ALTER TABLE … ADD CONSTRAINT … NOT VALID` form drizzle emits and this phase
// ships. (`CASCADE`, which is rejected on other grounds, IS the one measured in
// that shipping form.) So the chosen action still owes a DSQL round in the
// shape it will actually take — D138 says so, and it is obligation 5 in W7's
// body.
// `infra/docs/dsql-constraints.md`'s foreign-key section records them and is
// the provenance. **It records that `RESTRICT` was verified inline in `CREATE
// TABLE`, not yet in the `ALTER TABLE` form drizzle emits**, which is the
// measurement this ruling turns on and which D138 and
// `https://github.com/RomanKushyk/investment-tracker/issues/48`
// both cite. The rest of that section draws on the page's own rounds 6-7
// without splitting them further, so cite the page for anything beyond
// `RESTRICT`.
//
// **Deletion is a BATCHED application cascade** — the asset's transactions,
// then `user_price`, and the asset LAST so a failure midway is resumable.
// **IT USED TO HAVE A STEP ZERO and no longer does**: a batched `UPDATE` that
// nulled every settlement link pointing INTO this asset, which existed only to
// make the self-referential `settles_payout_id` key safe. That key is not
// declared — a withholding is a field on the payout it was taken from
// (`docs/superpowers/specs/2026-09-12-tax-on-the-payout-design.md`) — so there
// is nothing left to null, and the sequence is three steps rather than four.
// With it went the resume hazard that step owned: no row inserted between two
// batches can re-create a reference, because no transaction references another
// at all. Resume still means resume the SEQUENCE (D138), for the ordinary
// reason that a partly-deleted asset's children may already be gone.
// (This comment previously ordered the two children the other way
// round. **Nothing turns on it** — neither child references the other, so any
// order satisfies the keys.) **The exact SQL is D138's and is deliberately NOT copied here** —
// it has three properties a paraphrase loses: every predicate is USER-SCOPED
// (`id` is unique only within a user, which is what the composite primary key
// below says), each step batches through a key-set sub-select because Postgres
// accepts no `LIMIT` on `UPDATE`/`DELETE`, and **each batch is its own
// TRANSACTION**, since DSQL's 3 000-row ceiling is per transaction and a loop
// inside one would not clear it.
//
// **Adding one is not free.** Drizzle emits a foreign key — the column-level
// `references()` and the table-level `foreignKey()` builder alike — as a bare
// `ALTER TABLE … ADD CONSTRAINT`, which DSQL refuses unless promotion appends
// `NOT VALID` — the third rewrite rule, which D137 makes live rather than
// conditional. At W7 that `ALTER` runs on newly created EMPTY tables and W7
// seeds fresh data (D128), so the key skips no rows: D101's clean-audit
// precondition is met by there being nothing to audit. DSQL environment facts (the two-step index promotion,
// what ALTER TABLE can and cannot do, replay behaviour) live in
// `infra/migrations/drafts/README.md`; W7's data-migration notes live in
// issue #46. The PGlite suite this file's
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
    // BOTH, and the app writes only the second. `coupon_amount` is the whole-
    // position ₴ figure the form used to ask for; `coupon_rate_pct` is the fixed
    // annual rate that replaced it (D119), from which the ₴ is derived as
    // `rate/100 ÷ paymentsPerYear × 1000 × units`. The legacy column stays
    // because assets created before that date carry a figure and no rate, and
    // their ledgers hold no quantities to scale a rate by — dropping it would
    // land those bonds here with no coupon at all.
    couponAmount: numeric('coupon_amount'),
    couponRatePct: numeric('coupon_rate_pct'),
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
    // THE SAME RANGE THE FORM AND THE BACKUP ENFORCE (D119). A rate is a
    // percentage of the ₴1000 face, so 0 and negatives are not smaller rates —
    // they are values `couponPerPayment` treats as absent, falling back to the
    // legacy amount with nothing to say it did.
    check(
      'asset_coupon_rate_pct_ck',
      sql`${t.couponRatePct} IS NULL OR (${t.couponRatePct} > 0 AND ${t.couponRatePct} <= 100)`,
    ),
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
    // What the provider withheld from THIS payout. Payout rows only and
    // strictly below the amount, both enforced below. ONE figure rather than
    // two: a taxed distribution here carries income tax and the military levy,
    // but the provider reports a single withheld number, so recording the two
    // apart would mean deriving them from the rates — and a computed figure
    // eventually lies where a recorded one cannot. A second column stays
    // additive if a screen ever needs the components.
    taxWithheld: numeric('tax_withheld'),
    // The row's own line of context, 1..100 characters. The cap is a DESIGN
    // constraint before it is a database one — the ledger row renders it, and
    // `design/extensions/withholding-and-note.dc.html` T5 holds the
    // measurements that pick the number. Counted in characters and not lines
    // because a line count is not a thing SQL checks.
    note: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    // The SPEC's eight names. The app's `dividend_accrual` is rejected on
    // purpose until the migration maps it to `dividend_payout`.
    //
    // `tax` LEFT on the redesign: a withholding is a field on the payout it was
    // taken from, never a row of its own. The self-referential key that was to
    // tie the two together described a graph — chains, settlers naming no
    // asset, cross-asset settlement, a cycle an `UPDATE` can build — where the
    // application only ever wanted one sentence.
    check(
      'transaction_type_ck',
      sql`${t.type} IN ('deposit', 'withdrawal', 'buy', 'sell', 'dividend_payout',
        'interest_payout', 'reinvest', 'redemption')`,
    ),
    check('transaction_amount_ck', sql`${t.amount} > 0`),
    // A negative quantity would flip a position movement independently of
    // `type`, and nothing else records units.
    check('transaction_quantity_sign_ck', sql`${t.quantity} IS NULL OR ${t.quantity} > 0`),
    check('transaction_unit_price_ck', sql`${t.unitPrice} IS NULL OR ${t.unitPrice} > 0`),
    // A row that moves no position must not invent a quantity. THE CONVERSE IS
    // NOW A CHECK TOO — `transaction_quantity_required_ck`, declared below,
    // added when W7 stopped migrating legacy rows and started seeding fresh ones
    // (D125/D128). This comment used to end "application-enforced, not a CHECK,
    // because legacy rows carry no quantity and cannot be reconstructed", which
    // was true until there were no legacy rows to carry.
    check(
      'transaction_quantity_absent_ck',
      sql`${t.type} IN ('buy', 'sell', 'reinvest', 'redemption') OR ${t.quantity} IS NULL`,
    ),
    // THE CONVERSE (D125). A row that moves a position must state its count.
    //
    // NO BACKFILL STEP IS OWED, and an earlier version of this comment said one
    // was. D112 declined this CHECK because pre-#31 rows have none and their
    // counts are unrecoverable — true, and irrelevant here: **W7 seeds fresh
    // demo data rather than carrying the local store across** (owner,
    // 2026-09-01, `docs/plans/phase-w-i-ii-iii.md`). There is no live user and
    // so no history to migrate, which is the same premise D128 rests on. The
    // constraint is simply true of everything that will ever be written.
    //
    // The store must not be weaker than the app, which is the argument the
    // `unit_price` check beside this one already makes. With the count required
    // at the form (D124) and at the backup importer, a schema that still
    // accepted a count-less `buy` would let a migration land rows the
    // application itself refuses to write — and every coupon figure D119
    // derives is `rate × units`, so such a row values its whole position at
    // nothing and says nothing about why.
    check(
      'transaction_quantity_required_ck',
      sql`${t.type} NOT IN ('buy', 'sell', 'reinvest', 'redemption') OR ${t.quantity} IS NOT NULL`,
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
    // THE WITHHOLDING'S TRIO, shaped after the `quantity` one above. NULL is the
    // only spelling of "none", exactly as it is there — a withholding of zero
    // and no withholding are one state, and the bond half of this portfolio is
    // always in it.
    check(
      'transaction_tax_absent_ck',
      sql`${t.type} IN ('dividend_payout', 'interest_payout') OR ${t.taxWithheld} IS NULL`,
    ),
    check('transaction_tax_sign_ck', sql`${t.taxWithheld} IS NULL OR ${t.taxWithheld} > 0`),
    // STRICTLY below: a withholding that is the whole payout leaves nothing
    // received. It catches a decimal slipped the wrong way UP — 654,40 on a
    // payout of 467,46 — and deliberately not one slipped DOWN, which stays a
    // plausible figure no constraint can tell from a real one.
    check(
      'transaction_tax_bound_ck',
      sql`${t.taxWithheld} IS NULL OR ${t.taxWithheld} < ${t.amount}`,
    ),
    // 1..100, and NULL for none. The empty string is refused rather than
    // normalized here because this is the store: the FORM is where a blank
    // field becomes an absent one, and a row reaching this far with `''` came
    // from somewhere that skipped it.
    // NOT ENTIRELY WHITESPACE, which subsumes "not empty" — the zero-length
    // string matches `^[[:space:]]*$` too, so one predicate covers both ends.
    // This is the one place the three doors did not agree: the form turns a note
    // of spaces into absence and the backup envelope refuses one, while a bare
    // `length > 0` accepted it, and such a note renders as an EMPTY second line
    // on the ledger, drawn for nobody.
    //
    // `btrim` WAS THE FIRST SPELLING AND IS WRONG: its default character set is
    // the SPACE alone, so a note of a single tab passed it — measured in PGlite.
    // The POSIX class is what matches the `String.trim()` the other two doors
    // use. The upper bound stays on the RAW length, which is what keeps the app
    // unable to write a row this refuses.
    //
    // It diverges from the clause issue #46 quotes, deliberately: that text
    // predates the question, and «NULL is the only spelling of none» is the
    // intent it was written to serve.
    check(
      'transaction_note_ck',
      sql`${t.note} IS NULL OR (${t.note} !~ '^[[:space:]]*$' AND length(${t.note}) <= 100)`,
    ),
    // TWO ONE-WAY RULES THAT NOW MEET IN THE MIDDLE, and the second half is
    // what keeps a withholding attributable. They used to leave a gap on
    // purpose: a biconditional would have forced an asset onto every `tax`
    // row, and the spec wanted one only where the tax related to a payout. With
    // that type retired there are eight types, two must name NO asset and six
    // must name one, and across the eight the two rules ARE the biconditional —
    // no type is left to judgement for the first time.
    //
    // THE WIDENING IS NOT COSMETIC. Taxes are attributed by the row's OWN asset
    // (`sumByAsset` keys on it), so a payout naming none would put its
    // withholding under the empty key: no per-asset consumer reads it while the
    // portfolio totals still count it, and the maps and the totals disagree —
    // worse than a gap, because nothing looks missing. Requiring the asset
    // closes that at the source and spares the withholding a guard of its own.
    //
    // The store has been looser than the form here for no recorded reason — the
    // form has always asked for an asset on a payout — so this is the two
    // agreeing rather than a new rule.
    //
    // `transaction_asset_absent_ck` USED TO BE THE SECOND REASON, and it was
    // the app that was wrong: `schemas.ts` filled `assetId` for all nine types,
    // so this CHECK would have rejected every deposit the app had ever
    // recorded — while the seed, the backup importer and the ledger row all
    // already used `''` for exactly these two types. D129 made the form agree
    // with them.
    //
    // THE MIGRATION IS NOT DISCHARGED BY THAT, and the column's own comment
    // above says why: NULL, never `''`. D129 retires item 3 of
    // issue #46 — there is no longer a
    // borrowed real id to identify and strip — and leaves item 2 exactly where
    // it was: `''` is not a uuid, so a migration that copies Dexie's value
    // verbatim still fails this CHECK. Translate, do not copy.
    check(
      'transaction_asset_absent_ck',
      sql`${t.type} NOT IN ('deposit', 'withdrawal') OR ${t.assetId} IS NULL`,
    ),
    check(
      'transaction_asset_present_ck',
      sql`${t.type} NOT IN ('buy', 'sell', 'reinvest', 'redemption', 'dividend_payout',
        'interest_payout') OR ${t.assetId} IS NOT NULL`,
    ),
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
