export type YieldType = 'fixed_coupon' | 'dividends' | 'capitalization' | 'div_cap';
// 'none' = capitalization-only (renders "None (price only)"); the New-asset form
// offers only the 4 README options — 'none' is seed-only.
export type PayoutSchedule = 'maturity' | 'monthly' | 'quarterly' | 'semiannual' | 'none';
// 'withdrawal' (external cash out, WEALTH-MANAGEMENT §1.1/§5.1) and
// 'redemption' (bond principal returned at maturity, §1.1/§2.1) joined in P1
// feat/formula-parity — the domain accepts them, but the TransactionPanel
// select does NOT offer them until P2 feat/metrics-exposure.
export type TxType =
  | 'buy'
  | 'sell'
  | 'deposit'
  | 'withdrawal'
  | 'dividend_accrual'
  | 'interest_payout'
  | 'reinvest'
  | 'redemption'
  | 'tax';
export type TxSource = 'own' | 'accrual' | 'reinvest_reit' | 'reinvest_6475';
export type ColorKey = 'reit' | 'energy' | 'ovdp8976' | 'ovdp6475';

export interface Asset {
  id: string;
  name: string;
  code: string; // 2 letters shown in the avatar circle
  colorKey: ColorKey;
  yieldType: YieldType;
  expectedPct: number;
  targetPct: number;
  payoutSchedule: PayoutSchedule;
  firstPurchase: string; // ISO yyyy-MM-dd (all dates below too)
  createdAt: string; // ISO datetime — listAssets display order
  maturity?: string;
  couponAmount?: number;
  nextCoupon?: string;
  reinvestPolicy?: string;
  // Inzhur link (P2 feat/asset-form): valued as units × fetched sell price
  // once P3's fetch lands. `ref` = fund slug ('inzhur-reit') or bond ISIN
  // ('UA4000238976'). Optional object field — no Dexie version bump (D9).
  inzhur?: { kind: 'fund' | 'bond'; ref: string; units: number };
}

export interface Snapshot {
  date: string; // primary key
  quotes: Record<string, number>; // partial until all assets quoted
  cash: number;
  savedAt?: string; // ISO datetime, set on save — feeds "Last saved 25.07, 21:14"
}

export interface Transaction {
  id: string;
  date: string;
  type: TxType;
  assetId: string; // '' for portfolio-level rows (deposit)
  amount: number;
  source: TxSource;
}

// Where a quote DRAFT value came from (P3 S2 provenance chips). Lives with the
// draft in `state/draft.ts`, not in any Dexie row: it describes an unsaved
// input, and the saved Snapshot keeps no notion of provenance. A draft with no
// origin is the user's own value — the fact G5 protects. 'cache' = the
// last-good payload served after a failed fetch (the amber "as of 25.07").
export type QuoteSource = 'fetch' | 'cache';

export interface QuoteOrigin {
  source: QuoteSource;
  /** ISO instant of the fetch that produced the value. */
  at: string;
}

export interface Settings {
  currency: 'UAH' | 'USD';
  usdRate: number; // 44.83
}
