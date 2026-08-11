# Kubushka Next-Phase Plan (v1.0.0 → cloud)

> **For agentic workers:** this is the living plan of record. Pick the first non-done task, branch as named, tick the checkbox here, keep the Status table current, update `navigation-map.md` + folder READMEs, gates green per merge (`pnpm lint && pnpm typecheck && pnpm test`).

**Rewritten 2026-08-11.** The original plan (approved 2026-07-28) assumed a permanently local-first app. A planning session on 2026-08-04 redirected the project to a cloud backend with auth, and the first stage of that work is **deployed and running**. This file now carries only what is still live: the shipped record, the retired items with their reasons, and the work that can actually start today. Everything cut is listed under **Retired** rather than deleted silently — the reasoning is the useful part.

**Companion documents:** stack + staging decision `docs/superpowers/specs/2026-08-04-cloud-stack-and-cost.md` · target data model `docs/superpowers/specs/2026-08-04-data-model.md` · deployed backend `infra/README.md` · decisions `docs/DECISIONS.md` (D26–D28 cover the archive) · formula rulings `docs/FORMULA-AUDIT.md` · v1 record `docs/BUILD-PLAN.md`.

## Status

| # | Phase | Status |
|---|-------|--------|
| 0 | Repo hygiene | **done** (2026-07-28) |
| 1 | Core consolidation, write surface, formula audit | **done** (2026-07-29) — v1.1.0 |
| 2 | Settings home & real-data era | **done** (2026-08-02) — v1.2.0 |
| 3 | Living data: Inzhur fetch, fixed yield, reminders | **done** (2026-08-04) — v1.3.0 |
| 4 | Data portability | **closed** — JSON export/import + CSV export shipped; CSV import + mirror retired (D29) |
| B1 | Backend: price capture archive | **done, live** (2026-08-11) |
| B2 | Backend: observation schema + read API | **blocked on evidence** — NBU half ready now, Inzhur half ~2026-09-01 |
| B3 | Backend: auth, user schema, repository → HTTP | todo — the migration proper |
| 5 | Appearance & language: dark theme + UK | **todo — startable now** |
| 6 | Chart analytics: ranges + cap-by-day | todo — startable, but re-verify after B3 |
| 7 | Full control: DB browser | todo — after B3 by construction |

Current version: **v1.3.0**. Per-phase tags continue per `docs/VERSIONING.md`.

## What shipped (compressed record — detail lives in git + DECISIONS)

- **Phase 0** `chore/next-phase-prep` — trimmed Inzhur fixture, gitignore, doc pointers.
- **Phase 1** `refactor/core-folder`, `feat/repo-write-surface`, `chore/settings-persist-version`, `feat/backup-export-json`, `feat/formula-parity` — `src/core/` pure domain layer; full repository write surface; JSON backup envelope v1; the formula audit (`docs/FORMULA-AUDIT.md`).
- **Phase 2** `feat/settings-shell`, `feat/asset-form`, `feat/targets-editor`, `feat/dataset-split`, `feat/clear-data`, `feat/metrics-exposure` — `/settings`, full asset editing, demo/live dataset split, safe erase, audited metrics on screen.
- **Phase 3** `feat/inzhur-client`, `feat/fetch-quotes`, `feat/fixed-yield`, `feat/reminders` — the headline daily ritual: fetch quotes, accrual ghosts, coupon confirm cards, in-app reminders.
- **Phase 4** `feat/backup-import` — validate → diff → confirm → one rw transaction, safety backup first (D24). `feat/csv-export` — one CSV per table with the pinned dialect, plus `src/lib/download.ts` (save-picker parity, a cancelled picker is not an error) which the JSON backup button now shares (D29).
- **Backend B1** — `infra/` SAM stack: Aurora DSQL cluster, capture Lambda on EventBridge Scheduler at 01:00 Europe/Kyiv, DLQ, five alarms, two metric filters. Captures **two** sources per run (Inzhur `_api/assets`, NBU fair value), writes a journal row on every outcome including failures, and detects a frozen upstream by hashing prices rather than payloads (D26–D28). NBU archive backfilled to 2016-01-04.
- **2026-08-11, outside any phase** — `fix: count sale proceeds in netResult and accrue coupons over the real period` (commit `290b26f`). Both were latent sign/precision defects found during the backend work: `netResult` ignored sale proceeds (a redemption inverted the sign), `dailyAccrual` divided by 365 instead of the real 182-day coupon period. FORMULA-AUDIT ruling 4 now records the ACT/ACT exception.

## Retired — and why

