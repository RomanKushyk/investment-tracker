import { describe, expect, it } from 'vitest';

import { unitsByAsset } from './derive';
import type { Snapshot, Transaction } from './types';
import { rebuildSnapshots, userPriceLookup, type UserPrice } from './valuation';
import { buildView } from './view/build';
import { TEST_LEDGERS } from './view/test-ledgers';

describe('userPriceLookup — the user’s own prices, on their own dates', () => {
  const lookup = userPriceLookup([{ assetId: 'a1', asOf: '2026-05-01', price: 12 }]);

  it('names the day it observed and its source', () => {
    expect(lookup('a1', '2026-05-01')).toEqual({
      price: 12,
      observedOn: '2026-05-01',
      source: 'user',
    });
  });

  it('answers that day only — a price carries nowhere', () => {
    expect(lookup('a1', '2026-05-02')).toBeUndefined();
    expect(lookup('a1', '2026-04-30')).toBeUndefined();
    expect(lookup('a2', '2026-05-01')).toBeUndefined();
  });
});

describe('rebuildSnapshots — one snapshot per date that values anything', () => {
  const txs: Transaction[] = [
    { id: 'b1', date: '2026-03-01', type: 'buy', assetId: 'a1', amount: 1000, quantity: 100 },
    { id: 'b2', date: '2026-03-01', type: 'buy', assetId: 'a2', amount: 500, quantity: 50 },
  ];
  const prices: UserPrice[] = [
    { assetId: 'a1', asOf: '2026-04-01', price: 11 },
    { assetId: 'a2', asOf: '2026-04-01', price: 9 },
    { assetId: 'a1', asOf: '2026-05-01', price: 12 },
  ];

  it('values each priced asset at that day’s units × price', () => {
    expect(rebuildSnapshots(txs, prices)).toEqual([
      { date: '2026-04-01', quotes: { a1: 1100, a2: 450 } },
      { date: '2026-05-01', quotes: { a1: 1200 } },
    ]);
  });

  it('a date with no user price has no snapshot, and an unpriced asset no value', () => {
    const rebuilt = rebuildSnapshots(txs, prices);
    expect(rebuilt.map((s) => s.date)).toEqual(['2026-04-01', '2026-05-01']);
    expect(Object.hasOwn(rebuilt[1].quotes, 'a2')).toBe(false);
  });

  it('a date that values nothing has no snapshot: a priced asset the ledger cannot count', () => {
    const uncounted: Transaction[] = [
      { id: 'b1', date: '2026-03-01', type: 'buy', assetId: 'a1', amount: 1000 },
    ];
    expect(rebuildSnapshots(uncounted, [{ assetId: 'a1', asOf: '2026-04-01', price: 11 }])).toEqual(
      [],
    );
  });

  it('comes out in date order, whatever order the prices arrive in', () => {
    expect(rebuildSnapshots(txs, [...prices].reverse())).toEqual(rebuildSnapshots(txs, prices));
    expect(rebuildSnapshots(txs, [...prices].reverse()).map((s) => s.date)).toEqual([
      '2026-04-01',
      '2026-05-01',
    ]);
  });
});

// Each stored quote is a ₴ position value; divided by the units held that day it is the per-unit
// price the server would store for it. A non-zero quote of a position held none of has no such price.
const asUserPrices = (snapshots: Snapshot[], txs: Transaction[]): UserPrice[] | undefined => {
  const out: UserPrice[] = [];
  for (const s of snapshots) {
    const units = unitsByAsset(txs, s.date);
    for (const [assetId, quote] of Object.entries(s.quotes)) {
      if (!(units[assetId] > 0)) return undefined;
      out.push({ assetId, asOf: s.date, price: quote / units[assetId] });
    }
  }
  return out;
};

const unsaved = (snapshots: Snapshot[]): Snapshot[] =>
  snapshots.map(({ date, quotes }) => ({ date, quotes }));

// The paths where two outputs differ by more than float noise: the composers sum ₴ floats in key
// order, so the same quotes in another order can differ in the last place.
function beyondNoise(a: unknown, b: unknown, path = '$'): string[] {
  if (typeof a === 'number' && typeof b === 'number') {
    const close = Object.is(a, b) || Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b));
    return close ? [] : [path];
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return Object.is(a, b) ? [] : [path];
  }
  const at = (o: object, k: string) => (o as Record<string, unknown>)[k];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => beyondNoise(at(a, k), at(b, k), `${path}.${k}`));
}

describe('every golden ledger a per-unit price can express rebuilds to its own figures', () => {
  const expressible = TEST_LEDGERS.filter(
    (l) => asUserPrices(l.input.snapshots, l.input.transactions) !== undefined,
  );

  // `sold-out` quotes …8976 after the ledger holds none of it: no price per unit values to that.
  it('leaves out only the ledger that quotes a position held none of', () => {
    expect(TEST_LEDGERS.filter((l) => !expressible.includes(l)).map((l) => l.name)).toEqual([
      'sold-out',
    ]);
  });

  // The seed's case is the criterion: every composer over all six periods, through `buildView`.
  it.each(expressible.map((l) => [l.name, l.input] as const))('%s', (_, input) => {
    const prices = asUserPrices(input.snapshots, input.transactions)!;
    const rebuilt = rebuildSnapshots(input.transactions, prices);
    expect(rebuilt).toEqual(unsaved(input.snapshots));
    expect(buildView({ ...input, snapshots: rebuilt })).toEqual(buildView(input));
  });

  it('read in the store’s order, asset then date, the seed differs by float noise at most', () => {
    const seed = TEST_LEDGERS.find((l) => l.name === 'seed')!.input;
    // `user_price`'s primary key is (user_id, asset_id, as_of).
    const stored = asUserPrices(seed.snapshots, seed.transactions)!.sort(
      (x, y) => x.assetId.localeCompare(y.assetId) || x.asOf.localeCompare(y.asOf),
    );
    const rebuilt = rebuildSnapshots(seed.transactions, stored);
    expect(beyondNoise(buildView({ ...seed, snapshots: rebuilt }), buildView(seed))).toEqual([]);
  });
});
