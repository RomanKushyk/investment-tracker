// Pure helpers for the Daily quotes screen. Covered by quotes.test.ts.
import { needsQuote } from '@quirenote/core/derive';
import { amountInputSchema } from '@quirenote/core/schemas';
import type { Lang } from '@quirenote/core/money';

/** Money, as whole kopiykas — the unit the app displays and the one to compare in. */
function kopiykas(n: number): number {
  return Math.round(n * 100);
}
import type { Asset } from '@quirenote/core/types';
import type { DayQuotes } from '@quirenote/core/view/serve';

/** Each asset's latest recorded quote strictly before the day, with the day it was recorded: the
 *  day's read answers it (`GET /view/day`), and a day's rows are read for no other. */
export type PreviousQuotes = DayQuotes['previous'];

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

// The pill and the pending rail count over the same assets, so their «N з M» share one M.
function neededAssets(assets: Asset[], units: Record<string, number>, date: string): Asset[] {
  return assets.filter((a) => needsQuote(a, date, units[a.id]));
}

// The pill counts only the assets the day needs quoted, by the rule Balances reads a snapshot
// as complete by: a quote typed for a position sold out that day is saved, and counts nowhere.
// A day that needs none has nothing to count, so there is no pill rather than «0 з 0».
export function quoteProgress(
  assets: Asset[],
  units: Record<string, number>,
  date: string,
  quotes: Record<string, number>,
): { filled: number; total: number } | undefined {
  const needed = neededAssets(assets, units, date);
  if (needed.length === 0) return undefined;
  return { filled: needed.filter((a) => Object.hasOwn(quotes, a.id)).length, total: needed.length };
}

// The latest quote strictly BEFORE the selected date, WITH its date: the accrual
// carry-forward needs both. An OWN key only: an asset id is a key of a plain map.
export function lastQuoteBefore(
  previous: PreviousQuotes,
  assetId: string,
): { value: number; date: string } | undefined {
  return Object.hasOwn(previous, assetId) ? previous[assetId] : undefined;
}

// The same quote as a bare number. The row subline always reads "yesterday" even
// when the actual gap is bigger.
export function yesterdayQuote(previous: PreviousQuotes, assetId: string): number | undefined {
  return lastQuoteBefore(previous, assetId)?.value;
}

// THE PENDING CHANGE the rail names. Not a total: the sidebar already shows the
// capital, and one quantity with two values on one screen is the failure this
// block exists to avoid.
//
// THE BASELINE IS `yesterdayQuote`, and the trap is worth naming because the
// wrong function looks right: `quotesAsOf` with no date is unbounded, so on any
// day the picker is not sitting on today it measures against a snapshot LATER
// than the one every row's own subline compares to.
//
// IT IS THE DAY'S UNITS AT THE LAST PRICE BEFORE IT (`dayQuotes`), so a trade since
// that price is no change: on a day nothing is observed on yet, the save's capital move.
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
//
// ONLY THE ASSETS THE DAY NEEDS QUOTED COUNT, the pill's: a quote for a position
// held none of that day moves nothing the snapshot values.
export function pendingChange(
  assets: Asset[],
  units: Record<string, number>,
  drafts: Record<string, string | undefined>,
  previous: PreviousQuotes,
  selectedDate: string,
  lang: Lang,
): { sum: number; changed: number; total: number } {
  let sum = 0;
  let changed = 0;
  const needed = neededAssets(assets, units, selectedDate);
  // The screen's own reading, not a second parse of the same string: only what
  // `collectQuotes` accepts counts.
  const { quotes } = collectQuotes(drafts, needed, lang);
  for (const a of needed) {
    const value = quotes[a.id];
    if (value === undefined) continue;
    const baseline = yesterdayQuote(previous, a.id);
    if (baseline === undefined || kopiykas(value) === kopiykas(baseline)) continue;
    sum += value - baseline;
    changed += 1;
  }
  return { sum, changed, total: needed.length };
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