| Item | Reason |
|---|---|
| **Phase 4 `feat/file-mirror`** (Chromium file-sync mirror) | It was a durability answer to a local-only app: keep a copy outside the browser because the browser is the only home. The cloud store answers durability better and on every device, and the mirror was Chromium-only, best-effort and never authoritative. Nothing survives it. |
| **CSV import** (half of `feat/csv-roundtrip`) | A restore path for a database that will no longer live in the browser — and a partial one at that, since it covered snapshots only. Cancelled 2026-08-11 by owner ruling; the written, green implementation was removed rather than merged (D29). The **export** half shipped: it hands the user their own numbers in a spreadsheet's language and has no dependency on where the data is stored. |
| **D2 — IndexedDB as system of record** | Superseded by B3, not before. Until `src/lib/repository.ts` becomes an HTTP client, D2 still holds and code must respect it. |
| **D16 / G4 — demo + live dual datasets** | The split existed so real data could hide from a pinned demo seed inside one browser. Server-side accounts make it a per-account concern. Retire **at B3**, not now — the sidebar DEMO badge and the seed checkpoints in `navigation-map.md` are load-bearing until then. |
| **G2's `deleteAsset`** | Owner ruling: assets accumulate, nothing is deleted. The method stays in the codebase (it is tested and harmless) but no new surface may depend on cascade-delete semantics. |
| **The v1 "spreadsheet as DB" framing** (draft item 8) | Answered by the archive + accounts. The user's actual need — durability and cross-device — is met without a file ever being the system of record. |

**Resolved 2026-08-11:** merged export-only. `papaparse`, `src/lib/csv-parse.ts`, the parser and diff in `csv.ts`, `repo.replaceSnapshots` and the dialog's CSV variant are gone; the import row accepts `.json` alone and its copy no longer promises otherwise.

## Governing decisions — current standing

- **G1 — `src/core/` is the pure domain layer, `src/lib/` is persistence/infra.** Binding, and more valuable after B3: the domain layer is exactly the part the migration does not touch. Structured-returns rule (core returns keys/tokens, never English prose) still binding.
- **G2 — repository write surface.** Binding as the *interface*; its Dexie implementation is what B3 replaces. New code calls `repository.ts`, never `db.ts`.
- **G3 — settings persist version + `partialize` in the same commit.** Binding.
- **G4 — dataset split.** Binding until B3 (see Retired).
- **G5 — automation is suggest-only by construction.** Binding and non-negotiable: fetched and accrued values reach a draft or a prefilled form, and the user's Save/Confirm is the sole write path. This survives the cloud move unchanged and applies to anything the server suggests too.
- **G6 — new dependencies each get a DECISIONS entry.** Binding.
- **G7 — design-brief pipeline** (brief → design session → `design/extensions/*.dc.html` → implementation; pure-logic tasks are never design-blocked). Binding.
- **G8 — ordering rationale.** Superseded by the staging in this file.

---

## What can be started right now

Four tracks. N1 and N2 are pure and independent of everything; N3 is the backend's own next step and is partly gated on elapsed time; N4 is the largest ready block of user-visible work.

### N1 — Bond price re-derivation from `returnRates` — branch `feat/bond-dcf`

Pure core, no dependencies, no design gate. The feed's bond price is not a market quote — it is a discounted cash flow over `paymentSchedule` whose only free parameter is `returnRates.sell`:

`P(D) = Σ CFᵢ × (1 + y)^(−ACT_days/365)`

Verified out-of-sample (2026-07-28 → 2026-08-10: predicted 1063.1288 vs quoted 1063.13). `returnRates` and `status` are captured as of `dee6b47`, so the inputs exist in every stored row from 2026-08-10 onward.

- [ ] `core/inzhur/dcf.ts`: `derivePrice(schedule, yield, onIso)` + `impliedYield(price, schedule, onIso)` (bisection; the inverse is what detects a revision when only the price moved).
- [ ] Compare stored price vs derived price on fetch; a mismatch beyond a kopeck tolerance is a **surfaced anomaly**, never a silent correction (G5).
- [ ] Feed the same function to the capture Lambda in a later infra commit so the anomaly is caught nightly, not only when the app is open.

**Why it earns its place:** a yield revision is invisible in the price alone, and it is the one upstream change that silently rewrites what the portfolio is worth. Verify: the out-of-sample pair above as a fixture, plus a round-trip `impliedYield(derivePrice(s, y)) ≈ y`.

### N2 — Parse errors become visible — branch `feat/parse-diagnostics`

The owner asked for parsing to be **controllable via super-admin settings and for parse errors to be visible**. The control half needs the B3 user model; the visibility half needs nothing.

