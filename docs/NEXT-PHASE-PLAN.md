# Kubushka Next-Phase Plan (v1.0.0 → v1.x)

> **For agentic workers:** this is the living plan for everything after v1.0.0, replacing `BUILD-PLAN.md` (kept as the v1 record) as the plan of record. Same working rules: pick the first non-done phase/task, branch as named, tick checkboxes here as you complete them, keep the Status table current, update `navigation-map.md` + folder READMEs, gates green per merge. Approved in the planning session of 2026-07-28 after a six-agent investigation, a live exploration of the user's Inzhur dashboard, and a three-lens design panel.

**Source items:** `docs/NEXT-PHASE-DRAFT.md` (17 items). **Formula spec:** `docs/WEALTH-MANAGEMENT-ARCHITECTRUE.md` (spreadsheet-era challenges — reconciled below).

**User intent (binding, clarified 2026-07-28):**
- "Spreadsheet as DB" = durability + cross-device persistence → IndexedDB stays canonical; JSON = lossless backup; CSV = spreadsheet view; optional Chromium auto-export **mirror** to a user-picked file (synced folder for cross-device). Never a file/Sheet as system of record.
- "Quick read from Inzhur" = **Fetch quotes** button. Assets get an "Inzhur asset" link (fund slug / bond ISIN) + **units**; daily value = units × fetched sell price, one click for all.
- "Auto track fixed yield" = auto-suggested bond quotes AND auto-suggested coupon transactions, each behind its own toggle; **suggest, never silently write; never rewrite history**.
- Reminders = in-app only.
- Every new UI surface gets a **design brief** first, consumed by a separate Claude design session that extends the design reference before implementation.
- Approved: `fake-indexeddb` devDep for repository tests (scoped D4 amendment); dataset migration = current `kubushka` DB becomes **demo**, new empty **live** DB.

## Status

| # | Phase | Branches | Status |
|---|-------|----------|--------|
| 0 | Repo hygiene | `chore/next-phase-prep` | **done** (2026-07-28) |
| 1 | Core consolidation & write surface (+ formula audit) | `refactor/core-folder` … `docs/design-brief-phase-2` | **done** (2026-07-29) |
| 2 | Settings home & real-data era | `feat/settings-shell` … `docs/design-brief-phase-3` | **in progress** (started 2026-08-01) |
| 3 | Living data: Inzhur fetch, fixed yield, reminders | `feat/inzhur-client` … `docs/design-brief-phase-4` | todo |
| 4 | Data portability: import, CSV, mirror | `feat/backup-import` … `docs/design-brief-phase-5` | todo |
| 5 | Appearance & language: dark theme + UK | `feat/dark-theme`, `feat/i18n-uk`, `docs/design-brief-phase-6` | todo |
| 6 | Chart analytics: ranges + cap-by-day | `feat/chart-toolbar` … `docs/design-brief-phase-7` | todo |
| 7 | Full control: DB browser | `feat/db-browser` | todo |

## Key facts from the investigation (grounding)

