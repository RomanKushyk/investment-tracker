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

## D13 — Formula model: dual metric families + ledger-reconciled cash (2026-07-29)

Phase 1 `feat/formula-parity` reconciles the app against `docs/WEALTH-MANAGEMENT-ARCHITECTRUE.md`; the full challenge-by-challenge record with validation figures is `docs/FORMULA-AUDIT.md`. Pinned model:

- **Dual metric families, both permanent.** The v1 D5-pinned metrics (`netResult`, `yieldSinceStart`, `annualizedPct`, `investedByAsset` = buys+reinvests) ARE the doc's CapitalGain family and keep every pinned figure. The doc §2.1/§5 total-return family lands additively in `core/derive.ts`: `investedOwnByAsset` (buys only), `payoutsGross/taxesPaid/payoutsNet` (per asset + total), `soldAmount` (sell + redemption), `capitalGain(Pct)`, `totalNetProfit`, `totalReturnPct` (denominator `investedOwn` — external capital only), `cashYieldPct`, `netDeposits`, `globalRoi`, `incomeReceivedNet`, plus `core/xirr.ts` (Newton-Raphson + bisection, no deps). P2 `feat/metrics-exposure` surfaces and labels them; the families are never conflated.
- **Cash = observed + ledger-reconciliation check.** `Snapshot.cash` stays the user-observed broker balance (system of record); `freeCashFromLedger(txs)` = deposits − withdrawals − buys + sells + redemptions derives the ledger view, `ledgerCashDrift` = stored − derived feeds the P2 drift warning. Deliberate deviation from doc §1.1, validated on the seed (7,75 ✓ vs doc-verbatim 3 661,31 ✗).
- **External-payout rule.** Payout/reinvest/tax rows never touch broker cash: payouts are external unless reinvested (real Inzhur config pays to bank), and a reinvest is funded by its paired same-date payout (net zero). Revisit triggers: a payout `destination` field (P-future) brings broker-credited payouts into the sum; an accrual-funded buy adds a source filter to the buy term.
- **TxTypes `withdrawal` + `redemption` added** across `core/types.ts`, `core/schemas.ts` (form schema) and `core/backup/json.ts` (same-commit widening per D12). Domain-only until P2: the TransactionPanel select's option list is unchanged; only its `Record<TxType, string>` recent-row label map gained the two entries (type totality).
- **Fintech rulings (pinned, details in FORMULA-AUDIT):** float money with display-only 2 dp rounding (integer kopecks rejected; revisit on multi-currency/lot-level sells); zero-denominator guards return `null` → "—", never NaN/Infinity (`globalRoi` also null for netDeposits ≤ 0); no FIFO/lot cost basis (cash-flow model; total-return is the honest post-partial-sell metric); day count ACT/365 everywhere (matches Excel XIRR); core percentages are fractions (`sharePct` stays the pinned v1 0–100 exception); tax rows net per-asset and in `incomeReceivedNet.total` but are never guessed into dividend/coupon categories.

## D14 — Design-extension workflow: immutable originals + design/extensions/ (2026-07-29)

Phase 1 `docs/design-brief-phase-2` implements decision G7 of `docs/NEXT-PHASE-PLAN.md` and **amends the `design/README.md` "never edit" rule**:

- **Original handoff files stay immutable** (`Investment Tracker.dc.html`, `Tracker Options.dc.html`, `support.js`) — never edited, exactly as before.
- **New surfaces get design references in `design/extensions/<surface>.dc.html`** — the only files ever added under `design/`. They use the master reference's idiom: inline styles, exact colors/sizes/spacing literal in the markup, same `.dc.html` format.
- **Pipeline (G7):** the last task of phase N writes `docs/design-briefs/phase-N+1-<name>.md` per the template pinned in `docs/design-briefs/README.md` (purpose + parent screen + reference line refs · exact-EN-copy content inventory · full state matrix default/hover/focus/disabled/loading/error/empty/stale/demo-disabled · D7 motion spec trigger→property→duration/easing→reduced-motion fallback · token constraints · layout constraints radius 20–24/999, 360 px, sidebar · acceptance checklist). A **separate Claude design session** turns the brief into the extension file(s); a phase's UI tasks may not start before its extension reference is merged. Pure-logic tasks are never design-blocked.
- **Precedence:** once an extension is merged, the reference wins visual disputes; the brief wins copy and behavior disputes. Briefs never amend after their extension merged — supersede with a new section.
- First instance: `docs/design-briefs/phase-2-settings-real-data.md`, which also mints the phase's one new token family `--color-warn/-tint/-tint-text` (values chosen by the design session; no ad-hoc hex).

## D15 — Deploy: Amplify Hosting manual-deploy app driven by GitHub Actions (2026-07-29)

`infra/amplify-hybrid-deploy` puts the app online. Runbook: `docs/DEPLOYMENT.md`; design
spec: `docs/superpowers/specs/2026-07-29-amplify-hybrid-deploy-design.md`.

- **Amplify Hosting only, no Amplify backend.** The app is a pure client-side SPA over
  Dexie/IndexedDB (D2) with no server, so hosting is the whole deployment surface.
