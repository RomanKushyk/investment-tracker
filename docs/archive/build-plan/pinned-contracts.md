# v1 — pinned contracts

> Moved **verbatim** from `../BUILD-PLAN.md` on 2026-08-26 (D95). Index: [`../BUILD-PLAN.md`](../BUILD-PLAN.md). **v1 is closed — this is a record, not a task list**, but **these still bind** until a decision supersedes them: the domain types, the Dexie schema, the repository surface, the derivations, the formats, the tokens and the routes.

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

