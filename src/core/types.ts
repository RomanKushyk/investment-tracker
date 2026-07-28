export type YieldType = 'fixed_coupon' | 'dividends' | 'capitalization' | 'div_cap';
// 'none' = capitalization-only (renders "None (price only)"); the New-asset form
// offers only the 4 README options — 'none' is seed-only.
export type PayoutSchedule = 'maturity' | 'monthly' | 'quarterly' | 'semiannual' | 'none';
export type TxType =
  | 'buy'
  | 'sell'
  | 'deposit'
  | 'dividend_accrual'
  | 'interest_payout'
  | 'reinvest'
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

export interface Settings {
  currency: 'UAH' | 'USD';
  usdRate: number; // 44.83
}
