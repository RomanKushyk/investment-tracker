# Plan B — Waiting, with dates

> **For agentic workers:** nothing here is startable on demand — each item waits on elapsed time, an external event, or another phase. **Check the dated table first every session.** An item whose date has passed moves to `PLAN-NOW.md` or is executed here directly; an item whose date is near needs preparation, not waiting.
>
> **Companion plans:** `PLAN-NOW.md` (startable today) · `PLAN-OPEN.md` (undecided). Parent: `NEXT-PHASE-PLAN.md`.

Written 2026-08-11. Dates are Europe/Kyiv. "Earliest" is when the gate *opens*, not when work must start. "Hard" is a date that cannot be moved — miss it and the cost column says what it costs.

## The dated table

| # | Item | Gate | Earliest | Hard? | Cost of missing |
|---|------|------|----------|-------|-----------------|
| W1 | Frozen-feed detector on real data | 5 business days of captures (`STALE_AFTER_DAYS=5`) | **2026-08-17** | no | none — it accrues by itself |
| W2 | DPU measured over a real week | 7 days of captures | **2026-08-17** | no | none, but A2's before/after needs it |
| W3 | Inzhur observation window closes | ~3 weeks of captures from 2026-08-10 | **2026-09-01** | no | schema decided on thin evidence |
| W4 | Inzhur observation schema | W3 + `PLAN-NOW.md` A4 | **2026-09-01** | no | blocks B3 migration |
| W5 | **cum/ex boundary on UA4000238976** | the coupon itself | **2026-09-24** | **yes** | **182 days** — next chance 2027-03-24 |
| W6 | DPU measured over a real month | 30 days of captures | **2026-09-10** | no | none |
| W7 | B3 migration: auth, user schema, HTTP client | W4 + durability gate passed | **2026-09-01** | no | everything downstream |
| W8 | Super-admin control surface | W7 | after W7 | no | parse control stays code-only |
| W9 | First year sealed in the archive | the 01:00 run on 1 Jan writes 31 Dec | **2027-01-01** | no | a year cached wrong is cached forever |
| W10 | UA4000238976 matures | the bond | **2027-03-24** | **yes** | first production exercise of the `sold` term |
| W11 | AWS credits expire | — | **2027-07-29** | **yes** | $119.99 unused |
| W12 | UA4000236475 matures | the bond | **2028-09-27** | **yes** | second redemption |
| W13 | Phase 6: chart analytics | W7 — deferred by judgment, not blocked | after W7 | no | doing it twice |
| W14 | Phase 7: DB browser | W7 — by construction | after W7 | no | building it twice |

---

# Phase W-I — Self-accruing observations (no action until the date)

These need nobody to do anything. They are listed so the *check* is not forgotten.

## W1 — Frozen-feed detector on real data — **from 2026-08-17**

**Gate:** the detector reports `unchangedDays` per source. Until several business days of digest-bearing rows exist, the number is trivially 1 and proves nothing. `STALE_AFTER_DAYS` is 5, so the first genuinely meaningful reading is five business days after the first digest row (2026-08-10).

**What to check on the day:** invoke the Lambda with `{}` and read `unchangedDays` for `inzhur` and `nbu_fv`. 1 = prices moved (healthy). >1 = consecutive business days with an identical price digest — report which source and how many days.

**Do not confuse the two failure modes.** `StalePricesAlarm` fires when prices stop *moving*; `StreakCheckLivenessAlarm` fires when the check stops *running*. Only the second is automatic — a detector that silently stopped looks identical to a healthy feed. That is why both exist.

**Note on the threshold:** 5 rather than the 2–3 the research suggested, because how often ОВДП quotes genuinely sit flat is empirical and nobody has the data yet. A threshold that cries wolf gets muted, and a muted alarm is worse than none. Revisit once W6 has a month of data.

## W2 / W6 — DPU measured over a week, then a month — **2026-08-17**, **2026-09-10**

**Gate:** elapsed time only. The cost spec calls this out — the formula is documented (`ReadDPU = max(BytesRead, 2048) × 0.00000183105`) and reproduces a published bill to three significant figures, but **background/system DPU (auto-ANALYZE, index maintenance) is genuinely unmodellable** and only measurement settles it.

- [ ] 2026-08-17 — record a week's actual DPU against the ~325 DPU/month year-1 projection, in `infra/README.md` field notes.
- [ ] 2026-09-10 — record the month figure. This is also the honest denominator for `PLAN-NOW.md` A2's before/after.

**No design decision differs across the $0–$2/month spread this could move.** Measure it to know it, not to decide anything.

---

# Phase W-II — The unrepeatable observation

## W5 — cum/ex boundary on UA4000238976 — **2026-09-24, hard**

