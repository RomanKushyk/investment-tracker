# Plan A — Startable now

> **For agentic workers:** every task here is unblocked *today* — no evidence, no decision and no other phase gates it. Pick the first non-done task in section order, branch as named, tick the checkbox, keep the Status table current, gates green per merge (`pnpm lint && pnpm typecheck && pnpm test`; `infra/` tasks additionally deploy through `.github/workflows/deploy.yml`).
>
> **Companion plans:** `PLAN-WAITING.md` (dated, gated on evidence or elapsed time) · `PLAN-OPEN.md` (questions with no answer yet). Parent: `NEXT-PHASE-PLAN.md`. Decisions: `DECISIONS.md`.

Written 2026-08-11. Section order is deadline pressure first, then irreversibility, then value per hour, then size.

## Status

| # | Phase | Branch | Size | Status |
|---|-------|--------|------|--------|
| **Section A** | **Time-critical** | | | |
| A1 | Coupon dates walk the published schedule | `fix/coupon-schedule-grid` | S | todo |
| **Section B** | **Backend — cheaper before the archive grows** | | | |
| A2 | Raw payloads out of `price_capture` | `infra/payload-split` | M | todo |
| A3 | DSQL durability gate: backup + PITR | `infra/verify-durability` | S | todo |
| A4 | NBU observation schema | `infra/nbu-observation-schema` | M | todo |
| **Section C** | **App — pure, independent** | | | |
| A5 | Live NBU ₴/$ rate | `feat/nbu-rate` | S | todo |
| A6 | Bond price re-derivation (DCF) | `feat/bond-dcf` | M | todo |
| A7 | Parse errors become visible | `feat/parse-diagnostics` | S | todo |
| **Section D** | **The one large sweep** | | | |
| A8 | Design brief: appearance + language | `docs/design-brief-phase-5` | M | todo |
| A9 | Dark theme | `feat/dark-theme` | L | design-gated |
| A10 | Ukrainian | `feat/i18n-uk` | L | design-gated |

---

# Section A — Time-critical

## A1 — Coupon dates walk the published schedule — `fix/coupon-schedule-grid`

**Goal:** the app proposes a coupon on the date the provider actually pays it.

**Rationale — this one has a date.** `couponsInGap` and `rollNextCoupon` walk an `addMonths(·, 6)` grid. The real bonds pay every **182 days, always a Wednesday**. Measured drift from the 25.03.2026 anchor:

| Real payment | Grid says | Drift |
|---|---|---|
| 2026-09-23 | 2026-09-25 | +2 d |
| 2027-03-24 | 2027-03-25 | +1 d |
| 2027-09-22 | 2027-09-25 | +3 d |
| 2028-03-22 | 2028-03-25 | +3 d |
| 2028-09-20 | 2028-09-25 | +5 d |

The next real coupon on UA4000238976 is **2026-09-23**, and the grid would offer it on the 25th. That is the same date `PLAN-WAITING.md` W5 needs clean for the cum/ex observation, and it is a money value the user confirms with one press. `dailyAccrual` was fixed on 2026-08-11 (commit `290b26f`) to take the real period length; the date grid is the untouched half of the same defect.

- [ ] `core/accrual.ts` — `couponsInGap` and `rollNextCoupon` accept the provider's payment dates and walk **those**, not a month grid. Reuse the existing `couponPeriodDays` bracketing rather than inventing a second traversal.
- [ ] Keep the `addMonths` grid as the fallback for an asset with no linked schedule — an unlinked bond has nothing better, exactly as `dailyAccrual` keeps its approximation. Do not delete it.
- [ ] Thread the feed to the callers. `DailyQuotes.tsx` already holds `fetch.feed`; audit every `dueCoupons` call site and pass it where it exists.
- [ ] `rollNextCoupon` must still clamp at maturity and still return `{kind:'matured'}` past it — the schedule ends there too, so the clamp is now expressible from the data rather than asserted.

**Contracts:** `couponsInGap` / `rollNextCoupon` signatures gain an optional schedule argument — additive, so no caller breaks. **DECISIONS:** amend the D-Inzhur family: published schedule beats derived grid wherever the provider supplies one.
**Verify:** the drift table above becomes fixtures (real date accepted, grid date rejected). A gap spanning 2026-09-23 subtracts exactly one coupon, not zero and not two. An unlinked bond keeps its current behaviour byte-for-byte — that is the non-regression, and it protects the ~97 seed-coupled test blocks. Browser: with the feed loaded, the coupon card appears on the 23rd.
**Risk:** the schedule's final row carries coupon **and** principal on the maturity date (7840 + 100000 kopecks). `couponForecast` already tie-breaks by taking the smaller row; the traversal must not double-count that date.

