// Pure helpers for the Settings screen (per-screen glue, imports core only).
// Covered by settings.test.ts.
import type { Snapshot, Transaction } from '../../core/types';

// What deleting an asset cascades over (G2: the asset, its transactions, its
// quote key in every snapshot) — structured counts; the confirm dialog owns
// the sentence (D8).
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
