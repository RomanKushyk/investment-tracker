// Pure glue for the Overview screen's derived (non-KPI-grid) cards — imports
// core/ only, returns structured tokens (G1). Covered by overview.test.ts.
import { addMonths } from '../../core/dates';
import {
  allocationDeltaPp,
  globalRoi,
  headlineTotal,
  latestCash,
  ledgerCashDrift,
  netDeposits,
  sharePct,
  topUpAmount,
} from '../../core/derive';
import type { Asset, Snapshot, Transaction } from '../../core/types';

export interface UnderweightResult {
  asset: Asset;
  deltaPp: number;
  topUp: number;
}

// Rebalance hint: the asset furthest UNDER its target share (most negative
// allocationDeltaPp) — ₴149,016.36 total + seed shares -> OVDP …8976 (D5#4).
export function mostUnderweightAsset(
  assets: Asset[],
  values: Record<string, number>,
  total: number,
): UnderweightResult | undefined {
  // Zero snapshots (empty DB) — share/target math degenerates (every asset
  // reads as fully underweight, topUp resolves to ₴0.00). Bail out so the
  // caller can show an empty state instead of a nonsense hint.
  if (total === 0) return undefined;

  let best: UnderweightResult | undefined;
  for (const asset of assets) {
    const value = values[asset.id] ?? 0;
    const deltaPp = allocationDeltaPp(sharePct(value, total), asset.targetPct);
    if (!best || deltaPp < best.deltaPp) {
      best = { asset, deltaPp, topUp: topUpAmount(value, asset.targetPct, total) };
    }
  }
  return best;
}

export interface TotalReturnKpi {
  uah: number; // the audit's NetFinancialResult = totalCapital − netDeposits
  roi: number | null; // globalRoi fraction; null when netDeposits ≤ 0 → UI renders "—"
}

// "Total return (net)" KPI (S9a) — the §5 total-return family (D13,
// docs/FORMULA-AUDIT.md): performance against EXTERNAL deposits only, shipped
// ADDITIVELY beside the D5-pinned capital-gain KPI (relabeled, never changed).
// Demo: +₴5,839.99 / +4.08% (149 016,36 − 143 176,37 over 143 176,37).
export function totalReturnKpi(
  snapshots: Snapshot[],
  transactions: Transaction[],
): TotalReturnKpi {
  const total = headlineTotal(snapshots);
  const deposits = netDeposits(transactions);
  return { uah: total - deposits, roi: globalRoi(total, deposits) };
}

// S9d chip threshold: |stored − derived| must EXCEED this to surface (₴).
export const LEDGER_DRIFT_EPSILON = 0.01;

// Ledger-drift chip value (S9d): stored observed cash vs freeCashFromLedger
// (D13 reconciliation check). Returns the signed drift when |drift| > ε,
// null otherwise (chip hidden) — also null with no snapshots (nothing
// observed to reconcile; covers the loading/empty states). Demo is 0 by
// construction (deposits 143 176,37 − buys 143 168,62 = 7,75 = stored cash).
export function ledgerDriftChip(
  snapshots: Snapshot[],
  transactions: Transaction[],
): number | null {
  if (snapshots.length === 0) return null;
  const drift = ledgerCashDrift(latestCash(snapshots), transactions);
  return Math.abs(drift) > LEDGER_DRIFT_EPSILON ? drift : null;
}

export interface PayoutRow {
  assetId: string;
  kind: 'coupon' | 'dividend';
  assetRef: string; // data-derived: '…8976' (bond last-4) / 'REIT' (last name word)
  amount: number;
  approx: boolean; // dividend rows are estimates — the UI renders a '~' prefix
  date: string; // ISO; chronological sort key — the UI renders '10 Aug'
}

// Next payouts card (design lines 187-194, D5#7): bonds read couponAmount +
// nextCoupon directly; dividend-bearing assets estimate their latest
// dividend_accrual amount, with the next date = that accrual's date + one
// payout-schedule period. Assets with payoutSchedule 'none' (Energy) or
// missing the attributes/history needed to estimate are omitted. Structured
// tokens only — the component layer assembles the visible strings (G1).
export function nextPayoutRows(assets: Asset[], transactions: Transaction[]): PayoutRow[] {
  const rows: PayoutRow[] = [];

  for (const asset of assets) {
    if (asset.yieldType === 'fixed_coupon') {
      if (asset.couponAmount === undefined || !asset.nextCoupon) continue;
      rows.push({
        assetId: asset.id,
        kind: 'coupon',
        assetRef: `…${asset.name.slice(-4)}`,
        amount: asset.couponAmount,
        approx: false,
        date: asset.nextCoupon,
      });
      continue;
    }

    if (asset.payoutSchedule === 'none') continue;

    const accruals = transactions.filter(
      (t) => t.type === 'dividend_accrual' && t.assetId === asset.id,
    );
    if (accruals.length === 0) continue;
    const latest = accruals.reduce((a, b) => (a.date > b.date ? a : b));
    const monthsPer = { monthly: 1, quarterly: 3, semiannual: 6, maturity: 0 }[
      asset.payoutSchedule
    ];
    if (!monthsPer) continue;
    rows.push({
      assetId: asset.id,
      kind: 'dividend',
      assetRef: asset.name.split(' ').at(-1)!,
      amount: latest.amount,
      approx: true,
      date: addMonths(latest.date, monthsPer),
    });
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
