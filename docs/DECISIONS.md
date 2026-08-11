# Decisions

Decision log for Quirenote. Add new entries at the bottom; never rewrite history — supersede instead.

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

## D24 — Import replaces, never merges: validate → diff → confirm → one rw transaction (2026-08-04)

Phase 4 `feat/backup-import` implements the S2–S4 surfaces
(`design/extensions/data-portability.dc.html` S1–S2,
`design/extensions/import-dialog.dc.html` S3–S4) and the phase's binding
safety-first doctrine. Pure half: `src/core/backup/import.ts` (plus the
extensions to `core/backup/json.ts`); infra: `src/lib/sync.ts`; UI:
`src/screens/settings/ImportRow.tsx` + `ImportDialog.tsx` + `import-labels.ts`.

- **Ordering is the feature.** Validate fully → show a diff → the user confirms
  → ONE `rw` transaction. Nothing is written by a parse, a preview, a drag, a
  hover or a mount: `validateImport` is pure, the dialog is a report, and the
  Confirm press is the sole write path (browser-verified — Cancel/Esc/close and
  every rejection leave the row counts byte-identical). One bad row stops the
  whole import; there is no partial apply and no merge mode. **Replaces, never
  merges:** a key the file omits is REMOVED, which is why the diff exists at all
  — the S3 dialog states removals before the press, and the worked case is
  yesterday's backup silently dropping today's work.
- **The safety backup is a guarantee, so it is not cancellable.** The pre-import
  `kubushka-before-import-<date>.json` is built and handed to the browser BEFORE
  `repo.replaceAll`, always through `<a download>` (never `showSaveFilePicker` —
  a Save-as dialog can be cancelled, S5's one pinned exception to save-picker
  parity). If it cannot be built the import never starts (`Could not create the
  safety backup — nothing was imported.`). Verified live under lock contention:
  the safety line had already flipped to "Safety backup downloaded — …" while
  the replace was still queued behind another tab, and the downloaded file held
  the PRE-import state. `useBackupDownload` grew `{name, quiet}` for it; every
  other caller is unchanged.
- **`core/backup/json.ts` was EXTENDED, not forked.** `readEnvelopeHead` is the
  format/version gate `parseBackup` always applied, extracted so the import
  validator dispatches on the same decision and prints the D12 parser's own
  sentence verbatim as its mono technical-detail line — one implementation, so
  the two can never drift. `integrityIssues` now returns STRUCTURED issues
  (`RowIssue` = table + row address + field + code + value, D8) and `parseBackup`
  renders them back to its P1 strings byte-identically. **Duplicate primary keys
  joined the integrity pass:** a duplicated asset or transaction id survives the
  row schemas, collapses silently in the id set, and would otherwise abort
  `bulkAdd` with an opaque ConstraintError instead of a row-addressed reason.
- **Row addressing (pinned, matches the S4 reference and brief verbatim):**
  snapshots by `date`, transactions by `id`, **assets by array INDEX**. An asset
  id is the referential anchor every other table's error quotes, so addressing a
  malformed asset ROW by index keeps "this row is broken" distinguishable from
  "something points at this id" — and the index is the only address a file with a
  broken id still has. A row whose own key field is the invalid one falls back to
  the index for the same reason. The list is capped at 10 with the exact total
  stated.
- **Envelope version policy:** `formatVersion` 1 is current; a NEWER version is
  rejected with the pinned "written by a newer version of the app" sentence
  (code `newer-format`), and any other unreadable version (a hand-edited 0, a
  string) gets `unsupported-format` rather than a claim about a newer app — one
  sentence beyond the brief's inventory, because the alternatives were a lie or
  a silent no-op. Datetimes stay timezone-less by plain regex (D12): a
  `Z`-suffixed value is a rejection, unit- and browser-verified.
- **Web Lock + BroadcastChannel (`lib/sync.ts`).** Dexie's `rw` transaction is
  atomic within one tab, but two tabs each running clear+bulkAdd can interleave
  and leave a mix of both datasets, so `replaceAll`/`clearAll` run inside
  `navigator.locks.request('kubushka-db')`. The request is two-phase (an
  `ifAvailable` probe, then a queued wait) purely so contention is KNOWABLE —
  that is what powers the S3 `Waiting for another tab…` slot; a plain request
  cannot tell "instant" from "queued". Where Web Locks are unavailable the write
  still runs: a missing safeguard never blocks a feature.
  `BroadcastChannel('kubushka-sync')` posts `{kind:'replace'|'clear'}` only
  AFTER a committed write; ONE channel object both posts and listens, because a
  channel never delivers to itself — that is what keeps the acting tab from
  toasting at itself. `useDbSync` (hosted in `app/Layout`, like the D22 reminder
  toast) invalidates every query and shows the one pinned cross-tab toast. A
  `clear` reuses that same sentence: the brief pins one, and both events mean
  "what you hold is gone".
- **Demo is a legal import target (G4/D16)** — it targets the ACTIVE dataset and
  the row says so; "Reset demo data…" is the escape hatch. Import is never
  disabled anywhere: it is the recovery path in every dataset.
- **Settings apply only on the opt-in, and only through the store.** The
  checkbox is default OFF; applying runs the file's block through
  `migrateSettings` (D11) and calls `setCurrency`/`setUsdRate` — never a direct
  localStorage write, and never `dataset`/automation/reminder fields. A file with
  no settings block replaces the checkbox with a line, never a disabled checkbox.
- **A successful import resets the quote draft** (`kubushka-draft`) — the hazard
  D17 named for erase: the imported dataset has its own asset ids, and a
  leftover draft would show phantom values against them.
