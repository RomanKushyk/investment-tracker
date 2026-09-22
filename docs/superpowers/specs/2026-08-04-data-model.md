# Data model — Quirenote cloud backend

What is stored after the cloud move, and why; stack and cost are in `2026-08-04-cloud-stack-and-cost.md`.
**The ledger half is settled**, the price-archive half waiting on the archive-scaling investigation.

## Principle

**Store what was observed. Derive everything else.** The app never computes a figure it could have
recorded, and in particular it **never calculates tax** — a withholding is something Inzhur really
performed. Rates change, ОВДП coupons are exempt while ІСІ dividends are taxed at 14% (9% ПДФО + 5%
військовий збір), and a computed figure would eventually be wrong where a recorded one cannot be. Two
things are stored, **transactions** and the **price archive**; there is no stored daily snapshot. Still
open are the archive's layout and API contract, how captured prices become portfolio history without
violating the suggest-only rule, and `netResult`, which has no `sold` term — a latent sign inversion
that maturity will trigger.

## The ledger

Every transaction is one signed movement on one provider account, and the sign is a function of the
type rather than a stored field. `deposit` and `withdrawal` move the account alone, `+` and `−`; `buy`
and `reinvest` are `−` account and `+` units, with a reinvest buying the asset chosen on that payout;
`sell` and `redemption` are `+` account and `−` units; `dividend_payout` and `interest_payout` credit
the account gross less any withholding and move no units.

Inzhur always credits the account first and performs any onward routing — a bank transfer, a
reinvest — as a **separate operation**, so every movement stays observable. There is no `destination`
field: the route is expressed by the following transaction. A withholding is the one thing that does
NOT get its own row; it travels on the payout it was taken from, so a payout's signed amount is
`amount - coalesce(tax_withheld, 0)` — what actually reached the account. Free cash is then the sum
of signed account rows and units the sum of quantity deltas, with no exclusion rule, no pairing
heuristic and no computed tax.

### `transaction`

`user_id` is the scope and there is no `portfolio` table; `amount` is always positive and `date` is a
Kyiv calendar date. Four columns carry a constraint the type cannot:

| Column | Why |
|---|---|
| `quantity` | **nullable, required on position-moving rows.** Unrecoverable if not captured on the day; FIFO lots stay derivable from it forever |
| `unit_price` | nullable; keep fees in separate rows rather than baking them in |
| `tax_withheld` | **nullable, payout rows only** — what the provider withheld from this payout, below its amount |
| `note` | **nullable, any type** — 1–100 characters, NULL the only spelling of none. The cap is a DRAWN constraint, the ledger row rendering it (`design/extensions/withholding-and-note.dc.html`) |

**`settles_payout_id` was refused.** A separate tax row linking back would make double counting
structurally impossible, but a field on the payout answers "does every payout have its tax?" by
construction — there is no second row to join — and carries the asset and the category with it, which
is what ruling 6 of `FORMULA-AUDIT.md` left open
([`2026-09-12-tax-on-the-payout-design.md`](2026-09-12-tax-on-the-payout-design.md)).

Aurora DSQL has foreign keys, composite and enforced, and the user schema declares five, all `ON
DELETE RESTRICT` — the self-referential sixth went with the settlement key. Rows ARE deleted, an
asset going by an application cascade, children before the parent, in batches (*User schema and
deletes*). `account` is one row per provider per user, modelled from day one though Inzhur is the
only provider — cheap now, expensive to retrofit. Withdrawals to a bank card leave the perimeter,
**excluded from free cash** but kept in the ledger so "how much have I withdrawn" stays answerable.
`asset` is per-user, joining the global price archive by provider ref (fund slug or bond ISIN).

**No CHECK constraint may enumerate a value naming a specific holding.** A reinvest target is
user-selectable per payout, so it is an asset reference and never an enum member, and `colorKey` is a
palette slot rather than a seed-asset name. `TxSource` goes entirely rather than losing its two
`reinvest_*` members: the remaining pair is read by nothing and answered by the row's own type, so
the record carries no source of funds at all (*Forms and layout*).

