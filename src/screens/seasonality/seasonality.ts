// Pure data-shaping for the Seasonality screen (day-of-month bars + insight
// cards) — not in src/lib, that layer stays untouched per this task's scope.
// Covered by seasonality.test.ts.
import { couponProjection, scheduledCouponMonths } from '../../core/accrual';
import { investedByAsset, transactionsFromWindow, unitsByAsset } from '../../core/derive';
import type { PeriodWindow } from '../../core/period';
import type { Asset, Transaction } from '../../core/types';

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

// Expected coupon bars come from core/accrual.couponProjection, so a bond
// missing couponAmount and/or nextCoupon still projects (estimated amount /
// maturity date) instead of vanishing from the chart — P3 feat/fixed-yield.
function expectedByDayOfMonth(
  assets: Asset[],
  transactions: Transaction[],
): Record<number, number> {
  const out: Record<number, number> = {};
  const invested = investedByAsset(transactions);
  const units = unitsByAsset(transactions);
  for (const a of assets) {
    const coupon = couponProjection(a, invested[a.id] ?? 0, units[a.id]);
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
 * ONE SERIES WINDOWS AND THE OTHER CANNOT, and the spine says which (A42).
 * `/seasonality actual bars` are **FLOW** — "sum over the window, bucketed by
 * day or by month" — while `/seasonality expected bars` are **FORECAST**:
 * *"nothing — a projection has no window"*. A coupon due in September is due in
 * September whichever three months you are looking at, so the expected series
 * reads the whole ledger in every window, including the `investedByAsset` that
 * sizes an estimated coupon.
 *
 * THE CLIP IS BOTTOM-ONLY, matching `/overview`'s `Отриманий дохід` — the same
 * FLOW row of the same table, and the same reason `yieldTableRowsIn` gives: a
 * payout entered since the last saved quote is the most recent reality, and
 * clipping the top end makes it vanish from this screen while every other
 * screen counts it. On the seed the two readings agree to the kopeck.
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
    const coupon = couponProjection(a, invested[a.id] ?? 0, units[a.id]);
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
 * The same two series bucketed by MONTH OF YEAR (A41, extension § S4).
 *
 * THE EXPECTED SERIES IS THE ONE THAT CHANGES, and it is D-5's answer. On a day
 * axis one bond contributes ONE bar, because `couponProjection` returns one
 * occurrence; on a month axis it contributes every month it is scheduled to pay
 * in, which `scheduledCouponMonths` walks forward from the schedule rather than
 * subtracting from history. The sheet left this open because both of its
 * formulations degenerated — see that function for why, and for the test that
 * pins the case they failed.
 *
 * The amount is `couponProjection`'s, unchanged: one coupon's worth per month
 * the bond pays in. A bond that pays twice a year shows its coupon in two
 * months, not half of it in each — the bar answers "what lands in this month",
 * and what lands is a whole coupon.
 */
export function seasonalityMonths(
  transactions: Transaction[],
  assets: Asset[],
): SeasonalityMonth[] {
  return seasonalityMonthsIn(transactions, assets, undefined);
}

/** The month axis under the same window, and the same split (A42). */
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

// "Income anchor" card: the day-of-month with the most accumulated income.
export function incomeAnchorDay(days: SeasonalityDay[]): SeasonalityDay | undefined {
  return days.reduce<SeasonalityDay | undefined>(
    (best, d) => (!best || d.actual > best.actual ? d : best),
    undefined,
  );
}

// The asset contributing the most income on a given day-of-month.
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

// The asset contributing the most expected coupon income on a given
// day-of-month (mirrors dominantAssetOnDay, but over projected coupon dates
// rather than posted transactions).
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
    const coupon = couponProjection(a, invested[a.id] ?? 0, units[a.id]);
    if (coupon === undefined || dayOfMonth(coupon.date) !== day) continue;
    if (coupon.amount > bestAmount) {
      bestAmount = coupon.amount;
      bestId = a.id;
    }
  }
  return bestId;
}

// First -> latest dividend_accrual amount for an asset ("₴580 -> ₴700 and growing").
export function anchorAssetGrowth(
  transactions: Transaction[],
  assetId: string,
): { first: number; last: number } | undefined {
  const matches = transactions
    .filter((t) => t.type === 'dividend_accrual' && t.assetId === assetId)
    .sort((a, b) => a.date.localeCompare(b.date));
  // ONE PAYOUT IS NOT A TREND, and windowing this made that reachable (A42
  // review). The card's copy hardcodes «і зростають», so a window holding a
  // single REIT dividend rendered «700 ₴ → 700 ₴ і зростають» — and a window
  // whose first payout exceeds its last would render a DECLINE as growth. Two
  // points in the growing direction or the card falls back to its own
  // "no regular income yet" branch, which is the honest answer for a window
  // that cannot show a trend.
  if (matches.length < 2) return undefined;
  const first = matches[0].amount;
  const last = matches[matches.length - 1].amount;
  return last > first ? { first, last } : undefined;
}

// Longest trailing run of zero-income, zero-expected days ("Quiet stretch").
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

// Calendar months a bond has paid/will pay a coupon in, plus its coupon
// day-of-month — feeds the "Coupon season" card.
export function bondCouponInfo(
  asset: Asset,
  transactions: Transaction[],
): BondCouponInfo | undefined {
  if (asset.yieldType !== 'fixed_coupon') return undefined;
  const historical = transactions
    .filter((t) => t.type === 'interest_payout' && t.assetId === asset.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const historicalMonths = historical.map((t) => Number(t.date.slice(5, 7))).sort((a, b) => a - b);
  const months = new Set(historicalMonths);
  if (asset.nextCoupon) months.add(Number(asset.nextCoupon.slice(5, 7)));
  const day = asset.nextCoupon
    ? dayOfMonth(asset.nextCoupon)
    : historical.length
      ? dayOfMonth(historical[0].date)
      : 0;
  return { day, months: [...months].sort((a, b) => a - b), historicalMonths };
}
