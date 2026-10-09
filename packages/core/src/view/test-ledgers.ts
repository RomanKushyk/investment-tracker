// The golden master's ledgers: the seed, and the edges it never reaches — empty, a sale, an
// unquoted asset, a position sold out, a short ledger, a linked bond — where a moved line can
// change silently. Beside them, the stored quotes as per-unit price rows for the rebuild's suites.
import { parseAssetsFeed } from '../inzhur/parse';
import fixture from '../inzhur/__fixtures__/assets-sample.json';
import { unitsByAsset } from '../derive';
import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '../seed';
import type { Asset, Snapshot, Transaction } from '../types';
import type { PriceRow } from '../valuation';
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

// Beside the golden master's ledgers, not among them: a linked bond whose published dates the build
// carries. Its first period is 181 days and ends on the 30th, where a 182-day step reads the 1st.
export const PUBLISHED_DATES = [
  '2026-04-02',
  '2026-09-30',
  '2027-03-31',
  '2027-09-29',
  '2028-03-29',
  '2028-09-27',
];
export const PUBLISHED_BOND: Asset = {
  id: 'pub',
  name: 'OVDP UA0000000340',
  code: 'GB',
  colorKey: 'ovdp8976',
  yieldType: 'fixed_coupon',
  expectedPct: 16,
  targetPct: 10,
  payoutSchedule: 'semiannual',
  firstPurchase: '2026-03-01',
  createdAt: '2026-03-01T10:00:00',
  maturity: '2028-09-27',
  couponAmount: 500,
  nextCoupon: '2026-04-02',
  inzhur: { kind: 'bond', ref: 'UA0000000340' },
};
export const PUBLISHED_INPUT: ViewInput = {
  assets: [PUBLISHED_BOND],
  snapshots: [],
  transactions: [
    { id: 'd1', date: '2026-03-01', type: 'deposit', assetId: '', amount: 10_000 },
    { id: 'b1', date: '2026-03-01', type: 'buy', assetId: 'pub', amount: 10_000, quantity: 10 },
    { id: 'p1', date: '2026-04-02', type: 'interest_payout', assetId: 'pub', amount: 500 },
  ],
  today: TODAY,
  paymentDates: new Map([['pub', PUBLISHED_DATES]]),
};

// The coupon date a confirm made without the feed stores on UA4000235782's 181-day period, a day
// past the published one. Still held: every composer gates the projection on today's units.
export const OFF_LIST_DATES = [
  '2025-12-03',
  '2026-06-03',
  '2026-12-02',
  '2027-06-03',
  '2027-12-01',
  '2028-05-31',
  '2028-11-29',
];
export const OFF_LIST_INPUT: ViewInput = {
  assets: [{ ...PUBLISHED_BOND, maturity: '2028-11-29', nextCoupon: '2027-12-02' }],
  snapshots: [],
  transactions: [
    { id: 'd1', date: '2027-01-10', type: 'deposit', assetId: '', amount: 15_000 },
    { id: 'b1', date: '2027-01-10', type: 'buy', assetId: 'pub', amount: 15_000, quantity: 15 },
    { id: 'p1', date: '2027-06-03', type: 'interest_payout', assetId: 'pub', amount: 750 },
  ],
  today: '2027-11-30',
  paymentDates: new Map([['pub', OFF_LIST_DATES]]),
};

// Rows as the server stores them, beside the ledgers: one fund held since the January before, so each
// of the six periods opens on its own day and no period's curve is another's.
export const LONG_ROWS: { assets: Asset[]; transactions: Transaction[]; userPrices: PriceRow[] } = {
  assets: [
    {
      id: 'long',
      name: 'Long fund',
      code: 'LF',
      colorKey: 'reit',
      yieldType: 'capitalization',
      expectedPct: 12,
      targetPct: 100,
      payoutSchedule: 'none',
      firstPurchase: '2025-01-10',
      createdAt: '2025-01-10T10:00:00',
    },
  ],
  transactions: [
    { id: 'd1', date: '2025-01-10', type: 'deposit', assetId: '', amount: 10_000 },
    { id: 'b1', date: '2025-01-10', type: 'buy', assetId: 'long', amount: 10_000, quantity: 1000 },
  ],
  userPrices: (
    [
      ['2025-01-10', 10],
      ['2025-04-10', 10.4],
      ['2025-07-25', 10.9],
      ['2025-10-10', 11.3],
      ['2026-01-15', 11.8],
      ['2026-03-20', 12.1],
      ['2026-05-25', 12.6],
      ['2026-06-30', 12.9],
      ['2026-07-27', 13.3],
    ] as const
  ).map(([asOf, price]) => ({ assetId: 'long', asOf, price })),
};

// Each stored quote is a ₴ position value; divided by the units held that day it is the per-unit
// price the server would store for it. Any quote of a position held none of has no such price, and
// the ledger is then not expressible: undefined.
export const asPriceRows = (snapshots: Snapshot[], txs: Transaction[]): PriceRow[] | undefined => {
  const out: PriceRow[] = [];
  for (const s of snapshots) {
    const units = unitsByAsset(txs, s.date);
    for (const [assetId, quote] of Object.entries(s.quotes)) {
      if (!(units[assetId] > 0)) return undefined;
      out.push({ assetId, asOf: s.date, price: quote / units[assetId] });
    }
  }
  return out;
};
