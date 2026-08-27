# W7 migration translations — the app's data, translated for the schema

The user schema (`infra/schema/user.ts`) does not accept `src/lib/seed.ts`'s
shape, or the live app's, as-is. Seven translations are needed when W7
migrates existing data into it, carried here from the hand-written migration
draft's header before generation retired that header. Each one loses
something real if skipped.

## 1. IDs are slugs today; the schema says UUID

`seed.ts` assigns `'reit'`, `'energy'`, `'ovdp8976'`, `'ovdp6475'` and
transaction ids `'d1'`…`'r3'`; every one of the <!--f:seed.snapshots-->174<!--/f--> snapshots keys its
`quotes` map by those same asset slugs. A slug→UUID remap is needed across
`asset.id`, `transaction.id`, `transaction.asset_id`, `user_price.asset_id`
AND every snapshot quote key. Skipping this loses the <!--f:seed.snapshots-->174<!--/f--> snapshots — D33
says they cannot be regenerated.

## 2. `assetId` is `''` on the seed's portfolio-level rows

In SQL that is NULL. Empty string and NULL are different values; translate,
do not copy. Measured against `seed.ts` alone — item 3 below is the other
half, measured against the live app.

## 3. `deposit`/`withdrawal` rows carry a REAL `assetId` today, not `''`

`schemas.ts` declares `assetId` non-empty for all nine transaction types and
`TransactionPanel` fills it with `assets[0].id`; `derive.ts` already treats
that value as noise for a deposit. The migration must NULL it on these two
types — `transaction_asset_absent_ck` enforces the target state, so an
unconverted row is rejected rather than silently absorbed.

## 4. `Asset.inzhur.units` is the only place unit counts exist today

The schema has no column for a running total — deliberately, since units
become a derivation (`units(a, D) = Σ quantity deltas`) rather than a stored
total. That makes the existing value the ONLY seed for `transaction.quantity`,
and it is unrecoverable if not captured during the migration. It is exported
in the CSV today (`csv.ts`), so it also exists outside the database.

## 5. `Snapshot.cash` has no column, and no home is decided

All <!--f:seed.snapshots-->174<!--/f--> snapshots store a cash balance (`types.ts`: `Snapshot.cash: number`),
and the model's answer is derivation — `free_cash(D) = Σ signed amount up to
D` across `account`. But the withdrawal that produced A52 measured that
today's ledger does not reproduce today's figures, and D5 pins the ₴7.75
residue that every one of those snapshots records. So the <!--f:seed.snapshots-->174<!--/f--> recorded
balances are either dropped or need somewhere to live, and that is not this
document's call — it is the same ruling `docs/plans/PLAN-OPEN.md` O31 is
waiting on.

## 6. Timestamps are stored in three incompatible encodings

`TIMESTAMPTZ` resolves a zoneless literal against the session `TimeZone`.
`asset-builder` writes `toISOString()` (UTC, with `Z`); `repository.ts`
writes `toISOString().slice(0, 19)` — the same instant with the `Z`
stripped; the seed writes zoneless Kyiv wall times. Migrating them as-is
lands forms 2 and 3 two to three hours from their true instants, in opposite
directions, while form 1 is correct. `savedAt` is what renders the pinned
"Last saved 25.07, 21:14", so this changes displayed text. Normalize on the
way in; do not let the session zone decide.

## 7. `source` has no column in the new schema — the old→new map, in full

The old→new `Transaction` mapping the migration is written against:

| Old (app `Transaction`) | New (`transaction`) | Note |
|---|---|---|
| `id` | `id` | slug today — see item 1 |
| (none) | `user_id` | scope; no `portfolio` table |
| (none) | `account_id` | one row per provider/user |
| `date` | `date` | Kyiv calendar date |
| `type` | `type` | nine values; `dividend_accrual` → `dividend_payout`, below |
| `assetId` (`''` = portfolio) | `asset_id` | NULL, not `''` — see item 2 |
| `amount` | `amount` | positive, sign from type |
| (none) | `quantity` | required on position-moving rows; unrecoverable if not captured — see item 4 |
| (none) | `unit_price` | fees stay separate rows |
| (none) | `settles_payout_id` | `tax` rows ONLY; cannot be backfilled, which is why it goes in now |
| (none) | `created_at` | |
| `source` | *(no column)* | a real loss — below |

`source` is NOT write-only. `TransactionPanel.tsx` renders
a `Select` over `own | accrual | reinvest_reit | reinvest_6475` and writes
the chosen value on every recorded transaction, so a user picks it; `csv.ts`
exports it as the sixth transaction column; and `json.ts` declares it a
REQUIRED member of a `z.strictObject`. What is true is narrower: no
derivation in `src/core/` reads it. So dropping the column at W7 is a real
decision with three consequences — a field leaves the form, the CSV header
loses a column, and the backup envelope's required member goes, which is a
format-version question, not an additive change. Seed rows `r1`–`r3` carry
the two `reinvest_*` values that the schema's no-holding-enumeration rule
(`infra/schema/user.ts`, beside `asset_color_slot_ck`) forbids as CHECK
values, and they need a destination.

`dividend_accrual` (app) is the spec's `dividend_payout` — same row,
different name; both lists are nine long. `transaction_type_ck` spells the
spec's names, so the app's name is rejected until the migration maps it, and
`src/core/model-parity.test.ts` now enforces that mapping.
