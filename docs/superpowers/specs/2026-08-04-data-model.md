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

## The ledger

Every transaction is one signed movement on one provider account. The sign is a function of the
type, not a stored field.

| Type | Account | Units |
|---|---|---|
| `deposit` | **+** | — |
| `withdrawal` | **−** | — |
| `buy` | **−** | **+** |
| `sell` | **+** | **−** |
| `dividend_payout` | **+** (gross) | — |
| `interest_payout` | **+** (gross) | — |
| `tax` | **−** | — |
| `reinvest` | **−** | **+** (chosen asset) |
| `redemption` | **+** | **−** |

Inzhur always credits the account first and performs any onward routing (bank transfer,
reinvest, tax) as a **separate operation**. Every movement is therefore observable and recorded.
There is no `destination` field — the route is expressed by the following transaction.

### Derivations

```
free_cash(D)  = Σ signed amount over account rows up to D
units(a, D)   = Σ quantity deltas for asset a up to D
value(a, D)   = units(a, D) × price(a, D)      -- price from the archive
```

No exclusion rules, no pairing heuristics, no computed tax. The sum reconciles by construction.

### `transaction`

| Column | Notes |
|---|---|
| `id` | |
| `user_id` | scope; no `portfolio` table (independent accounts) |
| `account_id` | provider account — see below |
| `date` | Kyiv calendar date |
| `type` | one of the nine above |
| `amount` | always positive; the sign comes from `type` |
| `asset_id` | nullable — `deposit` / `withdrawal` carry none |
| `quantity` | **nullable, required on position-moving rows.** Unrecoverable if not captured on the day; FIFO lots stay derivable from it forever |
| `unit_price` | nullable; keep fees in separate rows rather than baking them in |
| `settles_payout_id` | **nullable, `tax` rows only** — the payout this tax belongs to |
| `created_at` | |

**`asset_id` on `tax` rows is required** when the tax relates to a payout. Without it,
`payoutsNet` per asset is uncomputable and the total-return family stays broken — this is the
gap `docs/FORMULA-AUDIT.md` ruling 6 left open.

**`settles_payout_id`** makes double counting structurally impossible and turns "does every
payout have its tax?" into a join rather than a date-fuzzy guess. It cannot be backfilled later,
which is why it goes in now. Validation: a tax may not exceed the payout it settles.

Aurora DSQL has **no foreign keys** — both references are application-enforced on write plus a
nightly integrity audit. Nothing is ever deleted, so there are no cascades.

### `account`

One row per provider per user. Free cash is `Σ` across accounts; the per-provider breakdown is a
`GROUP BY`. Withdrawals to a bank card leave the perimeter and are **excluded from free cash**
but stay in the ledger, so "how much have I withdrawn" remains answerable.

Modelled from day one even though Inzhur is currently the only provider — cheap now, expensive
to retrofit.

### `asset`

Per-user. Joins the global price archive by provider ref (fund slug or bond ISIN).

**No CHECK constraint may enumerate a value naming a specific holding.** `TxSource`'s
`reinvest_reit` / `reinvest_6475` are removed — the reinvest target is user-selectable per
payout, so it is an asset reference, not an enum member. `colorKey` likewise becomes a palette
slot rather than a seed-asset name.

## Price archive

Global, unscoped, cron-owned. Written by a DB role granted `SELECT, INSERT` and **not**
`UPDATE, DELETE` — DSQL has no triggers, so the grant is the only enforcement of append-only, and
it also keeps the cron out of user tables entirely, making the suggest-only rule a permission
rather than a convention.

**Scale is settled and is a non-event.** ~12,775 rows/year at 35 instruments. Read cost is
documented (`ReadDPU = max(BytesRead, 2048) × 0.00000183105`, 1.92 DPU/MiB, billed on bytes
*scanned*): ~6,506 DPU/month at year 20 = 6.5% of the always-free allowance; storage reaches 1 GB
in ~657 years. No partitioning, hot/cold split, downsampling, materialized aggregate or S3 origin
is justified this decade. Archive downsampling is rejected permanently — it destroys the only copy
that will ever exist.

### What the feed actually contains (measured 2026-07-28 and 2026-08-10)

Neither instrument class publishes a market observation.

