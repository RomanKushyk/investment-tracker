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
