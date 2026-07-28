// Pure glue for the Portfolio screen's highlight cards — not in src/lib, that
// layer stays untouched per this task's scope. Covered by portfolio.test.ts.
import { yieldSinceStart } from '../../core/derive';
import type { Asset, Transaction } from '../../core/types';

export interface PerformanceResult {
  asset: Asset;
  yield: number;
}

function extreme(
  assets: Asset[],
  values: Record<string, number>,
  invested: Record<string, number>,
  pick: (a: number, b: number) => boolean,
): PerformanceResult | undefined {
  // No asset has ever been quoted (empty DB) — every yield would default to 0
  // and the first asset would win by tie-break, which reads as a real result.
  // Bail out instead so the caller can show an empty state.
  if (!assets.some((a) => a.id in values)) return undefined;

  let best: PerformanceResult | undefined;
  for (const asset of assets) {
    const y = yieldSinceStart(values[asset.id] ?? 0, invested[asset.id] ?? 0);
    if (!best || pick(y, best.yield)) best = { asset, yield: y };
  }
  return best;
}

// Best performer card: highest yieldSinceStart.
export function bestPerformer(
  assets: Asset[],
  values: Record<string, number>,
  invested: Record<string, number>,
): PerformanceResult | undefined {
  return extreme(assets, values, invested, (y, best) => y > best);
}

// Laggard card: lowest yieldSinceStart.
export function laggard(
  assets: Asset[],
  values: Record<string, number>,
  invested: Record<string, number>,
): PerformanceResult | undefined {
  return extreme(assets, values, invested, (y, best) => y < best);
}

export interface IncomeEngineResult {
  asset: Asset;
  dividends: number;
  coupons: number;
}

// Income engine card: the asset that generated the most dividend+coupon
// income to date (dividend_accrual + interest_payout, counted on accrual).
export function incomeEngine(
  assets: Asset[],
  transactions: Transaction[],
): IncomeEngineResult | undefined {
  const byAsset = new Map<string, { dividends: number; coupons: number }>();
  for (const t of transactions) {
    if (t.type !== 'dividend_accrual' && t.type !== 'interest_payout') continue;
    const entry = byAsset.get(t.assetId) ?? { dividends: 0, coupons: 0 };
    if (t.type === 'dividend_accrual') entry.dividends += t.amount;
    else entry.coupons += t.amount;
    byAsset.set(t.assetId, entry);
  }

  let bestId: string | undefined;
  let bestTotal = -Infinity;
  for (const [id, { dividends, coupons }] of byAsset) {
    const total = dividends + coupons;
    if (total > bestTotal) {
      bestTotal = total;
      bestId = id;
    }
  }
  if (!bestId) return undefined;
  const asset = assets.find((a) => a.id === bestId);
  if (!asset) return undefined;
  const { dividends, coupons } = byAsset.get(bestId)!;
  return { asset, dividends, coupons };
}