---

# Section B — Backend, cheaper before the archive grows

## A2 — Raw payloads out of `price_capture` — `infra/payload-split`

**Goal:** the capture journal is narrow enough that scanning it is free.

**Rationale — a known deviation from the spec, and it gets more expensive every day.** `2026-08-04-data-model.md` § *Raw payloads* rules that payloads live in a **separate table**, because DSQL primary keys are index-organized and carry every column, so a wide row inflates every range scan proportionally — and DSQL bills bytes **scanned**, not returned. The deployed table (`infra/src/capture.ts:253`) holds `payload_gzip BYTEA NOT NULL` inline. Two queries already range-scan it:

- `unchangedStreak` — `SELECT quotes_sha256, as_of … ORDER BY as_of DESC LIMIT 60`. `quotes_sha256` is not in the `(as_of, requested_at)` index, so the scan must reach the row.
- the backfill-completeness check — `SELECT DISTINCT as_of … WHERE source = $1 AND as_of BETWEEN …` over the NBU rows, of which there are already ~2,600 from the 2016 backfill.

At ~12 kB/row that is a real and growing multiplier on the one cost DSQL charges for. **State the cost, do not assert it:** measure first (this phase's first task), then move.

- [ ] Measure before touching anything: `EXPLAIN ANALYZE` both queries and record bytes read. If the planner already avoids the payload, say so and close the phase — the deviation would then be cosmetic.
- [ ] If it does not: `price_payload (capture_id, payload_gzip, payload_bytes, payload_sha256)`, one DDL per transaction, no DDL mixed with DML (DSQL rules).
- [ ] Backfill from the existing rows in batches under the 3,000-mutated-rows-per-transaction cap, retrying SQLSTATE 40001.
- [ ] Drop the inline columns only after the copy is verified row-for-row by hash. **`DeletionPolicy: Retain` and deletion protection stay on throughout.**
- [ ] Add the missing index the two queries actually want (`source`, `as_of`) — no `DESC` in index keys, DSQL rejects it outright.

**Verify:** re-run `EXPLAIN ANALYZE` and record the before/after bytes in `infra/README.md` field notes. Row count and every `payload_sha256` identical before and after. A scheduled run and a `{backfill:…}` run both still succeed.
**Risk:** this is the only phase here that rewrites live archived data. It is sequenced first *because* the archive is ~2 days of Inzhur plus a settled NBU backfill — the cheapest it will ever be. Every day of delay adds rows.

## A3 — DSQL durability gate: backup + PITR — `infra/verify-durability`

**Goal:** prove the archive can be restored **before** anything irreplaceable depends on it.

**Rationale:** `2026-08-04-cloud-stack-and-cost.md` names this an explicit gate on Phase 2 — *"Verify DSQL backup/PITR. Gate: if either disappoints, price history moves to S3 + CloudFront."* It needs no evidence and no elapsed time, and the whole archive exists because a missed day is unrecoverable. Verifying restore *after* user data arrives inverts the risk for no reason.

- [ ] Confirm what the cluster actually has: PITR window, snapshot cadence, whether either is on by default on a free-tier single-region cluster.
- [ ] Perform a real restore to a throwaway cluster and diff row counts + hashes against the source. A backup that has never been restored is a belief, not a backup.
- [ ] Record the measured RPO/RTO in `infra/README.md`; delete the throwaway cluster and confirm the bill returns to baseline.
- [ ] If either disappoints: write the S3 + CloudFront fallback as a DECISIONS entry rather than improvising it later. The read contract was designed so this is a routing change with no client change.

**Verify:** a restored cluster answers the same `SELECT count(*), min(as_of), max(as_of)` per source as production.
**Risk:** a throwaway cluster is a billable resource. Delete it in the same session; the $5 budget with $1/$3 absolute alerts is the backstop.

## A4 — NBU observation schema — `infra/nbu-observation-schema`

**Goal:** turn the NBU half of the archive from raw captures into queryable observations.

**Rationale:** B2 of the staged plan wants the schema decided **with evidence in hand**, and for NBU the evidence is complete: the backfill to 2016-01-04 re-runs clean (`captured: 0, complete: true`), weekend behaviour is characterised (404, recorded as `not_published`, correctly not an alarm), `calc_date` matched the filename date on 14/14 sampled dates across 2016–2026, and the malformed header is understood (field 17 declares `g_spread,z_spread,cptype`, the data carries `cptype` alone). The Inzhur half is **not** ready and is in `PLAN-WAITING.md` W1 — do not let it drag this one.

- [ ] `price_observation` for the NBU source only, with the five columns the spec marks unaddable-later: `basis` **in the natural key**, `observed_at` separate from `as_of`, `source` + `parser_version`, and — for the Inzhur rows that follow — `returnRates.{buy,sell}` and `status`.
- [ ] `instrument` with `listed_from` / `retired_at`, and `instrument_ref` permanently allocated, never reused, never renamed.
- [ ] Backfill from the stored raw payloads. This is why they are stored: the schema can be wrong once and still recover.
- [ ] Do **not** store `observation_kind`. `published | carried | computed | frozen` are derived at read time — storing a judgment in an immutable column is the specific error the whole investigation exists to avoid.

**Contracts:** the natural key, and `as_of = capture_date − 1`, both pinned in writing before the first row.
**Verify:** observation count reconciles against capture count per date; a known NBU date reproduces the fair value in the raw file; re-running the backfill is a no-op.
**Risk:** DSQL keys are immutable — a wrong key is a DROP/CREATE, not a migration. `basis` in the key is the one hedge that makes a later valuation-basis decision free (`PLAN-OPEN.md` O6).

---

# Section C — App, pure and independent

## A5 — Live NBU ₴/$ rate — `feat/nbu-rate`

**Goal:** retire the hard-coded 44.83.

**Rationale — verified 2026-08-11, and it is not an automation.** `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=usd&date=YYYYMMDD&json` is public with `Access-Control-Allow-Origin: *` and returned `44.8305` today. A user-triggered fetch is the same shape as "Fetch quotes" — the "exactly one automation" ruling constrains **timers**, not requests. The stored 44.83 is already stale (NBU gave 44.7876 on 2026-08-04) and it silently mis-states every $ headline.

- [ ] `core/nbu/rate.ts` — tolerant pick-parse of `[{r030, txt, rate, cc, exchangedate, special}]`, same idiom as `core/inzhur/parse.ts`: per-entry skip, never all-or-nothing.
- [ ] **Always pass an explicit `date=`.** Without it the endpoint returns *tomorrow's* rate once published in the afternoon — a silent off-by-one on every value the user sees.
- [ ] Determine weekend/holiday behaviour with one request before writing the fallback — do not guess whether it 404s, returns empty, or carries the last published rate.
- [ ] Settings → Appearance: fetched rate with its date, `usdRate` stays a manual override, last-good cached in `meta`. Failure degrades to the stored value and says so.

**Contracts:** `usdRate` keeps its persisted shape; the fetched value is additive. **DECISIONS:** NBU rate policy — today's rate only, no archive (NBU history is backfillable at any time, so the asymmetry that makes the price archive urgent does not apply here).
**Verify:** fixture parse; explicit-date behaviour asserted; offline → stored value + stale note; the ₴ tables are untouched in every case (currency is a display unit for headline KPIs only).

## A6 — Bond price re-derivation — `feat/bond-dcf`

**Goal:** detect a silent yield revision, which the price alone cannot show.

**Rationale:** the feed's bond price is not a market quote but a discounted cash flow over `paymentSchedule` whose only free parameter is `returnRates.sell` — `P(D) = Σ CFᵢ × (1 + y)^(−ACT_days/365)`, verified out-of-sample 2026-07-28 → 2026-08-10 (predicted 1063.1288 vs quoted 1063.13). `returnRates` and `status` have been captured since `dee6b47`, so the inputs exist in every row from 2026-08-10 on.

- [ ] `core/inzhur/dcf.ts` — `derivePrice(schedule, yield, onIso)` and `impliedYield(price, schedule, onIso)` by bisection. The inverse is what catches a revision when only the price moved.
- [ ] Compare stored vs derived on fetch; a mismatch past a kopeck tolerance is a **surfaced anomaly**, never a silent correction (G5).
- [ ] Later, in an `infra/` commit, hand the same function to the capture Lambda so the check runs nightly rather than only when the app is open.
- [ ] Do not store the computed value. The spec is explicit: premises are captured forever, the conclusion never is — a stale provider value is stored as the observed fact.

**Verify:** the out-of-sample pair as a fixture; round-trip `impliedYield(derivePrice(s, y)) ≈ y`; the 6 short-dated bonds that miss the model are handled by residual threshold plus alert, not by a special case (`PLAN-OPEN.md` O8 — neither of the user's holdings is among them).

## A7 — Parse errors become visible — `feat/parse-diagnostics`

**Goal:** a provider field rename stops being invisible.

**Rationale:** the owner asked for parsing to be controllable via super-admin settings **and** for parse errors to be visible. The control half needs the B3 user model (`PLAN-OPEN.md` O14); the visibility half needs nothing. `parse.ts` already returns `{entries, skipped}` and **every caller discards `skipped`** — today a renamed field silently drops an asset from the fetch and the UI shows only an unlinked row.

- [ ] Surface `skipped` in the Daily-quotes fetch result: count plus per-entry reason, expandable, non-blocking.
- [ ] Persist the last parse outcome in `meta` beside `inzhur:lastFetch` so the diagnosis survives a reload.
- [ ] Settings → Automation: a read-only "last parse" panel. Editable controls land with B3.

**Verify:** a fixture with one malformed entry yields exactly one skip with its reason **and** parses the rest — the tolerant-parse contract must not regress into all-or-nothing.

---

# Section D — The one large sweep

Independent of persistence: it touches design tokens and strings, so the B3 migration cannot invalidate it. Doing it now means B3 lands on an already-themed, already-localised app rather than doubling the surface to re-verify. Phase 1's `var()`-emitting colors and the structured-returns rule exist to make both sweeps mechanical.

## A8 — Design brief — `docs/design-brief-phase-5`

**The G7 gate.** Nothing in A9/A10 starts before the design session merges `design/extensions/*.dc.html`.

- [ ] `docs/design-briefs/phase-5-appearance-language.md`: dark palette sheet (every token including the 4 asset hues at ≥4.5:1, shadows, chart grid and tooltip, sidebar-vs-page, focus and selection), theme + language segmented controls, UK reference copy (~20–30 % longer than EN).

## A9 — Dark theme — `feat/dark-theme`

- [ ] Split double-duty tokens into surface/on-surface pairs (`ink`, `sidebar-text`).
- [ ] Purge literal `bg-white` / `text-white` (TransactionPanel, AssetForm, Select, Sidebar, KpiCard, DatePicker, button-variants) and rgba shadows (Card, KpiCard, Select, DatePicker) into tokens.
- [ ] `[data-theme=dark]` block for all tokens including `--color-chart-*`; theme the recharts Tooltip and cursor.
- [ ] FOUC-free head script in `index.html` + `<meta name="color-scheme">`; store `theme` with `matchMedia` for `system`; chart `key`s stable across flips; toggle in Settings → Appearance.

## A10 — Ukrainian — `feat/i18n-uk`

- [ ] `src/i18n/messages.ts` (`en` canonical, `Dict` derived from it, `uk satisfies Dict`), `useT()` on `settings.language`.
- [ ] Sweep ~200 strings across ~26 files, one mechanical commit per screen; label maps return keys and their tests re-assert keys.
- [ ] `pnpm add date-fns` → DayPicker `locale={uk}` + `weekStartsOn`; `document.documentElement.lang`; MONTH_SHORT and ordinals into i18n; runtime key-parity test.
- [ ] **Pinned: `fmtTable` / `fmtProse` / `fmtDate` are byte-identical in both languages.** Formats never follow language.

**Contracts:** settings `theme` / `language`; the final token vocabulary; i18n namespace `screen.section.item`. **DECISIONS:** theme architecture (token redefinition, FOUC contract, persist key); i18n architecture (typed dict, keys-in-tests, formats-never-localize, `date-fns` dep — G6 entry).
**Verify:** unit — key parity compile-time and runtime, formatter invariance under `uk`. Browser — every route in dark, system and reduced-motion; hard-reload in dark with no white flash; UK with localised calendar, `<html lang>`, unchanged numbers and dates, 360 px overflow sweep; contrast spot-checks. Gates + build; tag.
**Risk:** the i18n sweep is wide though mechanical — freeze other UI branches while it runs.

---

## Cross-phase rules

- Branches as named; plain conventional commits; squash-merge to `dev`; no AI attribution in any git artifact.
- `pnpm lint && pnpm typecheck && pnpm test` per merge; `pnpm build` + tag per section close.
- `infra/` phases deploy through `.github/workflows/deploy.yml` only. CI drives one named stack and may not touch hosting config (D15).
- **Standing invariants:** no silent writes — fetched, derived and server-suggested values reach a draft or a prefill only (G5); empty cell ≠ 0; validate-fully-then-one-transaction; every new persisted settings field enters `partialize` in the same commit; D7 motion + reduced-motion on every new control.
- Every DDL change on DSQL: one statement per transaction, never mixed with DML, no `DESC` in index keys, retry SQLSTATE 40001, ≤3,000 mutated rows per transaction.

## Acceptance for Plan A

A1 makes the 2026-09-23 coupon land on the 23rd. A2–A4 leave a narrow journal, a proven restore and a queryable NBU history. A5–A7 retire the hard-coded rate, catch a yield revision and make a parse failure visible. A8–A10 leave every route themed and localised. At that point the only work left is dated (`PLAN-WAITING.md`) or undecided (`PLAN-OPEN.md`).
