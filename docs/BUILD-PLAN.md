# Kubushka Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking — tick them in this file as you complete them and keep the Status table current.

**Goal:** Recreate `design/Investment Tracker.dc.html` as a production React SPA where every figure is derived from locally stored data (Dexie/IndexedDB), seeded so first run matches the reference.

**Architecture:** A 9-route SPA (react-router) with a fixed dark sidebar shell. All portfolio data lives in IndexedDB behind `src/lib/repository.ts`, consumed via TanStack Query; pure derivation/formatting functions in `src/lib` turn raw records into every displayed number. Currency preference + draft quote entry live in persisted zustand stores.

**Tech Stack:** React 19, Vite 7, TypeScript 5 (strict), Tailwind 4 `@theme` tokens, Dexie 4, TanStack Query 5, zustand 5, react-hook-form + zod, recharts 3, Radix, CVA, sonner, react-day-picker, lucide-react. See `docs/DECISIONS.md`.

## Global constraints

Copied from README / CLAUDE.md — every task implicitly includes these:

- **Source of truth:** README.md is the spec; `design/Investment Tracker.dc.html` is the visual reference. Where the reference's mock copy is internally inconsistent, `docs/DECISIONS.md` D5 pins the resolution — check it before "fixing" a mismatch. Ignore `design/support.js` and `_ds/` references. `design/Tracker Options.dc.html` only disambiguates.
- **No hard-coded figures.** Every displayed number derives from stored assets/snapshots/transactions. Seed data makes first run match the reference.
- **Palette only via Tailwind `@theme` tokens** (Task 1) — no ad-hoc hex in components. Charts use `src/lib/colors.ts` (mirrors the tokens; recharts can't resolve CSS vars in SVG attributes).
- **Fonts:** Space Grotesk 600/700 for h1–h4, buttons, KPI numbers; Spline Sans Mono for body/labels/tables. h2 26px, KPI value 26px, micro-labels 10px uppercase `.12em`, body 13px, tables 12.5px.
- **Formats:** prose/KPI `₴68,629.36`, USD `$3,324.03`; tables/inputs `68 702,10` (NBSP thousands, comma decimals); dates `dd.MM.yyyy`, short `dd.MM`, payouts "10 Aug"; deltas always signed, green `#5c7355` / negative `#a8695a`, "pp" for point gaps. Exception: Allocation current-vs-target delta color encodes off-target severity, not sign (see Task 6).
- **Currency toggle** (₴/$, stored rate 44.83) converts **display only** of logo symbol, sidebar capital, Overview KPIs. Tables stay in ₴. Preference persists across reloads.
- **Layout:** no horizontal scroll ≥360px; sidebar 232px fixed, internally scrollable; grids wrap via `repeat(auto-fit,minmax(200px,1fr))`-style rules.
- **A11y:** focus-visible rings (`2px solid #26262a`, offset 2px), hover states, `aria-current` on active nav.
- **Quality gate per task:** `pnpm lint && pnpm typecheck` (plus `pnpm test` once vitest exists) green before commit; browser-verify against the design reference. The app is pinned to port 3000 (vite.config) — the dev server is usually already running; check before launching one.
- **Git:** pet project, no Jira. Branch `<type>/<kebab-title>` off `dev`, plain conventional commits, no AI attribution. Squash-merge back to `dev`, then push. Author identity: `RomanKushyk <romankushyk0@gmail.com>` (repo-local config — never the work identity).
- **Motion:** every interaction animates fluidly — see "Motion & interaction standards" below (user requirement, D7). Nothing pops or snaps instantly.
- **Docs upkeep:** every top-level folder carries a `README.md` with its local rules — create one for any new folder (Task 1 creates `src/README.md`). Root `navigation-map.md` is the agentic manual-testing map: update its route Status + checkpoints (and affected folder READMEs) whenever a task changes screens, flows or structure.

## Motion & interaction standards (user requirement — D7)

Every UX/UI move or interaction animates; the app must feel lively, tactile and **soft**. No new deps: CSS transitions + `tw-animate-css` utilities (imported in `src/index.css`) + recharts/sonner built-ins.

- **Defaults:** all `transition*` utilities inherit the soft curve `cubic-bezier(0.22,1,0.36,1)` and 220ms via the `--default-transition-*` theme tokens in `src/index.css`. Micro-feedback (hover) may drop to `duration-150`; reveals and layout shifts use `duration-300`–`400`.
- **Tactile press:** every button/pill/segment gets `transition active:scale-[.97]`.
- **Hover states:** never instant — background/opacity/color changes always transition.
- **Screen changes:** `Layout` re-mounts the outlet per route inside `animate-in fade-in slide-in-from-bottom-2 duration-300` (pattern already wired — keep it).
- **Reveals** (New-asset sub-form, cards appearing, empty states): `animate-in fade-in slide-in-from-*`/`zoom-in-*` — never instant mount; prefer symmetric exit when feasible.
- **Live state** (delta chips, "N of 4 filled" pill, filled-input borders): colors/borders transition; when a chip's *value* changes, re-trigger entry animation (`key` the element by value + `animate-in fade-in zoom-in-95`).
- **Charts (Task 6):** keep recharts `isAnimationActive` on, duration ≈900ms ease-out; data updates animate from previous state — never redraw cold.
- **Currency toggle (Task 7):** sliding thumb (transform transition); headline KPI values tween between currencies (~300ms rAF hook, e.g. `hooks/useTweenedNumber`).
- **Toasts:** sonner defaults are already soft — keep.
- **A11y:** the global `prefers-reduced-motion: reduce` kill-switch in `src/index.css` stays; never animate so click targets shift under a hovering pointer.

## Status

| # | Task | Branch | Status |
|---|------|--------|--------|
| 1 | Scaffold, theme, shell + nav | `feat/scaffold-shell` | **done** (2026-07-27) |
| 2 | Data layer + seed + tests | `feat/data-layer` | **done** (2026-07-27) |
| 3 | Daily quotes screen | `feat/daily-quotes` | **done** (2026-07-27) |
| 4 | Transaction form + new-asset sub-form | `feat/transaction-form` | **done** (2026-07-27) |
| 5 | Overview, Portfolio, Attributes | `feat/derived-views` | **done** (2026-07-27) |
| 6 | Charts: Balances, Payouts, Yield, Seasonality, Allocation | `feat/charts` | **done** (2026-07-28) |
| 7 | Currency toggle, toasts, polish, empty states | `feat/polish` | **done** (2026-07-28) — plan complete |

Plan complete. Deferred cosmetic items live in `docs/FOLLOW-UPS.md` (non-blocking; one `chore/cosmetic-sweep` branch clears them).

## Design reference

How to read `design/Investment Tracker.dc.html` — file anatomy, the **line map** that task references below ("design lines X–Y") point into, and the browser-rendering caveat — lives in **`design/README.md`**. Read it once per session before any visual work.

## File structure

```
index.html                  Vite entry (fonts NOT here — imported via @fontsource in main.tsx)
vite.config.ts              react (with react-compiler babel plugin) + tailwindcss plugins, port 3000
tsconfig.json               strict, bundler resolution
eslint.config.js            Vite react-ts template + eslint-config-prettier
.prettierrc                 prettier-plugin-tailwindcss
src/
  main.tsx                  fonts, QueryClientProvider, RouterProvider, <Toaster/>
  index.css                 Tailwind import + @theme tokens + base styles
  routes.tsx                createBrowserRouter: Layout wraps 9 eager routes
  app/Layout.tsx            flex shell, <Sidebar/> + <main><Outlet/></main>
  app/Sidebar.tsx           logo, nav pills, currency toggle, Total capital card
  lib/types.ts              domain types (below)
  lib/colors.ts             series/palette hex constants for charts
  lib/db.ts                 Dexie database
  lib/repository.ts         ONLY module importing db; async CRUD
  lib/seed.ts               ensureSeeded() — reference dataset (see Task 2)
  lib/derive.ts             pure derivations (unit-tested)
  lib/format.ts             number/date formatting (unit-tested)
  lib/schemas.ts            zod schemas for the transaction + quote forms
  hooks/queries.ts          TanStack Query hooks + mutation invalidation
  state/settings.ts         zustand persisted: currency, usdRate
  state/draft.ts            zustand persisted: draft quote entry
  components/ui/            Button, Card, Tag, Microlabel, AssetAvatar, … (CVA variants)
  components/charts/        one wrapper per recharts chart
  screens/                  DailyQuotes.tsx (+ TransactionPanel.tsx, NewAssetFields.tsx),
                            Overview.tsx, Balances.tsx, Payouts.tsx, Yield.tsx,
                            Attributes.tsx, Seasonality.tsx, Portfolio.tsx, Allocation.tsx
```

## Pinned contracts

Every session must use these exact names/types — they are the interfaces between tasks.

### Domain types (`src/lib/types.ts`)

```ts
export type YieldType = 'fixed_coupon' | 'dividends' | 'capitalization' | 'div_cap';
export type PayoutSchedule = 'maturity' | 'monthly' | 'quarterly' | 'semiannual' | 'none';
  // 'none' = capitalization-only (Inzhur Energy renders "None (price only)");
  // the New-asset form still offers only the 4 README options — 'none' is seed-only.
export type TxType = 'buy' | 'sell' | 'deposit' | 'dividend_accrual' | 'interest_payout' | 'reinvest' | 'tax';
export type TxSource = 'own' | 'accrual' | 'reinvest_reit' | 'reinvest_6475';
export type ColorKey = 'reit' | 'energy' | 'ovdp8976' | 'ovdp6475';
  // new assets cycle: colorKey = KEYS[existingAssetCount % 4]

export interface Asset {
  id: string; name: string; code: string; // 2 letters, avatar circle
  colorKey: ColorKey;
  yieldType: YieldType; expectedPct: number; targetPct: number;
  payoutSchedule: PayoutSchedule;
  firstPurchase: string;               // ISO yyyy-MM-dd (all dates below too)
  createdAt: string;                   // ISO datetime — listAssets display order
  maturity?: string; couponAmount?: number; nextCoupon?: string; reinvestPolicy?: string;
}
export interface Snapshot {
  date: string;                        // primary key
  quotes: Record<string, number>;      // PARTIAL until all assets quoted
  cash: number;
  savedAt?: string;                    // ISO datetime, set on save — feeds "Last saved 25.07, 21:14"
}
export interface Transaction { id: string; date: string; type: TxType; assetId: string; amount: number; source: TxSource }
export interface Settings { currency: 'UAH' | 'USD'; usdRate: number } // usdRate 44.83
```

### Dexie (`src/lib/db.ts`) — db name `kubushka`

```ts
class KubushkaDB extends Dexie {
  assets!: Table<Asset, string>;
  snapshots!: Table<Snapshot, string>;      // primary key: date
  transactions!: Table<Transaction, string>;
  constructor() {
    super('kubushka');
    this.version(1).stores({ assets: 'id', snapshots: 'date', transactions: 'id, date, assetId' });
  }
}
export const db = new KubushkaDB();
```

### Repository (`src/lib/repository.ts`)

```ts
export const repo = {
  listAssets(): Promise<Asset[]>,             // sorted by createdAt (display order)
  listSnapshots(): Promise<Snapshot[]>,       // ascending by date
  listTransactions(): Promise<Transaction[]>, // ascending by date
  saveSnapshot(s: Snapshot): Promise<void>,   // UPSERT by date (re-save replaces — §9); sets savedAt
  recordTransaction(tx: Transaction, newAsset?: Asset): Promise<void>, // one db.transaction: create asset if given, then tx
};
export function ensureSeeded(): Promise<void>; // also in repository.ts — seed.ts stays
// pure data builders (SEED_ASSETS, SEED_TRANSACTIONS, buildSeedSnapshots) with no
// Dexie import, so unit tests never need IndexedDB.
```

### Query hooks (`src/hooks/queries.ts`)

```ts
export const keys = { assets: ['assets'], snapshots: ['snapshots'], transactions: ['transactions'] } as const;
export function useAssets(): UseQueryResult<Asset[]>;
export function useSnapshots(): UseQueryResult<Snapshot[]>;
export function useTransactions(): UseQueryResult<Transaction[]>;
export function useSaveSnapshot();      // mutation → invalidate snapshots
export function useRecordTransaction(); // mutation → invalidate transactions + assets
```

### Stores

```ts
// state/settings.ts — persist key 'kubushka-settings'
{ currency: 'UAH' | 'USD', usdRate: number /* 44.83 */, setCurrency(c: 'UAH' | 'USD'): void }
// state/draft.ts — persist key 'kubushka-draft'
{ date: string, quotes: Record<string /*assetId*/, string /*raw input*/>,
  setDate(d: string): void, setQuote(assetId: string, v: string): void, clear(): void }
```

### Derivations (`src/lib/derive.ts`) — pure, no I/O

```ts
export const PORTFOLIO_START = '2026-02-03'; // global daysHeld basis — see annualized note below

export function latestQuotes(snaps: Snapshot[]): Record<string, number>;
  // latest available quote PER ASSET, partial snapshots included — the HEADLINE basis.
  // On seed: REIT 68702.10 (from partial 27.07) + the other three from 25.07 → all "Value now" figures.
export function latestCash(snaps: Snapshot[]): number;          // cash of the most recent snapshot (7.75)
export function headlineTotal(snaps: Snapshot[]): number;       // Σ latestQuotes + latestCash → 149016.36
export function latestCompleteSnapshot(snaps: Snapshot[], assetIds: string[]): Snapshot | undefined; // Balances only
export function totalCapital(s: Snapshot): number;              // Σ quotes + cash of ONE snapshot (Balances rows)
export function investedByAsset(txs: Transaction[]): Record<string, number>; // Σ amount where type ∈ {buy, reinvest}
export function reinvestedByAsset(txs: Transaction[]): Record<string, number>; // Σ amount where type === 'reinvest'
export function reinvestedTotal(txs: Transaction[]): number;
export function depositedTotal(txs: Transaction[]): number;     // Σ amount where type === 'deposit'
export function netResult(values: Record<string, number>, invested: Record<string, number>): { uah: number; pct: number };
  // Σvalues − Σinvested (cash EXCLUDED) → +4452.61 / +3.08%
export function yieldSinceStart(value: number, invested: number): number;      // value/invested − 1
export function annualizedPct(value: number, invested: number, daysHeld: number): number; // yieldSinceStart × 365/daysHeld
  // daysHeld = days since PORTFOLIO_START for EVERY asset (design §6.5 footnote pins the single global
  // date 03.02.2026 — per-asset firstPurchase would give …6475 +34.5% instead of the reference's +10.9%)
export function sharePct(value: number, total: number): number;
export function allocationDeltaPp(share: number, targetPct: number): number;   // share − target, in pp
export function trimAmount(share: number, targetPct: number, total: number): number;
  // overweight sell: (share − target)/100 × total → REIT trim ₴9,095.55 (design "−₴9,095")
export function topUpAmount(value: number, targetPct: number, total: number): number;
  // buy with NEW money (total grows): (target/100 × total − value) / (1 − target/100)
  // → …8976 top-up ₴11,429.49; reference prints "₴11,413" (mock rounding — display the derived value, see D5)
export function incomeReceived(txs: Transaction[]): { dividends: number; coupons: number; total: number };
  // dividend_accrual → dividends; interest_payout → coupons (coupons count on accrual — §6.5 footnote)
```

### Formatting (`src/lib/format.ts`)

```ts
export function fmtProse(n: number, currency?: 'UAH' | 'USD'): string; // ₴68,629.36 / $3,324.03 (en-US grouping)
export function fmtProseWhole(n: number, currency?: 'UAH' | 'USD'): string; // ₴149,016 — sidebar capital, Deposited KPI
export function fmtTable(n: number): string;  // 68 702,10 — Intl 'uk-UA': NBSP ( ) thousands, comma decimals
export function fmtPct(n: number, fractionDigits?: number): string; // '+4.41%' (explicit sign; default 2 dp, Yield annualized passes 1)
export function fmtDate(iso: string): string;      // 27.07.2026
export function fmtDateShort(iso: string): string; // 27.07
export function fmtSavedAt(iso: string): string;   // '25.07, 21:14' (from Snapshot.savedAt)
export function toUsd(uah: number, rate: number): number;
```

### Tailwind tokens (`src/index.css`)

```css
@import 'tailwindcss';
@theme {
  --font-display: 'Space Grotesk', sans-serif;
  --font-body: 'Spline Sans Mono', monospace;
  --color-page: #f6f5f3;   --color-ink: #26262a;    --color-card: #ffffff;
  --color-muted: #8b8a86;  --color-faint: #b3b2ae;  --color-hairline: #e8e7e4;
  --color-panel: #eceae7;  --color-panel-border: #dedcd8;
  --color-sidebar: #26262a;       --color-sidebar-text: #e9e8e6;
  --color-sidebar-muted: #96959b; --color-sidebar-inset: #333338;
  --color-sidebar-hover: #3d3d42; --color-sidebar-nav: #cfcecb;
  --color-pos: #5c7355;      --color-pos-tint: #e3eadf; --color-pos-tint-text: #4c5a48;
  --color-pos-on-dark: #b9cdb4; --color-pos-border: #c9d4c4;
  --color-neg: #a8695a;
  --color-reit: #8ba283;     --color-reit-tint: #e3eadf;     --color-reit-tint-text: #4c5a48;
  --color-energy: #c2a189;   --color-energy-tint: #efe4e0;   --color-energy-tint-text: #6d5a53;
  --color-ovdp8976: #98a3ad; --color-ovdp8976-tint: #e4e8eb; --color-ovdp8976-tint-text: #525c64;
  --color-ovdp6475: #5f5e5a; --color-ovdp6475-tint: #e8e7e4; --color-ovdp6475-tint-text: #5f5e5a;
}
```

Card shadow `0 1px 3px rgba(38,38,42,.06)`; cards radius 20–24px; buttons/pills radius 999px; focus ring `2px solid #26262a` offset 2px; selection bg `#e3eadf`; lucide stroke-width 2.75.

### Routes

`/` DailyQuotes · `/overview` · `/balances` · `/payouts` · `/yield` · `/attributes` · `/seasonality` · `/portfolio` · `/allocation` — all children of `Layout`, sidebar uses `NavLink` (gives `aria-current`).

---

## Task 1: Scaffold, theme tokens, fonts, shell + sidebar nav

**Files:** Create `index.html`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `.prettierrc`, `src/README.md`, `src/main.tsx`, `src/index.css`, `src/routes.tsx`, `src/app/Layout.tsx`, `src/app/Sidebar.tsx`, `src/screens/*.tsx` (9 placeholder screens).
**Produces:** working `pnpm dev` app on :3000, all routes navigable, tokens available to every later task.

- [x] Branch `feat/scaffold-shell` off `dev`.
- [x] `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react({ babel: { plugins: ['babel-plugin-react-compiler'] } }), tailwindcss()],
  server: { port: 3000 },
});
```

- [x] `tsconfig.json`: Vite react-ts template — `strict`, `target ES2022`, `moduleResolution "bundler"`, `jsx "react-jsx"`, `noEmit`, `verbatimModuleSyntax`, include `src` + `vite.config.ts`, types `["vite/client"]` (build script runs plain `tsc --noEmit`, so one tsconfig must cover everything).
- [x] `eslint.config.js` from the Vite react-ts template (typescript-eslint, react-hooks, react-refresh) + `eslint-config-prettier` last. `.prettierrc`: `{ "plugins": ["prettier-plugin-tailwindcss"] }`. Note: with eslint-plugin-react-hooks v7 the flat preset is `reactHooks.configs.flat.recommended` (`recommended-latest` is legacy format).
- [x] `src/index.css` with the exact `@theme` block above + base: page bg `--color-page`, text `--color-ink`, `font-body` default, `::selection` bg `#e3eadf`, focus-visible ring rule.
- [x] `src/main.tsx`: import `@fontsource/space-grotesk/{500,600,700}.css`, `@fontsource/spline-sans-mono/{400,500,600,700}.css`, `index.css`; render `QueryClientProvider` + `RouterProvider` (v7: `RouterProvider` imports from `react-router/dom`).
- [x] Layout + Sidebar per design lines 1–54 and README §5: 232px sticky sidebar, `border-radius 0 32px 32px 0`, internally scrollable, decorative circle; logo block; "DAILY ENTRY" / "ANALYTICS" groups; `NavLink` pills (active `#e9e8e6` bg + ink 700; inactive `#cfcecb`, hover opacity .85); currency toggle (static UI for now); Total capital card (placeholder dashes until Task 2 — never a hard-coded figure). Deviation from reference markup: the decorative circle sits inside a clipping layer — its raw `bottom:-60px` offset would force a permanent sidebar scrollbar (prototype quirk defeating "scroll only when needed").
- [x] 9 placeholder screens wired in `routes.tsx` — h2 + muted subtitle copied from each design section's first two lines (h2 + `<p>`; see the line map in `design/README.md` — README §6 only contains subtitle copy for two screens). Shared `components/ui/ScreenHeader.tsx`. Overview placeholder omits the derived " · {date} · rate" subtitle tail (Task 5 adds it).
- [x] `src/README.md`: folder rules — the structure table from "File structure" above, the repository-is-the-only-db-importer rule, the tokens-only palette rule, and a pointer to the Pinned contracts section of this plan.
- [x] Verify: `pnpm lint && pnpm typecheck` green; in browser — all routes navigable, `aria-current="page"` on active pill, sidebar scrolls internally on a short window (capital card reachable), no horizontal scroll at 360px. Verified 2026-07-27 via Chrome DevTools MCP; fonts confirmed loaded; only console noise is the missing-favicon 404.
- [x] Commit `feat: scaffold app shell with theme tokens and sidebar nav`; squash-merge to `dev`.

## Task 2: Data layer — types, Dexie, repository, seed, hooks, vitest

**Files:** Create `src/lib/{types,colors,db,repository,seed,derive,format,schemas}.ts`, `src/lib/{derive,format,seed}.test.ts`, `src/hooks/queries.ts`, `src/state/{settings,draft}.ts`. Modify `package.json` (add `vitest` devDep + `"test": "vitest run"`), `src/main.tsx` (await `ensureSeeded()` before render), `src/app/Sidebar.tsx` (real Total capital card).
**Consumes:** Task 1 scaffold. **Produces:** every pinned contract above.

- [x] Branch `feat/data-layer`; `pnpm add -D vitest`. Added `vitest.config.ts` (node environment) so tests never load the app's Vite plugins.
- [x] Write the failing tests FIRST — fixtures are the reference's own published figures (final suites grew beyond this sketch: 37 tests incl. all four annualized values, seed invariants, schema parsing — see `src/lib/*.test.ts`):

```ts
// src/lib/derive.test.ts
import { describe, expect, it } from 'vitest';
import { annualizedPct, headlineTotal, latestQuotes, netResult, topUpAmount, totalCapital, trimAmount, yieldSinceStart } from './derive';

const complete2507 = { date: '2026-07-25', cash: 7.75, savedAt: '2026-07-25T21:14:00',
  quotes: { reit: 68629.36, energy: 60086.09, ovdp8976: 15846.3, ovdp6475: 4374.12 } };
const partial2707 = { date: '2026-07-27', cash: 7.75, quotes: { reit: 68702.1 } };
const snaps = [complete2507, partial2707];

it('latest quotes merge the partial snapshot over the last complete one', () => {
  expect(latestQuotes(snaps)).toEqual({ reit: 68702.1, energy: 60086.09, ovdp8976: 15846.3, ovdp6475: 4374.12 });
  expect(headlineTotal(snaps)).toBeCloseTo(149016.36, 2); // sidebar / Overview / donut center
});
it('totalCapital of one complete snapshot (Balances row)', () => {
  expect(totalCapital(complete2507)).toBeCloseTo(148943.62, 2); // design 25.07 row total
});
it('net result excludes cash', () => {
  const invested = { reit: 65800, energy: 59208, ovdp8976: 15390, ovdp6475: 4158 };
  const r = netResult(latestQuotes(snaps), invested);
  expect(r.uah).toBeCloseTo(4452.61, 2);   // Overview "+₴4,452.61"
  expect(r.pct).toBeCloseTo(0.0308, 4);    // "+3.08% since 03.02"
});
it('yield since start matches the reference teaser strip', () => {
  expect(yieldSinceStart(68702.1, 65800)).toBeCloseTo(0.0441, 4);   // REIT +4.41%
  expect(yieldSinceStart(60086.09, 59208)).toBeCloseTo(0.0148, 4);  // Energy +1.48%
  expect(yieldSinceStart(15846.3, 15390)).toBeCloseTo(0.0296, 4);   // …8976 +2.96%
  expect(yieldSinceStart(4374.12, 4158)).toBeCloseTo(0.052, 4);     // …6475 +5.20%
});
it('annualized uses the GLOBAL portfolio start (03.02 → 27.07 = 174 days) for every asset', () => {
  expect(annualizedPct(68702.1, 65800, 174)).toBeCloseTo(0.0441 * 365 / 174, 3); // REIT +9.3%
  expect(annualizedPct(4374.12, 4158, 174)).toBeCloseTo(0.109, 3);  // …6475 +10.9% (NOT per-asset 55 days)
});
it('rebalance: trim is linear, top-up compounds the total', () => {
  expect(trimAmount(46.104, 40, 149016.36)).toBeCloseTo(9095.56, 0);        // REIT "−₴9,095"
  expect(topUpAmount(15846.3, 17, 149016.36)).toBeCloseTo(11429.49, 0);     // …8976 (reference prints 11,413 — D5)
});
```

```ts
// src/lib/format.test.ts
import { expect, it } from 'vitest';
import { fmtDate, fmtPct, fmtProse, fmtProseWhole, fmtSavedAt, fmtTable, toUsd } from './format';

it('formats per README §8', () => {
  expect(fmtProse(68629.36)).toBe('₴68,629.36');
  expect(fmtProse(toUsd(149016.36, 44.83), 'USD')).toBe('$3,324.03');
  expect(fmtProseWhole(149016.36)).toBe('₴149,016');   // sidebar capital
  expect(fmtProseWhole(143176.37)).toBe('₴143,176');   // Deposited KPI
  expect(fmtTable(68702.1)).toBe('68 702,10');
  expect(fmtPct(0.0441)).toBe('+4.41%');
  expect(fmtPct(-0.064)).toBe('-6.40%');
  expect(fmtDate('2026-07-27')).toBe('27.07.2026');
  expect(fmtSavedAt('2026-07-25T21:14:00')).toBe('25.07, 21:14');
});
```

- [x] `pnpm test` → confirm FAIL (modules don't exist yet). Watched RED at each stage.
- [x] Implement `types/colors/db/repository/derive/format` exactly per the pinned contracts; `pnpm test` → PASS.
- [x] `src/lib/seed.ts` — pure data builders; `ensureSeeded()` (no-op if `assets` non-empty, one Dexie transaction) lives in `repository.ts` so seed.ts never imports the db and stays unit-testable. **The reference's mock copy is internally inconsistent; seed per D5 so all derived figures are self-consistent and README §7 aggregates win:**
  - **Assets (4):** exact names/codes/attributes from design lines 340–409; targets 40/40/17/3; colorKeys `reit|energy|ovdp8976|ovdp6475`; Energy `payoutSchedule: 'none'`.
  - **Transactions:** `deposit` rows totaling **143 176,37** (Deposited KPI ₴143,176; equals own-funded buys 143 168,62 + cash 7,75); `buy` rows per asset such that buys + reinvests sum to invested 65 800 / 59 208 / 15 390 / 4 158; payout log rows from design lines 242–302 with ONE adjustment — the 648,13 dividend dated 12.05 becomes **472,13 dated 10.05** — so dividends derive to 3 641,44 + coupons 1 399,50 = 5 040,94 (README §7) and Seasonality has no stray day-12 bar; `reinvest` rows **687,02 + 484,36 (REIT) and 216,00 (…6475)**, same date+asset as their source payouts, so reinvestedByAsset gives 1 171,38 / 216,00 (Portfolio column) and reinvestedTotal 1 387,38.
  - **Snapshots (exactly 174):** deterministic (no `Math.random`) daily series **2026-02-03 → 2026-07-25 complete (173 snapshots, NO 26.07)** ending at quotes 68 629,36 / 60 086,09 / 15 846,30 / 4 374,12, pinning verbatim the 25.07→21.07 table rows from design lines 211–241; **plus a PARTIAL 27.07 snapshot `{ quotes: { reit: 68702.10 }, cash: 7.75 }`** (that's the reference's "pending" row, the "1 of 4 filled" pill, and the +0.11% chip). Seed 25.07's `savedAt: '2026-07-25T21:14:00'` ("Last saved 25.07, 21:14").
  - Add `src/lib/seed.test.ts`: run derivations over the seed arrays and assert headlineTotal 149 016,36; netResult +4 452,61 / +3.08%; incomeReceived {3 641,44, 1 399,50, 5 040,94}; reinvestedTotal 1 387,38 with per-asset 1 171,38 / 216,00; depositedTotal 143 176,37; snapshot count 174.
- [x] `schemas.ts` (zod): `quoteInputSchema` (positive number, comma OR dot decimals accepted — inputs display `68 702,10` style), `transactionSchema` (all Tx fields; `newAsset` sub-object required only when `assetId === 'new'`).
- [x] `hooks/queries.ts` + both zustand stores per pinned contracts; wire `ensureSeeded()` before render.
- [x] Sidebar Total capital card: value `fmtProseWhole(headlineTotal)` (₴149,016); sub-line = `fmtPct(netResult.pct)` + ` · ` + the same total in the OTHER currency (design line ~587: `+3.08% · $3,324.03` in UAH mode, `+3.08% · ₴149,016.36` in USD mode).
- [x] Verify (2026-07-27, Chrome DevTools MCP — exact renderVals strings, 4/174/18 store counts, wipe→reseed confirmed): `pnpm test`, `pnpm lint`, `pnpm typecheck` green; in browser — sidebar shows ₴149,016 / +3.08% · $3,324.03; IndexedDB `kubushka` in DevTools has 4 assets, 174 snapshots, seeded transactions; wipe IndexedDB → reload reseeds.
- [x] Commit `feat: add dexie data layer with seed data and derivation tests`; squash-merge to `dev`.

## Task 3: Daily quotes screen (entry flow end-to-end)

**Files:** Create `src/screens/DailyQuotes.tsx` (+ extract row/teaser components as needed), `src/components/ui/*` primitives it needs. Modify nothing in `lib`.
**Consumes:** `useAssets`, `useSnapshots`, `useSaveSnapshot`, `state/draft`, `quoteInputSchema`, `latestQuotes`, `fmtTable`, `fmtPct`, `fmtDateShort`, `fmtSavedAt`.

- [x] Branch `feat/daily-quotes`. Reference: design lines 55–146, README §6.1.
- [x] Two-column layout (`flex:1 1 560px` main / `flex:1 1 300px; max-width:360px` side, wrap). Side panel is a placeholder card until Task 4.
- [x] Header row: h2 + live progress pill "N of 4 filled" (green tint) + date field (react-day-picker, dd.MM.yyyy) pushed right. Inputs initialize from **today's saved snapshot (if any) merged with the draft store** — on seed, REIT is pre-filled 68 702,10 → pill reads "1 of 4 filled".
- [x] Asset rows: 34px tinted avatar (2-letter code, asset colorKey tint), name + "₴… yesterday" subline; "yesterday" = the previous snapshot with a quote for that asset (on seed: 25.07 — the copy still says "yesterday"). Numeric input parsed through `quoteInputSchema` (comma or dot decimals) — empty: placeholder = yesterday's quote, "—" chip; filled: green border (`--color-pos-border`) + live delta chip vs yesterday (`+0.11%` = 68 702,10 vs 68 629,36; signed, green/negative).
- [x] Draft persistence: inputs read/write `state/draft` (survive reload); date change clears drafts.
- [x] Actions row: primary dark pill "Save snapshot" → `useSaveSnapshot` upsert for the selected date (partial quotes allowed) + sonner toast "Snapshot saved"; "Last saved" text = `fmtSavedAt(max savedAt)` (seed shows "25.07, 21:14"); outline pill "Copy yesterday" prefills all inputs with yesterday's quotes.
- [x] Yield teaser strip card: "Yield since start:" + per-asset `fmtPct(yieldSinceStart(latestQuotes[i], invested[i]))` + ghost button "Yield chart →" linking `/yield`.
- [x] Motion (D7): delta chips re-animate on value change (`key` by value + `animate-in fade-in zoom-in-95`); progress pill count transitions; filled-input green border transitions in; buttons get `transition active:scale-[.97]`; asset rows `animate-in` on mount.
- [x] Verify §9 items: typing updates chip + pill live; save persists (check IndexedDB) + toast + last-saved updates; re-save same day replaces (row count in DevTools unchanged); Copy yesterday fills all. `pnpm lint && pnpm typecheck && pnpm test` green; visual diff vs reference. Verified 2026-07-27 (Chrome DevTools MCP; 43 tests). Known carry-over to Task 7: 360px horizontal overflow is shell-level (Task 1 sidebar) + README §6.1 row minimums — re-verify per the §9 traceability table.
- [x] Commit `feat: add daily quotes entry flow`; squash-merge to `dev`.

## Task 4: Transaction form incl. new-asset sub-form

**Files:** Create `src/screens/TransactionPanel.tsx`, `src/screens/NewAssetFields.tsx`, Radix Select wrapper in `components/ui`. Modify `src/screens/DailyQuotes.tsx` (mount real panel).
**Consumes:** `transactionSchema`, `useRecordTransaction`, `useAssets`, `useTransactions`.

- [x] Branch `feat/transaction-form`. Reference: design lines 69–146 region, README §6.1 side panel.
- [x] Panel card (bg `--color-panel`, border `--color-panel-border`, radius 24): title "Transaction" + "OCCASIONAL" microlabel + subtitle. react-hook-form + zodResolver(`transactionSchema`).
- [x] Fields: Date + Type (2-col; types Buy/Sell/Deposit/Dividend accrual/Interest payout/Reinvest/Tax); Asset select — first option "+ New asset…" then assets; Amount ₴ + Source (Own funds/Accrual/Reinvest (REIT)/Reinvest (…6475)); primary pill "Record transaction".
- [x] New asset details sub-card — rendered ONLY when Asset = "+ New asset…": white bg, dashed `--color-faint` border, radius 16, inner inputs bg `--color-page`. Fields: Name; Yield type (4 options); Expected % + Target % (2-col); Payout schedule (4 README options — never 'none').
- [x] Submit: `recordTransaction(tx, newAsset?)` — atomically creates asset (id from crypto.randomUUID, code = first 2 letters uppercased, `colorKey = KEYS[assetCount % 4]` per the pinned cycle rule) when sub-form active; toast "Transaction recorded"; form resets.
- [x] Recent transactions card: last 3 via `useTransactions`, "Type · Asset — amount — date" rows; updates after submit.
- [x] Motion (D7): New-asset sub-card reveals with `animate-in fade-in slide-in-from-top-2 duration-300` (and soft collapse if feasible); selects/inputs transition focus states; submit button tactile press; new row in Recent transactions animates in.
- [x] Verify §9: sub-form only for "+ New asset…"; recording creates asset + transaction (new asset appears in Daily-quotes rows and Attributes, with a cycled avatar tint); recent list updates. Gates green; visual diff. Verified 2026-07-27 (Chrome DevTools MCP; 47 tests; Attributes portion deferred — screen exists only from Task 5). Fix round: panel radius made deterministic 24px via Card `radius` prop (+ Select borderColor/bg and Button `weight` variants replacing className collisions).
- [x] Commit `feat: add transaction recording with inline asset creation`; squash-merge to `dev`.

## Task 5: Overview + Portfolio + Attributes (pure derivations)

**Files:** Create `src/screens/{Overview,Portfolio,Attributes}.tsx`, shared `components/ui` bits (KPI card, color dot, share bar, tag).
**Consumes:** all of `derive.ts` + `format.ts`; settings store for currency-aware KPIs.

- [x] Branch `feat/derived-views`.
- [x] Overview (design 147–210, §6.2): subtitle with derived date + rate; KPI grid — Total capital (dark, currency-aware, `headlineTotal`), Net result (green, `netResult` → "+₴4,452.61 / +3.08% since 03.02"), Deposited (`fmtProseWhole(depositedTotal)` → ₴143,176, sub-line "+ ₴1,387.38 reinvested" from `reinvestedTotal`), Free cash (`latestCash`); Assets card with per-asset rows (`latestQuotes` values, yieldSinceStart deltas) + 12px stacked share bar; Next payouts card — bonds from `couponAmount`+`nextCoupon`/`maturity` attributes, dividend assets estimated as their latest dividend amount with "~" prefix and next-schedule date (reference's "~₴715 · 10 Aug" vs derived ~₴700 is accepted mock imprecision — D5); Rebalance hint (top up = `topUpAmount` for the most-underweight asset, "Open Allocation →"); Income received card (`incomeReceived` split → ₴5,040.94).
- [x] Portfolio (design 459–495, §6.8): positions table (Asset | Yield-type tag | Invested | of it reinvested (`reinvestedByAsset`) | Value now (`latestQuotes`) | P&L ₴ | P&L % | Share) + bold Total row ("Total + cash ₴7.75", value 149 016,36); Best performer / Laggard / Income engine cards — all computed, not looked up.
- [x] Attributes (design 340–409, §6.6): 2×2 asset cards, avatar + h3 + yield-type tag + 2-col `<dl>` of facts; bonds swap in YTM/Coupon/Maturity/Next coupon; Energy renders "None (price only)". "Actual ann." = `annualizedPct` with the global PORTFOLIO_START basis. Read-only.
- [x] Motion (D7): KPI cards and asset rows animate in (subtle stagger via `delay-*` is welcome); share-bar segments transition width; hover states on rows/cards transition.
- [x] Verify: every figure matches the reference on seed data (per D5 where the reference disagrees with itself); tables formatted `68 702,10`; deltas signed/colored. Gates green; visual diff per screen. Verified 2026-07-27 (Chrome DevTools MCP, dev server on :3002; 75 tests; KPI strings cross-checked against the design's own renderVals literals). All four Overview KPIs are currency-aware per README §9. Fix round: Attributes facts converted to semantic dl/dt/dd.
- [x] Commit `feat: add overview, portfolio and attributes views`; squash-merge to `dev`.

## Task 6: Charts — Balances, Payouts, Yield, Seasonality, Allocation

**Files:** Create `src/components/charts/{BalancesArea,PayoutsBars,YieldLines,SeasonalityBars,AllocationDonut}.tsx`, `src/screens/{Balances,Payouts,Yield,Seasonality,Allocation}.tsx`.
**Consumes:** snapshots/transactions hooks, `derive.ts`, `lib/colors.ts`.

- [x] Branch `feat/charts`. All charts recompute from stored data (§9); colors from `lib/colors.ts`; grid lines `#e8e7e4` (hairline token value); bar radius ≈6; no legends beyond inline dot-legends.
- [x] Balances (design 211–241, §6.3): recharts AreaChart of `totalCapital` per complete snapshot (line `#5c7355`, fill `#e3eadf`); snapshot table — most recent 6 rows with a simple Prev/Next pagination over the full set (README: "paginate in production"); today's partial row → "pending" (`--color-faint`) cells + "—" total; footer "Showing last 6 snapshots · N total since 03.02.2026" with derived N (=174 on seed).
- [x] Payouts (design 242–302, §6.4): stacked monthly bars (dividends `reit` color, coupons `ovdp8976` color, value labels on top); Received total (dark) / Upcoming (green tint, same attribute-based rules as Overview Next payouts) / Reinvested (`reinvestedTotal` · derived % of `incomeReceived.total` → 27.5%) cards; payout log table with Type tag + Destination — derived: a payout with a same-date same-asset `reinvest` tx renders "reinvested (₴X)" with that tx's amount, else "account".
- [x] Yield (design 303–339, §6.5): 4-line cumulative-% chart (series colors, end dots); table Asset | Invested | Value now | Δ total | Annualized (global PORTFOLIO_START basis) | vs expected (negative pp in `--color-neg`); footnote verbatim from design.
- [x] Seasonality (design 410–458, §6.7): income-by-day-of-month bars — gray 3–5px stubs for zero days, tall colored bars on days 3/10/25 (day-10 label derives to ₴3,641 vs the reference's ₴3,817 — accepted, D5), `*` expected bar = `couponAmount` on its `nextCoupon` day (₴1,240* day 25); stub footnote; 3 insight cards (Income anchor / Coupon season / Quiet stretch) — derive day totals from transactions.
- [x] Allocation (design 496–552, §6.9): 340px/1fr grid; donut (30px ring, center "₴149k / 4 assets + cash" from `headlineTotal`) + legend; Current-vs-target labeled progress pills (fill = share, black 2px tick at target, signed deltas — **color encodes severity, not sign**: near-target (|Δ| ≤ ~0.5pp) green, off-target red, per design lines 524–537 where +6.1 is red and −0.1 is green); numbered Rebalance plan — `topUpAmount` for buys, `trimAmount` for sells.
- [x] Motion (D7): recharts `isAnimationActive` on everywhere, duration ≈900ms ease-out; donut sweeps in; bars grow from baseline; data changes animate from previous state; allocation progress-pill fills transition width.
- [x] Verify: wipe IndexedDB → reseed → every chart matches reference (modulo D5 deviations); add a transaction → Payouts/Seasonality/Allocation update. Gates green; visual diff per chart (shape, colors, labels). Verified 2026-07-28 (Chrome DevTools MCP; 120 tests). Fix round: expected Seasonality bars now colored by contributing asset (day 3 → …6475, day 25 → …8976).
- [x] Commit `feat: add balances, payouts, yield, seasonality and allocation charts`; squash-merge to `dev`.

## Task 7: Currency toggle, toasts, polish, empty states

**Files:** Modify `src/app/Sidebar.tsx` (live toggle + logo symbol), `src/screens/Overview.tsx` (KPI conversion), touched screens for empty states.

- [x] Branch `feat/polish`.
- [x] Currency toggle functional: segmented control switches settings store; converts ONLY logo symbol (₴/$), sidebar Total capital (value + sub-line flip per design renderVals), Overview headline KPIs — at rate 44.83, `$3,324.03` formatting; persists across reload (§9). Tables/inputs remain ₴.
- [x] Empty states (README §10.7): no snapshots yet (Daily quotes placeholders, charts with friendly empty message) and single-asset portfolio — no crashes, sensible copy.
- [x] Motion (D7): currency toggle thumb slides between segments; headline KPIs + sidebar capital tween numerically on toggle (`hooks/useTweenedNumber`, ~300ms rAF); full motion sweep — every interactive element transitions, screen changes animate, `prefers-reduced-motion` verified to disable it all.
- [x] Polish sweep vs §9: hover states everywhere, focus-visible rings, `aria-current`, sidebar internal scroll, 360px no-horizontal-scroll. Verify every §9 item in the browser and record pass/fail in the Result column of the traceability table below (README itself stays untouched). Sidebar narrows via `max-sm:` rail below 640px (232px desktop look unchanged); all 9 routes verified overflow-free at 360px and 641px.
- [x] Final gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green (141 tests; 1 known react-compiler/RHF lint warning).
- [x] Commit `feat: add currency toggle, empty states and a11y polish`; squash-merge to `dev`.

## §9 behavior checklist → task traceability

| §9 item | Owned by | Result |
|---------|----------|--------|
| Quote entry live chips/pill, save+toast+last-saved, copy yesterday | Task 3 | **pass** (2026-07-28) |
| Snapshot upsert per day | Task 2 (repo) + 3 (UI) | **pass** (2026-07-28) |
| Transaction form / new-asset sub-form / recent list | Task 4 | **pass** (2026-07-28) |
| Currency toggle persistence + scope | Task 7 (store from Task 2) | **pass** (2026-07-28) — only logo/sidebar/Overview KPIs convert; tables ₴; survives reload |
| Charts recompute from stored data | Task 6 | **pass** (2026-07-28) |
| No horizontal scroll ≥360px; sidebar internal scroll | Task 1, re-verified Task 7 | **pass** (2026-07-28) — `max-sm:` sidebar rail; all 9 routes clean at 360px & 641px |
| Focus rings, hover, aria-current | Task 1, re-verified Task 7 | **pass** (2026-07-28) |

## Session workflow (every future session)

1. Read `CLAUDE.md`, this file's Status table, `docs/DECISIONS.md` (especially D5 before touching seed/derivations). README.md stays the spec of record.
2. `git checkout dev && git pull` (remote: `origin` → RomanKushyk/investment-tracker on the personal GitHub account; commits must be authored `RomanKushyk <romankushyk0@gmail.com>` — repo-local config, already set).
3. Take the first non-done task, branch as listed, execute steps top-to-bottom, ticking checkboxes in this file as you go.
4. Browser-verify against `design/Investment Tracker.dc.html` — open it directly (interactive via its bottom script), but remember the `.btn/.input/.field/.table/.tag` styling caveat in `design/README.md`. Use root `navigation-map.md` for per-route checkpoints and expected seed values. The app runs pinned to :3000; the user's dev server is usually already up — check before starting one.
5. All gates green → conventional commit, squash-merge to `dev`, update the Status table + `navigation-map.md` (route Status, any changed checkpoints) + affected folder READMEs, commit doc updates.