## Price archive

Global, unscoped, cron-owned. Written by a DB role granted `SELECT, INSERT` and **not** `UPDATE,
DELETE` — DSQL has no triggers, so the grant is the only enforcement of append-only, and it also keeps
the cron out of user tables entirely, making the suggest-only rule a permission not a convention.

**Scale is settled and is a non-event** at ~35 instruments, so no partitioning, hot/cold split,
downsampling, materialized aggregate or S3 origin is justified this decade — and **archive
downsampling is rejected permanently**, because it destroys the only copy that will ever exist. What
does need watching is the PLAN rather than the row count (*Cloud target*): a table scan bills
`payload_gzip` where an index path does not, and one capture query scanned only because its `ORDER BY`
bound to a `to_char()` alias instead of the column. Size with `EXPLAIN (ANALYZE, VERBOSE)`.

### What the feed actually contains

Neither instrument class publishes a market observation. **Bonds are a closed-form function of the
date** — `sellUAH = Σ CF_i × (1+y)^(−ACT_days/365)` over remaining cashflows with `y =
returnRates.sell`, confirmed out of sample to within a kopeck. Coupon periods are **exactly 182 days
and always a Wednesday**, not six calendar months, and the daily step is a **ramp**, so linear
accrual is wrong at every point. **Funds are arithmetic on NAV**: `sellUAH = navUAH × 1.009` and
`buyUAH = navUAH × 1.010` exactly, on both funds, so `navUAH` is the only genuine channel.

A weekend OVDP value is therefore **computable, not carried**, but it is worth one day's accretion
where a single unnoticed 25 bp yield revision is worth more than a year of weekends — **the value of
this finding is that it makes yield revisions visible, not that it fixes weekends.** The genuinely
damaging artifact is neither: a raw dirty-price series shows a large one-day loss and drawdown on a
bond that never lost a kopeck, the coupon sawtooth. Max drawdown is provably *invariant* to
carry-forward and volatility unbiased provided the annualizer matches the sampling grid.

**Three records, not one table:**

| Record | Written | Holds |
|---|---|---|
| `price_capture` | once per cron run, **including failed runs** | HTTP outcome, error, payload bytes + hash, entry count, skipped refs. This — not the absence of a price row — is the liveness signal |
| `price_observation` | per instrument per capture | exactly what the provider served, never a judgment about it |
| `bond_terms` | versioned, effective-dated, every run | payment schedule + maturity. Reconstructable in principle, but delisting after maturity destroys the live copy permanently |

### Columns that cannot be added later

| Column | Why it must exist from row one |
|---|---|
| `basis` **in the natural key** | Otherwise `nav` and `bid` for one instrument-day cannot coexist. DSQL keys are immutable — unrecoverable |
| `observed_at` (separate from `as_of`) | 8 bytes; distinguishes "price was flat" from "backfilled late" |
| `source` + parser version | If the parser was ever wrong, only this identifies which rows it produced |
| **`returnRates.{buy,sell}`** | The only genuinely new information a bond row carries, the only way to detect a yield revision, and what makes the archive re-derivable |
| **`status`** | Flips without the price changing, and the flip date is gone forever if not captured that day. Captured verbatim, never filtered (*The price archive*) |

**`observation_kind` is NOT stored as a semantic class.** `published | carried | computed | frozen` are
derived at read time, because for funds they are strictly inferences and for bonds the inference
depends on a model that may be revised. Storing a judgment in an immutable column is the error this
whole investigation exists to avoid, which is also why **computed bond values are never stored**: the
premises are captured forever, the conclusion never is, and a stale provider value is stored as the
observed fact. For consumers, **levels carry forward; changes never do** — a zero delta and an unknown
delta must never render the same. `instrument` needs both `listed_from` and `retired_at`, or a missing
row cannot be told apart from "the instrument did not exist yet", which is what the cron-silence alarm
depends on, and `instrument_ref` is **permanently allocated, never reused, never renamed** with no FK
protecting that. **`as_of` semantics, pinned, and there are TWO**, the two endpoints differing in kind:
Inzhur's `as_of` is the Kyiv date of the run, its live endpoint serving the price struck for that date,
published ~13:00 the day before; NBU's is that date − 1, its URL naming a date's file that does not
exist until ~09:30. Pinned in writing because a silent redefinition poisons the archive with no way to
tell which rows used which rule. `infra/src/dates.ts` holds the rule and `dates.test.ts` pins the split.

