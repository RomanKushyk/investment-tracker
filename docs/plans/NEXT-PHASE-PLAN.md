# Quirenote Next-Phase Plan (v1.0.0 → cloud)

> **For agentic workers:** this file is the **plan of record and the index**. It holds the shipped record, the retired items and the governing decisions. **Execution lives in three sibling plans — go there for tasks:**
>
> | Plan | What is in it | How to use it |
> |---|---|---|
> | **`PLAN-NOW.md`** | Everything startable today, in sections ordered by deadline pressure then irreversibility. Full phase ceremony. | Pick the first non-done task in section order. |
> | **`PLAN-WAITING.md`** | Everything gated on elapsed time or an external event, with earliest dates, which are hard, and the cost of missing each. | **Read its dated table at the start of any session touching `infra/` or the migration.** |
> | **`PLAN-OPEN.md`** | Questions with no answer. Mostly closed (D30–D35, 2026-08-11); what remains is deferred by design. | **Never implement from it.** Needing an answer is the signal to ask, not to choose quietly. |
>
> Branch as named, tick the checkbox in the plan that owns the task, update `navigation-map.md` + folder READMEs, gates green per merge (`pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`).

**Rewritten 2026-08-11.** The original plan (approved 2026-07-28) assumed a permanently local-first app. A planning session on 2026-08-04 redirected the project to a cloud backend with auth, and the first stage of that work is **deployed and running**. This file now carries only what is still live: the shipped record, the retired items with their reasons, and the work that can actually start today. Everything cut is listed under **Retired** rather than deleted silently — the reasoning is the useful part.

**Companion documents:** stack + staging decision `docs/superpowers/specs/2026-08-04-cloud-stack-and-cost.md` · target data model `docs/superpowers/specs/2026-08-04-data-model.md` · deployed backend `infra/README.md` · decisions `docs/decisions/README.md` (D26–D28 cover the archive) · formula rulings `docs/reference/FORMULA-AUDIT.md` · v1 record `docs/archive/BUILD-PLAN.md`.

## Status

| # | Phase | Status | Executable work |
|---|-------|--------|-----------------|
| 0 | Repo hygiene | **done** (2026-07-28) | — |
| 1 | Core consolidation, write surface, formula audit | **done** (2026-07-29) — v1.1.0 | — |
| 2 | Settings home & real-data era | **done** (2026-08-02) — v1.2.0 | — |
| 3 | Living data: Inzhur fetch, fixed yield, reminders | **done** (2026-08-04) — v1.3.0 | — |
| 4 | Data portability | **closed** — JSON export/import + CSV export shipped; CSV import + mirror retired (D29) | — |
| B1 | Backend: price capture archive | **done, live** (2026-08-11) | closed — A2 (index, D48), A3 (durability gate, D49), A14 (backup liveness) all done |
| B2 | Backend: observation schema + read API | **NBU half done** (2026-08-11, D50) | Inzhur half → `PLAN-WAITING.md` W3–W4 · read API still to come |
| B3 | Backend: auth, user schema, repository → HTTP | todo — the migration proper, scope now specified (D32–D34) | `PLAN-WAITING.md` W7 |
| 5 | Appearance & language: dark theme + UK | **done** (2026-08-14) — v1.5.0 | closed — A8 brief, A9 dark theme, A10 Ukrainian (D58) |
| 6 | Chart analytics: ranges + cap-by-day | **ranges done** (2026-08-24) — Phase 8, A38–A41, shipping as **v1.8.0**; cap-by-day still todo (W13) | The range half landed as a PERSISTED store field (`settings.period`, one writer, read by `/overview` and `/yield`) rather than W13's `useSearchParams` form — a window is a preference here, not a shareable URL. **No carve-outs left:** `/seasonality` is wired ([A42], actual bars only — a projection has no window), and the annualized basis is **settled by D80** with F-3's grey shipped alongside it. The window is read by all three screens the control always claimed. W13 still owns cap-by-day |
| 7 | Full control: DB browser | todo | `PLAN-WAITING.md` W14 |
| M | The mobile shell — two shells, one breakpoint | **done** (2026-08-17) — v1.6.0 | closed — A16 brief, A17 shell + record cards (D66), A18 one scroll surface (D65) |
| — | Coupon dates walk the published schedule | **done** (2026-08-11) | `PLAN-NOW.md` A1 — landed well before the 2026-09-23 deadline |

