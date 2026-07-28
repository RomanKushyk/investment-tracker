# Decisions

Decision log for Kubushka. Add new entries at the bottom; never rewrite history — supersede instead.

## D1 — Tech stack: use `package.json` as-is (2026-07-27)

React 19 + Vite 7 + TypeScript 5 + Tailwind 4 (`@tailwindcss/vite`), react-router 7, TanStack Query 5, zustand 5, react-hook-form 7 + zod 4, recharts 3, Radix (`radix-ui` umbrella package), CVA + tailwind-merge, sonner, react-day-picker 9, lucide-react, React Compiler babel plugin. Fonts via `@fontsource/space-grotesk` + `@fontsource/spline-sans-mono`.

The stack was fixed by the handoff `package.json`; no substitutions. Note: README §3 mentions `socket.io-client` being in deps — it is **not** actually present in `package.json`, so there is nothing to omit.

## D2 — Persistence: Dexie.js on IndexedDB (2026-07-27)

**Chosen by the user** over (a) localStorage JSON and (b) a hand-rolled IndexedDB wrapper.

- Dependency added: `dexie@^4.4.4` (the one deliberate deviation from "package.json as-is").
- Database name `kubushka`, one table per entity (`assets`, `snapshots`, `transactions`), schema pinned in `docs/BUILD-PLAN.md` Task 2.
- All access goes through `src/lib/repository.ts`; components never import `db` directly. UI consumes the repository via TanStack Query hooks.
- Settings (currency preference) and draft quote entry are **not** in Dexie — they live in persisted zustand stores (localStorage), per README §3.

## D3 — Personal pet project: no Jira (2026-07-27)

This is the user's personal pet project. **Never ask for a Jira key.** Git conventions:

- Base branch: `dev` (the initial commit lives there; feature branches start from and merge back to it).
- Branches: `<type>/<short-kebab-title>`, e.g. `feat/daily-quotes` — no ticket keys.
- Commits: plain conventional commits `<type>: <summary>` — no ticket keys, no AI-attribution trailers/footers.

## D4 — Testing: vitest for pure logic only (2026-07-27)

Add `vitest` as a devDependency in Task 2 (first task that produces pure logic). Unit-test the derivation/formatting layer (`src/lib/derive.ts`, `src/lib/format.ts`) against the known seed figures from README §7 — these are real portfolio numbers with published expected outputs (+4.41%, +₴4,452.61, $3,324.03 …), which make exact-value fixtures. UI is verified in the browser against the design reference plus the README §9 behavior checklist; no component/E2E test harness unless a future need appears.

## D5 — Reference-data reconciliation (2026-07-27)

An adversarial review (3 agents cross-checking README, the design HTML and the plan) proved the reference's mock data is **internally inconsistent**. These resolutions are pinned; do not "fix" the resulting mismatches back:

1. **Headline figures use latest-quote-per-asset, not the latest complete snapshot.** The 27.07 snapshot is PARTIAL (only REIT 68 702,10; others "pending"). Sidebar/Overview/donut/Portfolio show ₴149,016.36 = REIT's 27.07 quote + the other three from 25.07 + cash — README §7's "latest complete snapshot" wording (→ ₴148,943.62) contradicts the reference's own numbers and is superseded by `latestQuotes`/`headlineTotal`. Net result +₴4,452.61 excludes cash.
2. **Snapshot seed = exactly 174:** daily 03.02→25.07 complete (173, **no 26.07** — the reference table jumps 25.07→27.07) + the partial 27.07 row.
3. **Income: README §7 aggregates win** (div 3 641,44 + coupons 1 399,50 = 5 040,94; reinvested 1 387,38 = REIT 1 171,38 + …6475 216,00, "27.5% of income"). The design's payout log sums ₴176,00 higher (div 3 817,44) and its reinvest destinations sum 1 583,57 — both irreconcilable with the KPI cards. Seed adjustment: the 648,13 dividend dated 12.05 becomes **472,13 dated 10.05**; reinvest txs are **687,02 + 484,36 (REIT), 216,00 (…6475)**. Accepted visible deviations from the reference: one log row, the May bar label, Seasonality day-10 label ₴3,641 (reference ₴3,817), and two destination cells that gain derived amounts — "reinvested (₴484,36)" and "reinvested (₴216,00)" — where the reference prints plain "reinvested".
4. **Rebalance uses two formulas:** trim = (share−target)%×total (matches reference −₴9,095); top-up = (target%×total − value)/(1 − target%) ≈ ₴11,429 (reference prints ₴11,413 — mock rounding; we display the derived value).
5. **Annualized daysHeld basis is the global portfolio start 03.02.2026 for every asset** (design footnote; per-asset firstPurchase would give …6475 +34.5% instead of the reference's +10.9%).
6. **Deposited KPI (₴143,176)** is derived from seeded `deposit` transactions totaling 143 176,37 (= own-funded buys 143 168,62 + cash 7,75).
7. **Expected/upcoming payouts:** bonds from `couponAmount` + `nextCoupon`/`maturity` attributes; dividend assets estimated as their latest dividend with a "~" prefix (reference's "~₴715" vs derived ~₴700 — accepted mock imprecision).

## D6 — Personal git identity + GitHub remote (2026-07-27)

Commits in this repo are authored as **`RomanKushyk <romankushyk0@gmail.com>`** (personal account, set via repo-local `git config` — never the work identity). Remote: `origin` → `git@github-personal:RomanKushyk/investment-tracker.git` (SSH host alias for the personal account); `dev` tracks `origin/dev` and is the default branch. History up to `46a8a7d` was rewritten once (filter-branch) to fix authorship and force-pushed — do not rewrite published history again.

## D7 — Fluid, soft motion on every interaction (2026-07-27)

**User requirement:** each UX/UI move/interaction must contain fluid animation — the app should feel lively, tactile, and "soft". The static design reference specifies no motion, so the motion system is ours: standards are pinned in the "Motion & interaction standards" section of `docs/BUILD-PLAN.md` and every UI task must satisfy them.

Tooling decision: **no new dependencies** — CSS transitions with soft-eased Tailwind defaults (`--default-transition-*` theme tokens), `tw-animate-css` (already in deps) for enter/exit reveals and route transitions, recharts' built-in chart animation, sonner's built-in toast motion. Global `prefers-reduced-motion: reduce` kill-switch in `src/index.css` is mandatory a11y behavior.

## D8 — `src/core/` pure domain layer, structured returns, one sign convention (2026-07-28)

Phase 1 `refactor/core-folder` implements decision G1 of `docs/NEXT-PHASE-PLAN.md`:

- **`src/core/` is the pure domain layer; `src/lib/` keeps persistence/infra only** (`db.ts`, `repository.ts`, `seed.ts`). v1's `lib/{types,derive,format,colors,asset-builder,schemas}` moved into `core/`: `format.ts` merged with `screens/shared/format.ts` into `core/money.ts`; `screens/shared/dates.ts` became `core/dates.ts` and absorbed the previously triplicated `todayIso()`; `screens/shared/` dissolved. The v1 pinned contracts (`docs/BUILD-PLAN.md`) keep their exact shapes — only module paths changed. The sidebar consumes `core/derive.headlineKpis` instead of re-deriving Overview's KPI math.
- **Import zones are machine-enforced** via ESLint `no-restricted-imports` (`eslint.config.js`): core imports only core (no react/react-dom/dexie/zustand, no `lib/`, no UI layers); `lib/db.ts` is imported only by `lib/repository.ts` (D2, now enforced, verified to fire).
- **Structured-returns rule** (i18n anticipation): pure modules under `core/` and `screens/<route>/` return keys/tokens, never assembled English prose. Converted: `screens/payouts/payouts.ts` (destination string → `{kind:'account'} | {kind:'reinvested', amount}`), `screens/overview/overview.ts` (`PayoutRow` label/amount/date strings → `{kind, assetRef, amount, approx, date}` tokens), `screens/attributes/attributes.ts` (schedule/coupon label assembly → `{schedule, day}` fact). English assembly now lives in the component layer: `components/ui/date-labels.ts` (`MONTH_SHORT`, `fmtPayoutDate`, `ordinal`) and `components/ui/schedule-labels.ts` (`SCHEDULE_LABEL`, `COUPON_FREQUENCY`). Clean numeric returns were not redesigned.
- **One sign convention: U+2212.** Every signed display string routes through `core/money.signed()`, which pins the U+2212 minus glyph. Nuance: the design reference's mock copy prints ASCII hyphens, but v1 shipped `signedPp` on U+2212 and typography agrees (proper minus, matches the mono tabular figures) — D5-style pragmatics pin U+2212 app-wide. The old `fmtPct` ASCII-hyphen fixtures were updated to U+2212 (the one sanctioned fixture edit of the task).
- **Chart colors are theme vars:** `core/colors.ts` emits `var(--color-chart-*)` strings for every SVG paint used by the 5 chart components; the aliases resolve to the existing palette tokens in `src/index.css` `@theme` — a visual no-op in light mode, and the seam Phase 5's dark theme redefines. No chart computes with a color value in JS, so no hex constants remain in `colors.ts`; `asset-builder.ts` imports `COLOR_KEYS` from `core/colors` (its private cycle copy removed).

## D9 — Dexie `meta` table + versioning policy (2026-07-28)

Phase 1 `feat/repo-write-surface` implements decision G2 of `docs/NEXT-PHASE-PLAN.md`:

- **Dexie `version(2)` adds a `meta` key-value table** (`meta: 'key'`; row shape `{ key: string; value: unknown }`). First occupant: the `seeded` flag; later occupants per the plan: the mirror file handle (P4), the Inzhur last-good cache (P3).
- **`ensureSeeded()` seeds only when the `assets` table is empty AND `meta 'seeded'` is absent**, and stamps the flag after seeding — so deliberate emptiness (delete-last-asset, `clearAll({reseed:false})`, an imported empty dataset) survives reloads. v1's `count()===0` heuristic would have resurrected the seed. The v2 `upgrade` fn stamps `seeded` on existing DBs that already hold assets (they were seeded under the v1 heuristic). `replaceAll` and `clearAll` also stamp the flag.
- **Versioning policy (pinned):** bump the Dexie version ONLY for stores/index changes (new table, new/changed index, changed primary key). New *optional* object fields never bump — IndexedDB stores whole objects, so optional fields need no schema change (e.g. P2's `Asset.inzhur` will not bump).

## D10 — Scoped D4 amendment: `fake-indexeddb` for repository tests (2026-07-28)

**Approved by the user 2026-07-28** (recorded in `docs/NEXT-PHASE-PLAN.md` header + G6). D4 ("vitest for pure logic only") is amended in one scoped way: the G2 write surface (cascade atomicity, meta-guarded seeding, all-or-nothing `replaceAll`) is untestable without IndexedDB, so `fake-indexeddb` joins devDependencies for `src/lib/repository.test.ts` **only**.

- `import 'fake-indexeddb/auto'` sits at the top of that one file; `vitest.config` and all other tests are untouched — everything else stays pure-logic (D4 intact).
- Isolation: `db.delete()` + `db.open()` in `beforeEach` gives every test a fresh database.
- The ESLint D2 zone (`lib/db.ts` imported only by `lib/repository.ts`) gains exactly one more exempt file — `src/lib/repository.test.ts`, which needs the `db` instance for isolation and count assertions. App code remains locked out.
- Seed row counts pinned by the suite: **4 assets / 174 snapshots / 18 transactions** (the plan's "4/174/19" was a miscount — 3 deposits + 4 buys + 6 dividends + 2 coupons + 3 reinvests = 18, matching the browser-verified counts in `docs/BUILD-PLAN.md` Task 2).

## D11 — Settings persist versioning (2026-07-28)

Phase 1 `chore/settings-persist-version` implements decision G3 of `docs/NEXT-PHASE-PLAN.md` for `src/state/settings.ts` (persist key `kubushka-settings`):

- **`version: 1` + additive-safe `migrate`.** The exported pure `migrateSettings(persisted)` picks only the known persisted fields from whatever shape is on disk (v0 payloads, hand-edited JSON, future rollbacks): unknown fields are dropped, missing/invalid ones fall back to defaults, then zustand's merge fills the rest of the store. Unit-tested against a v0 payload fixture.
- **Partialize doctrine (pinned in a comment block at the store):** every new persisted field enters `partialize` — and `PersistedSettings`/`PERSISTED_DEFAULTS`/`migrateSettings` — **in the same commit** that introduces it; a field missing from `partialize` silently resets on reload.
- **`theme` and `dataset` stay top-level under `state`** in the persisted JSON: the future `index.html` head scripts (P5 FOUC-free theme flip, P2 dataset-at-boot DB selection) read `JSON.parse(localStorage['kubushka-settings']).state.theme/.state.dataset` before React boots.
- **Version-bump policy:** bump only for an incompatible reshape of the persisted payload; additive fields never bump (migrate + merge cover them).

## D12 — Backup envelope v1: hand-rolled JSON + zod; `dexie-export-import` rejected (2026-07-28)

Phase 1 `feat/backup-export-json` implements the safety-backup half of draft item 6 (`docs/NEXT-PHASE-PLAN.md` P1):

- **Envelope (formatVersion 1, pinned):** `{ format: 'kubushka-backup', formatVersion: 1, exportedAt, dbVersion, dataset: 'demo'|'live', assets, snapshots, transactions, settings? }`, built by pure `core/backup/json.buildBackup(assets, snapshots, transactions, settings, dataset, exportedAt, dbVersion)`. `exportedAt` and `dbVersion` come from the CALLER (`new Date().toISOString().slice(0,19)` / `repository.dbVersion` = Dexie `verno`, the one new repository export) so the core module stays deterministic and pure (G1). Data source: `repo.exportAll()` (one `r` transaction).
- **Forward-compatible schema:** `backupEnvelopeSchema` validates rows with `z.strictObject` (unknown keys rejected) but already accepts the P2 asset extension `inzhur?: {kind:'fund'|'bond', ref, units}` and the seed-only `'none'` payout schedule, so formatVersion stays 1 when those land. The tx-type enum mirrors `TxType` and is NOT pre-widened: P1 `feat/formula-parity` adds `'withdrawal'`/`'redemption'` here in the same commit it extends `TxType` (a wider enum alone would break `parseBackup`'s `Transaction[]` typing).
- **Datetimes are timezone-less by plain regex** — `yyyy-MM-ddTHH:mm:ss`, dates `yyyy-MM-dd`, deliberately NOT `z.iso.datetime()`: a `'Z'`-suffixed or offset datetime is rejected. `buildBackup` normalizes `createdAt`/`savedAt` with `.slice(0,19)` because v1's `buildNewAsset` stamps a full `toISOString()` (with `Z` + millis) — without this, a backup holding any user-created asset would fail the backup's own schema.
- **`parseBackup(text)` → `{ok:true,data} | {ok:false,issues[]}`** with post-parse referential integrity: `tx.assetId ∈ asset ids ∪ {''}`, snapshot quote keys ⊆ asset ids, snapshot dates unique; a non-1 `formatVersion` is rejected before the row schemas with one clear message (the P4 import dispatch point).
- **`dexie-export-import` rejected (G6):** its file format is Dexie-internal rather than an app-owned stable contract; it performs no domain-level validation while the import doctrine is validate-fully-then-one-rw-transaction; it adds a dependency for what ~100 lines of zod does; and the backup should stay human-readable/diff-friendly per the "spreadsheet as DB" intent.
- **UI (the flagged pre-design exception):** one visually quiet "Backup" outline pill in the sidebar footer under the Total capital card — downloads `kubushka-backup-<todayIso>.json` via Blob + `URL.createObjectURL`; D7 motion rides on the Button base (`transition active:scale-[.97]`, soft hover fill). Restyled/relocated into Settings→Data in P2. Two enablers, both token-safe: `buttonVariants` gains a real `size` variant (`md` default = the exact former classes, new `sm`) per the same no-fighting-utilities rationale as its `weight` variant; the outline variant's two paint tokens are remapped for the dark sidebar at the element level (`--color-ink` → `sidebar-nav`, `--color-sidebar-text` → `sidebar-hover`) — token-to-token, no ad-hoc hex.