**Bonds are a closed-form function of the date.** `sellUAH = Σ CF_i × (1+y)^(−ACT_days/365)` over
remaining cashflows, with `y = returnRates.sell`. Out-of-sample forward test — freeze `y` at 07-28,
predict 08-10 — gives **1063.1288 vs 1063.13 actual** (0.0012 ₴) and 1100.7844 vs 1100.79 (0.0056 ₴).
It lands exactly on the coupon: P(22.09) − P(23.09) = 77.9717 = coupon 78.40 minus one day's
accretion. Coupon periods are **exactly 182 days and always a Wednesday** — not six calendar months.
The daily step is a **ramp** (+6.5% across a period), so linear accrual is wrong at every point.

**Funds are arithmetic on NAV.** `sellUAH = navUAH × 1.009` and `buyUAH = navUAH × 1.010` exactly,
to six significant figures, on both funds. The only genuine channel is `navUAH`.

So for OVDP a weekend value is **computable, not carried** — the owner's insight, confirmed. But the
magnitude is small: our computed value differs from a stale provider value by one day's accretion,
**≈₴6–8 per weekend on this portfolio (0.008%)**. A single unnoticed 25 bp yield revision is worth
~₴4–5 per bond — more than every weekend in a year combined. **The value of this finding is that it
makes yield revisions visible, not that it fixes weekends.**

The genuinely damaging artifact is neither: a raw dirty-price series shows a **−7.21% one-day loss
and 7.21% max drawdown on a bond that never lost a kopeck** — the coupon sawtooth. (Max drawdown is
provably *invariant* to carry-forward; volatility is unbiased provided the annualizer matches the
sampling grid. The earlier "carried values poison volatility and drawdown" claim was overstated.)

### Three records, not one table

| Record | Written | Holds |
|---|---|---|
| `price_capture` | once per cron run, **including failed runs** | HTTP outcome, error, payload bytes + hash, entry count, skipped refs. This — not the absence of a price row — is the liveness signal |
| `price_observation` | per instrument per capture | exactly what the provider served |
| `bond_terms` | versioned, effective-dated, every run | payment schedule + maturity. Reconstructable in principle, but delisting after maturity destroys the live copy permanently |

### Columns that cannot be added later

| Column | Why it must exist from row one |
|---|---|
| `basis` **in the natural key** | Otherwise `nav` and `bid` for one instrument-day cannot coexist. DSQL keys are immutable — unrecoverable |
| `observed_at` (separate from `as_of`) | 8 bytes; distinguishes "price was flat" from "backfilled late" |
| `source` + parser version | If the parser was ever wrong, only this identifies which rows it produced |
| **`returnRates.{buy,sell}`** | Currently **discarded** by `parse.ts:89-96`. The only genuinely new information a bond row carries, the only way to detect a yield revision, and what makes the archive re-derivable and date-stampable. Highest value per line of code in the whole investigation |
| **`status`** | Currently **discarded** by `parse.ts:98-102`. Flips without the price changing; the flip date is gone forever if not captured that day. Captured verbatim, never filtered (D19) |

**`observation_kind` is NOT stored as a semantic class.** Store only what the cron witnessed;
`published | carried | computed | frozen` are **derived at read time**. For funds they are strictly
inferences; for bonds the inference depends on a model that may be revised. Storing a judgment in an
immutable column is the error this whole investigation exists to avoid.

**Computed bond values are derived at read time, never stored.** The premises (schedule, yield) are
captured forever; the conclusion never is. A stale provider value is stored as the observed fact —
substituting our computed value into the stored row is rejected outright.

### Governing rule for consumers

**Levels carry forward; changes never do.** A zero delta and an unknown delta must never render the
same.

`listed_from` / `retired_at` on `instrument` — without both, a missing row cannot be told apart
from "the instrument did not exist yet", which is what the cron-silence alarm depends on.

`instrument_ref` is **permanently allocated, never reused, never renamed.** No FK protects this.

**`as_of` semantics, pinned:** the 01:00 Europe/Kyiv run reads prices published ~13:00 the previous
day, so `as_of = capture_date − 1`. Written down because a silent redefinition later poisons the
archive with no way to tell which rows used which rule.

### Corrections

If the provider ever revises a price, or the cron writes a wrong value, corrections go in a
**separate append-only overlay table** (`price_correction`: same natural key, corrected price,
reason, applied_at), left-joined at read time. The base archive stays literally immutable, the
correction is itself an auditable append, and "what did we believe on date X" stays answerable.
A `revision` column in the primary key is explicitly **not** used — on DSQL that would be an
unrecoverable DROP/CREATE, not a migration.

