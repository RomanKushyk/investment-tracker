// Pure data-shaping for the Seasonality screen. Covered by seasonality.test.ts.
import {
  couponPerPayment,
  couponProjection,
  owedCouponDate,
  scheduledCouponMonths,
} from '../accrual';
import { investedByAsset, transactionsFromWindow, unitsByAsset } from '../derive';
import type { PeriodWindow } from '../period';
import type { Asset, Transaction } from '../types';
import type { LedgerInput, PeriodInput } from './input';
import { windowView } from './window';

export interface SeasonalityDay {
  day: number; // 1-31
  actual: number; // Σ dividend_accrual + interest_payout on this day-of-month, all months
  expected?: number; // projected coupon of a bond paying on this day-of-month
}

function dayOfMonth(iso: string): number {
  return Number(iso.slice(-2));
}

export function incomeByDayOfMonth(transactions: Transaction[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const t of transactions) {
    if (t.type !== 'dividend_accrual' && t.type !== 'interest_payout') continue;
    const day = dayOfMonth(t.date);
    out[day] = (out[day] ?? 0) + t.amount;
  }
  return out;
}

// Expected coupon bars come from `couponProjection`, so a bond missing
// `couponAmount` and/or `nextCoupon` still projects instead of vanishing.
function expectedByDayOfMonth(
  assets: Asset[],
  transactions: Transaction[],
): Record<number, number> {
  const out: Record<number, number> = {};
  const invested = investedByAsset(transactions);
  const units = unitsByAsset(transactions);
  for (const a of assets) {
    const coupon = couponProjection(a, invested[a.id] ?? 0, units[a.id], transactions);
    if (coupon === undefined) continue;
    const day = dayOfMonth(coupon.date);
    out[day] = (out[day] ?? 0) + coupon.amount;
  }
  return out;
}

export function seasonalityDays(transactions: Transaction[], assets: Asset[]): SeasonalityDay[] {
  return seasonalityDaysIn(transactions, assets, undefined);
}

/**
 * ONE SERIES WINDOWS AND THE OTHER CANNOT. The actual bars are FLOW — summed
 * over the window — while the expected bars are FORECAST: a coupon due in
 * September is due in September whichever three months you are looking at, so
 * the expected series reads the whole ledger in every window.
 *
 * THE CLIP IS BOTTOM-ONLY: a payout entered since the last saved quote is the
 * most recent reality, and clipping the top end makes it vanish from this screen
 * while every other screen counts it.
 */
export function seasonalityDaysIn(
  transactions: Transaction[],
  assets: Asset[],
  w: PeriodWindow | undefined,
): SeasonalityDay[] {
  const inside = transactionsFromWindow(transactions, w);
  const actual = incomeByDayOfMonth(inside);
  const expected = expectedByDayOfMonth(assets, transactions);
  const days: SeasonalityDay[] = [];
  for (let day = 1; day <= 31; day++) {
    days.push({ day, actual: actual[day] ?? 0, expected: expected[day] });
  }
  return days;
}

/** Recorded payout income, summed per calendar month. */
export function incomeByMonth(transactions: Transaction[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const t of transactions) {
    if (t.type !== 'dividend_accrual' && t.type !== 'interest_payout') continue;
    const month = Number(t.date.slice(5, 7));
    out[month] = (out[month] ?? 0) + t.amount;
  }
  return out;
}

function expectedByMonth(assets: Asset[], transactions: Transaction[]): Record<number, number> {
  const out: Record<number, number> = {};
  const invested = investedByAsset(transactions);
  const units = unitsByAsset(transactions);
  for (const a of assets) {
    const coupon = couponProjection(a, invested[a.id] ?? 0, units[a.id], transactions);
    if (coupon === undefined) continue;
    for (const month of scheduledCouponMonths(a, transactions)) {
      out[month] = (out[month] ?? 0) + coupon.amount;
    }
  }
  return out;
}

export interface SeasonalityMonth {
  month: number;
  actual: number;
  expected?: number;
}

/**
 * The same two series bucketed by MONTH OF YEAR.
 *
 * THE EXPECTED SERIES IS THE ONE THAT CHANGES: on a day axis a bond contributes
 * ONE bar, because `couponProjection` returns one occurrence; on a month axis it
 * contributes every month it is scheduled to pay in, which
 * `scheduledCouponMonths` walks forward from the schedule rather than
 * subtracting from history.
 *
 * The amount is `couponProjection`'s, unchanged: a bond that pays twice a year
 * shows its coupon in two months, not half of it in each — the bar answers "what
 * lands in this month", and what lands is a whole coupon.
 */