**The only genuinely unrepeatable item in this plan.** The spec calls it "one free observation already scheduled": ≈1081.82 cum versus ≈1003.42 ex, a step of ≈78.40 — exactly the coupon. It settles the cum/ex convention by observation instead of inference.

**The date arithmetic matters, get it right:**
- The coupon pays **2026-09-23**.
- Inzhur refreshes prices ~13:00 Kyiv, so the price published on day D is captured by the 01:00 run on D+1 and stored with `as_of = D`.
- Therefore the ex-price lands with `as_of = 2026-09-23`, **written at 01:00 on 2026-09-24**.
- The comparison is `as_of 2026-09-22` (cum) against `as_of 2026-09-23` (ex).

**Preparation — must be done before the date, not on it:**
- [ ] `PLAN-NOW.md` **A1 must be merged first.** The date grid currently says 2026-09-25; a coupon suggested on the wrong day contaminates the very observation this exists to make.
- [ ] Confirm before 2026-09-22 that the scheduled capture is healthy — the silence alarm covers a dead job, but check rather than assume.

**On 2026-09-24 or after:**
- [ ] Read both rows and record the actual step against the ≈78.40 prediction.
- [ ] Record the verdict in DECISIONS — cum/ex convention, stated once, in writing.

**Cost of missing:** 182 days. The next boundary is 2027-03-24, which is also W10 (maturity) and therefore a *different*, messier observation — final coupon and principal on the same date. Missing 2026-09-24 means the clean version does not recur.

**What does not need doing:** nothing has to run on the day. The capture is automatic; only the reading is manual.

---

# Phase W-III — Evidence-gated backend

## W3 / W4 — Inzhur observation window and schema — **from 2026-09-01**

**Gate:** ~3 weeks of raw captures from 2026-08-10. Two days cannot show weekend behaviour, holiday behaviour, yield stability, fund NAV cadence, payload byte-stability, or the shape of an outage.

**Why this is a gate and not caution.** The archive schema is decided **with evidence in hand** deliberately, and nothing is lost meanwhile because raw payloads regenerate any schema retroactively. DSQL keys are immutable — a wrong natural key is a DROP/CREATE, not a migration.

**What the window is expected to answer:**
- [ ] Does the feed refresh on Saturdays and Sundays?
- [ ] How does a public holiday read — same as a weekend, or different?
- [ ] Is `returnRates.sell` stable day to day, and does it ever move without the price moving?
- [ ] What cadence do fund NAVs follow relative to bond prices?
- [ ] Are payload bytes stable enough that `payload_sha256` means anything, or is only `quotes_sha256` informative? (The frozen-feed detector already assumes the latter — D28.)
- [ ] What does an outage actually look like: 5xx, timeout, truncated body, or a stale-but-valid payload?

**Then, as W4:**
- [ ] Extend `price_observation` to the Inzhur source, reusing the key `PLAN-NOW.md` A4 pinned for NBU.
- [ ] `bond_terms`, versioned and effective-dated, written every run — reconstructable in principle, but **delisting after maturity destroys the live copy permanently**, which is why it is captured rather than derived.
- [ ] Backfill from stored raw payloads; re-running must be a no-op.

**Explicitly not decided by this window** — see `PLAN-OPEN.md`: the fund T-1 dedup rule (O7) rests on one informative observation and conflates the FX conversion date with the NAV strike date; **do not ship it on this evidence**, more weeks do not automatically fix it.

## W7 — B3 migration — **earliest 2026-09-01**

**Gate:** W4 complete **and** `PLAN-NOW.md` A3 (durability) passed. ~10–12 days of work per the staging estimate.

Scope, per spec: user schema in DSQL, Cognito, API Gateway + API Lambda, `repository.ts` rewritten as an HTTP client, PWA shell, test repair, cutover. Front-loaded accepted costs: **OCC retry handling** (`If-Match` becomes `UPDATE … WHERE version = $2` + rowcount, mutations retry on SQLSTATE 40001) and **no local emulator** (local Postgres for the inner loop with the schema kept inside the DSQL subset, real DSQL in CI).

**Do not start this before `PLAN-OPEN.md` Round 1 is answered** — those items cannot be added after the first DDL.

Retires D2 (IndexedDB), D16/G4 (demo+live split) and the dataset guards. `navigation-map.md` needs a full re-baseline in the same phase; ~97 `it()` blocks across 12 files depend on the seed helpers.

## W8 — Super-admin control surface — **after W7**

Deferred until the app can read the archive. The data is already being recorded, so nothing is lost by waiting.

