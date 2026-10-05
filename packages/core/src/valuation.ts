// The snapshot series rebuilt from per-unit prices rather than stored: one snapshot per date
// that values anything, at that day's `units × price` (*Derived figures and the seed*). No I/O.
import { valueAsOf, type PriceLookup } from './derive';
import type { Snapshot, Transaction } from './types';

/** One of the user's own price observations: the `user_price` row core reads. */
export interface UserPrice {
  assetId: string;
  asOf: string;
  price: number;
}

const key = (assetId: string, asOf: string) => `${asOf}\u0000${assetId}`;

/** The user's prices, each answering on its own date only: a price carries nowhere here. */
export function userPriceLookup(rows: UserPrice[]): PriceLookup {
  const byKey = new Map(rows.map((r) => [key(r.assetId, r.asOf), r.price]));
  return (assetId, asOf) => {
    const price = byKey.get(key(assetId, asOf));
    return price === undefined ? undefined : { price, observedOn: asOf, source: 'user' };
  };
}

const noArchive: PriceLookup = () => undefined;

// A quote is a ₴ figure, rounded ONCE, at creation, to kopecks.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** In date order. An asset the ledger cannot count has no value, as `valueAsOf` answers, and a
 *  date that values nothing has no snapshot. */
export function rebuildSnapshots(txs: Transaction[], prices: UserPrice[]): Snapshot[] {
  const userPrice = userPriceLookup(prices);
  const byDate = new Map<string, Record<string, number>>();
  for (const { assetId, asOf } of prices) {
    const value = valueAsOf(assetId, asOf, txs, userPrice, noArchive);
    if (value === undefined) continue;
    let quotes = byDate.get(asOf);
    if (quotes === undefined) byDate.set(asOf, (quotes = {}));
    quotes[assetId] = round2(value);
  }
  return [...byDate]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, quotes]) => ({ date, quotes }));
}
