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
  | 'redemption';
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
  /**
   * The bond's fixed annual coupon rate, percent (15.68 for a bond paying ₴78.40
   * per unit twice a year on a ₴1000 nominal). D119.
   *
   * THE RATE, not the amount, because the rate is what a bond actually has: it is
   * set at issuance and never moves, while the ₴ a coupon pays moves with the
   * holding. `couponPerPayment` scales it by the ledger's units.
   *
   * NOT `expectedPct`, which on a bond is YTM at purchase — a different quantity
   * that depends on the price this holder paid. Measured, the two differ by up to
   * 4.3 percentage points and in both directions
   * (`docs/reference/OVDP-COUPON-STRUCTURE.md`).
   */
  couponRatePct?: number;
  /**
   * LEGACY (D119): ₴ one coupon paid for the WHOLE position, hand-typed. Never
   * asked for again and never written; read only when `couponRatePct` cannot
   * answer, which is every asset created before this field existed — the seed's
   * two bonds included, whose ledgers carry no quantities to scale a rate by.
   */
  couponAmount?: number;
  nextCoupon?: string;
  reinvestPolicy?: string;
  // Inzhur link (P2 feat/asset-form): valued as units × fetched sell price
  // once P3's fetch lands. `ref` = fund slug ('inzhur-reit') or bond ISIN
  // ('UA4000238976'). Optional object field — no Dexie version bump (D9).
  // `units` is LEGACY and no longer asked for (D117). The form's Units field was
  // removed on 2026-08-31: units are `Σ transaction.quantity` (D112), and in the
  // quick-create flow the very transaction being recorded IS the first purchase,
  // so the group asked for a count the row beneath it already carried.
  //
  // The FIELD went; the property stays, optional, and is never written again. It
  // is the only unit count an asset linked before this date has —
  // issue #46 §4 calls those counts unrecoverable — so
  // `matchAssets` still falls back to it and nothing regresses before the ledger
  // is backfilled. A new link carries no `units` at all.
  inzhur?: { kind: 'fund' | 'bond'; ref: string; units?: number };
}

export interface Snapshot {
  date: string; // primary key
  quotes: Record<string, number>; // partial until all assets quoted
  cash: number;
  savedAt?: string; // ISO datetime, set on save — feeds "Last saved 25.07, 21:14"
}

/**
 * The only types that may carry `quantity` — W7's `transaction_quantity_absent_ck`
 * (`infra/schema/user.ts`), mirrored here so the app and the target schema cannot
 * drift. ONE WAY ONLY, exactly as the CHECK reads: a row that moves no position
 * must not invent a quantity, while a position-moving row is allowed to lack one,
 * because every row recorded before #31 does and none can be reconstructed.
 */
export const POSITION_MOVING = ['buy', 'sell', 'reinvest', 'redemption'] as const;

/** Does this row move a position, and so admit units? */
export function movesPosition(type: TxType): boolean {
  return (POSITION_MOVING as readonly TxType[]).includes(type);
}

/**
 * The only types that may carry `taxWithheld` — W7's `transaction_tax_absent_ck`
 * (`infra/schema/user.ts`), mirrored here the way `POSITION_MOVING` mirrors the
 * quantity rule beside it. The schema spells the second `dividend_payout`; the
 * migration maps the name and the MEMBERSHIP is the same two.
 *
 * EXPORTED, unlike `PORTFOLIO_LEVEL` below, and the difference is not taste.
 * That one is not exported because `targetsAsset` is written as a NEGATION, so
 * a second name for it would hand a caller a way to ask the question inverted.
 * This is positive membership, and `derive.ts` needs the LIST rather than the
 * question — `sumByAsset` and `sumWhere` take a type array — so the tuple is the
 * same fact spelled once rather than twice.
 */
export const PAYOUT_TYPES = ['dividend_accrual', 'interest_payout'] as const;

/** Is this row a distribution, and so admit a withholding? */
export function isPayout(type: TxType): boolean {
  return (PAYOUT_TYPES as readonly TxType[]).includes(type);
}

/**
 * The rows that cross the PORTFOLIO's edge rather than an asset's, and so name
 * no asset at all. `Transaction.assetId` below has documented `''` for them
 * since P1, `lib/seed.ts` writes exactly that, `backup/json.ts` skips its
 * referential check for it and the ledger row already labels it «Портфель» —
 * `derive.ts`'s `portfolioXirr` draws the same line, citing doc §5.1.
 *
 * NOT EXPORTED, unlike `POSITION_MOVING`: `targetsAsset` is the whole API, and
 * a second name for the same fact would only give a caller a way to ask the
 * question wrongly. Membership is pinned exhaustively in `derive.test.ts`,
 * which is what stops a tenth `TxType` from defaulting into the other class in
 * silence — this predicate is a negation, so a new type joins the majority
 * without anything failing.
 */
const PORTFOLIO_LEVEL = ['deposit', 'withdrawal'] as const;

