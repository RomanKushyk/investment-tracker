# Data model — the price archive

> Moved **verbatim** from [`../2026-08-04-data-model.md`](../2026-08-04-data-model.md) on 2026-08-26 (D95). **Contracts here are load-bearing** — the observation key is immutable on DSQL (D30): changing it is a DROP/CREATE of a live archive, not a migration.

## Price archive

Global, unscoped, cron-owned. Written by a DB role granted `SELECT, INSERT` and **not**
`UPDATE, DELETE` — DSQL has no triggers, so the grant is the only enforcement of append-only, and
it also keeps the cron out of user tables entirely, making the suggest-only rule a permission
rather than a convention.

**Scale is settled and is a non-event.** ~12,775 rows/year at 35 instruments. Read cost is
documented (`ReadDPU = max(BytesRead, 2048) × 0.00000183105`, 1.92 DPU/MiB, billed on bytes
*scanned*): ~6,506 DPU/month at year 20 = 6.5% of the always-free allowance **[D91, 2026-08-25:
row count does not settle read cost — the PLAN does. A table scan bills `payload_gzip`; an index
path does not (6,664 rows for 1.210 DPU). One capture query scanned only because its `ORDER BY`
bound to a `to_char()` alias instead of the column. Size with `EXPLAIN (ANALYZE, VERBOSE)`, which
prints per-statement DPU]**; storage reaches 1 GB in ~657 years. No partitioning, hot/cold split, downsampling, materialized aggregate or S3 origin
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

~156–165 KB/day raw. Stored **gzipped** and in a **separate table** — DSQL primary keys are
index-organized and carry every column, so a wide row inflates every range scan proportionally.

**Measured on the first live capture (2026-08-10): 156,117 bytes → 12 kB, ~92% compression.**
That is **~4.4 MB/year**, roughly half the 8 MB/year this spec originally estimated, and about
0.4% of the 1 GB always-free allowance per year. Uncompressed it would have crossed 1 GB around
year 17; compressed the question does not arise this century.

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
