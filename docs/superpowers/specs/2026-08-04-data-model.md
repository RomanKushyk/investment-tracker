# Data model — Kubushka cloud backend

Scope: the stored data model after the cloud move. Stack and cost are specified in
`2026-08-04-cloud-stack-and-cost.md`.

Status: **the ledger half is settled.** The price-archive half is pending the archive-scaling
investigation (storage layout, URL/API contract, retention horizon).

## Principle

**Store what was observed. Derive everything else.**

The app never computes a figure it could have recorded. In particular it **never calculates
tax** — tax is a real transaction that Inzhur performs, so it is recorded, not inferred. Rates
change, ОВДП coupons are exempt while ІСІ dividends are taxed at 14% (9% ПДФО + 5% військовий
збір), and any attempt to compute that would eventually be wrong. A recorded fact cannot be.

Two things are stored: **transactions** (the user's side) and the **price archive** (the
provider's side). Nothing else — there is no stored daily snapshot.

## The rest of it is in `data-model/`

**Split 2026-08-26 (D95)** — moved **verbatim** so no file exceeds 200 lines. Nothing was summarised.

| File | Holds |
|---|---|
| [`data-model/ledger.md`](data-model/ledger.md) | The ledger |
| [`data-model/price-archive.md`](data-model/price-archive.md) | Price archive |
| [`data-model/sources.md`](data-model/sources.md) | Sources |
| [`data-model/operating-capture.md`](data-model/operating-capture.md) | Operating the capture — what the super-admin sees and controls |

## Independent code fixes

Two defects found during this work, both shippable on their own and both affecting values the user
confirms with one press:

1. **`dailyAccrual`** divides by 365; it must divide the coupon by the **actual period length**
   (ACT/ACT ICMA). FORMULA-AUDIT ruling 4 gets amended to scope ACT/365 to annualisation.
2. **`couponsInGap` / `rollNextCoupon`** walk an `addMonths(·, 6)` grid, which is 1 day off by
   2026-09-30 and **4 days off by 2028-09-27**. They must walk the published schedule.

## Removed

`Snapshot` as a stored entity · stored `cash` (D13's observed-balance compromise, and the
"unpaired payouts are external" rule with it) · `destination` on payouts · `gross`/`net`
attributes · `deleteAsset` · demo/live dataset split · JSON import · CSV.

## Consequence for the seed

`src/lib/seed.ts` will not reconcile under this model — its 18 transactions carry no withdrawal
rows and no separate tax rows, so the account sum will not produce ₴7,75. It survives as a **test
fixture only** (demo mode is removed), and must be updated alongside the schema. Roughly 150 test
blocks depend on `buildSeedSnapshots()`.

## Open

- Price-archive layout and API contract (pending investigation)
- Past-date prefill: how captured prices become portfolio history without violating the
  suggest-only rule
- `netResult` has no `sold` term — a latent sign inversion that maturity will trigger