`parse.ts` already returns `{entries, skipped}` and every caller discards `skipped`. Today a provider that renames a field silently drops that asset from the fetch and the UI shows only an unlinked row.

- [ ] Surface `skipped` in the Daily-quotes fetch result: count + per-entry reason, expandable, non-blocking.
- [ ] Persist the last parse outcome in `meta` alongside `inzhur:lastFetch` so the diagnosis survives a reload.
- [ ] Settings → Automation: a read-only "last parse" panel (the editable super-admin controls land in B3).

**Verify:** a fixture with one deliberately malformed entry produces one skip with its reason, and the other entries still parse — the tolerant-parse contract from D-Inzhur must not regress into all-or-nothing.

### N3 — Backend Phase 2: observation schema + read API — branch `infra/observation-schema`

The archive stores raw capture rows. Nothing reads them yet, and the app does not know the backend exists.

**Evidence gate, stated honestly:** B2's whole point is deciding the schema *with evidence in hand*.

- **NBU half is ready now.** The backfill to 2016-01-04 is complete and verified (`captured: 0, complete: true` on re-run), weekend/holiday behaviour is characterised (404 on weekends), `calc_date` matched the filename date on 14/14 sampled dates across 2016–2026, and the malformed header (field 17 declares three columns, data carries one) is understood. The NBU observation schema can be finalised today.
- **Inzhur half is not.** Capture began 2026-08-10; two days of data cannot show weekend behaviour, holiday behaviour, or yield stability. The spec asks for ~3 weeks. **Earliest honest date: ~2026-09-01.** Until then the frozen-feed detector accumulates the evidence by itself and needs no attention.

- [ ] Finalise + create the NBU observation table; backfill it from the stored raw rows (they regenerate any schema retroactively — that is why they are stored).
- [ ] Measure real DPU against the documented `max(BytesRead, 2048) × 0.00000183105` and record the figure in the spec's cost section.
- [ ] Verify DSQL backup/PITR actually works before any user data depends on it. This is the gate the spec names; if it disappoints, price history moves to S3 + CloudFront.
- [ ] *(after ~2026-09-01)* the same three steps for Inzhur.

### N4 — Phase 5: dark theme + Ukrainian — branches `feat/dark-theme`, `feat/i18n-uk`

**The largest block of ready work, and the one the migration cannot invalidate** — it touches design tokens and strings, not persistence. Doing it now means B3 lands on an already-themed, already-localised app instead of doubling the surface to re-verify. Phase 1's `var()`-emitting colors and structured-returns rule were built to make both sweeps mechanical.

- [ ] `docs/design-briefs/phase-5-appearance-language.md` — **the gate (G7)**: dark palette sheet (every token incl. the 4 asset hues at ≥4.5:1, shadows, chart grid/tooltip, sidebar-vs-page, focus/selection), theme + language segmented controls, UK reference copy (~20–30 % longer than EN). Nothing below starts before the design session merges `design/extensions/*.dc.html`.
- [ ] `feat/dark-theme` — split double-duty tokens into surface/on-surface pairs (`ink`, `sidebar-text`); purge literal `bg-white`/`text-white` (TransactionPanel, AssetForm, Select, Sidebar, KpiCard, DatePicker, button-variants) and rgba shadows (Card, KpiCard, Select, DatePicker) into tokens; `[data-theme=dark]` block for all tokens incl. `--color-chart-*`; theme the recharts Tooltip and cursor; FOUC-free head script in `index.html` + `<meta name="color-scheme">`; store `theme` + `matchMedia` for `system`; stable chart `key`s across flips; toggle in Settings → Appearance.
- [ ] `feat/i18n-uk` — `src/i18n/messages.ts` (`en` canonical, `Dict` derived from it, `uk satisfies Dict`), `useT()` on `settings.language`; sweep ~200 strings across ~26 files, one mechanical commit per screen; label maps return keys and their tests re-assert keys; `pnpm add date-fns` → DayPicker `locale={uk}` + `weekStartsOn`; `document.documentElement.lang`; MONTH_SHORT and ordinals move into i18n; runtime key-parity test. **Pinned: `fmtTable`/`fmtProse`/`fmtDate` are byte-identical in both languages** — formats never follow language.

**Contracts:** settings `theme`/`language`; the final token vocabulary; i18n namespace `screen.section.item`. **DECISIONS:** theme architecture (token redefinition, FOUC contract, persist key) and i18n architecture (typed dict, keys-in-tests, formats-never-localize, date-fns dep).
**Verify:** unit — key parity (compile-time and runtime), formatter invariance under `uk`. Browser — every route in dark, system and reduced-motion; hard-reload in dark with no white flash; UK: calendar localised, `<html lang>` set, numbers and dates unchanged, 360 px overflow sweep; contrast spot-checks. Gates + build; tag.
**Risk:** the i18n sweep is wide though mechanical — freeze other UI branches while it runs.

