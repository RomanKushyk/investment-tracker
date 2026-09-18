// Pure glue for the "Fetch quotes" ritual: everything here returns TOKENS, never
// English — the words live in the components.
//
// A FETCH MAY FILL A DRAFT INPUT BUT NEVER OVERWRITE A NUMBER THE USER PUT
// THERE. `reconcileFetched` is where that rule is decided, per row, once.
import { kyivDateIso, msUntilNextKyivHour } from '../../core/dates';
import type { InzhurMatch } from '../../core/inzhur/parse';
import type { Lang } from '../../core/money';
import { amountInputSchema } from '../../core/schemas';
import type { Asset, QuoteOrigin } from '../../core/types';

/**
 * Provenance chip tokens — `at` is an instant; the component formats it.
 * `note: 'accrual'` marks an accepted suggestion: same `auto` pill, different
 * microcopy.
 */
export type ProvenanceChip =
  | { chip: 'auto'; at: string; note?: 'accrual' }
  | { chip: 'stale'; at: string }
  | { chip: 'manual' };

export interface FeedFreshness {
  state: 'fresh' | 'stale';
  at: string;
}

/** The button machine; the error state is a toast, never a button style. */
export type FetchButtonState = 'demo' | 'unlinked' | 'loading' | 'success' | 'idle';

export interface DraftRow {
  raw: string | undefined;
  origin: QuoteOrigin | undefined;
}

export interface FetchApplication {
  /** Rows whose draft the fetch may fill (empty, or machine-owned already). */
  fills: { assetId: string; value: number }[];
  /** Rows the user typed whose value differs — OFFERED, never applied. */
  offers: { assetId: string; value: number }[];
  /**
   * Assets whose ledger sums BELOW zero — recorded sales exceed recorded
   * purchases. A data error rather than a valuation problem, and the only bucket
   * here that names one: `no-position` rows are ordinary and stay silent.
   */
  negative: string[];
  /** Linked and matched, but no count from any source. */
  noCount: string[];
}

function kopecks(n: number): number {
  return Math.round(n * 100);
}

export function sameQuote(raw: string | undefined, value: number, lang: Lang): boolean {
  if (raw === undefined) return false;
  const parsed = amountInputSchema(lang).safeParse(raw);
  return parsed.success && kopecks(parsed.data) === kopecks(value);
}

/** A draft the USER owns: non-empty and not produced by a fetch or cache fill. */
export function isTyped(row: DraftRow): boolean {
  return row.raw !== undefined && row.raw.trim() !== '' && row.origin === undefined;
}

/**
 * An offer is shown only while the row still holds a differing value of the
 * user's own, so accepting it, clearing the draft or switching the date all
 * retire it without any extra bookkeeping.
 */
export function offerVisible(row: DraftRow, value: number, lang: Lang): boolean {
  return isTyped(row) && !sameQuote(row.raw, value, lang);
}

export function provenanceChip(linked: boolean, row: DraftRow): ProvenanceChip | undefined {
  if (!linked) return undefined; // unlinked rows have no provenance to show
  if (row.raw === undefined || row.raw.trim() === '') return undefined;
  if (row.origin === undefined) return { chip: 'manual' };
  if (row.origin.source === 'cache') return { chip: 'stale', at: row.origin.at };
  return row.origin.source === 'accrual'
    ? { chip: 'auto', at: row.origin.at, note: 'accrual' }
    : { chip: 'auto', at: row.origin.at };
}

/**
 * THE DECISION. Every matched linked row lands in exactly one bucket: fill (the
 * draft is empty or was itself machine-filled), offer (the user's value differs)
 * or neither — the user already typed this very number, so the chip stays
 * `manual`: it is still their number.
 */
export function reconcileFetched(
  matches: InzhurMatch[],
  quotes: Record<string, string>,
  origins: Record<string, QuoteOrigin>,
  lang: Lang,
): FetchApplication {
  const fills: FetchApplication['fills'] = [];
  const offers: FetchApplication['offers'] = [];
  const negative: string[] = [];
  const noCount: string[] = [];

  for (const match of matches) {
    // A MATCH WITH NO VALUE IS SKIPPED, not filled with a guess: the asset is in the
    // feed but no count is known for it, so there is no position value to offer.
    // Falling through with `undefined` would write the string "undefined" into the
    // draft; with 0 it would write a real, wrong number.
    // NO VALUE MEANS NO OFFER — but only `no-position` means no message. A sold-out
    // holding is a fact the ledger states on purpose; a count below zero is
    // impossible; and NO COUNT AT ALL is a row the user has to be told about,
    // because nothing else on the screen says why it stayed empty.
    if (match.value === undefined) {
      if (match.noValue === 'negative') negative.push(match.asset.id);
      if (match.noValue === 'no-count') noCount.push(match.asset.id);
      continue;
    }
    const value = match.value;
    const assetId = match.asset.id;
    const row: DraftRow = { raw: quotes[assetId], origin: origins[assetId] };
    if (!isTyped(row)) fills.push({ assetId, value });
    else if (!sameQuote(row.raw, value, lang)) offers.push({ assetId, value });
  }

  return { fills, offers, negative, noCount };
}

/** How many portfolio assets carry a link — 0 disables the button. */
export function linkedCount(assets: Asset[]): number {
  return assets.filter((a) => a.inzhur !== undefined).length;
}

export function latestFetchedAt(...instants: (string | undefined)[]): string | undefined {
  return instants.reduce<string | undefined>(
    (best, at) => (at !== undefined && (best === undefined || at > best) ? at : best),
    undefined,
  );
}

/**
 * A payload fetched on today's KYIV date is fresh; anything older is the
 * last-good cache. Kyiv because the feed's own refresh is Kyiv's.
 */
export function feedFreshness(fetchedAt: string | undefined, now: Date): FeedFreshness | undefined {
  if (fetchedAt === undefined) return undefined;
  const fresh = kyivDateIso(new Date(fetchedAt)) === kyivDateIso(now);
  return { state: fresh ? 'fresh' : 'stale', at: fetchedAt };
}

/**
 * A click while the query is still fresh re-serves the cache instantly, on the
 * same boundary the query's own staleTime uses. The hour is a parameter because
 * this module imports core only and never learns the query's constants.
 */
export function payloadStillFresh(fetchedAt: string, now: Date, refreshHour: number): boolean {
  const at = new Date(fetchedAt);
  return now.getTime() < at.getTime() + msUntilNextKyivHour(at, refreshHour);
}

/** Gating plus machine state. Demo wins, then "nothing to fetch". */
export function fetchButtonState(opts: {
  demo: boolean;
  linked: number;
  loading: boolean;
  flash: boolean;
}): FetchButtonState {
  if (opts.demo) return 'demo';
  if (opts.linked === 0) return 'unlinked';
  if (opts.loading) return 'loading';
  if (opts.flash) return 'success';
  return 'idle';
}
