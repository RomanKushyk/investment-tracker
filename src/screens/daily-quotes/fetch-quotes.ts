// Per-screen pure glue for the Daily-quotes "Fetch quotes" ritual (S1–S3 of
// design/extensions/daily-quotes-live.dc.html). Everything here is pure and
// returns TOKENS, never English (D8) — the words live in the components.
//
// G5 IS THE WHOLE POINT of this module: a fetch may fill a draft input, but it
// may never overwrite a number the user put there. `reconcileFetched` is where
// that rule is decided, per row, once.
import { kyivDateIso, msUntilNextKyivHour } from '../../core/dates';
import type { InzhurMatch } from '../../core/inzhur/parse';
import { quoteInputSchema } from '../../core/schemas';
import type { Asset, QuoteOrigin } from '../../core/types';

/**
 * S2 provenance chip tokens — `at` is an instant; the component formats it.
 * `note: 'accrual'` marks an accepted S4 suggestion: same `auto` pill, but the
 * microcopy beside it reads "accrual" instead of "fetched HH:MM".
 */
export type ProvenanceChip =
  | { chip: 'auto'; at: string; note?: 'accrual' }
  | { chip: 'stale'; at: string }
  | { chip: 'manual' };

/** S1 header microcopy token: the payload is either today's or older. */
export interface FeedFreshness {
  state: 'fresh' | 'stale';
  at: string;
}

/** S1 button machine (the error state is a toast, never a button style). */
export type FetchButtonState = 'demo' | 'unlinked' | 'loading' | 'success' | 'idle';

/** One row of the reconciliation input. */
export interface DraftRow {
  raw: string | undefined;
  origin: QuoteOrigin | undefined;
}

export interface FetchApplication {
  /** Rows whose draft the fetch may fill (empty, or machine-owned already). */
  fills: { assetId: string; value: number }[];
  /** Rows the user typed whose value differs — OFFERED (S3), never applied. */
  offers: { assetId: string; value: number }[];
}

function kopecks(n: number): number {
  return Math.round(n * 100);
}

/** Does this raw draft text already mean exactly `value`? (S3 equality guard.) */
export function sameQuote(raw: string | undefined, value: number): boolean {
  if (raw === undefined) return false;
  const parsed = quoteInputSchema.safeParse(raw);
  return parsed.success && kopecks(parsed.data) === kopecks(value);
}

/** A draft the USER owns: non-empty and not produced by a fetch/cache fill. */
export function isTyped(row: DraftRow): boolean {
  return row.raw !== undefined && row.raw.trim() !== '' && row.origin === undefined;
}

/**
 * S3: an offer is shown only while the row still holds a differing value of
 * the user's own — so accepting it, clearing the draft or switching the date
 * all retire the offer without any extra bookkeeping.
 */
export function offerVisible(row: DraftRow, value: number): boolean {
  return isTyped(row) && !sameQuote(row.raw, value);
}

/** S2: the chip of a linked row's current draft (undefined = no chip at all). */
export function provenanceChip(
  linked: boolean,
  row: DraftRow,
): ProvenanceChip | undefined {
  if (!linked) return undefined; // unlinked rows have no provenance to show
  if (row.raw === undefined || row.raw.trim() === '') return undefined;
  if (row.origin === undefined) return { chip: 'manual' };
  if (row.origin.source === 'cache') return { chip: 'stale', at: row.origin.at };
  return row.origin.source === 'accrual'
    ? { chip: 'auto', at: row.origin.at, note: 'accrual' }
    : { chip: 'auto', at: row.origin.at };
}

/**
 * THE G5 decision. Every matched linked row lands in exactly one bucket:
 * fill (the draft is empty or was itself machine-filled), offer (the user's
 * value differs) or neither (the user already typed this very number — no
 * offer, and the chip stays `manual`: it is still their number).
 */
export function reconcileFetched(
  matches: InzhurMatch[],
  quotes: Record<string, string>,
  origins: Record<string, QuoteOrigin>,
): FetchApplication {
  const fills: FetchApplication['fills'] = [];
  const offers: FetchApplication['offers'] = [];

  for (const match of matches) {
    const assetId = match.asset.id;
    const row: DraftRow = { raw: quotes[assetId], origin: origins[assetId] };
    if (!isTyped(row)) fills.push({ assetId, value: match.value });
    else if (!sameQuote(row.raw, match.value)) offers.push({ assetId, value: match.value });
  }

  return { fills, offers };
}

/** How many portfolio assets carry an Inzhur link — 0 disables the button. */
export function linkedCount(assets: Asset[]): number {
  return assets.filter((a) => a.inzhur !== undefined).length;
}

/** The later of two fetch instants (either may be absent). */
export function latestFetchedAt(...instants: (string | undefined)[]): string | undefined {
  return instants.reduce<string | undefined>(
    (best, at) => (at !== undefined && (best === undefined || at > best) ? at : best),
    undefined,
  );
}

/**
 * S1 header microcopy: a payload fetched on today's KYIV date is fresh
 * ("Inzhur 13:05"); anything older is the last-good cache ("Inzhur as of
 * 25.07", warn). Kyiv because the feed's ~13:00 refresh is Kyiv's (D19).
 */
export function feedFreshness(
  fetchedAt: string | undefined,
  now: Date,
): FeedFreshness | undefined {
  if (fetchedAt === undefined) return undefined;
  const fresh = kyivDateIso(new Date(fetchedAt)) === kyivDateIso(now);
  return { state: fresh ? 'fresh' : 'stale', at: fetchedAt };
}

/**
 * S1: "a click while the query is still fresh re-serves the cache instantly".
 * Same boundary the query's own staleTime uses — a payload stays fresh until
 * the feed's next `refreshHour`:00 in Kyiv (D19), so the hour is a parameter
 * (this module imports core only and never learns the query's constants).
 */
export function payloadStillFresh(fetchedAt: string, now: Date, refreshHour: number): boolean {
  const at = new Date(fetchedAt);
  return now.getTime() < at.getTime() + msUntilNextKyivHour(at, refreshHour);
}

/** S1 gating + machine state. Demo wins, then "nothing to fetch". */
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