**Phase 6 is lettered M above on purpose.** The design briefs number their own
phases, and *their* phase 6 is the mobile shell while *this* table's phase 6 is
chart analytics — two different bodies of work under one number. The mobile work
gets a letter here until one of the two numbering schemes is retired; do not
merge the rows.

Current version: **<!--f:app.version-->v1.8.0<!--/f-->** — machine-maintained from `package.json`, never hand-edited. It is fenced because the hand-written form said `v1.6.1` through six releases (1.6.2 → 1.8.0) before a review caught it. Per-phase tags continue per `docs/reference/VERSIONING.md`.

## What shipped (compressed record — detail lives in git + DECISIONS)

- **Phase 0** `chore/next-phase-prep` — trimmed Inzhur fixture, gitignore, doc pointers.
- **Phase 1** `refactor/core-folder`, `feat/repo-write-surface`, `chore/settings-persist-version`, `feat/backup-export-json`, `feat/formula-parity` — `src/core/` pure domain layer; full repository write surface; JSON backup envelope v1; the formula audit (`docs/reference/FORMULA-AUDIT.md`).
- **Phase 2** `feat/settings-shell`, `feat/asset-form`, `feat/targets-editor`, `feat/dataset-split`, `feat/clear-data`, `feat/metrics-exposure` — `/settings`, full asset editing, demo/live dataset split, safe erase, audited metrics on screen.
- **Phase 3** `feat/inzhur-client`, `feat/fetch-quotes`, `feat/fixed-yield`, `feat/reminders` — the headline daily ritual: fetch quotes, accrual ghosts, coupon confirm cards, in-app reminders.
- **Phase 4** `feat/backup-import` — validate → diff → confirm → one rw transaction, safety backup first (D24). `feat/csv-export` — one CSV per table with the pinned dialect, plus `src/lib/download.ts` (save-picker parity, a cancelled picker is not an error) which the JSON backup button now shares (D29).
- **Backend B1** — `infra/` SAM stack: Aurora DSQL cluster, capture Lambda on EventBridge Scheduler at 01:00 Europe/Kyiv, DLQ, five alarms, two metric filters. Captures **two** sources per run (Inzhur `_api/assets`, NBU fair value), writes a journal row on every outcome including failures, and detects a frozen upstream by hashing prices rather than payloads (D26–D28) — **the hashing stands, the detection was retired 2026-08-18 by D70**, once W1 measured that daily bond accrual keeps the digest fresh by construction and a value check can never fire. NBU archive backfilled to 2016-01-04.
- **2026-08-11, outside any phase** — `fix: count sale proceeds in netResult and accrue coupons over the real period` (commit `290b26f`). Both were latent sign/precision defects found during the backend work: `netResult` ignored sale proceeds (a redemption inverted the sign), `dailyAccrual` divided by 365 instead of the real 182-day coupon period. FORMULA-AUDIT ruling 4 now records the ACT/ACT exception.
- **Phase 5** `feat/dark-theme`, `feat/i18n-uk` — the Light/Dark/System control and the whole dark sheet measured against WCAG, then Ukrainian as the DEFAULT language with formatting that follows the language rather than the context (Contract 0, D58). The font pair changed with it: IBM Plex Sans + JetBrains Mono, because neither original face carries a single Cyrillic letter (D54).
- **The mobile shell** `feat/mobile-shell`, `feat/scroll-surface` — two shells at one breakpoint, `md` (D66): an off-canvas drawer and a header that carries the capital below it, the 244px rail and a collapse control above, and the four tables folded into record cards. 44 × 44 is hit area and never geometry, so no radius moved. Every constrained box went through one `Scroller` (D65) and dialogs became three bands of which only the middle scrolls. Closed with zero horizontal overflow on all ten routes across five widths and both themes.
- **2026-08-17, outside any phase** — `muted` re-derived against the surface it is worst on and `label` retired into it (D68), after the light palette was measured against WCAG 1.4.3 for the first time and failed on all three backdrops.

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