1. **Inzhur public endpoint** (verified live 2026-07-28): `GET https://www.inzhur.reit/_api/assets` — unauthenticated, `Access-Control-Allow-Origin: *`, JSON array of all assets. Funds by `slug` (`inzhur-reit`, `inzhur-energy`) with `prices.{buyUAH,sellUAH,navUAH,…}`; bonds by `assetDetails.isin` with per-unit prices, **`paymentSchedule` [{date, amount}] in kopecks per bond** (7840 = ₴78.40 coupon, 100000 = ₴1,000 principal), `maturityDate`, `returnRates`. Position value = units × `sellUAH` (verified vs the user's dashboard: 6 164 × 11.1389 = 68 660.18 ₴; 15 × 1 057.67 = 15 865.05 ₴; 4 × 88.85 = 355.40 ₴ coupons paid). Constraint: **bare GET, zero custom headers** (preflight has no ACAO). Prices refresh daily ~13:00 Kyiv. `ACAO:*` is not contractual → graceful degradation + last-good cache + manual entry authoritative. Fallbacks: `/{offer/<slug>/}_payload.json` (devalue JSON), HTML scrape. The authenticated `core.inzhur.reit` API is unusable from a local SPA (15-min JWT, origin-locked CORS). Trimmed sample: `src/core/inzhur/__fixtures__/assets-sample.json`.
2. **User's real portfolio ≠ D5 seed** (real maturities 24.03.2027/27.09.2028, real invested amounts, units 6164/9/15/4, coupons paid 0.00/355.40) → deliver editing/import tools AND isolate the pinned seed as the demo dataset.
3. **Repository is read-mostly** (only `saveSnapshot`, `recordTransaction`); `ensureSeeded()` reseeds whenever `assets.count()===0` → "clear" is impossible today; deleting the last asset would resurrect the seed.
4. **A second core layer exists** (`screens/shared/`, 9 per-screen pure modules, ~20 inline `.tsx` computation sites, `todayIso()` triplicated, Sidebar re-deriving Overview KPIs) — created because `lib/` was contract-frozen mid-v1.
5. **Theme**: Tailwind 4 utilities emit `var(--color-*)` → a `[data-theme=dark]` token block flips the app; SVG paint attrs resolve `var()` in all engines → `colors.ts` can emit var() strings. Real work: split double-duty tokens (`ink`, `sidebar-text`), purge literal `bg-white`/`text-white`/rgba shadows, theme recharts tooltip, FOUC head script. Dark palette values = design work.
6. **i18n**: typed hand-rolled dict (EN canonical, `uk satisfies Dict`); label maps in unit-tested pure modules → tests re-assert **keys**; `date-fns` becomes a direct dep (day-picker `locale={uk}`); pinned number/date formats never follow language.
7. **Import/export**: hand-rolled versioned JSON envelope + zod `strictObject` rows (PayoutSchedule incl. seed-only `'none'`; datetimes are timezone-less `ISO.slice(0,19)` — plain regex, NOT `z.iso.datetime()`; post-parse referential integrity) validated fully **before** one `rw` clear+bulkAdd transaction; CSV wide snapshots with **empty cell = pending ≠ 0**; papaparse parse-only; Web Locks + BroadcastChannel for multi-tab; File System Access API = Chromium-only progressive enhancement (persistent handles live in IndexedDB `meta`, not localStorage).
8. **Serverless reminders**: no background wake exists → derive-don't-schedule: pure `computeReminders()` + in-app banners, derived ids, dismissals in settings.

## Formula reconciliation vs `WEALTH-MANAGEMENT-ARCHITECTRUE.md`

Comparison of the doc's six challenges against the app's actual derivations, numbers validated. Resolutions land in Phase 1 `feat/formula-parity`; UI exposure in Phase 2 `feat/metrics-exposure`.

| Doc challenge | App status | Resolution |
|---|---|---|
| **§1 SSOT — FreeCash derived from the ledger** | ❌ `Snapshot.cash` is stored/manual; no derivation reads cash from transactions. Missing TxTypes: `withdrawal`, `redemption`. | Add `core/derive.freeCashFromLedger(txs)` per doc §1.1 — with a nuance the doc misses: **unreinvested payouts leave the system** (real Inzhur config sends Energy dividends to the bank). Seed validates only under "payout is external unless paired with a same-date reinvest": deposits 143 176,37 − own-funded buys 143 168,62 = **7,75 ✓**; naively adding payouts (+5 040,94) − reinvests (−1 387,38) would give 3 661,31 ✗. Model: keep `Snapshot.cash` as the *observed* broker balance + a **ledger-reconciliation check** (warning when \|stored − derived\| > ε) — surfaces the doc's "leaks" without breaking D5. Add `withdrawal` + `redemption` TxTypes. |
| **§2 Capital Gain vs Total Return + Tax Illusion** | ❌ Real and live: `netResult`/`yieldSinceStart` are capital-gain-only; `tax` rows exist but **no derivation reads them**. User's real …6475: invested 4 496,40, value 4 379,52 → **−₴116,88 (−2.6 %) "loss"**, yet +355,40 coupons → total net profit **+₴238,52 (+5.3 %)**. | Implement doc §2.1 in core: `payoutsNet` (gross − taxes), `soldAmount` (sell + redemption), `capitalGain`, `totalNetProfit`, `cashYieldPct`, `capitalGainPct`, `totalReturnPct` (denominator `investedOwn`). Net-of-tax `incomeReceived` variant. Existing metrics stay (they ARE the CapitalGain family) — relabeled per design so the families are never conflated. |
| **§3 Rebalance moving-target algebra** | ✅ Resolved exactly: `topUpAmount = (target×total − value)/(1 − target)` ≡ doc §3.1; pinned test ₴11 429,49. | Doc-reference comment; keep invariant test. |
| **§4 Latest-price querying + null handling** | ✅ Resolved better than the doc: `latestQuotes` merges partial snapshots per-asset over sorted reads; **pending ≠ 0** beats the doc's "return 0" (which would corrupt `headlineTotal` — documented as an improvement). | Doc-mapping comment only. |
| **§5 Global ROI denominator corruption** | ❌ Headline "+3.08 %" divides by buys+reinvests (the corruption §5 bans) and ignores payouts. Doc-compliant on seed: NetDeposits 143 176,37; TotalCapital 149 016,36; NetFinancialResult **+5 839,99**; GlobalROI **+4.08 %**. | Conflicts with D5-pinned figures → resolve **additively**: existing KPI stays (relabeled capital-gain), new `netDeposits`/`globalRoi` in core, surfaced per P2 design brief. Demo keeps pinned figures; both families tested. |
| **§6.1 XIRR/CAGR** | ❌ Simple scaling ×365/daysHeld from PORTFOLIO_START (D5#5) — not money-weighted; annualizes <1 y. | Pure `core/xirr.ts` (Newton–Raphson + bisection fallback, no new dep; fixtures incl. convergence edges). Surfaced alongside (not replacing) the pinned simple annualized; <1 y figures get a clarity label. |
| **§6.2 Seasonality day-of-month returns** | ⚠️ P6 chart originally planned as absolute ₴ deltas; doc wants **avg % returns**. Doc's own formula ignores flow contamination (buys/reinvests inflate position-value "returns"). | P6: day-over-day **percentage** return, flow-adjusted (subtract same-day buy/reinvest before dividing; unit-price basis where units known); average per day-of-month. Improvement over doc, flagged. |

**Fintech-practice rulings (folded into the P1 audit):** JS-float money acceptable at this scale with a pinned rounding policy (round at display only, 2 dp; no accumulated rounded intermediates; integer-kopeck representation consciously rejected — revisit if multi-currency/lot-level sells arrive). Zero-denominator guards return null → "—", never Infinity/NaN. Sells use the cash-flow model (no FIFO/lot cost basis — per-asset capital-gain% is ambiguous after partial sells; total-return is the honest metric). Day-count = ACT/365, documented. App↔doc naming map pinned in core docs (`dividend_accrual`↔Dividend Payout, `interest_payout`↔Interest Payout, `reinvest`↔Reinvestment; new `withdrawal`, `redemption`).

## Draft item → phase map

| # | Draft item | Approach | Phase |
|---|-----------|----------|-------|
| 1 | Core formulas → core folder | `src/core/` pure domain layer; consolidate lib + screens/shared + inline sites; structured-returns rule | 1 |
| 2 | Settings tab | `/settings` route, 3rd nav group; sections Portfolio/Data/Automation/Appearance | 2 (shell), filled 2–5 |
| 2a | Move add-new-asset | Standalone `AssetForm` (create+edit, ALL fields incl. bond + Inzhur link + units); TransactionPanel keeps quick-create | 2 |
| 2b | Set targets | Targets editor (Σ≠100 warning, live preview) | 2 |
| 2c | Reminders | `core/reminders.ts` + banner strip + dismissals | 3 |
| 2d | DB configs | Data section: dataset switch, export/import/clear, mirror | 2+4 |
| 2e | What else customizable | usdRate editable, reminder lead days, theme/lang, motion override | 2+3+5 |
| 3 | Theme toggle | Token flip + surface/on-surface split + FOUC script + dark palette (design) | 5 |
| 4 | Language toggle | Typed dict EN+UK; tests assert keys; date-fns dep | 5 |
| 5 | Import JSON/CSV | Preview→diff→confirm; atomic replaceAll; CSV snapshots wide+long | 4 |
| 6 | Export JSON/CSV | JSON envelope (P1, safety-first) + per-table CSV (P4) | 1+4 |
| 7 | Clear | "Erase live" vs "Reset demo"; typed confirm + backup-first CTA; meta-guard kills auto-reseed | 2 |
| 8 | Spreadsheet as DB | Export (1/4) + auto-export mirror (4) per accepted verdict | 1+4 |
| 9 | Auto track fixed yield | `core/accrual.ts` suggestions + coupon confirm flow + rollNextCoupon; toggles | 3 |
| 10 | Inzhur quick read | `core/inzhur/parse` + `useInzhurAssets` + Fetch button; units model | 3 |
| 11 | DB browser edit/delete | `/data` route, 3 tabs, dialogs, impact hints | 7 |
| 12 | Date-range filter | ChartToolbar + URL params + trap fixes | 6 |
| 13 | Seasonality cap-by-day | `core/day-deltas.ts` (avg % day-over-day returns, flow-adjusted per doc §6.2) + sibling chart | 6 |
| 14 | Mock mode | Two Dexie DBs: `kubushka` (=demo, keeps seed) + `kubushka-live`; reload-on-toggle; DEMO badge | 2 |
| — | Design briefs (user note) | Template pinned P1; each phase ends by writing the next phase's brief; design session produces `design/extensions/*.dc.html`; UI tasks gated on merged reference | all |

## Governing decisions (made once — no phase reworks a predecessor)

**G1 — `src/core/` is the pure domain layer; `src/lib/` stays persistence/infra.** Core layout: `types, derive, money (format + signed helpers, one U+2212 display convention), dates (single todayIso, addMonths clamped, range helpers, Kyiv-time helper), colors (emits var() strings; owns COLOR_KEY_CYCLE), asset-builder, schemas`, later `backup/`, `inzhur/`, `xirr`, `accrual`, `reminders`, `day-deltas`. Import rules via ESLint `no-restricted-imports`: core imports only core; lib imports core; only `lib/repository.ts` imports `lib/db.ts`; `screens/<route>/<route>.ts` selectors stay per-screen and import core. `screens/shared/` dissolves into core. **Structured-returns rule** (i18n anticipation): core + per-screen pure modules return keys/tokens (`{month, year}`, `'label.topUp'`), never assembled English prose.
**G2 — Repository write surface (P1):** `addAsset`, `updateAsset(id, patch)`, `deleteAsset(id)` (cascade always, atomic: asset + its transactions + its quote keys in every snapshot), `updateTransaction`, `deleteTransaction`, `deleteSnapshot(date)`, `moveSnapshotDate(from,to)` (delete+put one tx, block collision), `exportAll()` (one r tx), `replaceAll(data)` (one rw tx: clear+bulkAdd), `clearAll({reseed})`. Dexie `version(2)` adds `meta: 'key'` (seeding flag; later mirror handle, Inzhur last-good cache). `ensureSeeded` → meta flag (upgrade fn stamps `seeded` when assets exist). Versioning policy: bump only for stores/index changes; optional object fields never bump.
**G3 — Settings store** gets persist `version: 1` + `migrate` in P1; every new persisted field enters `partialize` in the same commit. Final shape (lands per phase): `currency, usdRate, dataset: 'demo'|'live', theme, language, autoQuoteSuggest, couponSuggest, remindersEnabled, reminderLeadDays, dismissedReminders`. FOUC/head scripts read the persist JSON — `theme`/`dataset` stay top-level in `state`.
**G4 — Dataset split (mock mode)** = two Dexie DBs selected at repository init from the persisted `dataset` flag (read synchronously from localStorage), `location.reload()` on toggle. Existing `kubushka` **is** the demo DB (zero migration); `kubushka-live` starts empty; default `'demo'`. Demo mode: Inzhur fetch, mirror, erase disabled; persistent DEMO badge; seed/tests/navigation-map checkpoints permanently re-homed to demo.
**G5 — Automation is suggest-only by construction**: fetched/accrued values land only in the draft store or a prefilled form; the user's Save/Confirm is the sole write path. Coupon amounts editable in the confirm (seed precedent: paid 1 183,50 vs scheduled 1 240). No `tax` row auto-drafted (OVDP coupons PIT-exempt in UA).
**G6 — New dependencies (each = DECISIONS entry):** `fake-indexeddb` (devDep, P1, approved), `papaparse` + `@types/papaparse` (P4, parse-only), `date-fns` (P5, day-picker locale). Rejected: `dexie-export-import`, `client-zip`, i18next/lingui, SheetJS/exceljs.
**G7 — Design-brief pipeline**: the last task of phase N writes `docs/design-briefs/phase-N+1-<name>.md`; a separate Claude design session turns it into `design/extensions/<surface>.dc.html` (same inline-style `.dc.html` idiom; original handoff files stay immutable — amends design/README's "never edit" rule); a phase's UI tasks may not start before its reference is merged. Brief template (pinned in P1): purpose + parent screen + reference line refs · content inventory with exact copy (EN; +UK from P5) · full state matrix (default/hover/focus/disabled/loading/error/empty/stale/demo-disabled) · D7 motion spec (trigger→property→duration/easing→reduced-motion fallback) · token constraints (both themes from P5) · layout constraints (radius 20–24/999, 360 px, sidebar) · acceptance checklist. Phase 1 has no UI → runs in parallel with the design session producing Phase 2's reference.
**G8 — Ordering rationale:** Core+write-surface first (everything builds on it; zero design dependency). Then the real-data era (Settings + AssetForm + dataset split) — the user cannot even hold real data today. Then automation (the headline daily-ritual win; safe before full import: JSON backup exists from P1, automation never writes silently). Then portability (envelope freezes after P2/P3 asset fields; mirror reuses serializers). Then the two whole-app sweeps (theme+i18n) after all major surfaces exist but before the last ones. Charts, then DB browser last — most dangerous, least frequent, gated behind backup+import, built on the finished component set.

---

## Phase 0 — Repo hygiene — branch `chore/next-phase-prep`

**Goal:** clean baseline. v1 already closed as v1.0.0.

- [x] Commit `docs/NEXT-PHASE-DRAFT.md`, `docs/WEALTH-MANAGEMENT-ARCHITECTRUE.md`, and this plan.
- [x] Replace root `inzhur-public-assets.json` (300 KB, untracked) with the trimmed fixture (2 funds by slug + ISINs UA4000238976/UA4000236475 incl. `paymentSchedule`) at `src/core/inzhur/__fixtures__/assets-sample.json`; delete the original.
- [x] Add `.playwright-mcp/` to `.gitignore`.
- [x] Update `docs/README.md` file table + `CLAUDE.md` living-plan pointer + `navigation-map.md` note.
- [x] Gates green; squash-merge to `dev`; push.

## Phase 1 — Core consolidation & write-surface foundation (L)

**Goal:** one pure domain layer + complete repository API + safety backup + the formula audit — features, not plumbing, from here on. **Covers:** item 1 + the WEALTH-MANAGEMENT reconciliation; enablers for 5–9, 11, 14. **No new UI** except one flagged button.
**Rationale:** the ~40 scattered computation sites, the frozen-lib workaround and the read-only repository are the bottlenecks every other item hits; the structured-returns and var()-colors rules set here make P5's sweeps mechanical; pure-logic phase runs concurrently with the first design session (G7).

- [x] `refactor/core-folder` — build `src/core/` per G1; move `lib/{types,derive,format,colors,asset-builder,schemas}` + `screens/shared/*` (re-export shims during migration, deleted before merge); dedupe `todayIso` ×3; unify signed formatting on U+2212; Sidebar consumes `screens/overview` selectors; `colors.ts` emits `var(--color-*)` + `--color-chart-*` aliases in `@theme` (visual no-op); structured-returns rule; ESLint import zones. Gate: all existing tests green with only import-path/fixture edits; visual diff vs reference pixel-identical.
- [x] `feat/repo-write-surface` — Dexie `version(2)` + `meta` + upgrade fn (stamps `seeded`); full G2 API; mutation hooks (`useUpdateAsset`, `useDeleteAsset`, `useUpdateTransaction`, `useDeleteTransaction`, `useDeleteSnapshot`, `useReplaceAll`, `useClearAll`) — per-entity invalidation for row ops, invalidate-all for cascade/replace/clear; `pnpm add -D fake-indexeddb` + `src/lib/repository.test.ts` (cascade atomicity, delete-last-asset does NOT reseed, `clearAll({reseed:false})` → still empty after re-init, `replaceAll` all-or-nothing).
- [x] `chore/settings-persist-version` — G3 (version+migrate+partialize doctrine).
- [x] `feat/backup-export-json` — `core/backup/json.ts`: envelope `{format:'kubushka-backup', formatVersion:1, exportedAt, dbVersion, dataset, assets, snapshots, transactions, settings?}` + zod schema written forward-compatible (P2/P3 asset fields already `.optional()`); `repo.exportAll()`; one "Download backup" button. **Flagged pre-design exception:** durability must not wait for the Settings design; restyled/moved in P2.
- [x] `feat/formula-parity` — **phase-closing formula audit** (user requirement): implement every gap from the reconciliation table in `src/core/` — `freeCashFromLedger` (+ external-payout rule), `payoutsNet`/`totalNetProfit`/`cashYieldPct`/`totalReturnPct`, `netDeposits`/`globalRoi`, `xirr`, net-of-tax `incomeReceived`; add TxTypes `withdrawal` + `redemption` (types/schemas/derive; UI exposure in P2); doc-reference comments on the already-resolved formulas (§3, §4). Then run a **multi-lens verification workflow** (correctness / doc-parity / fintech-practice skeptics) over the complete core formula set and record outcome + every pinned resolution in `docs/FORMULA-AUDIT.md` (challenge → app formula → validation figures → verdict). No UI changes.
- [x] `docs/design-brief-phase-2` — pin the brief template (G7) + write `docs/design-briefs/phase-2-settings-real-data.md` (incl. metric-exposure surfaces: Overview KPI relabel + net/total-return placement, Yield/Portfolio added columns, cash-reconciliation warning state).

**Contracts:** G1–G3 + the §2.1/§5/§6.1 core function signatures become pinned contracts here. **DECISIONS** (numbers assigned at append time): core architecture + structured returns; Dexie meta + versioning policy; settings persist versioning; scoped D4 amendment (fake-indexeddb — approved); backup envelope v1 (dexie-export-import rejected); design-extension workflow (G7); **formula model** (dual metric families capital-gain vs total-return-net; cash = observed + ledger-reconciliation check; external-payout rule; ACT/365; float-with-display-rounding; no-lot-cost-basis).
**Verify:** 138+ existing `it` green; new: money sign convention, `addMonths` month-end clamp (2026-08-31+6m→2027-02-28), envelope round-trip on seed (4/174/18 rows — the seed has 18 transactions, browser-verified in BUILD-PLAN Task 2; "19" was a miscount), repository suite; **formula-audit fixtures**: `freeCashFromLedger(seed)=7.75`, `globalRoi(seed)=+4.08 %` (5 839,99/143 176,37), illusion-of-loss fixture (invested 4 496,40, value 4 379,52, coupons 355,40 → capitalGain −116,88 / totalNetProfit +238,52), `xirr` known-good + convergence edges, zero-denominator guards → null, payout-external rule (unpaired payout excluded; paired payout+reinvest nets to zero cash). Browser: route sweep, backup downloads + re-validates. Gates + build.
**Risks:** widest import churn of the plan (shims + mechanical commits); upgrade fn tested against a copy of the real DB; Global-ROI/total-return figures differ from D5-pinned reference **by design** — additive-metrics rule prevents any pinned figure from changing (checked in the audit).

## Phase 2 — Settings home & the real-data era (M/L) — design-gated

**Goal:** a Settings home; create/edit every Asset field, set targets, hold REAL data in a separate live dataset with safe clear/reset; surface the audited metrics. **Covers:** 2, 2a, 2b, 2d(part), 2e(part), 7, 14.
**Rationale:** the user cannot correct real maturities or run a clean portfolio today; P3 automation would otherwise operate on wrong metadata or fake data. Dataset split promoted here because it IS the real-data enabler; approved migration is zero-code (`kubushka` stays demo).

- [x] `feat/settings-shell` — `/settings` route + third sidebar group per design; flat route, stacked section cards: **Portfolio** (asset manager entry, targets), **Data** (dataset switch, backup button relocated, reset/erase), **Automation** (placeholder), **Appearance** (currency + editable `usdRate`; theme/lang placeholders). Store: `usdRate` persisted+settable.
- [x] `feat/asset-form` — standalone `AssetForm` (create+edit; own types — replaces transaction-form-welded `NewAssetFields`): all Asset fields incl. previously seed-only `maturity/couponAmount/nextCoupon/payoutSchedule('none' allowed on edit)/reinvestPolicy`; **Inzhur group:** toggle → `{kind: fund|bond, ref: slug|ISIN (manual text this phase; live picker in P3), units}` — when linked, quantity replaces value-centric fields; type extension `inzhur?: {kind, ref, units}` (optional → no Dexie bump). TransactionPanel keeps inline quick-create rendering the same AssetForm (atomic `recordTransaction(tx, newAsset)` unchanged).
- [x] `feat/targets-editor` — per-asset `targetPct` editor + live Σ indicator (warn ≠100, non-blocking) + share preview; pure helpers + tests.
- [x] `feat/dataset-split` — G4 wiring: db factory, repository binds active DB at init, toggle+reload, `kubushka-live` created empty, demo reseeds-if-empty, sidebar DEMO badge, "Reset demo data"; navigation-map doctrine: all seed-pinned checkpoints run in demo.
- [x] `feat/clear-data` — Data section: "Erase live data" (`clearAll({reseed:false})`) + "Reset demo data"; typed-name confirm dialogs with one-click "Download backup first".
- [x] `feat/metrics-exposure` — surface the P1 audit metrics per design brief: Overview KPI relabel (capital-gain family) + net/total-return + income-net-of-tax placements; Yield table gains total-return + XIRR columns (<1 y annualized clarity label); Portfolio P&L columns disambiguated; cash-reconciliation warning (stored vs ledger-derived drift); TransactionPanel exposes `withdrawal`/`redemption`. Demo keeps every D5-pinned figure (additive only — verified against navigation-map).
- [x] `docs/design-brief-phase-3` — fetch/suggestion/reminder surfaces (richest brief: button 5-state machine, auto/manual/stale chips, ghost suggested inputs, coupon confirm card, reminder strip anatomy, Automation section).

**Contracts:** `/settings` route; `Asset.inzhur`; settings `dataset`/`usdRate`. **DECISIONS:** dual-dataset (naming, default demo, demo-guards, checkpoint doctrine).
**Verify:** unit — targets Σ fixtures, patch builders, form schema (bond+Inzhur variants); repository tests extend (dataset factory). Browser — edit …8976 maturity in demo → Attributes/Overview payouts update; flip to live → empty states everywhere; flip back → seed intact; delete last live asset → NO reseed; erase → empty after reload; metrics: every D5-pinned demo figure unchanged, new total-return/XIRR figures match audit fixtures. Gates + build; tag v1.2.0 (per-phase tags hereafter; v1.1.0 was already cut at the Phase 1 close — tag = `package.json` version per docs/VERSIONING.md).
**Risks:** AssetForm scope creep (attributes only); demo-default means the user consciously flips to live (Settings copy explains); demo edits desync checkpoints (Reset demo is the escape).

## Phase 3 — Living data: Inzhur fetch, fixed-yield automation, reminders (M/L) — the headline

**Goal:** open app → reminder says what's missing → one click fills every Inzhur-linked asset → bonds pre-suggest accrued values → due coupons offer one-tap recording. **Covers:** 9, 10, 2c, 2e(part).
**Rationale:** highest user value, as early as dependencies allow (P1 `updateAsset` + P2 links/units/Settings/dataset guard; JSON backup exists; G5 makes automation write-safe — full import is not a prerequisite). Reminders ride along: two of four kinds come from the accrual module.

- [ ] `feat/inzhur-client` — `core/inzhur/parse.ts` (pure): tolerant zod pick-parse of `_api/assets` (slug/isin/prices/paymentSchedule/maturityDate; per-asset skip on mismatch), kopecks→₴ **in exactly one tested place**, `matchAssets(portfolio, feed)` by slug/ISIN, `positionValue(units, sellUAH)`; fixture tests on `assets-sample.json`. `hooks/useInzhurAssets.ts`: TanStack Query `['inzhur','assets']`, `enabled:false`, bare `fetch` GET (no headers!), `retry:1`, ~10 s abort, `staleTime` until next ~13:00 Europe/Kyiv (DST-safe via `Intl`), `gcTime:Infinity`; last-good payload + `fetchedAt` in `meta`; disabled when `dataset==='demo'`.
- [ ] `feat/fetch-quotes` — "Fetch quotes" in Daily-quotes header: fills **draft store** for linked rows (units × sellUAH); never overwrites user-typed values (inline "Use fetched?" affordance); row chips auto/manual + "fetched 13:05" microcopy; stale-cache amber when serving last-good; failure → toast + stale offer; AssetForm Inzhur ref upgrades to live picker. User still presses Save snapshot — manual authoritative.
- [ ] `feat/fixed-yield` — `core/accrual.ts` (pure): `dailyAccrual(couponAmount, schedule)` (fallback `expectedPct×invested/365`), `suggestedQuote(lastQuote, lastDate, today, couponsInGap)` carry-forward, `dueCoupons(assets, txs, today)` (no matching `interest_payout` in window), `rollNextCoupon(asset)` (clamped at maturity; at maturity → flag-only). UX: ghost "suggested" values in unquoted fixed-coupon inputs (Inzhur-linked prefer units×price; API `paymentSchedule` as the amount forecast); coupon-due card → prefilled TransactionPanel (`interest_payout` + optional paired `reinvest`, amount editable) → confirm → `recordTransaction` + `updateAsset` rolls `nextCoupon` once. Toggles `autoQuoteSuggest`, `couponSuggest` in Settings→Automation. Fix: user-created fixed_coupon assets stop being silently skipped by Overview/Seasonality projections.
- [ ] `feat/reminders` — `core/reminders.ts`: `computeReminders(assets, snapshots, transactions, today, opts)` → `quote-missing:today`, `coupon:id:date` (≤N days, default 7), `coupon-overdue:…`, `maturity:…` (≤30 d); derived ids → dismissals naturally expire; `ReminderStrip` on `/` + `/overview`, one toast on open; Settings→Automation: enable, lead days, restore dismissed.
- [ ] `docs/design-brief-phase-4` — import dialog (dropzone, row-error list, diff summary), CSV cards, mirror status card states, danger-zone final look.

**Contracts:** settings automation fields; `Reminder` type; query key; meta `inzhur:lastFetch`. **DECISIONS:** Inzhur policy (public endpoint, bare GET, non-contractual ACAO → degrade to manual; ~13:00 Kyiv refresh); suggest-don't-write doctrine (+ no auto tax row).
**Verify:** unit — fixture parse (REIT sellUAH 11.1389; 7840→₴78.40; 100000→₴1,000; maturity 2027-03-24), `positionValue(6164, 11.1389)=68 660.18`, `4×88.85=355.40`, unknown-ISIN skip; accrual gap-crossing subtracts coupon, maturity clamp; `dueCoupons` dedupe vs manual tx; reminders matrix incl. partial-snapshot day + dismissal filtering; Kyiv staleTime across DST. Browser — live fetch on real data; DevTools-offline → graceful failure; dirty field untouched; confirm-coupon writes exactly one tx + rolls date once (StrictMode check); demo → button disabled. Gates + build; tag.
**Risks:** payload shape drift (tolerant parse + fixture + last-good); duplicate coupon suggestions (window-matching test); suggestion visuals must be unmistakably distinct from saved values (design brief owns it).

## Phase 4 — Data portability: import, CSV, auto-export mirror (M)

**Goal:** complete durability: lossless restore, CSV both ways, Chromium file mirror ("spreadsheet as DB" closed). **Covers:** 5, 6(CSV half), 8, 2d(rest).
**Rationale:** envelope freezes AFTER P2/P3 asset fields exist (formatVersion stays 1, fields optional); import is the bulk path for corrections; mirror reuses serializers + repo write hook; logic-heavy/design-light — fast phase after two design-heavy ones.

- [ ] `feat/backup-import` — `core/backup/import.ts`: full zod validation + referential-integrity pass + `formatVersion` dispatch (reject newer, clear message); `diffBackup(current, incoming)` → preview (per-table added/replaced/removed, warnings); UI: Settings→Data import (`<input type=file>`), preview dialog, **auto-download safety backup before** `repo.replaceAll` (acceptance criterion); one rw transaction; `navigator.locks.request('kubushka-db')` around replace/clear/reset; `BroadcastChannel('kubushka-sync')` → other tabs invalidate. Targets the active dataset (demo import allowed). Settings block applied on opt-in checkbox.
- [ ] `feat/csv-roundtrip` — `pnpm add papaparse @types/papaparse`; `core/backup/csv.ts`: hand-rolled RFC 4180 serializer (dot-decimal, no grouping, UTF-8 BOM, CRLF; snapshots **wide** — empty cell = pending, never 0; assets/transactions long); export per table; import **snapshots only** (wide+long auto-detect) through the same validation+preview pipeline — assets/transactions restore is JSON-only (flagged scope cut); `showSaveFilePicker` enhancement on all exports (swallow `AbortError`), `<a download>` fallback.
- [ ] `feat/file-mirror` — Settings→Data "Keep a file in sync (Chromium)": `showSaveFilePicker` target, handle in `meta`, `queryPermission`/`requestPermission` re-arm UI (Chrome 122+ persistent grant), repository `afterWrite` hook → debounce ~2 s → Web Lock → build full JSON → copy current to `.bak` → truncate-write; failures = dismissible warning, never block the write; write-only; hidden on Firefox/Safari; disabled in demo. Cross-device: point at a synced folder.
- [ ] `docs/design-brief-phase-5` — dark palette sheet (every token incl. 4 asset hues ≥4.5:1, shadows, chart grid/tooltip, sidebar-vs-page, focus/selection), theme+language segmented controls, UK reference copy (~20–30 % longer).

**Contracts:** `replaceAll` semantics; envelope + CSV column orders; meta `mirrorHandle`. **DECISIONS:** papaparse + CSV dialect + import-replaces-not-merges + CSV-import scope; mirror policy (Chromium-only, `.bak` rotation, never authoritative).
**Verify:** unit — round-trip export→import deep-equal on seed; rejections (unknown assetId, dup snapshot date, `Z`-suffixed datetime, unknown key, formatVersion 2); CSV edges (comma/quote/newline/BOM; pending↔empty; long→wide merge); diff counts; replaceAll atomicity. Browser — export/clear/import restores all screens to checkpoints; malformed file → row errors + untouched DB; two-tab invalidation; mirror link/save/update + permission-revoke re-arm. Gates + build; tag.
**Risks:** "Replaces everything in <dataset>" copy unmissable; Excel locale (comma+dot machine CSV pinned, said in UI); mirror is best-effort — show last-synced, never promise more.

## Phase 5 — Appearance & language: dark theme + Ukrainian (M/L)

**Goal:** `light|dark|system` + EN/UK, swept once across the finished major surface set. **Covers:** 3, 4, 2e(rest).
**Rationale:** after P2–P4 all heavy surfaces exist → one sweep; before P6/P7 so chart toolbar + DB browser are born themed+localized. P1's var()-colors + structured-returns make both sweeps mechanical.

- [ ] `feat/dark-theme` — split double-duty tokens into surface/on-surface pairs (`ink`, `sidebar-text`); purge literal `bg-white`/`text-white` (TransactionPanel, AssetForm, Select, Sidebar, KpiCard, DatePicker, button-variants) + rgba shadows (Card, KpiCard, Select, DatePicker) into tokens; `[data-theme=dark]` block for all tokens incl. `--color-chart-*` (values from P4 brief); theme recharts Tooltip/cursor; FOUC-free `index.html` head script + `<meta name="color-scheme">`; store `theme` + `matchMedia` for `system`; chart `key`s stable across flips; toggle in Settings→Appearance.
- [ ] `feat/i18n-uk` — `src/i18n/messages.ts` (`en` canonical, `Dict` from it, `uk satisfies Dict`), `useT()` on `settings.language`; sweep ~200 strings/~26 files; label maps → key-returning, tests re-assert keys (one mechanical commit per screen); `pnpm add date-fns` → DayPicker `locale={uk}` + `weekStartsOn`; `document.documentElement.lang`; MONTH_SHORT/ordinals into i18n; runtime key-parity test; **pinned: `fmtTable`/`fmtProse`/`fmtDate` identical in both languages**.
- [ ] `docs/design-brief-phase-6` — ChartToolbar (preset pills, custom-range popover, asset picker), cap-by-day chart form (recommendation: per-asset small multiples), sparse/empty range states, derived-subtitle copy — both themes.

**Contracts:** settings `theme`/`language`; final token vocabulary; i18n namespace `screen.section.item`. **DECISIONS:** theme architecture (token redefinition, FOUC contract, persist-key pinned); i18n architecture (typed dict, keys-in-tests, formats-never-localize, date-fns dep).
**Verify:** unit — key parity (compile-time + runtime), formatter invariance under `uk`. Browser — every route in dark + system + reduced-motion; hard-reload dark, no white flash; UK: calendar localized, `<html lang>`, numbers/dates unchanged, 360 px overflow sweep; contrast spot-checks. Gates + build; tag.
**Risks:** dark asset-tint contrast may need design iteration; i18n churn wide but mechanical — freeze other branches during the sweep.

## Phase 6 — Chart analytics: date ranges + cap-by-day-by-asset (M)

**Goal:** every time-series chart filterable (week/month/year/all/custom); new buy-timing chart. **Covers:** 12, 13.
**Rationale:** analytics value compounds with real history accumulating since P2; depends on core dates (P1), themed chart tokens (P5); windowing traps fixed as part of the feature.

- [ ] `feat/chart-toolbar` — `components/charts/ChartCard.tsx` + `ChartToolbar` (rolling presets 7d/1m/1y/all + custom via DatePicker `mode="range"`; first asset-picker); `hooks/useDateRange.ts` on `useSearchParams` (`?range=…&from&to`); pure `core/dates.filterRange` (inclusive bounds).
- [ ] `feat/chart-range-wiring` — all 5 chart screens; trap fixes pinned by tests: Balances YAxis domain derived from filtered data; **annualized keeps PORTFOLIO_START daysHeld basis regardless of window**; Payouts month labels year-qualified across years; hardcoded "Feb — Jul 2026" subtitles derive from actual range; sparse-window (<2 snapshots) empty state per design.
- [ ] `feat/seasonality-cap` — `core/day-deltas.ts` per doc §6.2 refined: per-asset day-over-day **percentage** return, flow-adjusted (subtract same-day buy/reinvest before dividing by prior value; seed reinvests 687,02/484,36/216 = regression fixtures); unit-price basis where units known; skip pairs missing a quote; average per day-of-month normalized by occurrence count; sibling chart on `/seasonality` with asset picker + range toolbar; insight line.
- [ ] `docs/design-brief-phase-7` — DB-browser tables, edit dialogs, cascade-confirm with impact hints, tab bar.

**Contracts:** URL param schema; `DayDelta` type; ChartCard/Toolbar props. **DECISIONS:** range semantics (URL state not settings; rolling presets; annualized-basis invariant).
**Verify:** unit — boundary inclusivity; annualized invariance (filtered ⇒ identical +10.9 % …6475); label disambiguation (`Feb '26`); day-deltas subtract 687,02 exactly; occurrence-count normalization. Browser — every chart × preset × theme × 360 px; URL round-trip; partial 27.07 snapshot produces no fake delta. Gates + build; tag.
**Risks:** recharts animation jank at 174 pts (measure; else crossfade); custom-range popover at 360 px.

## Phase 7 — Full control: DB browser (M)

**Goal:** simplified full-DB view (assets/snapshots/transactions) with edit/delete. **Covers:** 11.
**Rationale:** deliberately last — most dangerous, least frequent; gated behind backup (P1) + import (P4), born themed+localized (P5), reusing P1 repo methods + P2 AssetForm + P4 confirm patterns wholesale.

- [ ] `feat/db-browser` — `/data` route (linked from Settings→Data; own route — flagged deviation from the draft's literal "in settings tab"): three tabs; transactions edit via dialog (all fields), snapshots as editable quote grid (empty = pending) + `moveSnapshotDate` on date change, assets reuse AssetForm; every delete = typed confirm + **impact hint** from core derivations ("removes 14 transactions, quotes on 174 days; Income received −₴472,13"); pagination via generalized `paginateSnapshots`; demo edits allowed with Reset advertised in-context.
- [ ] Closeout — full navigation-map regression pass (demo mode) + groom leftovers into a fresh NEXT-PHASE-DRAFT (known seeds: NBU auto-rate for usdRate, richer demo dataset, favicon 404, Inzhur XLS transaction-import).

**Verify:** unit — impact-hint calculators on seed (delete 472,13 dividend → income 4 568,81; delete partial 27.07 → REIT headline falls back to 68 629,36); collision-blocked date move. Browser — edit tx amount → Overview KPIs re-tween; delete today's snapshot → progress pill resets; cascade counts match. Gates + final build; tag.

---

## Cross-phase rules

- **Git/gates:** per-task branches as named; plain conventional commits; squash-merge to `dev`; `pnpm lint && pnpm typecheck && pnpm test` per merge, `pnpm build` + version tag (v1.1.0…) per phase close; identity/D3/D6 conventions; no AI attribution.
- **Docs upkeep per phase:** this file's checkboxes + Status table; DECISIONS entries as listed per phase (numbering assigned sequentially at append time); navigation-map route rows + checkpoints (in demo mode from P2 on); folder READMEs (`src/core/`, `src/i18n/`, `docs/design-briefs/`, `design/extensions/`).
- **Standing integrity invariants (review checklist):** validate-fully-then-one-rw-transaction for multi-row writes; no silent writes (fetch/accrual → draft/prefill only); empty cell ≠ 0; no orphan rows persisted; destructive confirms always offer one-click backup; IndexedDB is the only system of record; every new persisted settings field enters `partialize` same commit; D7 motion + reduced-motion on every new control.
- **Design pipeline (G7):** brief → design session → `design/extensions/*.dc.html` merged → UI implementation. Pure-logic tasks are never design-blocked.

## Final acceptance (after P7)

Fresh profile → demo boots to reference checkpoints; flip live → enter real portfolio via AssetForm (+units) → fetch fills values → save → export → erase → import restores; dark+UK sweep across all routes; reduced-motion honored; 360 px no horizontal scroll.

## Flagged deviations from the draft

1. Asset CRUD + DB browser live on `/data` (Settings links to it) rather than literally inside the Settings tab — preferences vs entity-management lifecycles.
2. CSV **import** covers snapshots only; assets/transactions restore via JSON (lossless path).
3. Automation (P3) ships before full import (P4): JSON backup exists from P1 and automation is suggest-only.
4. Coupon suggestions never draft a `tax` row (OVDP coupons PIT-exempt; the type stays available manually).