---

## Queued behind the migration

### B3 — Auth, user schema, `repository.ts` → HTTP client (the migration proper)

The one irreversible-feeling step, and the reason everything above was staged in front of it. Scope per the spec: user schema in DSQL, Cognito, API Gateway + API Lambda, `repository.ts` rewritten as an HTTP client, PWA shell, test repair, cutover. Accepted costs are front-loaded and known: **OCC retry handling** (`If-Match` becomes `UPDATE … WHERE version = $2` + rowcount, mutations retry on SQLSTATE 40001) and **no local emulator** (local Postgres for the inner loop, schema deliberately kept inside the DSQL subset, real DSQL in CI).

Pinned by the owner and binding on the design:
- Prices are a **global single source of truth**; an account stores only user-specific data (amounts, transactions).
- Accounts are independent. Last-write-wins on the per-date snapshot key is acceptable.
- **Offline is expressly not a requirement** — "its okay to lose offline everywhere". This is what collapses the sync problem; do not reintroduce it.
- The scheduler auto-registers newly listed provider assets **into the catalog, never into a portfolio**.
- Exactly one automation: the 01:00 capture. Nothing else runs on a timer.

Retires D2, D16/G4, the demo/live split and the dataset guards. `navigation-map.md` needs a full re-baseline in the same phase — its checkpoints currently assume the demo seed in IndexedDB.

### Phase 6 — Chart analytics: ranges + cap-by-day

Startable today (the logic is pure), but every browser checkpoint would need re-verifying after B3, so it is cheaper after. Scope unchanged: `ChartCard` + `ChartToolbar` (7d/1m/1y/all + custom range), `useDateRange` on `useSearchParams`, pure `core/dates.filterRange`; wire all five chart screens with the pinned trap fixes (Balances YAxis domain from filtered data; **annualized keeps the PORTFOLIO_START `daysHeld` basis regardless of window**; Payouts month labels year-qualified across years; hardcoded "Feb — Jul 2026" subtitles derive from the actual range; sparse-window empty state). Then `core/day-deltas.ts`: per-asset day-over-day **percentage** return, flow-adjusted (subtract same-day buy/reinvest before dividing by prior value — seed reinvests 687,02/484,36/216 are the regression fixtures), unit-price basis where units are known, averaged per day-of-month normalised by occurrence count.

### Phase 7 — Full control: DB browser

After B3 by construction — it is built directly on the repository write surface, which B3 replaces. `/data` route, three tabs, edit dialogs, typed confirms with impact hints derived from core (`"removes 14 transactions, quotes on 174 days; Income received −₴472,13"`). Note the retired `deleteAsset`: the browser may edit, but asset deletion is no longer a product requirement.

---

## Cross-phase rules

- **Git/gates:** per-task branches as named; plain conventional commits; squash-merge to `dev`; `pnpm lint && pnpm typecheck && pnpm test` per merge; `pnpm build` + version tag per phase close; no AI attribution in any git artifact.
- **Docs upkeep per phase:** this file's checkboxes and Status table; DECISIONS entries (numbering assigned sequentially at append time — D28 is the current tail); `navigation-map.md` route rows and checkpoints (in demo mode until B3); folder READMEs (`src/core/`, `src/i18n/`, `docs/design-briefs/`, `design/extensions/`, `infra/`).
- **Standing integrity invariants (review checklist):** validate-fully-then-one-transaction for multi-row writes; **no silent writes** — fetched, accrued and server-suggested values reach a draft or prefill only; empty cell ≠ 0; no orphan rows persisted; destructive confirms always offer a one-click backup; every new persisted settings field enters `partialize` in the same commit; D7 motion + reduced-motion on every new control.
- **Design pipeline (G7):** brief → design session → `design/extensions/*.dc.html` merged → UI implementation. Pure-logic tasks are never design-blocked.

## Flagged deviations from the original draft

1. Asset CRUD and the DB browser live on `/data` (Settings links to it) rather than literally inside the Settings tab — preferences and entity-management have different lifecycles.
2. Automation (Phase 3) shipped before full import (Phase 4): JSON backup existed from Phase 1 and automation is suggest-only.
3. Coupon suggestions never draft a `tax` row (OVDP coupons are PIT-exempt in UA; the type stays available manually).
4. **CSV import and the file mirror were cancelled outright** rather than deferred — see Retired.
