// Pure helpers for the Daily quotes screen (not in src/lib — that layer stays
// untouched per Task 3 scope). Covered by quotes.test.ts.
import { quoteInputSchema } from '../../core/schemas';

/** Money, as whole kopiykas — the unit the app displays and the one to compare in. */
function kopiykas(n: number): number {
  return Math.round(n * 100);
}
import type { Asset, Snapshot } from '../../core/types';

export interface CollectedQuotes {
  /** Every non-empty draft the schema accepts, by asset id. */
  quotes: Record<string, number>;
  /** Ids whose draft is non-empty and refused. Save must not proceed while non-empty. */
  unreadable: string[];
}

// THE ONE READING OF THE DRAFTS. The save handler, the "N of M filled" pill and
// the pending rail all consume this, so a row the schema refuses is named once
// instead of silently dropped three times — which is how a pasted `4 214,24 грн.`
// used to save an empty day (#1). A blank draft is not an error; it is nothing.
export function collectQuotes(
  drafts: Record<string, string | undefined>,
  assets: Asset[],
): CollectedQuotes {
  const quotes: Record<string, number> = {};
  const unreadable: string[] = [];
  for (const a of assets) {
    const raw = drafts[a.id];
    if (raw === undefined || raw.trim() === '') continue;
    const parsed = quoteInputSchema.safeParse(raw);
    if (parsed.success) quotes[a.id] = parsed.data;
    else unreadable.push(a.id);
  }
  return { quotes, unreadable };
}

// The latest quote for this asset strictly BEFORE the selected date, WITH its
// date — the accrual carry-forward needs both (S4: value + how many days ago).
export function lastQuoteBefore(
  snapshots: Snapshot[],
  assetId: string,
  selectedDate: string,
): { value: number; date: string } | undefined {
  let best: Snapshot | undefined;
  for (const s of snapshots) {
    if (s.date < selectedDate && s.quotes[assetId] !== undefined) {
      if (!best || s.date > best.date) best = s;
    }
  }
  return best === undefined ? undefined : { value: best.quotes[assetId], date: best.date };
}

// The same quote as a bare number — the row subline always reads "yesterday"
// even when the actual gap is bigger (seed: no 26.07 snapshot, so 27.07's
// "yesterday" is 25.07 — README §6.1).
export function yesterdayQuote(
  snapshots: Snapshot[],
  assetId: string,
  selectedDate: string,
): number | undefined {
  return lastQuoteBefore(snapshots, assetId, selectedDate)?.value;
}

// THE PENDING CHANGE the rail names (sheet D-4). Not a total: the sidebar
// already shows ЗАГАЛЬНИЙ КАПІТАЛ, and one quantity with two values on one
// screen is the failure this block exists to avoid. A change is a different
// quantity, and the only one this screen is in a position to know.
//
// THE BASELINE IS `yesterdayQuote(… , selectedDate)`, deliberately, and the trap
// is worth naming because the wrong function looks right: `latestQuotes` is
// unbounded, so on any day the date picker is not sitting on today it measures
// against a snapshot LATER than the one every row's «… ₴ учора» subline compares
// to. The rail would say one thing and four sublines another.
//
// A row can be FILLED without changing anything, so this counts rows whose
// value DIFFERS from its baseline — never `filled(n, m)`'s count.
//
// AN ASSET WITH NO BASELINE IS NOT COUNTED, and that is a decision the sheet
// left open: its row shows no «учора», so there is nothing for the drafted value
// to be less than, and treating the missing baseline as 0 would print the
// asset's whole value as a change the day it gets its first quote.
//
// THE COMPARISON IS ROUNDED TO KOPIYKAS, because `===` on floats made "Copy
// yesterday" — which changes nothing by definition — report a change: a stored
// quote with more than two decimals can never equal the two-decimal string
// `f.num` writes back into the draft.
export function pendingChange(
  assets: Asset[],
  drafts: Record<string, string | undefined>,
  snapshots: Snapshot[],
  selectedDate: string,
): { sum: number; changed: number } {
  let sum = 0;
  let changed = 0;
  // The screen's own reading, not a second parse of the same string: only what
  // `collectQuotes` accepts counts, and an unreadable row counts as nothing here.
  const { quotes } = collectQuotes(drafts, assets);
  for (const a of assets) {
    const value = quotes[a.id];
    if (value === undefined) continue;
    const baseline = yesterdayQuote(snapshots, a.id, selectedDate);
    if (baseline === undefined || kopiykas(value) === kopiykas(baseline)) continue;
    sum += value - baseline;
    changed += 1;
  }
  return { sum, changed };
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
  return a.yieldType === 'fixed_coupon' ? `…${a.name.slice(-4)}` : a.name.split(' ').at(-1)!;
}

// Bond highlight/hint label — "OVDP …8976" (first word of the name + the
// …last-4 suffix). Was duplicated inline across Overview's rebalance hint,
// Portfolio's highlight cards and Allocation's rebalance plan; unified here.
// Callers still decide their own non-bond fallback (full name vs shortLabel).
export function bondAbbrev(a: Asset): string {
  return `${a.name.split(' ')[0]} ${shortLabel(a)}`;
}
