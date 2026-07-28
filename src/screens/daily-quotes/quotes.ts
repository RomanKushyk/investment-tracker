// Pure helpers for the Daily quotes screen (not in src/lib — that layer stays
// untouched per Task 3 scope). Covered by quotes.test.ts.
import type { Asset, Snapshot } from '../../core/types';

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

// Bonds are labeled by their last 4 digits ("…8976"); other assets by the
// last word of their name ("Inzhur REIT" -> "REIT") — matches design copy.
// Shared by YieldTeaser and TransactionPanel's Recent transactions rows.
export function shortLabel(a: Asset): string {
  return a.yieldType === 'fixed_coupon'
    ? `…${a.name.slice(-4)}`
    : a.name.split(' ').at(-1)!;
}

// Bond highlight/hint label — "OVDP …8976" (first word of the name + the
// …last-4 suffix). Was duplicated inline across Overview's rebalance hint,
// Portfolio's highlight cards and Allocation's rebalance plan; unified here.
// Callers still decide their own non-bond fallback (full name vs shortLabel).
export function bondAbbrev(a: Asset): string {
  return `${a.name.split(' ')[0]} ${shortLabel(a)}`;
}