Controls, in the spec's rough priority: enable/disable a source without a deploy · re-run one date (`{asOf}`) to repair a bad capture · run a backfill range · view the last N runs with their errors · view which tracked refs were missing from a published file.

The four states that must stay distinguishable, because conflating them is how a broken pipeline looks healthy: **captured** (`ok=true`) · **not published** (`404`, `not_published` — no alarm, it is a weekend) · **parse failure** (error set, payload still stored — alarm) · **never ran** (no row at all — the silence alarm).

---

# Phase W-IV — Calendar events

## W9 — First year sealed — **2027-01-01**

The read contract seals a period **on verified completeness, never on the calendar**, and the 01:00 run writes the previous day — so 31 December lands on 1 January. Sealed years serve `Cache-Control: public, max-age=31536000, immutable` with a strong ETag.

- [ ] Do not seal before verifying completeness for the whole year.
- [ ] **Version by filename** (`2026.v1.ndjson` behind a short-TTL manifest). `immutable` cannot be retracted — a wrong price cached under it persists on every device forever, and a filename bump is the only escape.

## W10 / W12 — Maturities — **2027-03-24**, **2028-09-27**

The first redemption is the first production exercise of the `sold` term added to `netResult` on 2026-08-11 (commit `290b26f`). Before that defect was fixed, a redemption inverted the headline sign.

- [ ] Before 2027-03-24, confirm `netResult` receives `soldAmount(transactions)` on every screen that renders it, and that `rollNextCoupon` returns `{kind:'matured'}` rather than rolling past maturity.
- [ ] The maturity row carries **coupon and principal on the same date** (7840 + 100000 kopecks). Confirm the traversal counts the coupon once and does not treat the principal as one.
- [ ] `status` flips around delisting and `bond_terms` is the only surviving copy of the schedule afterwards — verify it was captured before the instrument disappears.

## W11 — AWS credits expire — **2027-07-29**

$119.99, 12 months from account creation. Burn to date is **$0.01 in ~2 weeks**, so credits were never the binding constraint and expiry costs nothing in practice. Listed because it is a real date on the account, not because it needs action.

No closure deadline remains — the account moved to the Paid plan on 2026-08-10, retiring the 6-month Free-plan clock that would have closed it on 2027-01-29.

**Standing guardrail, unchanged:** $5 monthly budget, absolute alert thresholds at $1 and $3 actual and $5 forecast, all to the owner's email. Absolute rather than percentage because at a ~$0.02 baseline percentage thresholds fire on noise. **No budget actions attached** — notification only, never automated shutdown.

---

# Phase W-V — Sequenced after the migration by judgment, not by a gate

These two are **not blocked** — they are deferred on purpose, and the reason is written down so nobody re-derives it or, worse, quietly starts them.

## W13 — Phase 6: chart analytics — **after W7**

**Technically startable today.** The logic is pure: `core/dates.filterRange`, `useDateRange` on `useSearchParams`, `core/day-deltas.ts`. Deferred because every *browser* checkpoint would need re-verifying after W7 replaces the persistence layer, and the phase is checkpoint-heavy — five chart screens × presets × themes × 360 px. Doing it twice costs more than waiting.

**If it is pulled forward anyway** (a legitimate call if the migration slips), the pinned trap fixes in `NEXT-PHASE-PLAN.md` are non-negotiable — they were bought with the formula audit. The one that gets broken by accident: **annualized keeps the PORTFOLIO_START `daysHeld` basis regardless of the selected window.** A range filter that changes an annualised figure is a wrong figure, not a filtered one.

## W14 — Phase 7: DB browser — **after W7, by construction**

Not a judgment call. It is built directly on the repository write surface, which W7 replaces — building it first means building it twice.

Two things already decided that shape it: `deleteAsset` is retired (assets accumulate, nothing is deleted), so the browser may edit but not delete assets; and impact hints are derived from core (`"removes 14 transactions, quotes on 174 days; Income received −₴472,13"`), not counted in the component.

---

## Standing "no" list (relevant whenever any phase here provisions something)

At a $0.02 baseline only a fixed charge moves the bill: NAT Gateway **$33.58/mo** · Aurora Serverless v2 at 0.5 ACU ~$51/mo · Amplify **WAF $15/mo** (one console toggle, the likeliest accident) · public IPv4 **$3.65/mo even idle** · Lambda provisioned concurrency ~$2.29/mo *and it voids Lambda's free tier* · customer-managed KMS key $1–3/mo · Route 53 zone $0.50/mo · Secrets Manager $0.40/mo.

## Review cadence

Re-read the dated table at the start of any session that touches `infra/` or the migration. Move an item to `PLAN-NOW.md` the day its gate opens; do not let a passed date sit here unexecuted, because a plan whose dates are stale stops being read.
