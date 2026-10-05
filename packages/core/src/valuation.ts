// The snapshot series rebuilt from per-unit prices rather than stored: one snapshot per grid day
// that values anything, each asset at that day's `units × price`, the price the latest observation
// at or before the day from either source (*Derived figures and the seed*). No I/O.
import { dayBefore } from './dates';
import { holdsNone, ledgerUnits, type ObservedPrice, type PriceSource } from './derive';
import { PERIOD_OPTIONS } from './period';
import type { Asset, Snapshot, Transaction } from './types';
import { windowView } from './view/window';

/** One observation as core reads it: a `user_price` row, or an archive row resolved to the asset
 *  it prices, of the one basis the caller chose for that asset — bases are never merged. */
export interface PriceRow {
  assetId: string;
  asOf: string;
  price: number;
}

/** The two sources, at most one row per source, asset and date. */
export interface PriceRows {
  user: PriceRow[];
  archive: PriceRow[];
}

/** A `Snapshot` plus the observation behind each quote. */
export interface ValuedSnapshot extends Snapshot {
  observed: Record<string, ObservedPrice>;
}

// Per asset, by date.
type Series = Map<string, ObservedPrice[]>;

// Both sources in one list per asset, a same-day pair keeping the user's: the latest at or before a
// day is then the newer observation, and the user's on a tie.
function priceSeries({ user, archive }: PriceRows): Series {
  const out: Series = new Map();
  const add = (rows: PriceRow[], source: PriceSource) => {
    for (const { assetId, asOf, price } of rows) {
      let list = out.get(assetId);
      if (list === undefined) out.set(assetId, (list = []));
      list.push({ price, observedOn: asOf, source });
    }
  };
  // The archive first, so a stable sort alone would keep its row: the comparator makes the user's win.
  add(archive, 'archive');
  add(user, 'user');
  const userFirst = (o: ObservedPrice) => (o.source === 'user' ? 0 : 1);
  for (const [assetId, list] of out) {
    list.sort((a, b) => a.observedOn.localeCompare(b.observedOn) || userFirst(a) - userFirst(b));
    out.set(
      assetId,
      list.filter((o, i) => i === 0 || list[i - 1].observedOn !== o.observedOn),
    );
  }
  return out;
}

// The latest observation at or before `day`: Beancount's bisect, `price_list[index - 1]`.
function priceAtOrBefore(list: ObservedPrice[], day: string): ObservedPrice | undefined {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].observedOn <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? undefined : list[lo - 1];
}

// A quote is a ₴ figure, rounded ONCE, at creation, to kopecks.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface Grid {
  /** The assets observed on each day: such a day counts only while one of them is held. */
  observed: Map<string, string[]>;
  /** Transaction and window-bound days: each counts from the first day that values anything on. */
  forced: Set<string>;
}

// A position held none of has no quote, as the quotes form asks for none (`needsQuote`); the ledger
// makes it 0. A held one no source has observed yet is absent, never 0.
function valueDays(txs: Transaction[], series: Series, grid: Grid): ValuedSnapshot[] {
  const days = [...new Set([...grid.observed.keys(), ...grid.forced])].sort((a, b) =>
    a.localeCompare(b),
  );
  const out: ValuedSnapshot[] = [];
  for (const date of days) {
    const units = ledgerUnits(txs, date).units;
    const heldObservation = (grid.observed.get(date) ?? []).some((id) => units[id] > 0);
    if (!heldObservation && !grid.forced.has(date)) continue;
    const quotes: Record<string, number> = {};
    const observed: Record<string, ObservedPrice> = {};
    for (const [assetId, list] of series) {
      const held = units[assetId];
      if (held === undefined || holdsNone(held)) continue;
      const price = priceAtOrBefore(list, date);
      if (price === undefined) continue;
      quotes[assetId] = round2(held * price.price);
      observed[assetId] = price;
    }
    // A forced day after a full exit values nothing and still closes the windows.
    if (Object.keys(quotes).length > 0 || (grid.forced.has(date) && out.length > 0)) {
      out.push({ date, quotes, observed });
    }
  }
  return out;
}

/** In date order from the first day that values anything: every day a held asset is observed on,
 *  every transaction day and the day before each period opens; the latest closes every window. */
export function rebuildSnapshots(
  assets: Asset[],
  txs: Transaction[],
  prices: PriceRows,
): ValuedSnapshot[] {
  const series = priceSeries(prices);
  const observed = new Map<string, string[]>();
  for (const [assetId, list] of series) {
    for (const { observedOn } of list) {
      let ids = observed.get(observedOn);
      if (ids === undefined) observed.set(observedOn, (ids = []));
      ids.push(assetId);
    }
  }
  const forced = new Set(txs.map((t) => t.date));
  // The windows are read off a first pass. A kept eve cannot move them: it follows the first
  // valued day, a buy `portfolioStart` reads, and precedes the close.
  const first = valueDays(txs, series, { observed, forced });
  for (const period of PERIOD_OPTIONS) {
    const w = windowView({ assets, snapshots: first, transactions: txs, period });
    if (w !== undefined) forced.add(dayBefore(w.from));
  }
  return valueDays(txs, series, { observed, forced });
}