### Corrections, payloads, and the read contract

A revised price or a wrong capture goes in a **separate append-only overlay table**
(`price_correction`: same natural key, corrected price, reason, applied_at), left-joined at read
time, so the base archive stays literally immutable and "what did we believe on date X" stays
answerable. A `revision` column in the primary key is explicitly **not** used — on DSQL that is an
unrecoverable DROP/CREATE, not a migration. Raw payloads are stored **gzipped** and in a **separate
table**, DSQL primary keys being index-organized and carrying every column, so a wide row inflates
every range scan proportionally. The reason to keep them is **correctability, not provenance**: a raw
payload is the only thing that can regenerate history the provider will never republish, once a
parser turns out to have been wrong.

Prices and user data must **never share a response, an auth policy, or a cache policy**.

- `GET /v1/prices/{YYYY}.ndjson` — **public, no authorizer, ever.** Sealed years:
  `Cache-Control: public, max-age=31536000, immutable` + strong ETag; current year `max-age=3600,
  stale-while-revalidate=86400`. NDJSON, sorted deterministically, named keys, so a column added
  later does not break old parsers.
- **No query parameters in the default read path** — the range filter is a client-side slice of cached
  years, where a `?to=today` URL would mint a new cache key daily and never hit.
- **Seal a period on verified completeness, never on the calendar**: the 01:00 run writes the previous
  day, so 31 December lands on 1 January.
- **Version by filename** (`2026.v1.ndjson` behind a short-TTL manifest), because `immutable` cannot be
  retracted and a wrong price cached under it persists on every device forever.

Built this way, moving the archive to S3 + CloudFront later is a routing change with **no client
change at all**, which is the whole reason to fix the URL shape now. **No client-side cache is
written:** HTTP caching on immutable URLs captures nearly all the benefit with no invalidation bugs and
no question about whether it reintroduces what *Persistence today* removed. **FX is today's NBU rate
only, with no archive** — the currency toggle is a display unit, not a historical claim, and NBU's
rate history is backfillable at any time, so the asymmetry that makes the price archive urgent does
not apply. Pass an explicit `date=`, or the endpoint returns *tomorrow's* rate once published.

## Sources

There is **no single source of truth**, and there cannot be — the two instrument classes differ in
kind. **No Ukrainian law requires machine-readable public prices.** For a closed-end пайовий fund like
Inzhur's, the floor under ЗУ «Про інститути спільного інвестування» № 5080-VI and НКЦПФР rules is NAV
**calculated monthly**, filed in XML quarterly/annually and disclosed publicly only in
**human-readable** form; daily publication is required of **open-ended** funds alone. НКЦПФР's open
datasets contain no NAV, SMIDA's live feed carries filings rather than NAV, and **whether we may poll
it is settled: no, categorically** (*External sources*). So Inzhur's daily JSON is **voluntary
commercial disclosure**: contractually «Базова ціна», cl. 1.4 of their services agreement — *"the price
INZHUR offers to buy and/or sell securities at"*, a dealer quote on their own secondary market and not
a NAV, which is why it carries a ~0.1% spread and moves daily while NAV is struck monthly.

| | ОВДП (bonds) | Inzhur fund units |
|---|---|---|
| Official source | **NBU fair value, daily** | none |
| Archive | **back to 2016-01-04** | none |
| Backfillable | **yes, by URL** | **no** |
| What our archive is | convenience + cross-check | **the only copy that will ever exist** |

