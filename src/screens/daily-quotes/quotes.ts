// Pure helpers for the Daily quotes screen. Covered by quotes.test.ts.
import { amountInputSchema } from '../../core/schemas';
import type { Lang } from '../../core/money';

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

// THE ONE READING OF THE DRAFTS. The save handler, the filled pill and the
// pending rail all consume this, so a row the schema refuses is named once
// instead of silently dropped three times — which is how a pasted amount with a
// currency word used to save an empty day. A blank draft is not an error.
export function collectQuotes(
  drafts: Record<string, string | undefined>,
  assets: Asset[],
  lang: Lang,
): CollectedQuotes {
  const quotes: Record<string, number> = {};
  const unreadable: string[] = [];
  const schema = amountInputSchema(lang);
  for (const a of assets) {
    const raw = drafts[a.id];
    if (raw === undefined || raw.trim() === '') continue;
    const parsed = schema.safeParse(raw);
    if (parsed.success) quotes[a.id] = parsed.data;
    else unreadable.push(a.id);
  }
  return { quotes, unreadable };
}

// The latest quote strictly BEFORE the selected date, WITH its date: the accrual
// carry-forward needs both.
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

// The same quote as a bare number. The row subline always reads "yesterday" even
// when the actual gap is bigger.
export function yesterdayQuote(
  snapshots: Snapshot[],
  assetId: string,
  selectedDate: string,
): number | undefined {
  return lastQuoteBefore(snapshots, assetId, selectedDate)?.value;
}

// THE PENDING CHANGE the rail names. Not a total: the sidebar already shows the
// capital, and one quantity with two values on one screen is the failure this
// block exists to avoid.
//
// THE BASELINE IS `yesterdayQuote`, and the trap is worth naming because the
// wrong function looks right: `latestQuotes` is unbounded, so on any day the
// picker is not sitting on today it measures against a snapshot LATER than the
// one every row's own subline compares to.
//
// A row can be FILLED without changing anything, so this counts rows whose value
// DIFFERS from its baseline.
//
// AN ASSET WITH NO BASELINE IS NOT COUNTED: its row shows nothing to be less
// than, and treating the missing baseline as 0 would print the asset's whole
// value as a change the day it gets its first quote.
//
// THE COMPARISON IS ROUNDED TO KOPIYKAS, because `===` on floats made "Copy
// yesterday" — which changes nothing by definition — report a change.
export function pendingChange(
  assets: Asset[],
  drafts: Record<string, string | undefined>,
  snapshots: Snapshot[],
  selectedDate: string,
  lang: Lang,
): { sum: number; changed: number } {
  let sum = 0;
  let changed = 0;
  // The screen's own reading, not a second parse of the same string: only what
  // `collectQuotes` accepts counts.
  const { quotes } = collectQuotes(drafts, assets, lang);
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

// Only snapshots actually saved through the Save button carry `savedAt`.
export function maxSavedAt(snapshots: Snapshot[]): string | undefined {
  let best: string | undefined;
  for (const s of snapshots) {
    if (s.savedAt && (!best || s.savedAt > best)) best = s.savedAt;
  }
  return best;
}

// Bonds are labelled by their last four digits, other assets by the last word of
// their name. Shared by YieldTeaser and the Recent transactions rows.
export function shortLabel(a: Asset): string {
  return a.yieldType === 'fixed_coupon' ? `…${a.name.slice(-4)}` : a.name.split(' ').at(-1)!;
}

// Bond highlight label, unified here from three inline copies. Callers still
// decide their own non-bond fallback.
export function bondAbbrev(a: Asset): string {
  return `${a.name.split(' ')[0]} ${shortLabel(a)}`;
}
