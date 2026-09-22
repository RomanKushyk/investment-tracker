export type YieldType = 'fixed_coupon' | 'dividends' | 'capitalization' | 'div_cap';
// 'none' = capitalization-only; the New-asset form offers only the four README
// options, so 'none' is seed-only.
export type PayoutSchedule = 'maturity' | 'monthly' | 'quarterly' | 'semiannual' | 'none';
export type TxType =
  | 'buy'
  | 'sell'
  | 'deposit'
  | 'withdrawal'
  | 'dividend_accrual'
  | 'interest_payout'
  | 'reinvest'
  | 'redemption';

/**
 * The arm a `TxType` cannot reach. `never` accepts no member of the union, so a
 * ninth type fails to COMPILE at every call — which is what a type-keyed switch
 * is written without a silent `default:` to buy.
 *
 * It ANSWERS rather than throwing because the arm IS reachable at runtime, by a
 * row whose type the union no longer names: Dexie reads are unvalidated and no
 * migration retired `tax`. One such row made `freeCashFromLedger` return `NaN`,
 * and with no stored balance beside it that `NaN` now reaches the Free-cash card
 * and every total built on it. `Intl` prints the word rather than a dash, so the
 * screen reads BROKEN rather than plausible — which is the trade the fallback
 * buys, and the reason it must stay a fallback and never a silent 0.
 */
export function unnamedType<T>(_type: never, fallback: T): T {
  return fallback;
}
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
  /**
   * THE RATE, not the amount, because the rate is what a bond actually has: set at
   * issuance and never moving, while the ₴ a coupon pays moves with the holding.
   *
   * NOT `expectedPct`, which on a bond is YTM at purchase — a different quantity
   * that depends on the price this holder paid, and the two are measured to differ
   * in both directions (`docs/reference/OVDP-COUPON-STRUCTURE.md`).
   */
  couponRatePct?: number;
  couponAmount?: number;
  nextCoupon?: string;
  // `ref` = fund slug ('inzhur-reit') or bond ISIN ('UA4000238976').
  //
  // `units` is LEGACY and never written again — units are Σ `transaction.quantity`.
  // The property stays because it is the ONLY unit count an asset linked before the
  // form’s Units field was removed has, and those counts are unrecoverable.
  inzhur?: { kind: 'fund' | 'bond'; ref: string; units?: number };
}

export interface Snapshot {
  date: string; // primary key
  quotes: Record<string, number>; // partial until all assets quoted
  savedAt?: string; // ISO datetime, set on save — feeds "Last saved 25.07, 21:14"
}

/**
 * The only types that may carry `quantity` — `transaction_quantity_absent_ck` in
 * `infra/schema/user.ts`, mirrored here so the app and the schema cannot drift.
 * ONE WAY ONLY, exactly as the CHECK reads: a row that moves no position must not
 * invent a quantity, while a position-moving row is allowed to lack one, because
 * every row recorded before units existed does and none can be reconstructed.
 */
export const POSITION_MOVING = ['buy', 'sell', 'reinvest', 'redemption'] as const;

export function movesPosition(type: TxType): boolean {
  return (POSITION_MOVING as readonly TxType[]).includes(type);
}

/**
 * The only types that may carry `taxWithheld` — `transaction_tax_absent_ck`,
 * mirrored as `POSITION_MOVING` is. The schema spells the FIRST
 * `dividend_payout`; the migration maps the name and the MEMBERSHIP is the same
 * two. EXPORTED because `derive.ts` needs the LIST rather than the question.
 */
export const PAYOUT_TYPES = ['dividend_accrual', 'interest_payout'] as const;

export function isPayout(type: TxType): boolean {
  return (PAYOUT_TYPES as readonly TxType[]).includes(type);
}

/**
 * Does this row belong to an asset?
 *
 * A SWITCH OVER ALL EIGHT TYPES, because the question cannot be asked as a
 * NEGATION: the complement of a two-element list answers `true` for a type no one
 * classified, and the form would then demand an asset for a row that names none.
 *
 * The two that answer `false` cross the PORTFOLIO’s edge rather than an asset’s,
 * and carry `''`. It is the STORE’s rule as well as the form’s:
 * `transaction_asset_absent_ck` forbids an asset on exactly those two and
 * `transaction_asset_present_ck` REQUIRES one on the other six, so across the
 * eight the two CHECKs are this predicate and its negation.
 */
export function targetsAsset(type: TxType): boolean {
  switch (type) {
    case 'deposit':
    case 'withdrawal':
      return false;
    case 'buy':
    case 'sell':
    case 'dividend_accrual':
    case 'interest_payout':
    case 'reinvest':
    case 'redemption':
      return true;
    default:
      return unnamedType(type, true);
  }
}

export function unitDelta(tx: Transaction): number {
  if (tx.quantity === undefined || !movesPosition(tx.type)) return 0;
  return tx.type === 'sell' || tx.type === 'redemption' ? -tx.quantity : tx.quantity;
}

export interface Transaction {
  id: string;
  date: string;
  type: TxType;
  assetId: string; // '' for portfolio-level rows (deposit/withdrawal) — `targetsAsset`
  amount: number;
  /** Units this row moved. Position-moving types only, and OPTIONAL for good —
   *  every row recorded before units existed carries none, and those counts are
   *  unrecoverable, so absence is the normal state of historical data. */
  quantity?: number;
  /**
   * ₴ per unit, kept BESIDE `amount` rather than derived from it: the feed
   * publishes four decimals while `amount` is money and rounds to kopiykas, so
   * deriving either from the other loses a different digit each way.
   */
  unitPrice?: number;
  /**
   * ₴ the provider withheld from THIS payout. Payout types only and strictly below
   * `amount` — the three `transaction_tax_*` CHECKs, mirrored by the form and the
   * backup envelope.
   *
   * ONE FIGURE AND NOT TWO: a taxed distribution carries income tax and the
   * military levy, but the provider reports one withheld number, so splitting them
   * would mean deriving from the rates — which change, and a computed figure
   * eventually lies where a recorded one cannot.
   *
   * ABSENT IS THE ONLY SPELLING OF NONE, as for `quantity`.
   */
  taxWithheld?: number;
  /**
   * The row’s own line of context, 1–100 characters, on any type. THE CAP IS A
   * DRAWN CONSTRAINT before it is a stored one, and it is counted in CHARACTERS
   * rather than lines because `transaction_note_ck` enforces the same bound and
   * SQL cannot check a line count. Absent, never `''`.
   */
  note?: string;
}

// Where a quote DRAFT value came from. It lives with the draft, not in any Dexie
// row: it describes an unsaved input, and a saved Snapshot keeps no provenance.
// Both machine sources may be refilled by a later fetch — only a value with NO
// origin is the user’s and untouchable.
export type QuoteSource = 'fetch' | 'cache' | 'accrual';

export interface QuoteOrigin {
  source: QuoteSource;
  at: string;
}

export interface Settings {
  currency: 'UAH' | 'USD';
  usdRate: number; // 44.83
}
