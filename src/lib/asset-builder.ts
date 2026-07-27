// Pure builder for the Asset created inline from the Transaction panel's
// "New asset details" sub-form. Pinned rules (task 4 plan):
// id = crypto.randomUUID(); code = first 2 letters of the name, uppercased;
// colorKey cycles the 4 tint keys by current asset count; firstPurchase =
// the transaction's own date; createdAt = now (drives listAssets order).
import type { Asset, PayoutSchedule, YieldType } from './types';

const COLOR_KEY_CYCLE = ['reit', 'energy', 'ovdp8976', 'ovdp6475'] as const;

export interface NewAssetValues {
  name: string;
  yieldType: YieldType;
  expectedPct: number;
  targetPct: number;
  payoutSchedule: PayoutSchedule;
}

export function buildNewAsset(
  values: NewAssetValues,
  txDate: string,
  existingAssetCount: number,
): Asset {
  return {
    id: crypto.randomUUID(),
    name: values.name,
    code: values.name.trim().slice(0, 2).toUpperCase(),
    colorKey: COLOR_KEY_CYCLE[existingAssetCount % COLOR_KEY_CYCLE.length],
    yieldType: values.yieldType,
    expectedPct: values.expectedPct,
    targetPct: values.targetPct,
    payoutSchedule: values.payoutSchedule,
    firstPurchase: txDate,
    createdAt: new Date().toISOString(),
  };
}