## Where the executable work lives

The four tracks that used to be listed here, plus everything queued behind the migration, moved into the three sibling plans on 2026-08-11 so that "what can I start" and "what am I waiting for" stop sharing a page.

| Was here | Now in |
|---|---|
| bond DCF · parse diagnostics · the NBU half of the observation schema · theme + Ukrainian | `PLAN-NOW.md` A1–A10, alongside the coupon-date fix, the payload split and the durability gate |
| B3 migration · the Inzhur observation window · super-admin surface · Phase 6 charts · Phase 7 DB browser | `PLAN-WAITING.md`, each with its gate and its earliest date |
| Archive row schema · fund basis · past-date prefill · the seed's fate | `PLAN-OPEN.md`, in rounds by cost of getting them wrong |

**The pinned scope of the two post-migration phases stays recorded here**, because their trap fixes were bought with a formula audit and must not be re-derived:

- **Phase 6 — chart analytics.** `ChartCard` + `ChartToolbar` (7d/1m/1y/all + custom range), `useDateRange` on `useSearchParams`, pure `core/dates.filterRange`. Wire all five chart screens with the pinned trap fixes: Balances YAxis domain from filtered data; ~~**annualized keeps the PORTFOLIO_START `daysHeld` basis regardless of window**~~ — **SUPERSEDED 2026-08-24 by D80** (owner's ruling on O24): the window DOES change the basis, F-2 measured what the pin was protecting against, and F-3's grey ships with it. The pin was not wrong when written — with one window there was nothing to see; Payouts month labels year-qualified across years; ~~hardcoded "Feb — Jul 2026" subtitles derive from the actual range~~ — **partly done 2026-08-13:** the frozen ranges were simply REMOVED from the Balances and Seasonality subtitles, because a copy audit found them untrue on live data and, in Balances, already contradicted by a derived footer twenty lines below ("… total since &lt;earliest&gt;"). Deleting an untrue claim was the fix available today; this phase may still ADD a derived range if the toolbar makes one useful; sparse-window empty state. Then `core/day-deltas.ts` — per-asset day-over-day **percentage** return, flow-adjusted (subtract same-day buy/reinvest before dividing by prior value; seed reinvests 687,02/484,36/216 are the regression fixtures), unit-price basis where units are known, averaged per day-of-month normalised by occurrence count.
- **Phase 7 — DB browser.** `/data` route, three tabs, edit dialogs, typed confirms with impact hints derived from core (`"removes 14 transactions, quotes on 174 days; Income received −₴472,13"`). Note the retired `deleteAsset`: the browser may edit, but asset deletion is no longer a product requirement.

**B3, the migration proper**, is `PLAN-WAITING.md` W7. Its owner-pinned constraints stay binding wherever it is executed: prices are a **global single source of truth** and an account stores only user-specific data · accounts are independent, last-write-wins on the per-date key is acceptable · **offline is expressly not a requirement** and must not be reintroduced · the scheduler registers newly listed provider assets **into the catalog, never into a portfolio** · exactly one automation, the 01:00 capture.

---

## Cross-phase rules

- **Git/gates:** per-task branches as named; plain conventional commits; **`/code-review` on the branch before every squash-merge, findings fixed or declined in writing (D76)**; squash-merge to `dev`; `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` per merge; `pnpm build` + version tag per phase close; no AI attribution in any git artifact.
- **Docs upkeep per phase:** this file's checkboxes and Status table; DECISIONS entries (numbering assigned sequentially at append time — **the tail is the last row of `../decisions/README.md`**, not a number repeated here; **appending means CREATING `docs/decisions/D<n>.md`**, because D96 retired the range files, and a number is never reused or renumbered); `navigation-map.md` route rows and checkpoints (in demo mode until B3); folder READMEs (`src/core/`, `src/i18n/`, `docs/plans/`, `docs/archive/design-briefs/`, `docs/archive/plan-a|b|c/`, `docs/archive/build-plan/`, `docs/reference/deployment/`, `design/extensions/`, `infra/`) — **and the range tables inside the plan indexes, which is where a new body becomes unreachable if it is missed (D95)**.
- **Standing integrity invariants (review checklist):** validate-fully-then-one-transaction for multi-row writes; **no silent writes** — fetched, accrued and server-suggested values reach a draft or prefill only; empty cell ≠ 0; no orphan rows persisted; destructive confirms always offer a one-click backup; every new persisted settings field enters `partialize` in the same commit; D7 motion + reduced-motion on every new control.
- **Design pipeline (G7):** brief → design session → `design/extensions/*.dc.html` merged → UI implementation. Pure-logic tasks are never design-blocked.

## Ungroomed input — [GitHub Issues](https://github.com/RomanKushyk/investment-tracker/issues)

**Two channels since 2026-08-26, and the split is load-bearing** — it outlived
the files that first carried it. `enhancement` is what the app does not do yet;
`bug` is what it does WRONG. A missing capability is an `enhancement`; a
cosmetic shipped on purpose is `FOLLOW-UPS.md`; a bug is the app getting wrong
something it already does. **Nothing is fixed from a `bug` issue without
reproducing it first** — a line there is a symptom, not a diagnosis: reproduce,
write the failing test, then fix.

**The inbox left the repository 2026-08-28 (D103).** `USER-FEATURES-DRAFT.md`
and `USER-BUGS-DRAFT.md` became issues #1–#27, byte for byte, and the reason was
capture rather than storage: a line typed into a file on a phone is not a line
that reaches `git`, and four ideas were sitting uncommitted in the working tree
at the moment the migration was decided. It is still **deliberately not copied
here** — a second copy in this file is how the two drift.

**Nothing in it is planned.** The rules for working an issue — diagnosis first,
and D105's routing — are in [`README.md`](README.md) and deliberately not copied
here. The list moved out of `docs/archive/` on 2026-08-17 (the archive
rule is *never a task list*) and was pruned from 23 items to 7 in the same pass.

**Groomed and emptied 2026-08-18 (7 → 0)**, and it filled again — to 24 ideas by
the time it became issues #4–#27.
The seven lines became **A21, A22, A23** (`../archive/plan-a/section-h-1.md`,
which carries the line-by-line mapping — Section H left `PLAN-NOW.md` in D95), **W16** (`PLAN-WAITING.md`, gated on W7) and
**O22** (`PLAN-OPEN.md`). Three of the seven became design briefs rather than
implementations, per G7.

**The two that touched rulings recorded here were filed as rulings, not as work.**
The settings toggle that would auto-save the daily quotes is **O22** — G5 is
called binding and non-negotiable below, and narrowing it to "binding unless the
owner opts out" is a decision, not a feature. The provider-first asset form is
**A23**, whose brief is required to say which half is the app's and which belongs
to B3's catalog, since that catalog already registers newly listed provider
assets and never puts them in a portfolio.

## Flagged deviations from the original draft

1. Asset CRUD and the DB browser live on `/data` (Settings links to it) rather than literally inside the Settings tab — preferences and entity-management have different lifecycles.
2. Automation (Phase 3) shipped before full import (Phase 4): JSON backup existed from Phase 1 and automation is suggest-only.
3. Coupon suggestions never draft a `tax` row (OVDP coupons are PIT-exempt in UA; the type stays available manually).
4. **CSV import and the file mirror were cancelled outright** rather than deferred — see Retired.
