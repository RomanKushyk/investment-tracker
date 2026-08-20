// Pure data-shaping for the Allocation screen (donut/legend, current-vs-target
// pills, rebalance plan) — not in src/lib, that layer stays untouched per this
// task's scope. Covered by allocation.test.ts.
import { allocationDeltaPp, sharePct, topUpAmount, trimAmount } from '../../core/derive';
import type { Asset } from '../../core/types';

// Off-target color encodes SEVERITY, not sign: within ~0.5pp of target reads
// "near" (green) even if the delta is negative; beyond it reads "off" (red)
// even if the delta is positive (design lines 524-537, D5 checkpoint).
const NEAR_TARGET_PP = 0.5;

/**
 * The one place the threshold is applied (A30 review). `Allocation.tsx` has to
 * re-derive severity against a DRAFTED target while the editor is open, and the
 * first draft inlined `Math.abs(deltaPp) > 0.5` there — a second copy of a rule
 * `allocation.test.ts` only covers through `allocationRows`. Moving
 * `NEAR_TARGET_PP` would then have changed the rebalance plan and the pill
 * colour apart while the suite stayed green.
 */
export function severityOf(deltaPp: number): 'near' | 'off' {
  return Math.abs(deltaPp) <= NEAR_TARGET_PP ? 'near' : 'off';
}

export interface AllocationRow {
  asset: Asset;
  share: number; // pct 0-100
  target: number;
  deltaPp: number; // share - target
  severity: 'near' | 'off';
}

export function allocationRows(
  assets: Asset[],
  values: Record<string, number>,
  total: number,
): AllocationRow[] {
  return assets.map((asset) => {
    const share = sharePct(values[asset.id] ?? 0, total);
    const deltaPp = allocationDeltaPp(share, asset.targetPct);
    return {
      asset,
      share,
      target: asset.targetPct,
      deltaPp,
      severity: severityOf(deltaPp),
    };
  });
}

export interface RebalanceAction {
  kind: 'buy' | 'sell';
  asset: Asset;
  amount: number; // positive magnitude
}

export interface RebalancePlan {
  actions: RebalanceAction[]; // buys first, then sells (design order)
  withinRange: Asset[];
}

export function rebalancePlan(
  assets: Asset[],
  values: Record<string, number>,
  total: number,
): RebalancePlan {
  const actions: RebalanceAction[] = [];
  const withinRange: Asset[] = [];

  for (const asset of assets) {
    const value = values[asset.id] ?? 0;
    const share = sharePct(value, total);
    const deltaPp = allocationDeltaPp(share, asset.targetPct);
    if (deltaPp > NEAR_TARGET_PP) {
      actions.push({ kind: 'sell', asset, amount: trimAmount(share, asset.targetPct, total) });
    } else if (deltaPp < -NEAR_TARGET_PP) {
      actions.push({ kind: 'buy', asset, amount: topUpAmount(value, asset.targetPct, total) });
    } else {
      withinRange.push(asset);
    }
  }

  actions.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'buy' ? -1 : 1));
  return { actions, withinRange };
}
