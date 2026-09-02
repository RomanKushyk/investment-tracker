// Pure glue for the Attributes screen's facts — imports core/ only, returns
// structured tokens (G1): the schedule label words + ordinal assembly live in
// the component layer. Covered by attributes.test.ts.
import { annualizedPct, purchaseUnitPrice } from '../../core/derive';
import { impliedYield } from '../../core/inzhur/dcf';
import { matchAssets, NO_UNITS, type ParsedFeed } from '../../core/inzhur/parse';
import type { Asset, PayoutSchedule, Transaction } from '../../core/types';

// Latest dividend_accrual's day-of-month for this asset (drives "Monthly · ~10th").
export function dividendDayOfMonth(
  transactions: Transaction[],
  assetId: string,
): number | undefined {
  const matches = transactions.filter(
    (t) => t.type === 'dividend_accrual' && t.assetId === assetId,
  );
  if (matches.length === 0) return undefined;
  const latest = matches.reduce((a, b) => (a.date > b.date ? a : b));
  return Number(latest.date.slice(-2));
}

export interface PayoutScheduleFact {
  schedule: PayoutSchedule;
  day?: number; // latest dividend day-of-month; undefined for 'none' or no history
}

// Attributes card "Payout schedule" fact for non-bond assets (design line
// 354: "Monthly · ~10th"; Energy's 'none' schedule renders bare per line 369).
// Attributes.tsx assembles the label from SCHEDULE_LABEL + ordinal(day).
export function payoutScheduleFact(asset: Asset, transactions: Transaction[]): PayoutScheduleFact {
  if (asset.payoutSchedule === 'none') return { schedule: 'none' };
  return { schedule: asset.payoutSchedule, day: dividendDayOfMonth(transactions, asset.id) };
}

// "Actual (ann.)" fact: undefined until the asset has an actual quote. A
// freshly created asset has invested capital but no snapshot yet — value
// would fall back to 0, making yieldSinceStart read -100% and annualizedPct
// blow that up against the global daysHeld basis (e.g. -209.8%). Guarding
// here (render shows "—" for undefined) keeps annualizedPct itself a plain
// numeric derivation.
export function actualAnnualizedPct(
  value: number | undefined,
  invested: number,
  daysHeld: number,
): number | undefined {
  if (value === undefined) return undefined;
  return annualizedPct(value, invested, daysHeld);
}

/**
 * YTM AT PURCHASE, DERIVED (D120) — the yield the price this holder actually paid
 * implies, against the bond's own published schedule, on the day they bought.
 *
 * `Asset.expectedPct` has carried this as a hand-typed number. It is the one
 * bond attribute that genuinely CANNOT be folded into the coupon rate — the
 * coupon is set at issuance and is one number for life, while YTM depends on the
 * price paid, so the same bond bought on two dates has two of them
 * (`docs/reference/OVDP-COUPON-STRUCTURE.md`; the measured gap reaches 4.30 pp
 * and changes sign). But it is not a number a person should have to compute:
 * every input is already stored.
 *
 * THREE PIECES, and each can be absent:
 *   · the PRICE — `unitPrice` on the first purchase, which only rows recorded
 *     since #31 carry;
 *   · the SCHEDULE — the provider's, so the asset must be linked and in the feed;
 *   · the DATE — `firstPurchase`, which every asset has.
 *
 * `undefined` whenever any is missing, and the caller then shows the stored
 * `expectedPct` instead. That is not a fallback to a worse number so much as a
 * fallback to the only number available: an unlinked bond has no schedule and
 * nothing here can invent one.
 *
 * NOT STORED. Same rule the DCF module already states for a derived price: the
 * premises are captured, the conclusion never is (D31). A stored YTM would go
 * stale the moment the schedule was revised, and there would be nothing to say
 * so.
 */
export function derivedYtmPct(
  asset: Asset,
  transactions: Transaction[],
  feed: ParsedFeed | undefined,
): number | undefined {
  if (asset.yieldType !== 'fixed_coupon' || feed === undefined) return undefined;
  const bought = purchaseUnitPrice(transactions, asset.id);
  if (bought === undefined) return undefined;
  // `NO_UNITS`, not a bare `{}` — the shared constant, for the reason its own doc
  // gives. The per-asset `matchAssets` rebuild is deliberate and matches the three
  // call sites in `daily-quotes/suggestions.ts`; `Attributes` memoizes the loop.
  const [match] = matchAssets([asset], feed, NO_UNITS).linked;
  if (match === undefined) return undefined;
  // `bought.date`, NOT `asset.firstPurchase` — the price is discounted against
  // the day it was actually paid. The two are independently editable and need
  // not agree; see `purchaseUnitPrice`.
  const solved = impliedYield(bought.price, match.quote.paymentSchedule, bought.date);
  // `unbracketed` and `not_applicable` are FINDINGS, not failures — a price no
  // yield can produce, or a schedule already spent — but neither is a figure to
  // print, so both read the same way here.
  return solved.kind === 'solved' ? solved.yieldPct : undefined;
}
