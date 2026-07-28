// Pure glue for the Overview screen's derived (non-KPI-grid) cards — not in
// src/lib, that layer stays untouched per this task's scope. Covered by
// overview.test.ts.
import { allocationDeltaPp, sharePct, topUpAmount } from '../../lib/derive';
import { fmtProseWhole } from '../../lib/format';
import type { Asset, Transaction } from '../../lib/types';
import { addMonths, fmtPayoutDate } from '../shared/dates';

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

export interface PayoutRow {
  assetId: string;
  label: string;
  amountLabel: string;
  dateLabel: string;
  sortKey: string; // ISO date, for chronological sort
}

// Next payouts card (design lines 187-194, D5#7): bonds read couponAmount +
// nextCoupon directly; dividend-bearing assets estimate "~" + their latest
// dividend_accrual amount, with the next date = that accrual's date + one
// payout-schedule period. Assets with payoutSchedule 'none' (Energy) or
// missing the attributes/history needed to estimate are omitted.
export function nextPayoutRows(assets: Asset[], transactions: Transaction[]): PayoutRow[] {
  const rows: PayoutRow[] = [];

  for (const asset of assets) {
    if (asset.yieldType === 'fixed_coupon') {
      if (asset.couponAmount === undefined || !asset.nextCoupon) continue;
      rows.push({
        assetId: asset.id,
        label: `Coupon …${asset.name.slice(-4)}`,
        amountLabel: fmtProseWhole(asset.couponAmount),
        dateLabel: fmtPayoutDate(asset.nextCoupon),
        sortKey: asset.nextCoupon,
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
    const nextDate = addMonths(latest.date, monthsPer);
    rows.push({
      assetId: asset.id,
      label: `${asset.name.split(' ').at(-1)} dividend`,
      amountLabel: `~${fmtProseWhole(latest.amount)}`,
      dateLabel: fmtPayoutDate(nextDate),
      sortKey: nextDate,
    });
  }

  return rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}