- **Hybrid chosen over git-connected Amplify:** Amplify Hosting has **no build-status
  badge** (that is a CodeBuild feature), so a git-connected app cannot show deployment
  status in the README. A GitHub Actions workflow badge *is* real deployment status when the
  workflow performs the deploy and polls `GetJob` until `SUCCEED`. Console drag-and-drop was
  rejected as unautomatable for an actively developed project.
- **One-way door, accepted.** `CreateDeployment`/`StartDeployment` apply only to apps *not*
  connected to a Git repository, and there is no supported conversion between the two
  models — switching later means a new `appId` and a new URL.
- **Cost was not the deciding factor.** Amplify's free tier is 12-month-only; building in
  Actions (unlimited-free on public repos) removes the only non-trivial post-free-tier line
  item, but the delta is under $1/mo. The badge decided it.
- **Secondary benefit:** pnpm is absent from the Amplify build container, so a git-connected
  build would need its own install step. Building in Actions reuses the exact local
  toolchain (Node 26 + pnpm 11.10.0 via `corepack`).
- **Security posture:** GitHub OIDC, no long-lived AWS keys. The deploy job declares
  `environment: dev` (the app id, region and role ARN are scoped to that GitHub
  environment), which makes the OIDC `sub` claim `repo:…:environment:dev` **instead of**
  `ref:refs/heads/dev` — the two are mutually exclusive, so the IAM trust policy keys on the
  environment and branch pinning lives in the environment's deployment branch policy
  instead. The trust `sub` is
  `StringLike repo:RomanKushyk@97728952/investment-tracker@1313804031:environment:*` — repos
  created after 2026-07-15 carry immutable owner/repo IDs in the claim and cannot omit them —
  so a new environment needs no AWS change; the boundaries that hold are the repo (trust) and
  the single app branch `apps/d17m4jf400my6/branches/dev` (permissions), and each new
  environment must get its own deployment branch policy at creation. The role deliberately
  lacks `amplify:UpdateApp`, so the SPA 200 rewrite and cache headers stay console-managed
  and CI cannot change hosting configuration.
- **Public URL is not a data exposure:** every figure is derived in-browser from IndexedDB
  and nothing is transmitted (there is no backend to transmit to). A visitor gets the demo
  seed; the P2 `kubushka-live` dataset never leaves the owner's browser.

## D16 — Dual datasets: two Dexie DBs, boot-time binding, demo-first doctrine (2026-08-02)

Phase 2 `feat/dataset-split` implements decision G4 of `docs/NEXT-PHASE-PLAN.md`:

- **Naming (user-approved migration):** the pre-split `kubushka` database IS the demo
  dataset — zero data migration; live is a second, initially empty Dexie DB
  **`kubushka-live`**. `lib/db.ts` became a factory (`makeDb(name)`); the active instance
  binds ONCE at module init by reading `localStorage['kubushka-settings']` →
  `state.dataset` synchronously (the dataset-at-boot half of the D11 head-script
  contract). Anything but the exact `'live'` literal — including absent or malformed
  storage — means demo; `migrateSettings` applies the same rule so store and DB always
  agree. D2 stands: only `lib/repository.ts` imports `lib/db.ts`.
- **Default demo; reload-on-toggle.** First run and every legacy payload boots demo; the
  user consciously flips in Settings → Data (S5 segmented control, confirm-free but with
  explanatory copy + a brief pre-reload lockout). `setDataset` persists the flag and
  `location.reload()`s — no live cache migration, no runtime rebinding, and a same-value
  call is a guarded no-op so stray calls can never reload the app.
- **Guards:** `ensureSeeded()` seeds ONLY the demo DB — live never auto-seeds (the P1
  meta-flag logic still guards demo emptiness). The demo-mode guard contract for later
  phases is **`useDataset()`** (`src/state/settings.ts`): P3 Inzhur fetch, P4 file mirror
  and the live-only "Erase live data" flow disable themselves when it returns `'demo'`.
  Backups now stamp the ACTIVE dataset into the envelope's `dataset` field.
- **DEMO badge + reset:** persistent sidebar `DEMO` badge (warn-tint family, logo block;
  at the 136px rail it replaces the "Invest tracker" microline slot) whenever
  `dataset === 'demo'`; Settings→Data gains **"Reset demo data…"**
  (`clearAll({reseed:true})`, demo mode only) behind a simple backup-offering confirm —
  the S6 typed-name arming and the live "Erase" variant land with `feat/clear-data`.
- **Checkpoint doctrine:** every seed-pinned checkpoint in `navigation-map.md` runs
  against the DEMO dataset from now on; the reset recipe is per-DB (`kubushka` = demo,
  `kubushka-live` = live; the in-app "Reset demo data" is the demo shortcut).

## D17 — Destructive clears: typed-name AlertDialog idiom + erase scope (2026-08-02)

Phase 2 `feat/clear-data` implements the S6 dialogs (draft item 7, standing invariant
"destructive confirms always offer one-click backup"):

- **Radix `AlertDialog` (umbrella package) is the destructive-confirm primitive** —
  exported from `components/ui/Dialog.tsx` beside `Dialog`, sharing its exact visual
  shell (ink/40 overlay, radius-24 card, fade/zoom-in-95 300ms enter) but with alert
  semantics: outside click never dismisses, Esc cancels, focus trapped;
  `AlertDialogDescription` carries the body copy (Radix wires `aria-describedby`);
  initial focus is steered onto the confirm input via `onOpenAutoFocus`.