export function seasonalityMonths(
  transactions: Transaction[],
  assets: Asset[],
): SeasonalityMonth[] {
  return seasonalityMonthsIn(transactions, assets, undefined);
}

export function seasonalityMonthsIn(
  transactions: Transaction[],
  assets: Asset[],
  w: PeriodWindow | undefined,
): SeasonalityMonth[] {
  const inside = transactionsFromWindow(transactions, w);
  const actual = incomeByMonth(inside);
  const expected = expectedByMonth(assets, transactions);
  const months: SeasonalityMonth[] = [];
  for (let month = 1; month <= 12; month++) {
    months.push({ month, actual: actual[month] ?? 0, expected: expected[month] });
  }
  return months;
}

export function incomeAnchorDay(days: SeasonalityDay[]): SeasonalityDay | undefined {
  return days.reduce<SeasonalityDay | undefined>(
    (best, d) => (!best || d.actual > best.actual ? d : best),
    undefined,
  );
}

export function dominantAssetOnDay(transactions: Transaction[], day: number): string | undefined {
  const byAsset = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== 'dividend_accrual' && t.type !== 'interest_payout') continue;
    if (dayOfMonth(t.date) !== day) continue;
    byAsset.set(t.assetId, (byAsset.get(t.assetId) ?? 0) + t.amount);
  }
  let bestId: string | undefined;
  let bestAmount = -Infinity;
  for (const [id, amount] of byAsset) {
    if (amount > bestAmount) {
      bestAmount = amount;
      bestId = id;
    }
  }
  return bestId;
}

// Mirrors `dominantAssetOnDay` over projected coupon dates rather than posted
// transactions.
export function dominantExpectedAssetOnDay(
  assets: Asset[],
  transactions: Transaction[],
  day: number,
): string | undefined {
  let bestId: string | undefined;
  let bestAmount = -Infinity;
  const invested = investedByAsset(transactions);
  const units = unitsByAsset(transactions);
  for (const a of assets) {
    const coupon = couponProjection(a, invested[a.id] ?? 0, units[a.id], transactions);
    if (coupon === undefined || dayOfMonth(coupon.date) !== day) continue;
    if (coupon.amount > bestAmount) {
      bestAmount = coupon.amount;
      bestId = a.id;
    }
  }
  return bestId;
}

export function anchorAssetGrowth(
  transactions: Transaction[],
  assetId: string,
): { first: number; last: number } | undefined {
  const matches = transactions
    .filter((t) => t.type === 'dividend_accrual' && t.assetId === assetId)
    .sort((a, b) => a.date.localeCompare(b.date));
  // ONE PAYOUT IS NOT A TREND, and windowing this made that reachable: the card's
  // copy hardcodes «і зростають», so a single payout in the window rendered a
  // figure growing into itself, and a window whose first payout exceeds its last
  // would render a DECLINE as growth. Two points in the growing direction or the
  // card falls back to its own no-regular-income branch.
  if (matches.length < 2) return undefined;
  const first = matches[0].amount;
  const last = matches[matches.length - 1].amount;
  return last > first ? { first, last } : undefined;
}

export function quietStretch(days: SeasonalityDay[]): { from: number; to: number } | undefined {
  const to = 31;
  let from = 32;
  for (let day = 31; day >= 1; day--) {
    const entry = days.find((d) => d.day === day);
    if (entry && entry.actual === 0 && entry.expected === undefined) from = day;
    else break;
  }
  return from <= to ? { from, to } : undefined;
}

export interface BondCouponInfo {
  day: number;
  months: number[]; // historical + upcoming, deduped, ascending (1-12)
  historicalMonths: number[];
}

