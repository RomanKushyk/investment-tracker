// Pure data-shaping for the Allocation screen. Covered by allocation.test.ts.
import {
  allocationDeltaPp,
  cashIsShort,
  freeCashFromLedger,
  headlineTotal,
  heldValueOf,
  heldValues,
  sharePct,
  shareTotal,
  topUpAmount,
  trimAmount,
  usableTotal,
} from '../derive';
import type { Asset } from '../types';
import type { LedgerInput } from './input';

// Off-target colour encodes SEVERITY, not sign: within the threshold reads near
// even on a negative delta, and beyond it reads off even on a positive one.
const NEAR_TARGET_PP = 0.5;

// A row's pill colour, by the threshold above.
function severityOf(deltaPp: number): 'near' | 'off' {
  return Math.abs(deltaPp) <= NEAR_TARGET_PP ? 'near' : 'off';
}

export interface AllocationRow {
  asset: Asset;
  share: number | null; // pct 0-100; null when the total is not usable or the value is absent
  target: number;
  deltaPp: number | null; // share - target
  severity: 'near' | 'off' | null;
}

export function allocationRows(
  assets: Asset[],
  values: Record<string, number>,
  total: number,
): AllocationRow[] {
  return assets.map((asset) => {
    const value = heldValueOf(values, asset.id);
    const share = value === undefined ? null : sharePct(value, total);
    const deltaPp = share === null ? null : allocationDeltaPp(share, asset.targetPct);
    return {
      asset,
      share,
      target: asset.targetPct,
      deltaPp,
      severity: deltaPp === null ? null : severityOf(deltaPp),
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
  // No plan off a total that is not usable: `topUpAmount` would offer a negative buy.
  if (!usableTotal(total)) return { actions, withinRange };

  for (const asset of assets) {
    // A held position no snapshot values has no share: neither a buy nor "within range".
    const value = heldValueOf(values, asset.id);
    if (value === undefined) continue;
    const share = sharePct(value, total);
    if (share === null) continue;
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

export interface AllocationView {
  total: number;
  cashShort: boolean;
  /** Whether any share can be taken: the donut and the plan are gated on it. */
  usable: boolean;
  slices: { asset: Asset; value: number }[];
  rows: AllocationRow[];
  plan: RebalancePlan;
}

/** The Allocation screen's figures, against the share base the rest of the app uses.
 *  A DRAFTED target is the editor's, never a figure: it moves only the tick. */
export function allocationView({ assets, snapshots, transactions }: LedgerInput): AllocationView {
  const values = heldValues(assets, snapshots, transactions);
  const total = headlineTotal(snapshots, transactions);
  const cash = freeCashFromLedger(transactions);
  const base = shareTotal(total, cash);
  return {
    total,
    cashShort: cashIsShort(cash),
    usable: usableTotal(base),
    // An absent value draws no segment.
    slices: assets.flatMap((asset) => {
      const value = heldValueOf(values, asset.id);
      return value === undefined ? [] : [{ asset, value }];
    }),
    rows: allocationRows(assets, values, base),
    plan: rebalancePlan(assets, values, base),
  };
}