- **Typed-name arming:** the destructive button stays disabled until the input equals
  the dataset name (`'live'`/`'demo'`), case-insensitive and trimmed. The in-dialog
  "Download backup first" CTA reuses `useBackupDownload` (D12 envelope of the ACTIVE
  dataset) and never closes the dialog; on success it flips to an inert muted
  "Backup downloaded ✓" (`outlineMuted` button variant — a whole-variant swap per the
  D12 no-fighting-utilities rationale). Clear failure keeps the dialog open
  ("Could not complete — nothing was deleted." — `clearAll` is one rw transaction).
- **Erase scope (pinned):** "Erase live data" = `clearAll({reseed:false})` on the live
  DB **plus resetting the `kubushka-draft` quote draft** (it references erased asset
  ids; the store is one localStorage key across datasets); `kubushka-settings`
  (currency/usdRate/dataset/…) is retained — documented in the dialog body copy.
  "Reset demo data" keeps the draft (seed asset ids stay valid after reseeding).
- **Visibility, not disablement:** the Erase trigger renders only in live, Reset only
  in demo (S6 state matrix); the demo-guard contract stays `useDataset()` (D16).

## D18 — Metrics exposure: per-asset XIRR flow model + additive placements (2026-08-02)

Phase 2 `feat/metrics-exposure` surfaces the D13/FORMULA-AUDIT metrics per brief
S9–S10 (`design/extensions/metrics-exposure.dc.html`). Additive-only verified:
every D5-pinned figure byte-identical; only labels changed ("Net result" →
"Capital gain" on Overview, "P&L, ₴/%" → "Capital gain, ₴/%" on Portfolio, +
disambiguating footnotes on Yield/Portfolio).

- **"Total return (net)" KPI = the audit's NetFinancialResult** —
  `headlineTotal − netDeposits` with the `globalRoi` fraction as its sub
  (`screens/overview/overview.totalReturnKpi`; demo +₴5,839.99 / +4.08%). This
  is the §5 GLOBAL family (capital + cash vs external deposits), deliberately
  NOT Σ per-asset `totalNetProfit` (which adds externally-paid-out income the
  broker account never held; that family lives in the Yield column). Null roi
  (netDeposits ≤ 0) renders "—".
