// Pure glue for the Portfolio screen. Covered by portfolio.test.ts.
import { daysBetween, latestSnapshotDate } from '../dates';
import {
  cashIsShort,
  freeCashFromLedger,
  headlineTotal,
  investedByAsset,
  latestQuotes,
  netResult,
  reinvestedByAsset,
  reinvestedTotal,
  sharePct,
  shareTotal,
  soldAmount,
  usableTotal,
  yieldSinceStart,
} from '../derive';
import type { Asset, Snapshot, Transaction } from '../types';
import type { LedgerInput } from './input';

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
  // No asset has ever been quoted: every yield would default to 0 and the first
  // asset would win by tie-break, which reads as a real result. Bail out instead.
  if (!assets.some((a) => a.id in values)) return undefined;

  let best: PerformanceResult | undefined;
  for (const asset of assets) {
    const y = yieldSinceStart(values[asset.id] ?? 0, invested[asset.id] ?? 0);
    if (!best || pick(y, best.yield)) best = { asset, yield: y };
  }
  return best;
}

export function bestPerformer(
  assets: Asset[],
  values: Record<string, number>,
  invested: Record<string, number>,
): PerformanceResult | undefined {
  return extreme(assets, values, invested, (y, best) => y > best);
}

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

// Counted on accrual: dividend_accrual plus interest_payout.
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

/**
 * What deleting an asset cascades over — the asset, its transactions and its
 * quote key in every snapshot — as structured counts; the confirm dialog owns
 * the sentence.
 */
export function cascadeCounts(
  assetId: string,
  transactions: Transaction[],
  snapshots: Snapshot[],
): { transactions: number; quoteDays: number } {
  return {
    transactions: transactions.filter((t) => t.assetId === assetId).length,
    quoteDays: snapshots.filter((s) => assetId in s.quotes).length,
  };
}

export interface PortfolioRow {
  asset: Asset;
  value: number;
  invested: number;
  reinvested: number;
  /** Both omit the sale proceeds that the Total row's `net` adds (#323). */
  pnl: number;
  pnlPct: number;
  share: number | null;
}

export interface IncomeEngineView extends IncomeEngineResult {
  /** The larger of the two flows, which the card names. */
  kind: 'dividends' | 'coupons';
  amount: number;
  /** Any of its payouts went straight back in. */
  autoReinvested: boolean;
}

export interface PortfolioView {
  rows: PortfolioRow[];
  totals: {
    invested: number;
    reinvested: number;
    value: number;
    net: { uah: number; pct: number };
    /** 100 like any share, and absent on the same total the rows' shares are. */
    share: number | null;
  };
  cash: number;
  cashShort: boolean;
  best: PerformanceResult | undefined;
  /** Weeks from the best performer's first purchase to the latest valuation. */
  bestWeeks: number | undefined;
  worst: PerformanceResult | undefined;
  engine: IncomeEngineView | undefined;
}

/** The Portfolio screen's figures: one row per asset, and the table and the cards read
 *  the same rows. Over the whole ledger, to the latest valuation. */
export function portfolioView({ assets, snapshots, transactions }: LedgerInput): PortfolioView {
  const values = latestQuotes(snapshots);
  const invested = investedByAsset(transactions);
  const reinvested = reinvestedByAsset(transactions);
  const total = headlineTotal(snapshots, transactions);
  const cash = freeCashFromLedger(transactions);
  const base = shareTotal(total, cash);
  const best = bestPerformer(assets, values, invested);
  const now = latestSnapshotDate(snapshots);
  const engine = incomeEngine(assets, transactions);
  return {
    rows: assets.map((asset) => {
      const value = values[asset.id] ?? 0;
      const inv = invested[asset.id] ?? 0;
      return {
        asset,
        value,
        invested: inv,
        reinvested: reinvested[asset.id] ?? 0,
        pnl: value - inv,
        pnlPct: yieldSinceStart(value, inv),
        share: sharePct(value, base),
      };
    }),
    totals: {
      invested: Object.values(invested).reduce((a, b) => a + b, 0),
      reinvested: reinvestedTotal(transactions),
      value: total,
      net: netResult(values, invested, soldAmount(transactions)),
      share: usableTotal(base) ? 100 : null,
    },
    cash,
    cashShort: cashIsShort(cash),
    best,
    bestWeeks: best && now ? Math.round(daysBetween(best.asset.firstPurchase, now) / 7) : undefined,
    worst: laggard(assets, values, invested),
    engine: engine && {
      ...engine,
      kind: engine.dividends >= engine.coupons ? 'dividends' : 'coupons',
      amount: engine.dividends >= engine.coupons ? engine.dividends : engine.coupons,
      autoReinvested: (reinvested[engine.asset.id] ?? 0) > 0,
    },
  };
}