**The axis that matters is not "has an API" — it is "is backfillable".** Only the two fund NAVs are
genuinely perishable.

### NBU fair value

`https://bank.gov.ua/files/Fair_value/{YYYYMM}/{YYYYMMDD}_fv.txt`, published under Постанова Правління
НБУ № 732 (26.10.2015) for the NBU's own collateral valuation — a stable government feed rather than a
market-transparency duty, carrying `ETag` and `Last-Modified`, which Inzhur does not. Three parsing
traps, all verified against the live file:

- **cp1251, not UTF-8.** A UTF-8 read yields mojibake without erroring.
- **The header is malformed.** Its 18th semicolon field reads `g_spread,z_spread,cptype` — three
  comma-separated names — while data rows carry only `cptype` there, so zipping header to row mislabels
  the tail and invents two columns. **Parse by fixed index**: 0 `calc_date` · 1 `cpcode` (ISIN) · 2
  `ccy` · 3 `fair_value` · 4 `ytm` · 5 `clean_rate` · 7 `maturity` · 17 `cptype`.
- **404 on weekends and holidays is normal**, not an error. Recorded as `not_published`, never
  alarmed on. No holiday calendar is encoded — the 404 already carries that fact.

The two sources are **not substitutes** — measured ~0.9% apart on the same ISIN the same day, one
being a dealer quote and the other a model valuation. Both are stored, distinguished by `source`,
which joins the natural key `(as_of, ref, basis, source)` for exactly this reason: merging them would
present one as the other.

НДУ (csd.ua) issues real ISINs for the funds — **Inzhur REIT `UA5000014044`**, **Inzhur Energy
`UA5000012246`**, both CFI `CICJLU` — worth adopting over the provider slugs, because НКЦПФР approved
a merger of five Inzhur funds into one and the feed still carries `ocean-plaza` as `completed`: slugs
appear, change status and get absorbed. НДУ itself publishes **no valuation**.

## Operating the capture

Every capture writes a row whether it succeeded or not, so the run journal is the operational surface
and needs no new storage. **The four states must stay distinguishable**, conflating them being how a
broken pipeline looks healthy:

| State | How it reads | Alarm? |
|---|---|---|
| captured | `ok = true` | no |
| not published | `http_status = 404`, `error = not_published` | **no** — weekend/holiday |
| parse failure | `error` set, payload still stored | **yes** |
| never ran | **no row for that (as_of, source)** | **yes** — the silence alarm |

**Parse errors are never silent and never destructive.** A payload that fails to parse is still stored
— the raw bytes are what a later parser fix reads — and `parser_version` on every row is what makes
"which rows did the broken parser produce" answerable rather than archaeological. **Payloads are stored
whole, so no schema decision was a prerequisite for the first capture**: the feed's weekend and
holiday behaviour, yield stability, fund NAV cadence, payload byte-stability and the outage shape are
answerable from recorded payloads, and the daily observations are derived from them. Deferred until the app can read any of
it: the admin UI, per-source enable/disable as stored settings, alert routing per source.

### Do not re-litigate

- **Detection quality is bonds yes, funds no.** Inverting the DCF recovers the date the provider
  priced for at ~140:1 discrimination — an observation — while the fund FX-date channel rests on
  **one** informative observation and conflates "the date the rate was converted with" with "the date
  the NAV was struck", independent operations. Do not ship a fund T-1 dedup rule on that evidence.
- **`interpolated` is rejected.** Nothing in this portfolio requires interpolation.
- **`kubushka-snapshots-2026-08-04.csv` is seed-generated output**, not a recording — emitted by
  `seed.ts::pathQuote()` (linear ramp + sine). No weekday or provider inference may be drawn from it.
- **Never encode a holiday calendar in a stored row.** Derive from `as_of`.
- Deferred and revisable with zero migration: the `provenance` enum · volatility / max-drawdown /
  best-worst-day rules · fund valuation basis, deferred for free by keeping `basis` in the key · the 6
  short-dated bonds that miss the DCF model (neither holding is among them — residual threshold plus
  alert).