- **Per-asset XIRR flow model (pinned,
  `screens/yield/yield.assetCashFlows`):** `buy`/`reinvest`/`tax` → negative
  flows, `sell`/`redemption`/`dividend_accrual`/`interest_payout` → positive
  (tax at its own date = net-of-tax money-weighting), `deposit`/`withdrawal`
  skipped even when carrying an assetId (the transaction form always attaches
  the selected asset, but they are portfolio cash moves, not asset flows);
  terminal flow = the carried-forward latest quote (D5#1 semantics) on the
  latest snapshot date. Unquoted asset → no xirr/total-return (— like the v1
  columns).
- **"XIRR (ann.)" header suffix** while `daysBetween(PORTFOLIO_START, latest
  snapshot) < 365` (`xirrIsExtrapolated` token; component owns the copy, D8) —
  plain "XIRR" after a full year.
- **Ledger-drift chip (S9d):** `ledgerDriftChip` returns the signed
  `ledgerCashDrift` only when `|drift| > ₴0.01` AND snapshots exist; warn-tint
  tokens only (reconciliation nudge, never `neg`); native `title` tooltip this
  phase; re-keyed by value so changes re-run the 200ms entry animation. Demo
  drift is 0 by construction → hidden.
- **Derived demo figures now expected in navigation-map** (NOT D5-pinned —
  they are outputs of the audited formulas over the seed): Yield Total return
  +10.12% / +1.48% / +10.65% / +10.96%; XIRR +23.0% / +3.1% / +25.8% / +99.4%
  (the extension mock's +99.5% was an illustrative rounding; the derivation
  wins per the reference's own header note).

## D19 — Inzhur feed policy: public bare GET, tolerant parse, last-good cache (2026-08-04)

Phase 3 `feat/inzhur-client` (`docs/NEXT-PHASE-PLAN.md` key fact #1) pins how the
app reads Inzhur. Pure half: `src/core/inzhur/parse.ts`; network half:
`src/hooks/useInzhurAssets.ts`. Re-verified live on 2026-08-04 (35 entries,
`ACAO: *`, every field below present and unchanged).

- **Endpoint: `GET https://www.inzhur.reit/_api/assets`, unauthenticated, and it
  MUST be a BARE GET — zero custom request headers, no credentials.** Verified
  from the running app's origin (`http://localhost:3001`, 2026-08-04): a bare
  `fetch(url)` returns 200 with all 35 entries; adding a **non-safelisted**
  header (`X-Client`) fails, because it makes the request preflighted and the
  `OPTIONS` response carries no `Access-Control-Allow-Origin`; `credentials:
  'include'` fails too, since `ACAO: *` forbids credentialed requests. (A
  CORS-safelisted header such as `Accept` happens to survive — it triggers no
  preflight — but the rule stays "send nothing": the safelist is not worth
  betting a daily ritual on.) The response's `ACAO: *` is **not contractual** (a
  public marketing endpoint, not a documented API) — hence the degradation rules
  below.
- **The authenticated API is unusable from this app.** `core.inzhur.reit` issues
  15-minute JWTs through an origin-locked CORS policy that does not include
  localhost or the Amplify host, and there is no server to proxy through (D15:
  the app is a pure client-side SPA). Documented fallbacks if the public feed
  ever closes: `/{offer/<slug>/}_payload.json`, then an HTML scrape — both
  strictly worse; manual entry remains the always-available path.
- **~13:00 Europe/Kyiv refresh** is the freshness boundary: the query's
  `staleTime` is a function of the FETCH instant (`msUntilNextKyivHour`, so a
  payload fetched at 12:59 goes stale at 13:00, not 23 h later). Kyiv time is
  read from `Intl.DateTimeFormat` at the instant in question — **the +2/+3 DST
  offset is never hardcoded** (`core/dates.kyivDateIso` /
  `msUntilNextKyivHour`, tested on both DST sides and on both switch days).
- **Kopecks are the feed's unit for bond payments** (`paymentSchedule[].amount`,
  a decimal STRING: `"7840"` = ₴78.40 coupon per bond, `"100000"` = ₴1,000
  principal). `kopecksToUah` is the ONE place that divides by 100. Money the
  module CREATES (a position value, a coupon forecast) is rounded once at
  creation to kopecks — it is about to be shown and saved as an amount; D13's
  "round at display only" governs derivations over already-stored data.
- **Payment dates are midnight-Kyiv instants** (`2027-03-23T22:00:00.000Z` is
  24.03.2027 locally) — read in Kyiv time, a naive UTC slice lands a day early
  and contradicts the bond's own `maturityDate`. `maturityDate` itself is a
  plain `yyyy-MM-dd` and is kept as published.
- **Tolerant pick-parse, never `strictObject`.** The payload is third-party and
  will drift (today it carries 13 top-level fields we never read), so every
  schema picks the few fields we need and ignores the rest, and a per-entry
  mismatch **skips that entry** (collected in `ParsedFeed.skipped` by ISIN/slug)
  instead of failing the whole feed. Keys: funds by `slug`, bonds by
  `assetDetails.isin` — ISIN presence IS the kind (no live fund carries one,
  every live bond does). Matching against the portfolio's `Asset.inzhur.ref` is
  trimmed + case-insensitive; `status` is deliberately NOT filtered (a
  `completed` bond the user still holds must keep matching).
- **Degradation: manual entry is authoritative, the cache is the fallback.** The
  raw last-good payload + its fetch instant live in the Dexie `meta` table under
  **`inzhur:lastFetch`** (raw, so a later parse improvement re-reads the
  untouched feed) via two tiny typed repository accessors (`getMeta`/`setMeta`).
  A payload that parses to zero entries is treated as a failure and never
  overwrites the cache. The hook exposes the cache as `lastGood` beside the live
  `data` — S1 offers it ("Use values from 25.07"); it is never applied silently.
- **Query shape:** key `['inzhur','assets']` (+ local companion
  `['inzhur','lastFetch']` for the meta read), `enabled: false` — a request
  happens ONLY through the returned `fetchAssets()`, `retry: 1`, a ~10 s
  `AbortController` timeout chained to TanStack's own signal, `gcTime: Infinity`.
  `fetchAssets()` is a no-op in the demo dataset (G4/D16 `useDataset()`), so no
  request can leave the app there. Nothing in this module writes portfolio data
  (G5): a fetch yields values in memory only.
- **Amended by `feat/fetch-quotes` (2026-08-04): both queries run
  `networkMode: 'always'`.** With TanStack's default `'online'`, a press made
  while the browser is offline PAUSES the query — no request, no error, so the
  S1 failure path never ran and the button was a silent no-op (browser-verified
  with DevTools offline); worse, the paused fetch would resume on reconnect and
  fill drafts with nobody watching. `'always'` makes the attempt happen and
  FAIL, which is what the toast + stale-cache offer need. The companion
  `lastFetch` query is a local IndexedDB read and must never be paused for
  being "offline" — offline is exactly when the cache has to be readable. The
  same amendment makes that query return `?? null`: `getMeta` yields `undefined`
  when no cache row exists (the normal state on a fresh profile), which TanStack
  rejects as query data — it logged a console error and left the query failed.

## D20 — Fetch quotes: draft-only fill, provenance in the draft, live ref picker (2026-08-04)

Phase 3 `feat/fetch-quotes` implements S1–S3 of
`design/extensions/daily-quotes-live.dc.html` and S7 of
`design/extensions/automation.dc.html`. Pure decisions:
`src/screens/daily-quotes/fetch-quotes.ts`; wiring: `useQuoteFetch.ts`.

- **One press, three outcomes per linked row (G5 made decidable).**
  `reconcileFetched(matches, quotes, origins)` sorts every matched linked row
  into **fill** (draft empty, or its current value was itself machine-filled),
  **offer** (the user's own value differs → the S3 "Use fetched …?" pill, never
  applied) or neither (the user already typed that very number — no offer, chip
  stays `manual`). Equality is compared at kopeck precision, so float noise can
  never manufacture an offer. Nothing in the flow touches the repository: the
  fetch writes `state/draft.ts` only and "Save snapshot" stays the sole write
  path (browser-verified: after a fetch, the live DB still held 0 snapshots).
- **Provenance lives with the draft, not with the Snapshot.**
  `core/types.QuoteOrigin { source: 'fetch' | 'cache'; at }` is stored per asset
  in the persisted draft store (`kubushka-draft`), which is what makes "is this
  value the user's?" answerable after a reload — the chip and the no-overwrite
  rule survive exactly as long as the draft does. `setQuote` (the user typing,
  "Copy yesterday", the saved-snapshot prefill) DELETES the origin — those are
  all the user's numbers; the new `fillQuote(assetId, text, origin)` is the only
  machine path. A saved snapshot keeps no provenance: it is history, and history
  records values, not their sources.
- **Chips key off the SOURCE, not off dates.** Cache-served values always get
  the amber `as of dd.MM` chip, even when the cached payload is from today: the
  fetch that would have confirmed them failed, and an `auto · fetched HH:MM`
  chip would claim a success that did not happen. (S2's wording says "older than
  the selected date"; S1's state matrix says applying the cache gives warn chips
  — this resolves the overlap on the conservative side.) The success flash is
  likewise reserved for a fetch that actually succeeded; applying the cache
  leaves the button idle (state 5).
- **A fresh payload is re-served, not refetched** (S1): `payloadStillFresh`
  reuses the query's own boundary — fresh until the feed's next ~13:00 Kyiv
  refresh (D19) — so a second press within the same feed day fills from memory
  with no roundtrip (browser-verified: zero extra requests). Times and dates in
  the chips/microcopy are Kyiv wall clock (`core/dates.kyivTimeHm`, added here):
  the prices are stamped on Kyiv's clock, so "fetched 13:05" must be too.
- **Failure is always visible and always offers the alternative:** toast
  "Couldn't reach Inzhur — check your connection." plus, when a last-good cache
  exists, an action "Use values from dd.MM" that applies the cache **through the
  same reconciliation** (so typed values survive that path too). See the D19
  amendment above for the `networkMode: 'always'` fix that made this reachable
  offline.
- **S7 live picker.** The ref field became a `Select` fed by the feed — funds by
  slug (feed `title` + slug hint), bonds by ISIN (+ maturity hint) — and stores
  exactly the string the manual field stored, so `core/schemas` and the asset
  mappers are untouched. It fetches on FIRST OPEN (never on form mount), keeps
  an already-linked ref selectable when the feed lacks it, and **never blocks
  linking**: error/offline collapses into the manual input with a `muted` (not
  `neg`) note, demo forces manual mode with the specced note, and "Enter
  manually" ↔ "Pick from the list" round-trips at any time. Three additive
  `Select` props carry it (`option.hint` outside Radix's `ItemText` so the
  trigger shows the label alone, `onOpenChange`, `status` for the
  loading/empty/stale rows) plus an opt-in `scrollList` (the live feed lists ~30
  bonds; every pre-existing select keeps its exact unbounded height).
- **Two small enablers:** `buttonVariants` gains `size: 'header'` (padding 8/18,
  13px — the S1 pill sits one notch below `md` beside the 36px Date field), and
  `core/inzhur/parse` now picks the feed's `title` (whitespace-collapsed; the
  bonds' title carries a hard line break) for the picker's fund rows.

## D21 — Fixed-yield automation: accrual ghosts, coupon confirm, projection fallback (2026-08-04)

Phase 3 `feat/fixed-yield` implements S4/S5 of
`design/extensions/daily-quotes-live.dc.html` and the two S8 switches of
`design/extensions/automation.dc.html`. Pure half: `src/core/accrual.ts`;
per-screen glue: `src/screens/daily-quotes/suggestions.ts`; write path:
`src/screens/daily-quotes/CouponDueCard.tsx`.

- **Accrual basis (ACT/365, D13).** `dailyAccrual(couponAmount, schedule,
  fallback?)` spreads the stated coupon over its period
  (`couponAmount × payments-per-year ÷ 365`; monthly 12 · quarterly 4 ·
  semiannual 2 · maturity 1 · none 0) and falls back to
  `expectedPct × invested ÷ 365` when no coupon is stated — 0 means "not
  derivable", and the UI then suggests nothing. `suggestedQuote` carries the last
  quote forward by that rate, **subtracts every coupon whose date fell in
  `(lastDate, today]`** (a bond's price DROPS on payment day — the plan's Verify
  item; browser-verified: …8976's ghost fell from 15 914,25 to 14 674,25 the
  moment a 03.08 coupon sat in the gap) and **clamps the accrual at maturity**. A
  non-positive or backwards result is `null` (no ghost) rather than a number the
  quote schema would reject anyway. `couponsInGap` walks the coupon grid from the
  `nextCoupon` anchor in BOTH directions, because the anchor sits behind the gap
  once the coupon has been confirmed and ahead of it while it is pending.
- **The ghost is not a draft.** It is rendered as real muted text over an EMPTY
  input (dashed `faint` border + a 9px `suggested` micro-tag), never as a
  `placeholder` (which would vanish on focus and be indistinguishable from
  yesterday's hint) and never as the input's value (typing would then append to
  it). It is not counted in "N of M filled", shows no delta and cannot be saved.
  Accepting it is the only path into the draft store, and it lands as a MACHINE
  fill — `QuoteSource` gains `'accrual'`, so a later Inzhur fetch may still
  replace an accrual guess with a real price, while a value the user typed
  (no origin) stays untouchable (G5).
- **Chips follow S2, not S4, on unlinked rows.** S4 says an accepted suggestion
  shows chip `auto` + microcopy `accrual`; S2 says chips render ONLY on
  Inzhur-linked rows and never in demo. S2 wins where they overlap (otherwise
  every demo row would carry a chip, which S2 explicitly forbids): the `'accrual'`
  provenance is always recorded in the draft, and the chip appears wherever S2
  already allows one. Its tooltip is new copy ("Filled from coupon accrual — a
  suggestion you accepted.") — the brief's title vocabulary has no accrual entry.
- **Ghost dismissals are session state keyed by the selected DATE** (not a
  persisted field): a dismissal means "not for this date", and it is not worth a
  settings key. A reload re-offers the ghost — deliberate, since the ghost costs
  nothing and writes nothing.
- **Coupon dedupe = a symmetric ±7-day window** (`COUPON_MATCH_WINDOW_DAYS`):
  `dueCoupons` offers `nextCoupon ≤ today` only when NO `interest_payout` for that
  asset lies within a week of the date, which is what keeps a manually recorded
  coupon from being offered twice (plan Verify item) while every schedule period
  (≥ 1 month) stays far wider than the window, so a catch-up roll is never
  silenced by the coupon before it.
- **`rollNextCoupon` clamps, then flags.** The next scheduled date wins; a date
  that would overshoot `maturity` is clamped ONTO the maturity date (the final
  coupon lands with the principal); an asset already at/after maturity returns
  `{kind:'matured'}` — a flag only, so `nextCoupon` never moves past maturity and
  the asset stops suggesting.
- **One confirm, exactly one write set.** The S5 confirm records the
  `interest_payout` (dated the coupon's own date, `source: 'accrual'`), then the
  optional paired `reinvest` (same date/asset/amount — what the payout-destination
  derivations match on), then rolls `nextCoupon` with ONE `updateAsset`. The write
  runs in the click handler — never in an effect, so StrictMode's double-invoke
  cannot duplicate it — behind a `useRef` latch that also absorbs a double click
  (browser-verified: a double-click on "Record coupon" produced 18 → 19
  transactions and a single roll 2026-08-03 → 2027-02-03, still true after a
  reload). No `tax` row is ever drafted (G5/D13). Skip writes nothing at all and
  files the derived id `coupon:<assetId>:<date>` in `dismissedReminders`.
- **The coupon amount is prefilled, never guessed.** A linked bond takes the
  feed's `paymentSchedule` forecast (₴78,40/unit × units, the exact figure);
  otherwise the asset's stated `couponAmount`; otherwise the field opens EMPTY
  with the pinned "Enter an amount." guard. The `expectedPct` estimate is
  deliberately NOT offered here: it is honest in a projection card, but a
  transaction amount must not look authoritative when it is a guess.
- **Projection fallback (the plan's explicit fix).** `couponProjection(asset,
  invested)` now feeds both Overview "Next payouts" and Seasonality's expected
  bars. Both used to require BOTH `couponAmount` and `nextCoupon`, so a
  user-created bond missing either was skipped without a word. The amount falls
  back to the per-period share of `expectedPct × invested` and is flagged
  `estimated` (the UI's "~" prefix, like dividend estimates); the date falls back
  to `maturity` — a payment date the asset itself states. **No date is ever
  invented**: with neither date the projection stays absent. The demo seed carries
  both attributes on both bonds, which is why the gap was invisible — and why
  every D5-pinned figure is byte-identical (verified in the browser after a demo
  reset).
- **Settings→Automation (S8, partial).** `autoQuoteSuggest` + `couponSuggest`
  land as persisted fields (defaults ON) together with `dismissedReminders`
  (default `[]`), all three in `partialize` + `PersistedSettings` +
  `PERSISTED_DEFAULTS` + `migrateSettings` + store tests in this commit (G3/D11);
  `dismissedReminders` arrives now because the S5 skip needs it, and
  `restoreDismissed` comes with it so a skip is never a dead end (its S8 row is
  `feat/reminders`' UI). The reminders block keeps a placeholder. The P2 switch
  anatomy moved into `components/ui/Switch.tsx` (AssetForm's private
  `InzhurSwitch` now delegates to it) so the app keeps ONE switch.

## D22 — Reminders: derived ids, self-expiring dismissals, one toast per open (2026-08-04)

Phase 3 `feat/reminders` implements S6 of `design/extensions/reminders.dc.html`
and the reminders half of S8 (`design/extensions/automation.dc.html`). Pure
half: `src/core/reminders.ts`; glue: `src/hooks/useReminders.ts`; UI:
`src/components/ui/ReminderStrip.tsx` + `reminder-labels.ts`. The
suggest-don't-silently-write doctrine is already pinned (D20/D21) and needs no
extension: reminders write NOTHING at all — the only state they touch is the
user's own dismissal list.

- **`Reminder` is a pinned Phase-3 contract** — `{id, kind, severity, date,
  days, assetId?}`, tokens only (D8; the sentences live in
  `components/ui/reminder-labels.ts`). Four kinds with **derived** ids:
  `quote-missing:<date>` · `coupon:<assetId>:<date>` ·
  `coupon-overdue:<assetId>:<date>` · `maturity:<assetId>:<date>`.
  Derive-don't-schedule (plan key fact #8): a local-only SPA has no background
  wake, so every reminder is recomputed per render and **dismissals expire by
  themselves** — when an occurrence leaves scope its id stops being produced and
  its entry in `dismissedReminders` goes inert. Nothing prunes the list;
  "Restore dismissed" clears it wholesale. Severity → tint is 1:1 with the
  reference: info `pos-tint`, warn `warn-tint`, overdue the **minted
  `neg-tint`/`neg-tint-text`** (`#f0cec7` / `#693f35`, copied from the extension
  header into `@theme`; that one severity and nothing else). Order: overdue →
  warn → info, by date inside a severity; the strip caps at 3 with a pressable
  `+N more reminders` line.
- **quote-missing counts a PARTIAL day as missing** (the plan's Verify item): an
  asset with no quote key is pending, never 0 (D5#1), so the ritual is
  unfinished and the banner stays. With zero assets it never fires — there is
  nothing to quote. It is suppressed on `/` (the progress pill already says it)
  and carries the `Enter quotes →` link only on `/overview`.
- **Both coupon kinds reuse the S5 dedupe.** `dueCoupons`'s ±7-day
  recorded-payout check became the exported `core/accrual.couponRecorded`, so the
  card and the banners share ONE rule: a coupon recorded by hand (either side of
  its date) is never announced. `coupon` is `0 < days ≤ leadDays`; `days ≤ 0` is
  `coupon-overdue` and is announced however old it is — the lead time windows the
  FUTURE only.
- **Skipping the S5 card silences that occurrence's overdue banner** — the skip
  files the shared `coupon:<assetId>:<date>` id (D21) and `computeReminders`
  checks it beside `coupon-overdue:…`. The reverse does NOT hold: dismissing the
  banner leaves the card standing (the card is the tool, the banner the nudge).
- **Maturity is forward-only** (`0 ≤ days ≤ 30`) and keys off the asset's own
  `maturity` field regardless of yield type — a date the asset states is a date
  it pays out on. A maturity already past is never announced (the brief's copy
  only reads forward, and a redeemed bond needs no reminder).
- **One lead-days rule, two entry points.** `core/reminders.isLeadDays`
  (whole days, 1–30) backs the S8 field's parser
  (`screens/settings/settings.parseLeadDays`), `setReminderLeadDays` AND
  `migrateSettings`, so an invalid entry can never write and a tampered payload
  can never disagree with the screen (P2 usdRate precedent: the last valid value
  stays in effect while the field shows "Enter 1–30 days.").
- **Exactly one toast per app open.** `useReminderToast()` is hosted in
  `app/Layout` — the one mount point that spans every route — behind a
  MODULE-level latch: a ref would satisfy StrictMode's double-invoked effect, but
  the latch must also survive anything that remounts a host, and the toast has to
  fire on app open whatever route the user lands on. It fires on the first
  resolved read with the highest-severity sentence + ` · +N more`, and never
  again on navigation (browser-verified: one toast across four client-side
  navigations). `remindersEnabled` off at boot means no toast at all.
- **Dismiss commits on a TIMEOUT, not on `animationend`.** The banner plays its
  220 ms exit and the store records the id when the timer fires: a throttled or
  occluded tab never fires animation events (observed live during verification —
  a whole page's animation clock sat at 0), and a dismissal must be recorded
  whatever the compositor is doing. `prefers-reduced-motion` skips straight to
  the write.
- **`components/ui/Reveal.tsx`** — the AssetForm's private symmetric reveal/hide
  group became the app's ONE reveal idiom (same reasoning as D21's Switch
  extraction), with a `distance` prop because the S8 sub-rows travel 1 and the
  form groups 2. The reminder sub-rows (lead time + restore) collapse through it.
- **Three copy extensions beyond the reference's literals**, each an unavoidable
  edge of its own pattern: `in 1 day` (singular), `matures today (dd.MM.yyyy)`
  (a same-day maturity), `+1 more reminder` (singular overflow line).
- **The action link's `white-space:nowrap` holds from `sm` up only.** At 360 px
  the content column beside the 136 px rail is ~200 px, and a non-wrapping
  `Open Daily quotes →` pushed the page into 9 px of horizontal scroll
  (measured); below `sm` the link wraps and the strip holds at 360 px.
- **Settings (G3/D11):** `remindersEnabled` (default ON) and `reminderLeadDays`
  (default 7) enter `PersistedSettings` + `PERSISTED_DEFAULTS` +
  `migrateSettings` + `partialize` + store tests in this commit; the S8 restore
  row wires the `restoreDismissed` action D21 already added.

## D23 — Phase-3 review: coupon occurrences are derived from the grid, not from the pointer (2026-08-04)

Phase 3 `fix/phase-3-review` applies the findings of the three-lens audit of
`6d53afa..848e130`. Two were real defects in pure logic, four were smaller UI
fidelity/a11y gaps, and six were refuted with evidence (recorded in the review
report, not here). The rulings worth pinning:

- **`asset.nextCoupon` is an ANCHOR, not the app's idea of "the next coupon".**
  It only ever moves through the S5 confirm (D21), so any other way of settling
  an occurrence — recording the coupon in the Transaction panel (the path D21
  explicitly designs the ±7-day dedupe for), pressing **Skip**, or an
  `updateAsset` that fails after the payout row was written — left the pointer
  frozen on a settled date while the same dedupe silenced BOTH the S5 card and
  the S6 coupon banners for that asset **permanently**. The card and the
  reminders now read the new pure `core/accrual.nextUnsettledCoupon(asset,
  transactions, {windowDays, dismissed})`, which walks the asset's own coupon
  grid forward from the anchor and steps over every occurrence already recorded
  or skipped. This is what makes the brief's pinned S5 `skipped` row true ("the
  NEXT coupon date suggests normally") — browser-verified: skipping 01.06 made
  the 01.07 card and its overdue banner appear at once, and a coupon recorded by
  hand on 01.08 left the pointer untouched while the banner moved to "pays a
  coupon in 28 days (01.09.2026)". G5 is unchanged: the walk is a derivation, it
  writes nothing, and **Skip still writes nothing but the dismissal id**.
  Corollaries: `dueCoupons` takes the dismissal list as INPUT (the screen no
  longer filters its result — one rule, one place), and `rollNextCoupon(asset,
  from?)` rolls off the occurrence the confirm just recorded rather than the
  possibly-lagging pointer, so the stored date can never land on a date that is
  already settled. `couponProjection` is deliberately NOT changed: Overview's
  "Next payouts" and Seasonality's expected bars state the date the ASSET
  states, and every D5-pinned figure stays byte-identical.
- **A coupon grid is only ever indexed off its anchor.** `couponsInGap` used to
  rebuild the grid by stepping BACK with `addMonths` and then forward again — not
  an inverse once the month-end clamp fires (2026-08-31 −1m → 07-31 −1m → 06-30,
  then +1m → 07-30). A month-end anchor therefore drifted onto dates the asset
  never pays on and over-counted a coupon, and the S4 ghost subtracted a phantom
  ₴1,240 from a money value the user accepts with one press (verified: monthly
  anchor 31.08, gap 15.06→30.08 counted 3 coupons instead of 2). Every grid date
  is now `addMonths(anchor, k × months)`, computed from the anchor, with the
  start index found by month arithmetic and one period of margin. Demo anchors
  are day 25 and 03, so no pinned figure moved (ghosts still 15 914,25 /
  4 385,96).
- **Two disabled tiers on buttons, and a gated control must be able to explain
  itself.** `buttonVariants` gains `disabledTone: gated (.5) | busy (.7)` — a
  variant, not a className override, for the same no-fighting-utilities reason as
  `weight`/`size` — because the S1 drawings put an in-flight control at .7
  (`daily-quotes-live.dc.html:358`) and a gated one at .5 (`:385`, `:396`); the
  base class no longer hardcodes the .5. And because the shared base also carries
  `disabled:pointer-events-none`, a disabled button is not hit-testable and its
  own native tooltip can NEVER fire — which silently hid the only explanation S1
  gives for the demo and no-linked-assets states (demo being the default
  dataset). The gating states now render the button inside a hit-testable `span`
  that carries the same `title`; the button keeps the attribute so the accessible
  description survives. The S1 `aria-label` is gone: the button has visible text,
  and a fixed name overrode "Fetching…"/"Fetched 13:05" (WCAG 2.5.3) — the
  accessible name now follows the state.
- **A prefilled confirm field mirrors its prefill until the user touches it.**
  The S5 amount is `edited ?? fmtTable(prefill)` — no effect, no remount — so a
  prefill that only becomes available LATER (a linked bond's `paymentSchedule`
  forecast arrives with the first fetch, and the card's key is stable) still
  lands in an untouched field, while a typed value survives every later feed
  (verified live: the card opened empty, the real feed filled ₴1,176.00 =
  78,40 × 15, and a typed 1 183,50 survived the next fetch). Both new error
  messages (`Enter an amount.`, `Enter 1–30 days.`) sit outside their label and
  now carry `aria-describedby`, so assistive tech hears the reason and not just
  "invalid". `useInzhurAssets` memoizes the last-good cache read: `readCache`
  zod-parses the whole raw payload (~300 KB live) and ran on every render of
  every consumer, including every keystroke in a quote input.
- **The in-place edit of two merged design extensions (`cd21fa6`) is recorded,
  not repeated.** `design/extensions/README.md` pins "don't rework a merged
  surface in place — supersede via a new brief section + a new reference", and
  that commit edited `reminders.dc.html` (dismiss ✕ resting opacity .65 → .85,
  8 sites + the anatomy comment) and `daily-quotes-live.dc.html` (stale-offer
  dash `warn-tint` → `warn`, the Inzhur tooltip dropped from the accrual `auto`
  chip, two dismiss opacities) one commit after they merged. Sanctioned once,
  after the fact, on narrow grounds: it happened inside the same phase and
  BEFORE any implementation commit, and every change moved the reference toward
  the brief, which wins copy/behavior disputes anyway (the brief already pinned
  .85 at `phase-3-living-data.md:232,433`). The rule stands unweakened for
  anything after implementation, and for anything the brief does not already
  pin — those still need a superseding brief section and a new reference.