/**
 * Does this row belong to an asset? D129.
 *
 * IT IS NOW THE STORE'S RULE AS WELL AS THE FORM'S, and it did not used to be.
 * `transaction_asset_absent_ck` (`infra/schema/user.ts`) forbids an asset on
 * exactly the two types below, and `transaction_asset_present_ck` REQUIRES one
 * on all six others — so across the eight types the two CHECKs are this
 * predicate and its negation, with nothing left to judgement.
 *
 * THE GAP THAT USED TO BE HERE was the `tax` row: the CHECK required an asset
 * on the four position-moving types only, deliberately permitting a tax levied
 * on the account rather than on one payout. The form was always narrower — it
 * asked for an asset on a payout — and that mismatch is what made this
 * predicate unusable at a door that guards the store. With the type retired and
 * the CHECK widened, the two agree, and `backup/json.ts` reaches for THIS
 * predicate rather than `movesPosition`.
 *
 * The widening is what keeps a withholding attributable: taxes are summed by
 * the row's own asset, so a payout naming none would file one under the empty
 * key — counted in the portfolio total, read by no per-asset consumer, and
 * missing from neither in a way anything could notice.
 */
export function targetsAsset(type: TxType): boolean {
  return !(PORTFOLIO_LEVEL as readonly TxType[]).includes(type);
}

/** How many units this row ADDS to the position — `sell`/`redemption` remove. */
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
  source: TxSource;
  // ISSUE #31 — units, at last. Before these existed a `buy` recorded ₴ and
  // nothing else, so `Asset.inzhur.units` (one hand-typed total) was the app's
  // only unit count and every later purchase left it untouched: the fetch
  // silently understated the position by whatever those purchases bought.
  //
  // W7's `transaction.quantity` / `transaction.unit_price`, brought forward
  // rather than invented — the target schema has no running-total column on
  // `asset`, because units are a DERIVATION there: `units(a, D) = Σ quantity
  // deltas` (issue #46 §4). `derive.ts`'s
  // `unitsByAsset` is that sum.
  //
  // BOTH OPTIONAL, and they stay optional: every row recorded before this
  // landed carries neither, and §4 says the counts behind them are
  // unrecoverable. So a consumer must handle their absence — it is the normal
  // state of historical data, not a defect.
  /** Units this row moved. Position-moving types only (`movesPosition`). */
  quantity?: number;
  /**
   * ₴ per unit. Kept beside `amount` rather than derived from it because the
   * feed publishes four decimals (11.1389) while `amount` is money and rounds
   * to kopiykas — deriving one from the other loses a different digit each way.
   * W7 stores all three and enforces no arithmetic between them.
   */
  unitPrice?: number;
  /**
   * ₴ the provider withheld from THIS payout. Payout types only (`isPayout`)
   * and strictly below `amount` — W7's three `transaction_tax_*` CHECKs, which
   * the form and the backup envelope both mirror.
   *
   * ONE FIGURE AND NOT TWO. A taxed distribution here carries income tax and
   * the military levy, but the provider reports a single withheld number, so
   * recording the two apart would mean deriving them from the rates — the one
   * thing this model refuses, because rates change and a computed figure
   * eventually lies where a recorded one cannot.
   *
   * ABSENT IS THE ONLY SPELLING OF NONE, exactly as it is for `quantity`: a
   * withholding of zero and no withholding are one state, and the bond half of
   * this portfolio is always in it.
   */
  taxWithheld?: number;
  /**
   * The row's own line of context, 1–100 characters, on any type.
   *
   * THE CAP IS A DRAWN CONSTRAINT before it is a stored one — the ledger row
   * renders it, and the measurements that pick the number are in
   * `design/extensions/withholding-and-note.dc.html` T5. It is counted in
   * CHARACTERS rather than lines because `transaction_note_ck` has to enforce
   * the same bound and SQL cannot check a line count.
   *
   * Absent, never `''` — the form normalizes a blank field away and the backup
   * envelope refuses an empty string rather than repairing it.
   */
  note?: string;
}

// Where a quote DRAFT value came from (P3 S2 provenance chips). Lives with the
// draft in `state/draft.ts`, not in any Dexie row: it describes an unsaved
// input, and the saved Snapshot keeps no notion of provenance. A draft with no
// origin is the user's own value — the fact G5 protects. 'cache' = the
// last-good payload served after a failed fetch (the amber "as of 25.07");
// 'accrual' = an accepted S4 coupon-accrual suggestion (chip `auto` + the
// microcopy "accrual"). Both machine sources may be refilled by a later fetch —
// only a value with NO origin is the user's and untouchable.
export type QuoteSource = 'fetch' | 'cache' | 'accrual';

export interface QuoteOrigin {
  source: QuoteSource;
  /** ISO instant of the fetch that produced the value. */
  at: string;
}

export interface Settings {
  currency: 'UAH' | 'USD';
  usdRate: number; // 44.83
}
