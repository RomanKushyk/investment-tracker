# W7 migration translations — the app's data, translated for the schema

The user schema (`infra/schema/user.ts`) does not accept `src/lib/seed.ts`'s
shape as-is. Seven translations are listed here, carried from the hand-written
migration draft's header before generation retired that header. **Two of the
seven — items 3 and 4 — are DORMANT rather than owed**, for the one reason the
block below gives; the numbering never changes, because the items are cited.

> **W7 SEEDS FRESH DEMO DATA — it does not carry the local store across**
> (owner, 2026-09-01; [`D128`](../decisions/D128.md), recorded under W7 in
> [`../plans/phase-w-i-ii-iii.md`](../plans/phase-w-i-ii-iii.md)). There is no
> live user and therefore no history worth translating.
>
> **That splits this file in two, and the split is what to read it by:**
>
> - **Translations about SHAPE still apply in full** — ids, enum spellings, key
>   order, nullability, kopecks-vs-decimals. A fresh seed has to satisfy the
>   schema exactly as any other writer would.
> - **Translations that exist because a stored row PREDATES a rule do not.**
>   Items 3 and 4 below are that class. `quantity` (item 4) is unrecoverable only
>   for rows written before it was required, and no such row will be migrated,
>   because none will be migrated at all. The seed carries its own seven counts.
>   `transaction_quantity_required_ck` therefore owes **no backfill step** — read
>   its comment in `schema/user.ts`, which says the same. Item 3 joined the class
>   on 2026-09-02: [`D129`](../decisions/D129.md) stopped the form writing a
>   borrowed `assetId` on portfolio-level rows, so only a database seeded before
>   that date holds one.
>
> Nothing below is deleted: the item-4 reasoning is why the counts exist in the
> seed at all, and both dormant items become live again the day a real user's
> data has to move — a pre-D129 Dexie store still holds the borrowed ids.

## 1. IDs are slugs today; the schema says UUID

`seed.ts` assigns `'reit'`, `'energy'`, `'ovdp8976'`, `'ovdp6475'` and
transaction ids `'d1'`…`'r3'`; every one of the <!--f:seed.snapshots-->174<!--/f--> snapshots keys its
`quotes` map by those same asset slugs. A slug→UUID remap is needed across
`asset.id`, `transaction.id`, `transaction.asset_id`, `user_price.asset_id`
AND every snapshot quote key. Skipping this loses the <!--f:seed.snapshots-->174<!--/f--> snapshots — D33
says they cannot be regenerated.

## 2. `assetId` is `''` on the seed's portfolio-level rows

In SQL that is NULL. Empty string and NULL are different values; translate,
do not copy. Measured against `seed.ts` alone.

**OWED, and unchanged by D129.** Item 3 below used to be the other half, because
the live app wrote a real `assetId` on those rows and the migration had two
distinct values to recognise. It is dormant now — a store written by any build
from 2026-09-02 on carries only `''` — but this item is not, and never was,
about what the form writes: `''` is not a uuid, so a migration that copies
Dexie's value verbatim fails `transaction_asset_absent_ck` either way.

## 3. `deposit`/`withdrawal` rows may carry a REAL `assetId` — DORMANT since D129 (2026-09-02)

`schemas.ts` used to declare `assetId` non-empty for all nine transaction types
while `TransactionPanel` filled it with `assets[0].id`, so every deposit the app
recorded named an asset it had nothing to do with — a value `derive.ts` already
treated as noise, and one `transaction_asset_absent_ck` would have rejected at
migration. [`D129`](../decisions/D129.md) stopped the form writing it: from
2026-09-02 those two types carry `''`, the shape `seed.ts` always used.

**Dormant, not retired,** on the same footing as item 4 and for the same reason.
A Dexie store written before that date still holds the borrowed ids, and so does
any backup taken from one — the importer blanks them on the way in, which is the
app's own answer, not the migration's. If a real user's data ever moves, this
item is live and the migration must NULL those ids as well as the empty ones.

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
document's call.

**It is NOT the ruling O31 was waiting on, and D133 does not answer it.** O31
closed on 2026-09-02 ruling only that the pinned FIGURES may move. Where the
recorded cash balances LIVE — dropped, or given a column — is a separate
question that lost its pointer when O31 closed and has no home in
`PLAN-OPEN.md` today. Raise it before the migration assumes an answer.

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
| (none) | `quantity` | required on position-moving rows; the seed carries its own (D125). Item 4's "unrecoverable if not captured" applies to a MIGRATED row, and W7 migrates none (D128) |
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
