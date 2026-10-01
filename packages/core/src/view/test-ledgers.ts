// The golden master's ledgers: the seed, and the edges it never reaches — empty, a sale, an
// unquoted asset, a position sold out, a short ledger, a linked bond — where a moved line can
// change silently.
import { parseAssetsFeed } from '../inzhur/parse';
import fixture from '../inzhur/__fixtures__/assets-sample.json';
import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '../seed';
import type { Asset, Transaction } from '../types';
import type { ViewInput } from './input';

export interface TestLedger {
  name: string;
  input: ViewInput;
}

const TODAY = '2026-07-28';
const snapshots = buildSeedSnapshots();

// Bought after the last snapshot, so no snapshot quotes it.
const FRESH: Asset = {
  id: 'fresh',
  name: 'Fresh fund',
  code: 'FR',
  colorKey: 'energy',
  yieldType: 'capitalization',
  expectedPct: 12,
  targetPct: 0,
  payoutSchedule: 'none',
  firstPurchase: '2026-07-20',
  createdAt: '2026-07-20T10:00:00',
};

const SOLD: Transaction[] = [
  { id: 's1', date: '2026-07-15', type: 'sell', assetId: 'energy', amount: 10000, quantity: 1000 },
  { id: 'd9', date: '2026-07-20', type: 'deposit', assetId: '', amount: 5000 },
  { id: 'b9', date: '2026-07-20', type: 'buy', assetId: 'fresh', amount: 5000, quantity: 500 },
];

// Two positions sold out: …8976 while later snapshots still quote it, energy after its last quote.
const SOLD_OUT: Transaction[] = [
  { id: 's2', date: '2026-07-01', type: 'sell', assetId: 'ovdp8976', amount: 15800, quantity: 15 },
  { id: 's3', date: '2026-07-26', type: 'sell', assetId: 'energy', amount: 60500, quantity: 6000 },
];

// attributes.test.ts's linked bond: its feed entry solves a YTM at the paid price.
const LINKED_BOND: Asset = {
  id: 'ovdp8976',
  name: 'OVDP UA4000238976',
  code: 'GB',
  colorKey: 'ovdp8976',
  yieldType: 'fixed_coupon',
  expectedPct: 16.4,
  targetPct: 17,
  payoutSchedule: 'semiannual',
  firstPurchase: '2026-08-12',
  createdAt: '2026-02-05T10:00:00',
  inzhur: { kind: 'bond', ref: 'UA4000238976' },
};

export const TEST_LEDGERS: TestLedger[] = [
  {
    name: 'seed',
    input: { assets: SEED_ASSETS, snapshots, transactions: SEED_TRANSACTIONS, today: TODAY },
  },
  { name: 'empty', input: { assets: [], snapshots: [], transactions: [], today: TODAY } },
  {
    name: 'sold-and-unquoted',
    input: {
      assets: [...SEED_ASSETS, FRESH],
      snapshots,
      transactions: [...SEED_TRANSACTIONS, ...SOLD],
      today: TODAY,
    },
  },
  {
    name: 'sold-out',
    input: {
      assets: SEED_ASSETS,
      snapshots,
      transactions: [...SEED_TRANSACTIONS, ...SOLD_OUT],
      today: TODAY,
    },
  },
  {
    name: 'cash-short',
    input: {
      assets: SEED_ASSETS,
      snapshots,
      transactions: [
        ...SEED_TRANSACTIONS,
        { id: 'w9', date: '2026-07-20', type: 'withdrawal', assetId: '', amount: 100 },
      ],
      today: TODAY,
    },
  },
  {
    name: 'linked',
    input: {
      assets: [LINKED_BOND],
      snapshots: [],
      transactions: [
        { id: 'd1', date: '2026-08-12', type: 'deposit', assetId: '', amount: 10_576.7 },
        {
          id: 'b1',
          date: '2026-08-12',
          type: 'buy',
          assetId: 'ovdp8976',
          amount: 10_576.7,
          quantity: 10,
          unitPrice: 1057.67,
        },
      ],
      today: TODAY,
      feed: parseAssetsFeed(fixture),
    },
  },
];
