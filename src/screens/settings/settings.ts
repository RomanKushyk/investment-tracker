// Pure helpers for the Settings screen (per-screen glue, imports core only).
// Covered by settings.test.ts.
import { isLeadDays } from '../../core/reminders';
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

/**
 * S8 "Lead time, days": the typed value, or `null` when it is not a whole
 * number of days inside 1–30 (the field then shows "Enter 1–30 days." and
 * nothing is written — `core/reminders.isLeadDays` is the shared rule, so the
 * persist sanitizer can never disagree with this field).
 */
export function parseLeadDays(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number(trimmed);
  return isLeadDays(days) ? days : null;
}
