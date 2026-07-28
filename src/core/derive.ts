// Pure derivations — every displayed figure comes from these. No I/O.
// Reference-reconciliation rules are pinned in docs/DECISIONS.md D5.
import type { Snapshot, Transaction } from './types';

// Global daysHeld basis for annualization — a single date for ALL assets
// (design §6.5 footnote), NOT each asset's own firstPurchase.
export const PORTFOLIO_START = '2026-02-03';

const byDate = (snaps: Snapshot[]) => [...snaps].sort((a, b) => a.date.localeCompare(b.date));

// Latest available quote PER ASSET, partial snapshots included — the HEADLINE basis (D5#1).
export function latestQuotes(snaps: Snapshot[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of byDate(snaps)) Object.assign(out, s.quotes);
  return out;
}

export function latestCash(snaps: Snapshot[]): number {
  const sorted = byDate(snaps);
  return sorted.length ? sorted[sorted.length - 1].cash : 0;
}

export function headlineTotal(snaps: Snapshot[]): number {
  return Object.values(latestQuotes(snaps)).reduce((a, b) => a + b, 0) + latestCash(snaps);
}

// Balances-only: the most recent snapshot quoting every given asset.
export function latestCompleteSnapshot(
  snaps: Snapshot[],
  assetIds: string[],
): Snapshot | undefined {
  const sorted = byDate(snaps);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (assetIds.every((id) => sorted[i].quotes[id] !== undefined)) return sorted[i];
  }
  return undefined;
}

// Σ quotes + cash of ONE snapshot (Balances rows / area chart).
export function totalCapital(s: Snapshot): number {
  return Object.values(s.quotes).reduce((a, b) => a + b, 0) + s.cash;
}

function sumByAsset(txs: Transaction[], types: readonly Transaction['type'][]) {
  const out: Record<string, number> = {};
  for (const t of txs) {
    if (types.includes(t.type)) out[t.assetId] = (out[t.assetId] ?? 0) + t.amount;
  }
  return out;
}

export function investedByAsset(txs: Transaction[]): Record<string, number> {
  return sumByAsset(txs, ['buy', 'reinvest']);
}

export function reinvestedByAsset(txs: Transaction[]): Record<string, number> {
  return sumByAsset(txs, ['reinvest']);
}

export function reinvestedTotal(txs: Transaction[]): number {
  return Object.values(reinvestedByAsset(txs)).reduce((a, b) => a + b, 0);
}

export function depositedTotal(txs: Transaction[]): number {
  return txs.filter((t) => t.type === 'deposit').reduce((a, t) => a + t.amount, 0);
}

// Σvalues − Σinvested, cash EXCLUDED → +₴4,452.61 / +3.08% on seed.
export function netResult(
  values: Record<string, number>,
  invested: Record<string, number>,
): { uah: number; pct: number } {
  const v = Object.values(values).reduce((a, b) => a + b, 0);
  const i = Object.values(invested).reduce((a, b) => a + b, 0);
  return { uah: v - i, pct: i === 0 ? 0 : (v - i) / i };
}

export function yieldSinceStart(value: number, invested: number): number {
  return invested === 0 ? 0 : value / invested - 1;
}

export function annualizedPct(value: number, invested: number, daysHeld: number): number {
  return daysHeld === 0 ? 0 : (yieldSinceStart(value, invested) * 365) / daysHeld;
}

export function sharePct(value: number, total: number): number {
  return total === 0 ? 0 : (value / total) * 100;
}

export function allocationDeltaPp(share: number, targetPct: number): number {
  return share - targetPct;
}

// Overweight sell: linear share of the (unchanged) total → REIT trim ₴9,095.
export function trimAmount(share: number, targetPct: number, total: number): number {
  return ((share - targetPct) / 100) * total;
}

// Buy with NEW money — the total grows with the purchase (D5#4):
// x such that (value + x) / (total + x) = target → …8976 top-up ₴11,429.49.
export function topUpAmount(value: number, targetPct: number, total: number): number {
  const t = targetPct / 100;
  return (t * total - value) / (1 - t);
}

// Headline KPI composition (sidebar capital card): one derivation site so the
// shell never re-implements the latestQuotes/investedByAsset/netResult chain
// that Overview's KPI grid is built from.
export function headlineKpis(
  snaps: Snapshot[],
  txs: Transaction[],
): { total: number; net: { uah: number; pct: number } } {
  return {
    total: headlineTotal(snaps),
    net: netResult(latestQuotes(snaps), investedByAsset(txs)),
  };
}

// dividend_accrual → dividends; interest_payout → coupons (counted on accrual, §6.5).
export function incomeReceived(txs: Transaction[]): {
  dividends: number;
  coupons: number;
  total: number;
} {
  let dividends = 0;
  let coupons = 0;
  for (const t of txs) {
    if (t.type === 'dividend_accrual') dividends += t.amount;
    else if (t.type === 'interest_payout') coupons += t.amount;
  }
  return { dividends, coupons, total: dividends + coupons };
}
