// Pure glue for the Attributes screen's facts: imports core/ only and returns
// structured tokens, so the label words and the ordinal assembly live in the
// component layer.
import { couponPerPayment, nextUnsettledCouponDate } from '../accrual';
import { daysBetween } from '../dates';
import {
  annualizedPct,
  investedByAsset,
  latestQuotes,
  purchaseUnitPrice,
  startDateByAsset,
  unitsByAsset,
} from '../derive';
import { impliedYield } from '../inzhur/dcf';
import { matchAssets, NO_UNITS, type ParsedFeed } from '../inzhur/parse';
import type { Asset, PayoutSchedule, Transaction } from '../types';
import type { FeedInput, LedgerInput } from './input';
import { windowView } from './window';
import { shortBasisIn } from './yield';

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

// The "Payout schedule" fact for non-bond assets; Attributes.tsx assembles the
// label from SCHEDULE_LABEL and the ordinal.
export function payoutScheduleFact(asset: Asset, transactions: Transaction[]): PayoutScheduleFact {
  if (asset.payoutSchedule === 'none') return { schedule: 'none' };
  return { schedule: asset.payoutSchedule, day: dividendDayOfMonth(transactions, asset.id) };
}

// Undefined until the asset has an actual quote: a freshly created asset has
// invested capital but no snapshot, so value would fall back to 0 and the
// annualized figure would blow that up against the global basis. Guarding here
// keeps `annualizedPct` itself a plain numeric derivation.
export function actualAnnualizedPct(
  value: number | undefined,
  invested: number,
  daysHeld: number,
): number | undefined {
  if (value === undefined) return undefined;
  return annualizedPct(value, invested, daysHeld);
}

/**
 * YTM AT PURCHASE, DERIVED: the yield the price this holder actually paid
 * implies, against the bond's own published schedule, on the day they bought.
 *
 * It is the one bond attribute that genuinely CANNOT be folded into the coupon
 * rate — the coupon is set at issuance and is one number for life, while YTM
 * depends on the price paid, so the same bond bought on two dates has two of
 * them (`docs/reference/OVDP-COUPON-STRUCTURE.md`). But it is not a number a
 * person should have to compute: every input is already stored.
 *
 * THREE PIECES, and each can be absent — the PRICE (`unitPrice` on the first
 * purchase, which only newer rows carry), the SCHEDULE (the provider's, so the
 * asset must be linked and in the feed) and the DATE. `undefined` whenever any
 * is missing, and the caller then shows the stored `expectedPct`: not a fallback
 * to a worse number so much as to the only number available.
 *
 * NOT STORED, the same rule the DCF module states for a derived price: the
 * premises are captured, the conclusion never is. A stored YTM would go stale
 * the moment the schedule was revised, with nothing to say so.
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
  const solved = impliedYield(bought.price, match.quote.paymentSchedule, bought.date, 'ytm');
  // `unbracketed` and `not_applicable` are FINDINGS, not failures — a price no
  // yield can produce, or a schedule already spent — but neither is a figure to
  // print, so both read the same way here.
  return solved.kind === 'solved' ? solved.yieldPct : undefined;
}

export interface BondCard {
  kind: 'bond';
  asset: Asset;
  /** Solved from the paid price against the feed's schedule; absent without either. */
  ytm: number | undefined;
  /** What one payment pays THIS position, from the rate and the ledger's units. */
  coupon: number | undefined;
  /** The ledger's walk, never the stored pointer, which a recorded payout leaves behind. */
  nextCoupon: string | undefined;
}

export interface MarketCard {
  kind: 'market';
  asset: Asset;
  /** Over the full history's one span, and without the sale proceeds `/yield` adds (#288). */
  actualAnnualized: number | undefined;
  /** The mark `/yield` puts on the same figure, so the two screens agree on it. */
  shortBasis: boolean;
  payoutSchedule: PayoutScheduleFact;
}

export type AttributeCard = BondCard | MarketCard;

/** The Attributes screen's facts, one card per asset. A market asset's return is read
 *  over the full history, which is `/yield`'s window at `all`. */
export function attributesView(input: LedgerInput & FeedInput): { cards: AttributeCard[] } {
  const { assets, snapshots, transactions, feed } = input;
  const units = unitsByAsset(transactions);
  const values = latestQuotes(snapshots);
  const invested = investedByAsset(transactions);
  const w = windowView({ ...input, period: 'all' });
  const daysHeld = w ? daysBetween(w.from, w.to) : 0;
  const startByAsset = startDateByAsset(assets, transactions);
  return {
    cards: assets.map((asset): AttributeCard => {
      if (asset.yieldType === 'fixed_coupon') {
        return {
          kind: 'bond',
          asset,
          ytm: derivedYtmPct(asset, transactions, feed),
          coupon: couponPerPayment(asset, units[asset.id]),
          nextCoupon: nextUnsettledCouponDate(asset, transactions),
        };
      }
      const actualAnnualized = actualAnnualizedPct(
        values[asset.id],
        invested[asset.id] ?? 0,
        daysHeld,
      );
      return {
        kind: 'market',
        asset,
        actualAnnualized,
        shortBasis:
          actualAnnualized === undefined ? false : shortBasisIn(startByAsset[asset.id], w),
        payoutSchedule: payoutScheduleFact(asset, transactions),
      };
    }),
  };
}