// Calendar months a bond has paid or will pay a coupon in, plus its coupon
// day-of-month — feeds the "Coupon season" card.
export function bondCouponInfo(
  asset: Asset,
  /** The months it has paid in are read here, which the caller may window. */
  paid: Transaction[],
  /** The whole ledger: the payment still owed depends on every unit ever bought. */
  transactions: Transaction[],
): BondCouponInfo | undefined {
  if (asset.yieldType !== 'fixed_coupon') return undefined;
  const historical = paid
    .filter((t) => t.type === 'interest_payout' && t.assetId === asset.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  // In date order: the card names the first month it paid in, beside that payout's day.
  const historicalMonths = historical.map((t) => Number(t.date.slice(5, 7)));
  const months = new Set(historicalMonths);
  const owed = owedCouponDate(asset, transactions);
  if (owed) months.add(Number(owed.slice(5, 7)));
  // A paid day first: the payment still owed can be a short final coupon on the maturity.
  const day = historical.length ? dayOfMonth(historical[0].date) : owed ? dayOfMonth(owed) : 0;
  return { day, months: [...months].sort((a, b) => a - b), historicalMonths };
}

export interface SeasonalityDayRow {
  day: number;
  actual: number;
  expected: number | undefined;
  /** Whose payouts this day's ACTUAL bar is mostly, read inside the window. */
  dominantAssetId: string | undefined;
  /** Whose projected coupon the EXPECTED bar is, read over the whole ledger. */
  expectedAssetId: string | undefined;
}

export interface OtherBond {
  asset: Asset;
  info: BondCouponInfo | undefined;
  /** The month the card names: the first it has paid in, else the first scheduled. */
  month: number | undefined;
}

export interface SeasonalityView {
  days: SeasonalityDayRow[];
  months: SeasonalityMonth[];
  anchor: SeasonalityDay | undefined;
  anchorAsset: Asset | undefined;
  anchorGrowth: { first: number; last: number } | undefined;
  bigBond: Asset | undefined;
  bigBondInfo: BondCouponInfo | undefined;
  otherBonds: OtherBond[];
  quiet: { from: number; to: number } | undefined;
}

/** The Seasonality screen's figures: the bars, and the three cards that summarise them. */
export function seasonalityView(input: LedgerInput & PeriodInput): SeasonalityView {
  const { assets, transactions } = input;
  const w = windowView(input);
  // Every FLOW reads this windowed ledger, or a windowed bar wears an unwindowed colour and a
  // card names an asset that paid nothing inside the window.
  const windowed = transactionsFromWindow(transactions, w);
  const days = seasonalityDaysIn(transactions, assets, w);
  const anchor = incomeAnchorDay(days);
  const anchorAssetId =
    anchor && anchor.actual > 0 ? dominantAssetOnDay(windowed, anchor.day) : undefined;
  const anchorAsset = assets.find((a) => a.id === anchorAssetId);
  // RANKED BY THE DERIVED COUPON, not by the stored rate: what a bond PAYS depends
  // on how much is held, so ranking off the rate headlines the wrong bond.
  const units = unitsByAsset(transactions);
  const bonds = assets
    .map((a) => ({ asset: a, coupon: couponPerPayment(a, units[a.id]) }))
    // `coupon !== undefined` ALONE: `couponPerPayment` already returns `undefined` for any
    // non-`fixed_coupon` asset.
    .filter((b): b is { asset: Asset; coupon: number } => b.coupon !== undefined)
    .sort((x, y) => y.coupon - x.coupon)
    // The months a bond HAS PAID are read in window, or the card names a month the chart drew
    // no bar for; the schedule half is a forecast. A bond with neither has no season to name.
    .map((b) => ({ asset: b.asset, info: bondCouponInfo(b.asset, windowed, transactions) }))
    .filter((b): b is { asset: Asset; info: BondCouponInfo } => !!b.info?.months.length);
  const bigBond = bonds[0];
  return {
    days: days.map((d) => ({
      day: d.day,
      actual: d.actual,
      expected: d.expected,
      dominantAssetId: d.actual > 0 ? dominantAssetOnDay(windowed, d.day) : undefined,
      expectedAssetId:
        d.expected !== undefined
          ? dominantExpectedAssetOnDay(assets, transactions, d.day)
          : undefined,
    })),
    months: seasonalityMonthsIn(transactions, assets, w),
    anchor,
    anchorAsset,
    // WINDOWED, because the DAY this sentence names already is.
    anchorGrowth: anchorAsset ? anchorAssetGrowth(windowed, anchorAsset.id) : undefined,
    bigBond: bigBond?.asset,
    bigBondInfo: bigBond?.info,
    otherBonds: bonds.slice(1).map(({ asset, info }) => ({
      asset,
      info,
      month: info?.historicalMonths[0] ?? info?.months[0],
    })),
    // Windowed too, to agree with the bars above it: under a narrow window it reports the quiet
    // the window made, a risk for the copy rather than the derivation.
    quiet: quietStretch(days),
  };
}