- **`diffBackup` counts by the keys the DB stores** (assets by id, snapshots by
  date, transactions by id) and returns per-table added/replaced/removed plus the
  six pinned warning tokens; a table the file EMPTIES is stated once (its own
  wholesale-loss sentence supersedes the partial-removal line for those rows).
  Age fires from 7 days out, never for a future stamp. Two items from the plan's
  "e.g." list were resolved differently and deliberately: **settings-block
  presence** is surfaced where the design puts it (the opt-in checkbox vs "This
  file carries no settings.") rather than as a warning sentence, and **colorKey
  collisions are not warned about at all** — the app's own asset creator reuses
  hues past the fourth asset, so a repeated hue cannot be a file defect.
- **Round-trip invariant, verified both ways:** export → erase → import returns
  the seed byte-identically (`src/lib/repository.test.ts`) and every D5-pinned
  figure with it — browser-verified by importing a demo export into a wiped LIVE
  dataset: 4/174/18 · ₴149,016.36 · +₴4,452.61/+3.08% · deposited ₴143,176 ·
  income ₴5,040.94 · top up ₴11,429.50 · …6475 annualized +10.9%.
- **Mid-phase state:** the drop copy and the input's `accept` name `.csv` per the
  design, but only `.json` is in `IMPORT_EXTENSIONS` until `feat/csv-roundtrip`
  widens both — a `.csv` meanwhile gets the pinned file-type message, which is
  the honest answer while CSV import does not exist.

## D25 — `neg-tint` widened to irreversible-harm framing at block scale (2026-08-04)

Recorded by Phase 4 `feat/backup-import` on behalf of the phase (the design
brief requires the implementing task to log it). **Phase 4 mints no token**; its
one novelty is a widened reservation, restated here verbatim from
`docs/design-briefs/phase-4-data-portability.md` and the headers of both P4
extension references:

> **`neg-tint`/`neg-tint-text` are block-level framing for overdue reminders and
> irreversible-harm surfaces — never for validation messages (those stay `neg`
> text on `card`), never for numbers, deltas or counts, never for a routine
> control or a pressable's own fill.**

- D22 reserved the family for "the overdue reminder severity and NOTHING else".
  Phase 4 widens that to irreversible-harm framing at block scale, at **exactly
  two new sites and no more**: the **S3 "Replaces everything" banner** (tint
  background + tint-text sentences) and the **S8 danger-zone panel** (tint border
  + tint-text microlabel).
- The reason is the one the family was minted for: raw `neg` #a8695a carries a
  13 px sentence at only ~3.6:1 on `card`, while `neg-tint-text` #693f35 is
  6.08:1 on `neg-tint` #f0cec7 and 8.89:1 on `card`. Values are unchanged.
- Two consequences the P4 surfaces demonstrate: the S4 rejection lead line is
  plain `neg` on `card` (nothing was destroyed — no tint), and the diff counts
  are RAW accents, never tinted pills, so the tint families keep meaning "block"
  and not "number".
- The `@theme` comment block in `src/index.css` carries the widened rule at the
  token definition; the S8 half lands with the task that restyles the danger zone
  into its sub-panel.

## D26 — A price archive exists; the app is still local (2026-08-11)

`infra/` deploys a daily job (01:00 Europe/Kyiv, EventBridge Scheduler → Lambda)
that archives asset prices into **Aurora DSQL**. Rationale and cost analysis:
`docs/superpowers/specs/2026-08-04-cloud-stack-and-cost.md`.

**D2 is NOT superseded.** Portfolio data still lives in IndexedDB; nothing in
`src/` reads the backend. The job buys exactly one thing: the Inzhur feed
publishes no history, so a day the app is not opened was a price lost forever.
It is deliberately shipped ahead of any app change because that loss is the only
irreversible item on the roadmap — everything else can wait without cost.

Stack: DSQL + Lambda + Cognito-less IAM auth + EventBridge, no VPC anywhere
(a NAT Gateway is ~$33/mo against a ~$0.02 baseline, and the deploy role is
denied EC2 outright so it cannot be added by accident). Two IAM roles: the
GitHub OIDC role may only drive one named CloudFormation stack and pass the
execution role, which holds the resource permissions and is assumable only by
CloudFormation. This is also why not CDK — its bootstrap role is
`AdministratorAccess` by default, which would surrender the D15 posture.

Rejected with reasons in the spec: Next.js (delivers none of PWA/sync/cron, and
Amplify does not support manual deploys for SSR), DynamoDB-only, Amplify Gen 2,
RDS/Aurora Serverless v2 (a 12-month free tier this account never had), managed
sync engines (moot once offline was dropped).

## D27 — No single source of truth for prices; the axis is backfillability (2026-08-11)

Researched 2026-08-11. **No Ukrainian law obliges any fund, КУА or broker to
publish machine-readable prices.** For a closed-end пайовий fund like Inzhur's,
the floor under ЗУ «Про інститути спільного інвестування» № 5080-VI and НКЦПФР
rules is NAV **calculated monthly**, filed in XML quarterly/annually, disclosed
publicly in **human-readable** form. НКЦПФР's open datasets contain no NAV;
SMIDA's open-data API was retired 2021-06-30 (verified: 404).

So Inzhur's daily JSON is **voluntary commercial disclosure** — contractually
«Базова ціна», cl. 1.4 of their services agreement: *"the price INZHUR offers to
buy and/or sell at"*. A dealer quote on their own secondary market, not a NAV.
That is why it carries a ~0.1 % spread and moves daily while NAV is struck
monthly.

| | ОВДП | Inzhur fund units |
|---|---|---|
| Official source | **NBU fair value, daily, since 2016-01-04** | none |
| Backfillable | **yes, by URL** | **no** |
| Our archive is | convenience + cross-check | **the only copy that will ever exist** |

**The axis that matters is not "has an API" but "is backfillable".** Only the
two fund NAVs are perishable.

The two sources are **not substitutes** — measured ~0.9 % apart on the same ISIN
the same day, one a dealer quote and one a model valuation. Both are stored,
distinguished by `source`. In the future observation table `source` joins the
natural key `(as_of, ref, basis, source)`, because merging them would present one
as the other.

Also established: НДУ issues real ISINs for the funds (**UA5000014044** REIT,
**UA5000012246** Energy) and publishes **no valuation** — its `price` field is
the nominal issue value. Worth adopting over provider slugs, since НКЦПФР
approved a merger of five Inzhur funds on 2025-08-29 and slugs demonstrably
change status and get absorbed.

## D28 — The capture journal, and how a frozen feed is caught (2026-08-11)

**A row is written on every run**, including a 404 weekend and a hard failure.
The invariant this buys: a missing row means *"we never looked"*, never *"we
looked and there was nothing"* — which is what makes a gap diagnosable at all.
Liveness is therefore answered by `price_capture`, not by the absence of a price.

**Raw payloads are kept forever** (gzipped, ~4.4 MB/year measured — 156 117 bytes
compress to 12 kB). The reason is correctability, not provenance: if the parser
is ever wrong, the raw bytes are the only thing that can regenerate history the
provider will never republish. A payload that fails to parse is still stored, and
`parser_version` on every row makes "which rows did the broken parser produce"
answerable rather than archaeological.

**Frozen-upstream detection** is the fourth failure mode, and the only one that
looks like success: 200, all entries parse, every value plausible, none moved.
Neither the error alarm nor the silence alarm can see it.

- Hashed over the **price fields only**, never the payload. Two captures seconds
  apart differ by 6 bytes because `availableQuantity` ticks, so `payload_sha256`
  is unique on every fetch by construction.
- Counted in **business days**, and in **dates rather than rows** — a first
  implementation counted rows, so two captures of one afternoon reported a
  two-day streak and a manual re-invoke could have tripped the alarm on healthy
  data.
- Surfaced by a **log line plus metric filter**, not by throwing: a frozen
  upstream is not transient, so a thrown error would only make EventBridge retry
  and write more rows.
- The streak value is published **on every business-day capture, not only when
  bad**. A metric that appears only on failure cannot distinguish healthy from
  "the check stopped running".

Threshold is an env var (`STALE_AFTER_DAYS`, default 5) rather than the 2–3 the
research suggested: how often ОВДП quotes genuinely sit flat is empirical and
nobody has the data yet. A threshold that cries wolf gets muted, and a muted
alarm is worse than none.

## D29 — CSV ships export-only; the round trip is cancelled (2026-08-11)

`feat/csv-roundtrip` was specified as both directions. Only the export half
ships. The split is not a scope cut for time — the import half was written,
tested and green — it is that the two halves answered different questions and
only one of them survived the cloud move.

**Import was a durability answer.** "Spreadsheet as DB" existed because the
database lived in one browser profile, so a file outside it was the only way
back from a cleared origin. The server answers that, on every device, without
the user curating a file. Keeping a second restore path would mean two ways to
rebuild a portfolio, one of them lossy: CSV import covered snapshots ONLY —
assets and transactions restored from JSON regardless — so it could never be
*the* answer, only a partial one that had to be explained every time it was
offered.

**Export answers something else entirely, and nothing retires it.** It hands
the user their own numbers in the one format every spreadsheet opens. That has
no dependency on where the data is stored.

What this costs: nothing in the tree. What it removes: `papaparse` (never
merged), `src/lib/csv-parse.ts`, `parseSnapshotCsv`/`diffSnapshotCsv`,
`repo.replaceSnapshots`, the dialog's CSV variant, and the ESLint core-zone rule
that existed solely to keep papaparse out of `src/core`. The JSON envelope is
now the sole restore path, which is also the only lossless one.

**Two things the export half brought that outlive the CSV question:**

1. `src/lib/download.ts` — save-picker parity. Where `showSaveFilePicker` exists
   an export opens the browser's Save-as dialog; everywhere else `<a download>`
   puts the file in Downloads. Same bytes, same suggested name, and **a
   cancelled picker is not an error** — it resolves `'cancelled'`, writes
   nothing and says nothing. The JSON backup button moved onto this path too.
2. The **one pinned exception** (D24 restated): the pre-import safety backup
   always passes `via: 'anchor'`. A modal Save-as dialog in front of a safety
   guarantee is a dialog the user can cancel, and that guarantee must not be
   cancellable. Verified in-browser with `showSaveFilePicker` present: the
   safety backup still took the anchor path.

The dialect stays a pinned contract: comma separators, dot decimals, no
thousands grouping, UTF-8 with BOM, CRLF including after the last record, RFC
4180 quoting. Snapshots export **wide**, and **an empty cell means pending,
never 0** (D5#1) — so a spreadsheet's own SUM and AVERAGE skip an unrecorded
day instead of averaging in a zero. Snapshot columns are named
`Asset name (id)`; the bracketed id disambiguates two funds sharing a name.

## D30 — The observation key: basis vocabulary, FX placement, instrument ref (2026-08-11)

Resolves PLAN-OPEN O2, O3 and the key half of O5. All three were Round 1 —
irreversible, because DSQL primary keys are immutable and a wrong key is a
DROP/CREATE, not a migration. Grounded in the live feed fetched 2026-08-11
(35 entries) rather than in the trimmed fixture.

**`basis` vocabulary is `buy | sell | nav | fair`.** Inzhur serves nine price
fields, and they are three bases × three currencies: `buy`/`sell`/`nav` each in
a bare, a `…UAH` and a `…USD` variant. The bare field equals the UAH field on
**all 35 entries** — it is a duplicate, not a basis. NBU contributes `fair`.
Nothing else in either source is price-shaped.

**Currency is NOT part of the basis, and the USD value is not stored per
observation.** The feed's USD figures are a serve-time conversion, proven in
D31, so a per-observation USD column would stamp every row with a rate whose
date has nothing to do with that row's `as_of`. **The provider's FX rate is one
number per payload and belongs on `price_capture`, not on
`price_observation`.** Stored there it stays fully recoverable and it is honest
about its scope.

**`instrument_ref` is `isin` for bonds and `slug` for funds — and the slug can
never be the key on its own.** Measured: **all 31 bonds carry `slug: "ovdp"`.**
The slug is a category, not an identifier. `isin` is unique across all 31 and is
permanent by ISO 6166, which is exactly the "permanently allocated, never
reused, never renamed" property the design needs and that no foreign key can
enforce on DSQL.

The feed's own `id` is **rejected** as the ref: it is a small integer (observed
range 5–46, 35 distinct). Small sequential integers are the classic reuse
hazard, it is provider-internal with no published stability guarantee, and
nothing about it is more durable than the ISIN it accompanies.

So: `instrument_ref = isin` where an ISIN exists, `slug` otherwise, and the
instrument type decides which. A fund that later gains an ISIN keeps its slug
ref — the rule is fixed at allocation time and never re-evaluated, because
re-evaluating it is the rename the design forbids.

## D31 — What one payload proves: fund basis, the FX channel, matured bonds (2026-08-11)

Resolves PLAN-OPEN O6, O7 and O8 — from the live feed plus a DCF inversion over
all 31 bonds, not from a judgment call.

**Fund value uses `sell`. `nav` is not universally published:** it is exactly
`0` for `ocean-plaza` and `zhytniy`, two of the four funds. A basis absent for
half the instruments cannot be the basis. `sell` is present for all four and is
the figure already verified against the owner's own dashboard
(6 164 × 11.1389 = 68 660.18 ₴). O6 is settled without spending the hedge —
`basis` stays in the key regardless, so a future change still costs nothing.

**The fund T-1 dedup rule is rejected permanently, not deferred.** The spec
deferred it because the FX-date channel rested on one observation and conflated
the FX conversion date with the NAV strike date. That conflation is now
**proven**, and proven inside a single payload:

- All four funds convert at **44.7579** = NBU's rate for **2026-08-10**.
- All 31 bonds convert at **44.8305** = NBU's rate for **2026-08-11**.
- But inverting the DCF dates seven of those bonds' UAH prices to **2026-08-05
  through 2026-08-10** — up to six days stale — and they *still* carry the
  2026-08-11 rate.

A price struck on 5 August cannot have been converted with 11 August's rate at
strike time. Therefore **the conversion happens at serve time over the whole
payload**, and the FX vintage says nothing about when any individual price was
struck. The channel is not weak evidence; it is not evidence. Do not revisit it
with more weeks of the same observation.

**Matured bonds are identified by `status`, not by a residual threshold.** The
spec anticipated "6 short-dated bonds that miss the DCF model". Measured, they
are **7 bonds with `status: 'completed'`** whose payment schedules lie entirely
in the past (maturities 2025-10-01 through 2026-06-24) while the feed still
serves a frozen last price (1 072.85–1 088.60). The DCF returns 0 for them
because no cash flows remain — the model is not wrong, it is undefined.
`status` answers this exactly, and D19 requires capturing it verbatim and never
filtering on it, so no threshold is needed and none is added.

**The DCF's real product is a date, and it works.** Seventeen active bonds
reproduce their quote to a residual of **0.0007–0.0046 ₴** at `as_of =
2026-08-11`. The seven stale ones reproduce theirs at an earlier date, so
inverting the model **measures how stale each price is** — the one diagnostic a
price alone can never give. Four of those land at 0.10–0.18 ₴ rather than
~0.003; the likeliest cause is the published yield being rounded to two
decimals, and that is a caveat on the residual, not on the date.

## D32 — Auth: Cognito Essentials, managed login, open registration (2026-08-11)

Resolves PLAN-OPEN O1 and O4.

**Registration is OPEN** — owner ruling, against the recommendation in the
question, which had proposed a closed single-user system. *(Superseded by D38:
sign-up now produces an application that a super-admin approves, with a toggle
to open it fully. The consequences below still hold — an application still
costs an MAU.)* Recorded as the
owner's call, with its consequences stated here rather than discovered later.

**Cost is not one of those consequences.** Cognito's free tier is **10,000 MAU
per month, per account, indefinitely** for direct or social sign-in on the Lite
or Essentials tiers — it does not expire with the 12-month AWS free tier. Open
registration is $0 until this project has ten thousand monthly users.

**Tier is Essentials** (the default for new pools, and inside the free tier).
It includes Managed Login and passwordless options; Lite has only the classic
hosted UI and no passkeys. **Plus has no free tier**, which matters below.

**Sign-in is email + password through Cognito's managed login.** *(Amended by D36: social and passkey were added, with the one-account-per-email rules that go with them.)* This one was
left unanswered and is therefore decided here, and open registration is what
makes it near-mandatory rather than merely convenient: a public sign-up path
needs email verification, password reset and throttling on all of them. Managed
login supplies each as configuration. Hand-writing them would mean writing the
security-sensitive half of an auth system to avoid a login screen that does not
match the app's design. Revisable — nothing in the token contract depends on it.

**Session: refresh token measured in years.** Cognito permits 60 minutes to 10
years (console: up to 3,560 days), default 30 days. "Same everywhere" is binding
and **Clerk was rejected specifically for pinning 7 days**, so the refresh token
is set long deliberately. Access and ID tokens stay at the 60-minute default.

**Authorizer: API Gateway HTTP API with the native JWT authorizer.** It
validates Cognito's tokens with no Lambda in the path — nothing to invoke, pay
for or debug. A Lambda authorizer is rejected: it would add an invocation and a
cold start to every request to replicate what the platform already does.

**The one real cost of open registration, stated plainly:** threat protection
(adaptive auth, compromised-credential detection) lives in the **Plus** tier,
which has **no free tier**, and AWS WAF is **$15/mo** and already on the
standing "no" list. So a public sign-up path is defended by Cognito's built-in
request quotas and email verification alone. That is adequate for a personal
project and would not be for a real product; if abuse appears, the honest
options are to close registration or to start paying, and there is no third one.

`GET /v1/prices/{YYYY}.ndjson` stays **public with no authorizer, ever** — the
authorizer governs the user API alone.

## D33 — There is no past-date prefill; value is derived (2026-08-11)

Resolves PLAN-OPEN O12, the largest open question in the project.

The tension was real: the archive can fill 174 past days, G5 makes the user's
press the sole write path, and 174 presses will never happen. **The question
dissolves rather than being traded off**, because the ledger model already
removed `Snapshot` as a stored entity. Portfolio value at any date is
`units(a, D) × price(a, D)`, computed at read time. Nothing is prefilled because
nothing is written.

The gap the archive cannot cover is the owner's own history: Inzhur capture
begins 2026-08-10 and the existing 174 snapshots run February–July 2026, which
the provider will never republish.

**They migrate into a per-user `user_price` overlay, left-joined at read time —
the same shape as `price_correction`.** Resolution:

```
value(a, D) = units(a, D) × coalesce(user_price(a, D), archive(a, D))
```

This keeps both principles that would otherwise collide. Prices stay a **global
single source of truth**, because the global archive stays provider-only; the
owner's hand-entered observations are **their account's data**, which is what
they always were. And G5 is untouched: the server never writes a price into
anyone's portfolio, because portfolio value is not a stored thing to write.

Consequence: the migration must carry the 174 snapshots into `user_price` rather
than discarding them. Losing them would delete five months of history that no
source can regenerate.

## D34 — The seed is rewritten to reconcile, not replaced (2026-08-11)

Resolves PLAN-OPEN O13. Owner ruling.

`src/lib/seed.ts` cannot survive the ledger model unchanged: its 18 transactions
carry no `withdrawal` rows and no separate `tax` rows, so the account sum will
not produce ₴7,75 — and under the new model the sum reconciles **by
construction**, with no exclusion rules and no pairing heuristics. That is
precisely why the old seed fails it.

Measured coupling: **97 `it()` blocks across 12 files**, out of 508 in the suite.

**The seed gains the missing rows** — withdrawals, and `tax` rows carrying
`settles_payout_id` — so it reconciles the same way real data does. Every
D5-pinned figure and every `navigation-map.md` checkpoint stays valid; only the
fixture beneath them changes. A purpose-built minimal fixture was rejected
because it would rewrite the checkpoints, and checkpoints that change with the
fixture stop being able to catch a regression.

The seed survives as a **test fixture only** — demo mode goes with the dataset
split (D16/G4) at the migration.

## D35 — Round 3 stays derived, and the small Round 4 items (2026-08-11)

Closes the remainder of PLAN-OPEN.

**O9 `provenance`, O10 volatility/drawdown/best-worst-day, and O11 the UI
treatment of carried and computed days stay open deliberately** and are not
defects. Each is a **derivation**, so each is revisable at zero migration cost,
and the governing rule is already pinned: `published | carried | computed |
frozen` are derived at read time, never stored, because storing a judgment in an
immutable column is the specific error the archive design exists to avoid. The
consumer rule is likewise pinned and not open: **levels carry forward, changes
never do** — a zero delta and an unknown delta must never render the same.

**O14 — the parse-control boundary.** Runtime settings: enable/disable a source,
re-run one date, run a backfill range. Code: parser version, field mappings, the
tolerant-parse rules. The line is whether a wrong value can break capture with
no deploy to blame it on — an operator toggling a source is recoverable, an
operator editing a field mapping is a silent data defect. Unchanged and not
configurable: a payload that fails to parse is **still stored**, and the row
records why.

**O15 — the cash-reconciliation warning retires with stored cash.** D13
compromised on `Snapshot.cash` as an observed balance plus a drift warning,
because the derived figure could not be trusted. The ledger model removes stored
cash entirely and `free_cash(D)` is a plain signed sum — which the owner's real
statement was shown to reconcile against, to ₴8.11. With one number instead of
two there is nothing left to compare, so the warning goes. **This supersedes
D13's cash half**; its day-count and metric-family rulings stand.

**O16 — CSV export survives the migration** as a scope note, not a question. It
reads through `repository.ts`, which becomes an HTTP client; exporting full
history then means fetching the cached yearly NDJSON the read contract already
defines. No decision required — listed so it is not rediscovered mid-migration.

## D36 — Three sign-in methods, one account per email (2026-08-11)

Amends D32, which specified email + password alone. The owner wants **password
+ social + passkey**, and raised the Cognito trap: one email can end up with a
separate account per method. Researched before deciding, because the fix is
partly a pool setting that **cannot be changed after the pool is created**.

*(D39 makes passkeys the primary factor, not merely an available one.)*

**The premise is right for social and wrong for passkey.** A passkey is not an
account — it is a WebAuthn credential registered onto an existing user
(`StartWebAuthnRegistration` requires an access token, so the user is already
signed in), and sign-in is `AuthFlow: USER_AUTH` with `PREFERRED_CHALLENGE:
WEB_AUTHN` against an existing `USERNAME`. Passkeys therefore add zero
duplication risk. **The duplication problem is exactly one pair: a local
(email + password) user versus a federated (Google) user.**

Two mechanisms, and both are required — neither covers the other's case.

**1. `usernameAttributes: ['email']` — uniqueness among LOCAL users.** AWS's own
comparison table is explicit: with username attributes you *cannot* assign the
same email to more than one user, and a duplicate sign-up fails rather than
succeeding quietly. **This is immutable after pool creation** — getting it wrong
means recreating the pool — which is why it is settled now rather than during
the build.

`aliasAttributes` is **rejected**. It permits several users to hold the same
email and resolves the conflict with "only the last user who has verified the
attribute can sign in with it". A rule under which verifying an email silently
takes sign-in away from another account is not a rule this project wants.

**2. A pre-sign-up Lambda trigger calling `AdminLinkProviderForUser` —
uniqueness ACROSS providers.** Nothing in the pool's configuration stops Google
from minting a second profile for an address that already has a local user;
only the trigger does, by linking the incoming federated identity to the
existing local user *before* Cognito creates the duplicate. Afterwards the
Google sign-in resolves to the same account, with the same data. Ceiling: **five
federated identities per user**, far beyond one provider.

**The security condition on linking is not optional.** AWS states it directly:
*"it is critical that it only be used with external IdPs and linked attributes
that you trust."* Concretely — **link only when the IdP asserts
`email_verified: true`, checked explicitly in the trigger, never assumed.**
Linking on an unverified address means anyone who can present an identity
claiming that address inherits the account. Google does assert the claim; the
trigger must still read it, because the day a second provider is added is the
day an assumption becomes a takeover.

Direction is also decided: **the local account is the destination, the
federated identity is the source.** A local user exists whether or not Google
does, and the account that owns the portfolio should not be the one that
disappears if an external provider is removed.

**Cost note:** AWS recommends linking as a cost measure — a federated user who
signs in through a linked local account is billed as a local user. It barely
applies here (Google counts as a *social* provider, already inside the 10,000
MAU free tier, unlike the 50 MAU SAML/OIDC tier), but it points the same way.

## D37 — Watching the 10,000 MAU free tier: what exists and what does not (2026-08-11)

The owner asked for an alarm as usage approaches the free-tier limit, plus a
chart. Researched first, and the first finding changes the design.

**There is no CloudWatch metric for MAU.** `AWS/Cognito` publishes activity
counts — `SignUpSuccesses`, `SignInSuccesses`, `TokenRefreshSuccesses` — and
none of them is MAU: one user signing in thirty times is one MAU and thirty
`SignInSuccesses`. AWS's own cost page routes this to the Billing console,
Service Quotas utilisation and CloudTrail queries, not to a metric. So an alarm
"at 8,500 MAU" cannot be built directly, and anything claiming to be one is
measuring something else.

Three instruments together, each honest about what it is:

**1. AWS Free Tier usage alerts — exact, automatic, already on.** They notify at
**85% of the free-tier limit per service**, are enabled by default for
individual accounts, and cover always-free offerings. Zero code, zero cost. The
one action needed: the alert goes to the **root account email**, so confirm that
address is monitored (Billing → Preferences → Alert preferences).

**2. An AWS Budgets usage budget at 100% of the free tier — exact, and the
second of two free budgets.** Budgets bills 60 budget-days/month free, roughly
two always-on budgets; the project already runs one $5 cost budget, so this one
is still free. A third would cost $0.02/day.

**3. `EstimatedNumberOfUsers` — the leading indicator, and the chart.** Both
instruments above are billing-side and therefore lag. The pool's total user
count is a **strict upper bound on MAU** — MAU can never exceed the number of
users that exist — so alarming on it fires early and never late, which is the
right direction for a cost guard. It is one `DescribeUserPool` call, and
critically it does **not** mark anyone active, unlike `AdminGetUser`, which AWS
warns contributes to MAU. Charting `SignUpSuccesses` beside it shows the shape
of the risk that open registration (D32) actually introduces: a signup spike.

**It rides the 01:00 capture, because "exactly one automation" is a pinned
owner ruling.** No second schedule is created. The capture Lambda emits the
count as a log line, a **metric filter** turns it into a metric — free, and the
same pattern already used for `unchangedDays` (D28), which matters because only
10 custom metrics are free.

This widens the capture role by exactly one action, `cognito-idp:DescribeUserPool`.
Stated plainly because the role's narrowness is load-bearing: that action reads
**pool configuration, not users**. No user attribute, no user list and no user
data becomes reachable, so the boundary that makes suggest-only a permission
rather than a convention is intact.

**Thresholds.** Alarm at **8,000 users** (80%) rather than 85%, so it precedes
the billing-side alert instead of arriving with it — a guard that fires at the
same moment as the bill is not a guard. `TreatMissingData: notBreaching` here,
the opposite of the capture-silence alarm: a missing user count means the
emitter stopped, which is what the existing liveness alarm already catches, and
duplicating it would only produce two alarms for one fault.

**None of this can be built before the user pool exists** (W7). It is specified
now because `usernameAttributes` in D36 is immutable at creation, and a pool
built without the monitor in mind is a pool that gets it retrofitted.

## D38 — Registration is an application, not an open door (2026-08-11)

Supersedes D32's "registration is OPEN". The owner's third position is better
than either of the two the original question offered: **sign-up always succeeds
and always produces an application**, a super-admin approves, rejects or
removes it from a users table, and a toggle can open registration fully — with
a warning. Two research findings shaped how it is built, and one of them
contradicts the obvious assumption.

*(Completed by D39: the application no longer creates a Cognito user at all, which is what finally protects the allowance the section below says approval does not.)*

### Approval does not protect the free tier

**A pending user is already a monthly active user.** Cognito's own list of
MAU-marking operations begins with *"sign-up or administrative creation of a
user"* — activity, not approval, is what counts, and the only listed exemption
is CSV import. So a hundred spam sign-ups that are never approved consume a
hundred MAUs.

Stated plainly because the sequence of these decisions invites the opposite
conclusion: **the approval gate is access control, not cost control.** It
protects data, not the 10,000 MAU allowance. What protects the allowance is
D37's monitor, which is now doing load-bearing work rather than sitting there
as a formality — and `SignUpSuccesses`, already on its dashboard, is precisely
the signal that would show this happening.

The alternative that *would* protect MAU is refusing sign-up in the pre-sign-up
trigger while registration is closed. It is **rejected**, because it makes the
application impossible to submit, which is the one thing this design exists to
allow. The cost is accepted knowingly, not overlooked.

### The enforcement point is the API, not the token

The intuitive place for the gate is a **pre-authentication trigger** that
refuses unapproved users. It is not sufficient, and AWS documents why: *"the
pre authentication Lambda function doesn't invoke when your user has an
existing session"* — it blocks new sessions only.

Combined with D32's refresh token measured in **years**, that means a user
approved today and rejected next month keeps working until their session ends,
which is to say approximately never. **Any check that happens at token-issue
time cannot revoke anything.** The same applies to `cognito:groups`: group
membership is stamped into the token when it is issued, so removing someone
from a super-admin group does not take effect until the token refreshes.

Therefore:

**Cognito holds identity. The application holds status. The API checks it on
every request.** The API Lambda already loads the caller's row to scope data by
`user_id`, so the check costs nothing extra and there is exactly one place
where "may this person act" is answered.

- `app_user(user_id, email, status, role, applied_at, decided_at, decided_by)`
  in DSQL. `status ∈ pending | active | rejected`, `role ∈ user | super_admin`.
- A **post-confirmation trigger** creates the row as `pending` — or as `active`
  when the open-registration toggle is on.
- The API returns a distinct, honest response for `pending` — not 401, which
  means "who are you", but a state the client can render as *"your application
  is awaiting review"*. A pending user genuinely is signed in; they simply may
  not act.
- `cognito:groups` is **not** the authorization source. The `role` column is.
  The claim may be read as a hint, never as the decision.
- `AdminDisableUser` is applied to **rejected** users as defence in depth — it
  stops tokens being issued at all — but it is a consequence of the status, not
  the record of it.

### Bootstrap, or the system cannot start

Everyone starts `pending` and only a super-admin can approve — so the first
super-admin cannot approve themselves into existence. The owner is created with
`AdminCreateUser` and their row is seeded `active` + `super_admin` in the same
migration that creates the table. Written down because a system that cannot be
bootstrapped is discovered at the worst possible moment.

### Deleting users, and the principle it collides with

The ledger model says nothing is ever deleted, which is why there are no
cascades and why `deleteAsset` was retired. A users table with a delete button
walks straight into that.

The two cases are not the same and are decided separately:

- **A `pending` or `rejected` user owns no portfolio data.** Deleting them is a
  row and a Cognito user, no cascade exists, and it is genuinely just cleanup.
  This ships.
- **An `active` user with transactions is a different operation entirely** —
  it is the cascade the data model forbids. **Not decided here and not
  implemented.** Rejecting or disabling an established account achieves every
  operational purpose without destroying a ledger. If real deletion is ever
  needed (a deletion request, say), it gets its own decision and its own
  design, because "delete the user" and "delete five years of financial history"
  should never be the same button.

### The toggle

One row in the settings table, read by the post-confirmation trigger. Its
warning must say the specific thing rather than a generic caution: **with it on,
anyone who signs up gets in immediately, and there is no threat protection
behind it** — Cognito's Plus tier has no free tier and WAF is $15/mo and on the
standing "no" list (D32). Off is the default.

## D39 — Applications never touch Cognito; onboarding is passkey-first; SES lands with W7 (2026-08-11)

Completes D38. Three decisions that together protect the MAU allowance and the
sign-up surface at the same time, which D38 alone did not.

### An application creates a database row, not a Cognito user

D38 established that approval is access control and not cost control, because
Cognito marks a user active at **sign-up**, not at approval. The fix is to move
sign-up out of the application step entirely:

```
POST /v1/applications  →  row in DSQL              ← no MAU spent
        ↓ super-admin approves
AdminCreateUser        →  Cognito user created     ← MAU spent, on a chosen user
```

A hundred spam applications now cost a hundred rows, not a hundred MAUs. The
thing D38 exists to allow — submitting an application at any time — is
untouched, because the application never needed Cognito in the first place.

**Approval is also the verification.** The invitation goes to the address on the
application and only its owner can complete sign-in, so no separate
verify-your-email step exists at application time.

### Four defences on the now-exposed endpoint, all free

- **API Gateway route throttling** on `POST /v1/applications`. Built in, free,
  and it is the thing WAF is usually bought for at $15/mo.
- **One application per email**, enforced by a unique index. A flood against one
  address becomes one row.
- **No email is sent when an application is submitted.** Not a cost measure — a
  safety one. An email on submission would let anyone type a stranger's address
  and have this domain deliver mail to it, which makes the service a relay for
  harassment. The applicant sees confirmation in the UI; mail is sent only on
  approval, to an address that was approved.
- **The pre-sign-up trigger rejects unknown federated sign-ins.** A Google user
  is created on first sign-in through the IdP, which is a second route to
  `SignUp`, and it is closed by the same rule: no approved application, no
  account. When the open-registration toggle is on, the trigger auto-approves.

**One inference, flagged rather than asserted:** a sign-up that the pre-sign-up
trigger rejects should consume no MAU, because no user is created and MAU counts
users. That is not documented. Verify with one test sign-up once the pool
exists.

**Consequence for D37's monitor, and it improves it.** `SignUpSuccesses` now
counts *approvals* — an exact count of MAUs added, no longer a mixed signal. The
abuse indicator becomes applications-per-day from the app's own metric filter.
Two different phenomena — being found, and being attacked — stop sharing a graph.

### Onboarding is passkey-first, and steady state sends no email

Owner ruling, chosen over email-OTP sign-in.

```
approval → invitation with a temporary password
         → user sets their own password (NEW_PASSWORD_REQUIRED)
         → user registers a passkey immediately
         → every later sign-in: passkey, no email
```

The password the user sets is the recovery path, so **no email OTP factor is
enabled** and none is needed. Limits leave room: 20 passkeys per user, 5 linked
federated identities.

Email volume across an account's entire life is **two messages** — the
invitation, and a password reset if one is ever needed.

Why not email OTP, which is the nicer flow: it makes email the critical path for
*every new session*, and email has a hard ceiling described below. A passkey has
no ceiling and no delivery dependency. Note also that a passkey with user
verification can satisfy an MFA requirement (`FactorConfiguration:
MULTI_FACTOR_WITH_USER_VERIFICATION`), so passkey-first does not trade away MFA.

OTP stays available later at zero migration cost — it is a pool setting, not a
schema decision. One thing to avoid pre-emptively closing: **do not set MFA to
required**, because OTP flows are incompatible with required MFA.

### SES replaces Cognito's default email, and lands with W7

Owner ruling on timing.

**The default is unusable for this design, for two reasons that are not about
volume.** Cognito's built-in email allows **50 messages per day per AWS
account** — not per user pool, **not adjustable**, resetting at 09:00 UTC. And
addresses that hard-bounce go onto an **AWS-managed suppression list that cannot
be cleared while the pool uses the default configuration**; an address can stay
there indefinitely. A registration system that mails strangers will collect
typo'd addresses, and a permanently suppressed address is a permanently
unreachable applicant with no lever to fix it. SES gives an account-level
suppression list that is actually manageable.

Passkey-first keeps volume far under 50/day, so **the ceiling is not the reason
— the suppression list is.** Had OTP been chosen, the ceiling would have been
the reason too, and an attacker could have exhausted a whole day of sign-ins for
everyone.

**Cost is negligible and would have been negligible either way:** $0.10 per
1,000 messages. Even the OTP variant, at 10,000 users signing in three times
each, is a one-off $3 — because D32's refresh token measured in years makes
sign-ins rare. Do not assume the 2,000/day SES free tier: it is tied to sending
from EC2 or Elastic Beanstalk, which Cognito-via-SES is not, and this account
post-dates the free-tier restructuring that already ruled out RDS's legacy
allowance.

**The real cost is lead time, not money.** New SES accounts sit in a sandbox:
**200 messages per 24 hours, 1 per second, and delivery only to verified
addresses.** Until production access is granted, approving a stranger cannot
work at all. Production access is a free request with an unpredictable
turnaround, so it is raised early rather than discovered during the cutover.
Granted accounts default to 50,000 messages/day.

**Unresolved and it blocks SES:** *(resolved 2026-08-11 by D40 — `quirenote.com`.)* the sender identity. SES requires a verified
domain or address; the project has only `dev.d17m4jf400my6.amplifyapp.com`,
which cannot be verified for mail, and a Route 53 zone is $0.50/mo and on the
standing "no" list. Verifying a personal address works but gives poor
deliverability and DMARC alignment for a From address. Filed as PLAN-OPEN O17
because it involves spending money, which is the owner's call.

## D40 — The domain is `quirenote.com` (2026-08-11)

Resolves PLAN-OPEN O17 and unblocks `PLAN-NOW.md` A11, which unblocks the SES
half of W7.

**Chosen: `quirenote.com`.** A quire is a gathering of leaves bound into a book;
a note is both a record and a banknote. Both halves of what the app does, in one
word, and the compound reads on first sight because `note` is one of the most
familiar word-openings in English.

Selected from **116 candidates checked against registry RDAP across four
sweeps** (`.com`, `.org`, `.app`), then filtered a second time for phonetic
collisions. Two findings from that process are worth keeping, because they will
recur the next time anything here needs naming:

**Quality and `.com` availability are close to mutually exclusive.** Every
precise term was gone in all three zones — `daycount`, `daymark`, `tickmark`,
`dayclose`, `tallymark`, and twenty single words including `alidade`,
`astrolabe`, `gnomon`, `computus` and `registrum`. What survived was compound,
transliterated, or built on an unexploited prefix.

**The collision audit killed better-sounding names than the availability check
did.** `dayquire` was the front-runner until the owner heard **DayQuil** in it —
a Procter & Gamble pharma brand, plus Daiquiri behind it. Re-auditing the whole
list then removed `markquire` (**Macquarie**, an investment bank — same sector,
worse), `duquire` (**Duquesne Capital**), and `notchbook` (one letter from
`notebook`). The pattern: **`-quire` as an ending is structurally mined**, and
half the neighbours are financial. `quirenote` survives precisely because
`quire` sits at the front, where those collisions do not form.

**`notequire` was the owner's leading choice and was set aside** on a reading
risk: spoken aloud it is close to *"not acquire"*, which is an unfortunate thing
for an investment tracker to be called. `quirenote` is the same two words
reversed — the meaning is kept, the negation cannot form.

**DNS does not go to Route 53.** A hosted zone is $0.50/mo and on the standing
"no" list, and nothing needs it: SES wants DNS records, which any registrar's
free DNS serves, and Amplify supports third-party DNS with its own free
certificate. This is what keeps the domain from adding a standing AWS charge —
the whole cost is the registration fee.

**Records required for SES**, all in `eu-north-1` because identity and sandbox
status are per-Region: three CNAMEs for Easy DKIM, one MX plus one SPF TXT for a
custom MAIL FROM subdomain (without which DMARC passes on DKIM alone), and a
`_dmarc` TXT starting at `p=none` with a `rua` address.

**Not decided here:** whether the application is renamed from Kubushka to match.
Filed as PLAN-OPEN O18 — the user-facing half is cheap and the infrastructure
half is not, and conflating them is how a rename becomes an outage.

## D41 — The product is Quirenote; the machines stay Kubushka (2026-08-11)

Resolves PLAN-OPEN O18. Owner ruling: **rename what a person reads, leave the
infrastructure alone.** *(Infrastructure half superseded by D42 the same day: the
archive turned out to be two days old, so the rename goes all the way.)* The line is not cosmetic-vs-important — it is whether an
identifier is *addressed* by something.

**Renamed** — page `<title>`, the sidebar wordmark, every downloaded file name
(`quirenote-backup-<date>.json`, `quirenote-snapshots-<date>.csv`,
`quirenote-before-import-<date>.json`), the import copy that names the product,
and the headings of README, CLAUDE.md, DEPLOYMENT, BUILD-PLAN, NEXT-PHASE-PLAN
and this log. Verified in the browser: title, wordmark and a real CSV download
all read Quirenote, and no occurrence of the old name renders anywhere.

Download file names are safely renameable because **the importer validates the
envelope marker inside the file, never the file name** — so every backup
exported under the old name still imports.

**Not renamed, and each for a reason that would cost something real:**

| Identifier | Why it stays |
|---|---|
| Stack `kubushka-backend` | CloudFormation cannot rename a stack. Recreating it would delete the old one, and the DSQL cluster is `Retain` **plus** deletion-protected — so the archive would survive as an orphan: alive, holding the only copy of prices nobody can republish, managed by no stack. A cosmetic rename is not worth entering that state. |
| IAM roles `kubushka-github-deploy`, `kubushka-backend-cfn-exec` | Console-created, referenced by both workflows. |
| `BACKUP_FORMAT = 'kubushka-backup'` | A pinned contract. Renaming it makes every backup file ever exported unreadable. |
| localStorage `kubushka-settings`, `kubushka-draft` | The key **is** the data. A rename silently discards the user's settings and draft. |
| Dexie `kubushka` / `kubushka-live`, lock `kubushka-db`, channel `kubushka-sync` | Retiring wholesale when B3 replaces persistence (D2 superseded). Migrating a database that is about to be deleted is work with a negative return. |
| `class KubushkaDB` | Internal type name, addressed by nothing outside `lib/db.ts`, which retires with the rest. |
| npm `"name": "kubushka-invest-tracker"` | Nobody sees it; the sidebar badge reads `version`, not `name`. |

**One deliberate inconsistency is now on screen.** The rejection sentence reads
*"This isn't a Quirenote backup — it has no `kubushka-backup` marker."* The
product and the marker genuinely differ, and the message states both truthfully
rather than hiding the mismatch: a user checking their file will find
`kubushka-backup` inside it, and a message that claimed otherwise would send
them looking for something that is not there. The comment at that call site
records why, so a later reader does not "fix" it.

**Found while sweeping, unrelated to the rename:** `navigation-map.md`
checkpoint 20 still quoted the pre-D29 import copy offering *"a .json backup or
a .csv table"*. CSV import was cancelled; the map now matches the shipped
string.

## D42 — The rename goes all the way, and now is when it is cheap (2026-08-11)

Supersedes D41's infrastructure half. D41 kept every addressed identifier on the
grounds that renaming the stack risked orphaning the archive. **The reasoning was
right in form and wrong in scale**, and two facts from the owner settle it.

**What deleting the cluster actually costs is two or three days.** D41 weighed
the archive as if it were mature. Capture began 2026-08-10. The NBU half —
backfilled to 2016-01-04 — regenerates completely from a public archive, and its
backfill is verified idempotent (`captured: 0, complete: true` on re-run). Only
the Inzhur days are unrecoverable, and there are two of them.

**The owner keeps the originating spreadsheet**, so those prices exist outside
the archive anyway. The gap is recorded as acceptable by ruling, not assumed.

**`kubushka-live` is empty**, which removes the other expensive item: renaming
the Dexie databases needs no IndexedDB migration. The demo DB reseeds itself and
the live DB has nothing to carry.

So the expensive list from D41 collapses to nothing that is still expensive, and
**every day of delay adds one more unrecoverable day.** This is the cheapest the
rename will ever be.

**Four items D41 misclassified**, corrected here: the Web Lock `kubushka-db` and
the BroadcastChannel `kubushka-sync` persist **nothing** — they are runtime
strings, and renaming them is free. `class KubushkaDB`, the npm `name` and the
capture `USER_AGENT` likewise. `BACKUP_FORMAT` is a one-line change.

*(Amended during E1, on the owner's correction: dual-marker acceptance was
written and then removed. It was justified as "a downloaded backup must stay
readable" — but there is one user and no real data, so it was flexibility
nobody asked for, which CLAUDE.md rule 2 forbids. The marker is simply
renamed; a pre-rename file is now rejected, and that is correct because no
such file matters.)* Only the localStorage keys need real care, and the
settings store already has the `migrate` hook (G3) that does it.

**The order is deploy-new-then-delete-old, never the reverse.** The new stack
comes up beside the old one and is verified working before anything is torn
down, so there is no window without a backend and rollback at every step is
"keep the old stack". Briefly there are two clusters and two schedules; both
write, last-write-wins on the per-date key, and at this scale the duplicate cost
is not measurable. That is a far better trade than a gap with no way back.

**Two clocks restart, and both slips are small.** The frozen-feed detector's
streak history is per-cluster, so `PLAN-WAITING.md` W1 moves out by the two days
that had accumulated. W3's three-week Inzhur observation window restarts from
the new first capture, so W3/W4 — and therefore B3 — move by the same two days.
Stated because a restarted evidence clock is exactly the kind of thing that gets
noticed in September and blamed on something else.

**Not chosen: CloudFormation resource import or stack refactoring**, which could
move the cluster between stacks with zero loss. Both exist, but whether
`AWS::DSQL::Cluster` supports either is unverified, and chasing it buys back two
days the owner has already written off. If the archive were a year old the
calculus would invert — and that is precisely the argument for doing this now.

Steps, ordering and verification points are `PLAN-NOW.md` Section E.

## D43 — Backfill fails on every historical date, and it is not the layout (2026-08-11)

> **Corrected the same day.** The original diagnosis below — that the parser
> could not read older file layouts — was **wrong**, and the correction is at
> the end of this entry. The layout observation is real but was a coincidence,
> not the cause. Kept in full rather than rewritten, because the way a plausible
> wrong answer survived four ruled-out alternatives is the useful part.

## D43 (original, superseded) — The NBU parser only reads the current file layout

Found during E3, by checking a number instead of trusting a word. The backfill
on the new cluster reported `captured: 200, published: 0` for round after round.
`captured` counts rows written; `published` counts fetches that actually
produced a usable file. Zero published across 1,200 business days is not a
plausible calendar.

**The NBU file layout has changed at least four times:**

| Date sampled | Fields |
|---|---|
| 2016-01-05 | **8** |
| 2018-06-12 | **16** |
| 2021-03-15 | **17** |
| 2022-06-10 → today | **18** |

`parseNbu` was written against the 18-field layout. Everything before roughly
2022 fails to parse, so `entry_count`, `skipped_refs` and `quotes_sha256` are
null on those rows and `ok` is false.

**Ruled out before concluding**, because each would have implied a different
fix: the URL (identical shape, 200 from a desktop for every failing date), the
User-Agent (unchanged behaviour), geo or IP blocking (the same Lambda succeeds
on 2026-08-06 and 2026-08-07), rate limiting (one request per invocation still
fails), and timeouts (40 s for 200 dates — 200 ms each, far too fast to be a
timeout).

**The raw payloads are stored anyway, and that is the whole point.** The write
path stores `payload_gzip` regardless of parse outcome — the design says so in
as many words: *"a payload we cannot parse today is exactly what a future parser
fix needs to read."* So the archive holds the bytes for every date it fetched;
only the derived metadata is missing, and metadata is regenerable by definition.
This is the correctability rule working, not failing.

**This is pre-existing, not caused by the rename.** The parser has not changed,
so the old cluster carries the same gap. The new cluster therefore reaches the
same state as the old one, which is what E3 needed to be true — the move
degrades nothing.

**It does mean an earlier claim was weaker than it sounded.** "Backfill verified
complete — `captured: 0, complete: true` on re-run" proves only that a **row
exists per date**, never that the row parsed. The completeness check is
`SELECT DISTINCT as_of … WHERE source = $1`, which cannot distinguish an
archived file from an archived failure. Worth stating plainly: **a re-run will
not repair these rows**, because the dates now count as done.

**Two pieces of work follow, both filed in `PLAN-NOW.md`:**

1. **Teach `parseNbu` the historical layouts** — 8, 16 and 17 fields alongside
   18. Dispatch on the header row, which every generation carries, rather than
   on the date; a date-based rule would encode a boundary nobody has verified
   and would break again at the next change.
2. **Reprocess stored payloads** rather than re-fetching. The bytes are already
   held, NBU is spared 3,900 requests, and it makes the archive's core promise
   true in practice rather than only on paper.

### The actual cause

`parseNbu` reads fields 0–4 only — `calc_date`, `cpcode`, `ccy`, `fair_value`,
`ytm` — and **those five are identical in every generation of the file**. The
column count changed from 8 to 16 to 17 to 18, but never in a way that moves
them. The 2020 file parses fine: 188 data rows, correct digest.

What fails is this, in the handler:

```js
const TRACKED_ISINS = ['UA4000238976', 'UA4000236475'];
if (parsed.missing.length > 0) error = `tracked ISIN absent: ${skipped}`;
```

**Both bonds were issued in 2025–2026.** A fair-value file from 2020 cannot
contain them, so every historical date sets an error, `ok` goes false, and
`published` counts zero. The check is right for a daily capture — an instrument
vanishing from today's file really does mean it matured, was renamed, or the
file changed shape — and wrong for a backfill, where absence is simply the
calendar.

**So the damage is much smaller than the original entry claimed.** `entry_count`
and `quotes_sha256` were computed and stored correctly on every one of those
rows; the data is there. Only `ok` and `error` are wrong, plus `unchangedDays`
was skipped because it is gated on `error === null` — which for historical
dates is meaningless anyway.

**How the wrong answer survived.** Five alternatives were ruled out with real
evidence — URL, User-Agent, geo blocking, rate limiting, timeouts — and the
layout difference was genuinely visible in the files. Elimination plus a visible
anomaly felt like proof. It was not: nobody checked whether the parser actually
touched the columns that differed. **Ruling out four things does not make the
fifth true**, and a diagnosis is not finished until the mechanism is traced, not
merely correlated.

**The fix is small.** The tracked-ISIN check belongs to the daily capture, not
to backfill — pass it as an option rather than applying it unconditionally.
Long term it belongs to `listed_from` / `retired_at` on `instrument`, which the
data model already specifies for exactly this reason: telling "missing" apart
from "did not exist yet".

**And a defect in the completeness check itself**, which is what let this hide:
it should count a date as done when a row exists **and parsed**, not merely when
a row exists. Left as-is for now — changing it while a backfill is mid-flight
would re-fetch everything — but recorded so the next backfill does not inherit
the same blind spot.

## D44 — The alerting was silently dead, and every indicator said it was fine (2026-08-11)

Found while verifying the renamed stack. Three notifications were published to
the new topic — a real `SilenceAlarm` firing, a hand-written test, and a forced
`SetAlarmState` — and **none arrived**. The owner then found the explanation in
their inbox: *"Your subscription to the topic below has been deactivated."*

**SNS had deleted the subscription.** `ListSubscriptionsByTopic` returns the
literal string `Deleted` as the `SubscriptionArn`, and the topic reports
`SubscriptionsConfirmed: 0`. The likely chain: the confirmation email landed in
spam, a spam complaint went back to AWS through the feedback loop, and SNS
deactivates on complaint. It is the same spam folder that swallowed the previous
topic's confirmation email in the earlier deployment.

**Everything that should have caught this read as healthy:**

- `NumberOfNotificationsFailed: 0` — which does not mean "delivered", it means
  **nothing was even attempted**. There is no endpoint to fail against.
- `NumberOfNotificationsFilteredOut: 0`.
- The alarm's own history: `Successfully executed action … AlertTopic`.
  CloudWatch did its job perfectly and handed off to a topic with no listeners.
- All five alarms sitting in `OK`.

**And the check I wrote to verify it was itself wrong.** It classified a
subscription as confirmed whenever the ARN was not the literal
`PendingConfirmation` — so `Deleted` was reported as *confirmed*. That produced
a false all-clear in the exact place the failure lived. A verification that can
only detect the failure mode it anticipated is not a verification.

**Why this matters more than one lost subscription.** The entire archive design
rests on `SilenceAlarm` with `TreatMissingData: breaching` — the alarm that
answers *"did the capture stop running?"*. A silence alarm that cannot deliver
is worse than no alarm at all: it converts an unmonitored system into one
everybody believes is monitored. The capture could have stopped for weeks with
every dashboard green.

**The fix, and it follows the principle already used for `unchangedDays` (D28).**
That metric is emitted on every run, healthy or not, because *"a metric that
exists only on failure cannot distinguish healthy from the check stopped
running."* The same reasoning applies one level up: the delivery channel needs
its own liveness signal, and it cannot be delivered through the channel it is
checking.

- The 01:00 capture reads `GetTopicAttributes.SubscriptionsConfirmed` and logs
  it, as it already logs `unchangedDays`. A metric filter turns it into a
  metric; an alarm on `< 1` catches a dead channel.
- That alarm still notifies through the same dead topic, which is the
  chicken-and-egg. It is not solved by cleverness — it is solved by the value
  being **visible without email**: on the dashboard, and in the run journal the
  super-admin surface (W8) will read.
- Cost: one more `cognito`-style read in the existing run, no new schedule
  (the "exactly one automation" ruling holds).

**Operational, not technical, and it caused this twice now:** the confirmation
email must be moved out of spam *before* being clicked, and
`no-reply@sns.amazonaws.com` needs a never-send-to-spam filter. Marking any SNS
mail as spam deactivates the subscription, silently, forever.

**Update, same day — the endpoint is suppressed, not the pair.** The chosen fix
was a fresh topic ARN (`AlertTopic` → `CaptureAlertTopic`, commit `35b24d6`),
on the theory that SNS keyed the suppression to endpoint+topic. **It did not
work**: the new topic's subscription showed `Deleted` within seconds of
creation, exactly as the previous one had. So the suppression follows the
**address**, and the surviving subscription on the old topic survives only
because it was confirmed *before* the complaint — not because that topic is
special.

The test was cheap and it disproved the hypothesis, which is the point of
running it. What it leaves is one untested variable: a different address.
There is no public API to clear an SNS email suppression, so the address
cannot simply be un-blocked.

The topic rename stands on its own merits regardless — `CaptureAlertTopic`
says what it alerts about, and the old ARN was going away with the old stack.

**Answered by D45:** email is abandoned for the Console Mobile App. Original
wording kept below.

**Open question deliberately not answered here:** whether email is the right
channel at all. It has now failed twice for the same reason, and its failure
mode is invisible. Recorded rather than decided — the fix above makes the
failure *detectable*, which is the part that cannot wait.

## D45 — Alerts go to the Console Mobile App, not to email (2026-08-11)

Closes the question D44 left open. Owner ruling, taken after SNS email failed
three times in a row with the same signature.

**What email actually did.** Confirmation arrived, the owner confirmed it, and a
deactivation notice followed **within seconds** — three separate subscriptions,
across two different topic ARNs. No spam complaint had time to happen. The
best explanation left is that SNS's unsubscribe link is a bare GET with no
confirmation step, so any link-prefetching in the mail path — a scanner, a
security gateway, a one-click-unsubscribe feature — silently kills the
subscription. Recorded as the likeliest mechanism rather than a proven one; what
is proven is that three attempts produced three identical outcomes.

**A hypothesis was tested and disproved on the way.** A fresh topic ARN
(`AlertTopic` → `CaptureAlertTopic`) was deployed on the theory that suppression
was keyed to endpoint+topic. The new topic's subscription died just as fast, so
the pair theory was wrong. The rename stands on its own — the name says what it
alerts about — but it did not fix anything.

**The chosen channel takes a completely different path**, which is the point:

```
CloudWatch alarm → EventBridge → AWS User Notifications → Console Mobile App
```

SNS is not in it. Spam folders, complaint feedback loops, unsubscribe links and
link scanners are not in it either — the whole failure class disappears rather
than being worked around.

**Configuration**, all in `us-east-1` because that is where the account's
notification hub lives (the API refuses the call in `eu-north-1` and says so):

- Notification configuration `quirenote-backend-alarms`, aggregation `NONE` —
  alarms should not be batched.
- Event rule: source `aws.cloudwatch`, type `CloudWatch Alarm State Change`,
  region `eu-north-1`.
- Channel: the Console Mobile App device, associated through the console. **The
  `consoleapp` service is not exposed by the AWS CLI or the MCP tooling**, so
  the device cannot be listed or associated programmatically — that step is
  console-only, and worth knowing before someone tries to script it.

**Verified end to end, in both directions.** A forced `SetAlarmState` to ALARM
delivered a push; the return to OK delivered a second one. Both directions
matter: an alarm channel that only reports failure leaves every incident open
until someone checks by hand.

**Consequences to carry into A13 and E4:**

- The SNS `Subscription` block comes out of `template.yaml`. Left in, every
  deploy mints another subscription that dies on arrival — noise that looks
  like a configured channel.
- `CaptureAlertTopic` itself stays. It costs nothing, the alarms already point
  at it, and a second channel may want it later. It simply has no subscribers.
- A13's liveness signal changes target: the thing worth checking is no longer
  `SubscriptionsConfirmed` on a topic nobody listens to, but that the
  notification configuration is `ACTIVE` and has at least one channel. Same
  principle, different query.

## D46 — E3 is done: what the stack move actually cost and found (2026-08-11)

The rename is complete on the backend. One stack, one cluster, one schedule.
Recorded because almost nothing that mattered on the day was in the plan.

**Final inventory, verified rather than assumed:**

| | |
|---|---|
| Stack | `quirenote-backend` — the only one |
| Cluster | `<DSQL_CLUSTER_ID>`, ACTIVE, deletion-protected — the only one |
| Schedule | `cron(0 1 * * ? *)` `Europe/Kyiv`, ENABLED — the only one |
| Alarms | five, all OK |
| Roles | no `kubushka-*` role remains |
| Buckets | `quirenote-sam-artifacts-<AWS_ACCOUNT_ID>` only |
| NBU archive | 2016-01-04 → 2026-08-10, a non-forced re-run reports `captured: 0, complete: true` |

**The deploy-new-then-delete-old order earned itself.** The new stack ran beside
the old for roughly an hour while it was verified, the alert channel was
rebuilt, and two code defects were found and fixed. Every one of those would
have been an incident under a delete-first order. Nothing was ever without a
working backend.

**Three things were found that nobody was looking for**, and all three predate
the move:

1. **Two orphaned DSQL clusters** from the failed deploys of 2026-08-10.
   `DeletionPolicy: Retain` keeps a cluster when a stack CREATE rolls back, so
   each failed attempt left one behind, deletion-protected and owned by nothing.
   This is the exact hazard D41 cited as the reason *not* to touch the stack —
   it had already happened twice, unnoticed. The argument was sound and the
   premise was stale.
2. **The alerting was dead and every indicator said healthy** (D44, D45). Now on
   Console Mobile App push, verified in both directions.
3. **The tracked-ISIN check failed every historical date** (D43, as corrected).
   Fixed, and the whole archive re-captured.

**What the move cost, measured:** Inzhur `as_of` 2026-08-09 and 2026-08-10 —
two days, unrecoverable, accepted by ruling (D42) and covered by the owner's
spreadsheet. The NBU half regenerated in full. Nothing else.

**Two clocks restarted**, as D42 predicted: the frozen-feed streak history is
per-cluster and starts again, and the three-week Inzhur observation window
(`PLAN-WAITING.md` W3/W4, and therefore B3) restarts from 2026-08-11 rather
than 2026-08-10 — a one-day slip, because that is all that had accumulated.

**One thing worth carrying forward.** The email channel died with the old stack:
that subscription was the last living one, and it went with the topic. Push is
now the only channel and it has no fallback, which turns A13 from a tidy idea
into the thing that stops a repeat of D44.

**And a process note, because it caused real damage.** A backfill was launched
as a background task and its result was never read. It ran to completion under
the defective tracked-ISIN logic and filled the whole range with `ok: false` —
which a re-run could not repair, since the completeness check asks only whether
a row exists. Recovering it needed a new `force` flag, a deploy, and ~2,600
re-fetches. **Starting a job is not the same as finishing it**, and a background
task nobody reads is indistinguishable from one that failed.

## D47 — The alert channel measures itself, and SNS is gone (2026-08-11)

Implements A13, and removes a resource that turned out to be doing nothing.

**The capture now emits `alertChannels` on every scheduled run**, healthy or
not, the same way `unchangedDays` is emitted unconditionally — a signal that
appears only on failure cannot tell "fine" from "the check stopped running".
Verified in production:

```json
{"metric":"alertChannels","configuration":"quirenote-backend-alarms","status":"ACTIVE","value":1}
```

A metric filter turns it into `Quirenote/AlertChannels`, and `AlertChannelAlarm`
fires below one. **That alarm notifies through the channel it measures**, which
is circular on purpose: it is the backup. The primary is that the number is
readable with no delivery at all — in the log, on a dashboard, and in the run
journal. The fix for the D44 failure is not a cleverer alarm, it is a value
someone can look at.

**Three details that would each have cost an hour at 01:00:** the notifications
API answers only in `us-east-1` and refuses elsewhere by name; the configuration
is matched by NAME because an ARN carries the account id and this repository is
public; and the check never throws — a capture must not fail because a
monitoring read did — while a read error is logged distinctly rather than
reported as zero, since "could not tell" is not "no channels".

### The SNS topic is deleted, and the deploy failure is why

Removing just the `Subscription` block failed outright:

```
Invalid parameter: SubscriptionArn Reason: An ARN must have at least 6 elements, not 1
```

CloudFormation removes a subscription by calling `Unsubscribe` with the ARN it
stored, and SNS had already replaced that with the literal string `Deleted`.
**A subscription SNS has deactivated cannot be removed through CloudFormation at
all** — the only way out is deleting the topic.

That forced the question of whether to keep the topic, and the honest answer was
no. It was retained on "a second channel may want it later", which is exactly
the speculative value CLAUDE.md rule 2 forbids, and the evidence against it was
already in hand: **the push that verified the channel arrived while the SNS
subscription was dead**, so it can only have travelled EventBridge → AWS User
Notifications → Console Mobile App. SNS was never on the path.

The load-bearing fact: **CloudWatch publishes alarm state changes to EventBridge
for every alarm, independently of `AlarmActions`.** An alarm with no action
still alerts. Confirmed in production — six alarms, zero SNS topics, and a
capture that runs clean.

Removed with it: the `AlertEmail` parameter, which also took the owner's address
out of a public repository once nothing consumed it, and the `Kubushka` metric
namespace, renamed while its history was one day old and cheap to abandon.

**Net:** one delivery path instead of one working path plus one decorative one.

## D48 — The payload split is not needed; the missing index was (2026-08-11)

A2 asked for a measurement before a rewrite, and the measurement cancelled half
the phase and sharpened the other half.

**Measured on 6,628 rows holding 31.9 MiB of gzipped payloads.**

### The separate payload table is NOT needed

The data model rules that raw payloads live in their own table because DSQL
primary keys are index-organized and carry every column, so a wide row inflates
every range scan. The plan says otherwise:

```
-> Storage Scan on price_capture
    Projections: requested_at, as_of, quotes_sha256
```

**DSQL projects only the columns the query asks for.** `payload_gzip` is never
read. The rule was a correct statement about *storage* applied to the wrong
layer — an index-organized key does carry every column on disk, but a scan does
not read the whole disk. That difference is visible only in a query plan, which
is exactly why A2 began with `EXPLAIN ANALYZE` rather than a refactor.

Following the spec on faith would have meant rewriting 31.9 MiB of live archive,
under DSQL's one-DDL-per-transaction and 3,000-rows-per-transaction rules, for
no gain.

### The missing index was worse than assumed

Both operational queries were doing a **full scan of 6,628 rows to return 3**,
with `Rows Removed by Filter: 6625`. The existing `(as_of, requested_at)` index
could not help on principle: it leads with `as_of` while both queries filter on
`source`, and an index is only usable from its leading column.

`price_capture_source_as_of (source, as_of, requested_at)` — one index for both,
carrying `requested_at` so the streak query's `ORDER BY` is served too, and no
`DESC` because DSQL rejects a sort direction in index keys.

| | before | after |
|---|---|---|
| `unchangedStreak` | 735 ms | **2.26 ms** |
| `backfillCompleteness` | 742 ms | **32.8 ms** |

`Rows Removed by Filter` went from 6,625 to **0**, and the completeness check
became an **Index Only Scan** — it no longer touches the table at all.

**The ~730 ms was the cost A2 was worried about all along.** The phase was right
that something was expensive and wrong about what.

### Two things worth keeping

**`CREATE INDEX ASYNC` builds after the deploy reports success.** The first
measurement after deploying still showed the old plan at 735 ms; the second, 25
seconds later, showed 2.26 ms. Measuring once would have produced the confident
and wrong conclusion that the index did nothing.

**The old `(as_of, requested_at)` index is now dead weight** — no query leads
with `as_of`. It predates this change so it is not removed here, but it should
go when something else touches that DDL.

## D49 — The DSQL durability gate passes, and the archive had no backup at all (2026-08-11)

**Decision:** the price archive stays in Aurora DSQL. The S3 + CloudFront
fallback that `2026-08-04-cloud-stack-and-cost.md` held in reserve is **not**
taken. A daily AWS Backup plan now protects the cluster, and it lives outside
the stack it protects.

The gate was *"verify DSQL backup/PITR; if either disappoints, price history
moves to S3 + CloudFront."* It was answered by taking a backup and restoring it
to a throwaway cluster, not by reading documentation — the whole archive exists
because a missed day is permanently unrecoverable, so a backup nobody has
restored is worth exactly nothing.

### What the restore proved

Restored cluster against production, per source:

| | production 19:36 | restored | δ |
|---|---|---|---|
| rows | 6 630 | 6 628 | −2 |
| `inzhur` | 4 / 51 672 B | 3 / 38 759 B | −1 / −12 913 B |
| `nbu_fv` | 6 626 / 33 436 259 B | 6 625 / 33 431 602 B | −1 / −4 657 B |

The −2 is fully accounted for and is itself the interesting result. A capture
ran at ~19:35, **after** the backup's 19:32:06 snapshot point, appending one row
per source. The byte deltas confirm it rather than merely allowing it — 12 913 B
against a mean `inzhur` row of 12 920 B, 4 657 B against a mean `nbu_fv` row of
5 046 B. So the recovery point is a consistent point-in-time image, not an
approximate copy taken while writes were in flight.

Measured: backup 3 min 48 s, restore 2 min 19 s, RTO under ~10 minutes.

### The finding that mattered more than the gate

**The archive was not being backed up at all, and nothing said so.** Zero
vaults, zero plans, zero jobs — AWS Backup had never been used in the account.
Deletion protection was on, which protects against a `DeleteCluster` call and
against nothing else.

This is the same failure shape as D44 the same day: a green-looking system whose
green came from nothing having been attempted. It is worth naming as a pattern —
**absence of failure is not evidence of function** — because it has now produced
two independent near-misses in one day.

### Why DSQL's shape forces the schedule

DSQL exposes **no PITR**. `GetCluster` returns no backup field of any kind, and
a DSQL recovery point is a **full** backup, never incremental — continuous
backup is an AWS Backup capability for RDS, Aurora and S3, not this. Therefore
**the recovery point interval is the RPO**, and there is no knob that improves
it.

That is what fixes the schedule at `cron(45 22 * * ? *)`: 45 minutes after the
22:00 UTC capture. Writes here happen once a day, so backing up right behind the
write shrinks the exposed window from ~23 hours to ~45 minutes. A round-hour
schedule would have been strictly worse for no reason.

RPO is therefore **one capture** — and for the Inzhur half that is a real loss,
since the provider publishes no history. It is the floor available without
continuous backup, not a comfortable number.

### Two structural choices

**The vault, role, plan and selection are NOT in `template.yaml`.** A backup
inside the stack it protects is deleted by the accident it exists for — a
rollback, a bad changeset, a stack delete. `infra/scripts/bootstrap-backups.sh`
creates them idempotently instead. Secondary benefit: the execution role does
not gain a `backup:*` family, and that role is where widening is least
reversible.

**The selection matches the `app=quirenote` tag, never a cluster ARN.** DSQL
cluster IDs are generated, so a recreated cluster gets a new ARN and an
ARN-pinned selection would back up nothing, silently. Given what this same day
established about silent failure, that is not a hypothetical.

### Open, deliberately

Nothing yet verifies that the nightly backup **ran**. The whole entry above
argues that unverified success is the recurring defect here, so leaving it
unwatched would be inconsistent — see A14 in `PLAN-NOW.md`.