### Raw payloads

~165 KB/day = ~60 MB/year raw. Stored **gzipped** and in a **separate table** — DSQL primary keys
are index-organized and carry every column, so a wide row inflates every range scan proportionally.
Uncompressed this would cross the 1 GB free allowance around year 17; gzipped it is ~160 MB at
year 20.

The reason to keep them is **correctability, not provenance**: if the parser is ever wrong — unit
drift, a renamed field, a percentage that becomes a fraction — the raw payload is the only
mechanism that can regenerate history the provider will never republish.

### Read contract

Prices and user data must **never share a response, an auth policy, or a cache policy.**

- `GET /v1/prices/{YYYY}.ndjson` — **public, no authorizer, ever.** Sealed years:
  `Cache-Control: public, max-age=31536000, immutable` + strong ETag. Current year: `max-age=3600,
  stale-while-revalidate=86400`.
- **No query parameters in the default read path.** The date-range filter is a client-side slice of
  cached years, never a server parameter — a `?to=today` URL mints a new cache key daily and never hits.
- **Seal a period on verified completeness, never on the calendar** — the 01:00 run writes the
  previous day, so 31 December lands on 1 January.
- **Version by filename** (`2026.v1.ndjson` behind a short-TTL manifest). `immutable` cannot be
  retracted; a wrong price cached under it persists on every device forever.
- NDJSON, sorted deterministically, named keys — streamable, concatenable, stable ETags, and adding
  a column later does not break old parsers.

Built this way, moving the archive to S3 + CloudFront later is a routing change with **no client
change at all**. That is the whole reason to fix the URL shape now.

**No client-side cache is written.** HTTP caching on immutable URLs captures nearly all the benefit
with zero application code and no invalidation bugs — and no question about whether it reintroduces
what D2 removed.

### FX

**Today's NBU rate only. No archive.** The currency toggle is a display unit for headline KPIs, not
a historical claim, and NBU's rate history is backfillable at any time — the asymmetry that makes
the price archive urgent does not apply. The daily job refreshes the rate, which also retires the
hard-coded 44.83 (already stale: NBU gave 44.7876 on 2026-08-04). Pass an explicit `date=` — without
it the endpoint returns *tomorrow's* rate once published in the afternoon.

### Sequencing — raw payloads first

**Run the cron for ~3 weeks writing only timestamped raw payloads before finalising the archive
schema.** At ~165 KB/day this settles every remaining question with no schema decision as a
prerequisite: whether the feed refreshes on Saturdays, how holidays behave, whether the yield is
stable, fund NAV cadence, payload byte-stability, and the outage shape.

Land the two `parse.ts` fields (`returnRates`, `status`) *first* so parsed rows are complete when the
real archive starts.

One free observation is already scheduled: **2026-09-23**, the cum/ex boundary on UA4000238976 —
≈1081.82 cum vs ≈1003.42 ex. Unmissable, and it settles the convention.

Detection quality, for the record: **bonds yes, funds no.** Inverting the DCF recovers the date the
provider priced for at ~140:1 discrimination (0.42 ₴/day step against a 0.003 ₴ residual) — an
observation, not an inference. The fund FX-date channel rests on **one** informative observation and
conflates "the date the rate was converted with" with "the date the NAV was struck"; those are
independent operations. Do not ship a fund T-1 dedup rule on that evidence.

### Negative rulings — do not re-litigate

- **`interpolated` is rejected.** Nothing in this portfolio requires interpolation.
- **`kubushka-snapshots-2026-08-04.csv` is seed-generated output**, not a recording — emitted by
  `seed.ts::pathQuote()` (linear ramp + sine). No weekday or provider inference may be drawn from it.
- **Never encode a holiday calendar in a stored row.** Derive from `as_of`.

### Deferred (derivations, revisable with zero migration)

The `provenance` enum and its assignment rule · volatility / max-drawdown / best-worst-day rules
(none of these metrics exists yet) · fund valuation basis, deferred for free by keeping `basis` in
the key · `value_changed_at`, `modelResidual`, `identical_to_prev` and every other derived diagnostic
· UI treatment of carried and computed days · the 6 short-dated bonds that miss the DCF model
(neither holding is among them — handle by residual threshold plus alert).

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
