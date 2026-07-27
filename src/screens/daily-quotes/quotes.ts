// Pure helpers for the Daily quotes screen (not in src/lib — that layer stays
// untouched per Task 3 scope). Covered by quotes.test.ts.
import type { Snapshot } from '../../lib/types';

// The latest quote for this asset strictly BEFORE the selected date — the
// row subline always reads "yesterday" even when the actual gap is bigger
// (seed: no 26.07 snapshot, so 27.07's "yesterday" is 25.07 — README §6.1).
export function yesterdayQuote(
  snapshots: Snapshot[],
  assetId: string,
  selectedDate: string,
): number | undefined {
  let best: Snapshot | undefined;
  for (const s of snapshots) {
    if (s.date < selectedDate && s.quotes[assetId] !== undefined) {
      if (!best || s.date > best.date) best = s;
    }
  }
  return best?.quotes[assetId];
}

// Most recent savedAt across all snapshots — feeds "Last saved" (only
// snapshots that were actually saved via the Save button carry savedAt).
export function maxSavedAt(snapshots: Snapshot[]): string | undefined {
  let best: string | undefined;
  for (const s of snapshots) {
    if (s.savedAt && (!best || s.savedAt > best)) best = s.savedAt;
  }
  return best;
}
