import { describe, expect, it } from 'vitest';

import type { Asset, Transaction } from '../types';
import { allocationView } from './allocation';
import { capitalView } from './capital';
import type { ViewInput } from './input';
import { overviewView } from './overview';
import { portfolioView } from './portfolio';
import { TEST_LEDGERS } from './test-ledgers';

// A position the ledger holds and no snapshot values has no value: its value, share and
// capital gain in ₴ are absent, and nothing proposes buying it. One it holds none of is worth 0.
const ledger = (name: string) => TEST_LEDGERS.find((l) => l.name === name)!.input;
const byId = <T extends { asset: { id: string } }>(rows: T[], id: string) =>
  rows.find((r) => r.asset.id === id);

// A target that would make the asset the most underweight one, were it read as 0.
const withTarget = (input: ViewInput, id: string, targetPct: number): ViewInput => ({
  ...input,
  assets: input.assets.map((a) => (a.id === id ? { ...a, targetPct } : a)),
});

const NEW: Asset = {
  id: 'new',
  name: 'New fund',
  code: 'NF',
  colorKey: 'reit',
  yieldType: 'capitalization',
  expectedPct: 12,
  targetPct: 20,
  payoutSchedule: 'none',
  firstPurchase: '2026-07-20',
  createdAt: '2026-07-20T10:00:00',
};

describe.each<[string, string, ViewInput]>([
  ['a position no snapshot quotes', 'fresh', withTarget(ledger('sold-and-unquoted'), 'fresh', 20)],
  [
    'a position whose units the ledger cannot count',
    'new',
    {
      ...ledger('seed'),
      assets: [...ledger('seed').assets, NEW],
      transactions: [
        ...ledger('seed').transactions,
        { id: 'd9', date: '2026-07-20', type: 'deposit', assetId: '', amount: 5000 },
        // No quantity: the ledger cannot count the units, and no snapshot values them.
        { id: 'b9', date: '2026-07-20', type: 'buy', assetId: 'new', amount: 5000 },
      ] satisfies Transaction[],
    },
  ],
  [
    'a position bought back after the last valuation day',
    'ovdp8976',
    {
      ...ledger('sold-out'),
      transactions: [
        ...ledger('sold-out').transactions,
        // Sold out on 1 July, so the stale quote values none of these 5 units.
        {
          id: 'back',
          date: '2026-07-30',
          type: 'buy',
          assetId: 'ovdp8976',
          amount: 5300,
          quantity: 5,
        },
      ] satisfies Transaction[],
    },
  ],
  [
    'a position bought back after the last valuation day, its units uncounted',
    'ovdp8976',
    {
      ...ledger('sold-out'),
      transactions: [
        ...ledger('sold-out').transactions,
        { id: 'back', date: '2026-07-30', type: 'buy', assetId: 'ovdp8976', amount: 5300 },
      ] satisfies Transaction[],
    },
  ],
])('%s', (_, id, input) => {
  it('has no value and no share on Overview, and the hint never names it', () => {
    const view = overviewView({ ...input, period: 'all' });
    const row = byId(view.rows, id)!;
    expect(row.value).toBeUndefined();
    expect(row.share).toBeNull();
    expect(view.underweight).toBeDefined();
    expect(view.underweight!.asset.id).not.toBe(id);
  });

  it('has no share or delta on Allocation, no slice, and no line in the plan', () => {
    const view = allocationView(input);
    expect(view.usable).toBe(true);
    const row = byId(view.rows, id)!;
    expect([row.share, row.deltaPp, row.severity]).toEqual([null, null, null]);
    expect(byId(view.slices, id)).toBeUndefined();
    expect(view.plan.actions.map((a) => a.asset.id)).not.toContain(id);
    expect(view.plan.withinRange.map((a) => a.id)).not.toContain(id);
  });

  it('has no value, no capital gain in ₴ and no share on Portfolio', () => {
    const row = byId(portfolioView(input).rows, id)!;
    expect(row.value).toBeUndefined();
    expect(row.pnl).toBeUndefined();
    expect(row.share).toBeNull();
  });
});

// Never bought, or sold out before any snapshot quoted it: it is worth 0, and a buy is proposed.
describe.each<[string, ViewInput]>([
  ['an asset never bought', { ...ledger('seed'), assets: [...ledger('seed').assets, NEW] }],
  [
    'an asset sold out before any snapshot quoted it',
    {
      ...ledger('seed'),
      assets: [...ledger('seed').assets, NEW],
      transactions: [
        ...ledger('seed').transactions,
        { id: 'd9', date: '2026-07-20', type: 'deposit', assetId: '', amount: 1000 },
        { id: 'b9', date: '2026-07-20', type: 'buy', assetId: 'new', amount: 1000, quantity: 10 },
        { id: 's9', date: '2026-07-21', type: 'sell', assetId: 'new', amount: 1000, quantity: 10 },
      ] satisfies Transaction[],
    },
  ],
])('%s', (_, input) => {
  it('is worth 0 on all three screens, and the plan and the hint propose its buy', () => {
    const overview = overviewView({ ...input, period: 'all' });
    expect(byId(overview.rows, 'new')).toMatchObject({ value: 0, share: 0 });
    expect(overview.underweight!.asset.id).toBe('new');

    const allocation = allocationView(input);
    expect(byId(allocation.rows, 'new')!.share).toBe(0);
    expect(byId(allocation.slices, 'new')).toMatchObject({ value: 0 });
    expect(allocation.plan.actions).toContainEqual(
      expect.objectContaining({ kind: 'buy', asset: expect.objectContaining({ id: 'new' }) }),
    );

    expect(byId(portfolioView(input).rows, 'new')).toMatchObject({ value: 0, pnl: 0, share: 0 });
  });
});

describe('an asset a snapshot quotes and no ledger row moves', () => {
  // A linked asset valued from `inzhur.units`, or a balance typed before its buy: the total
  // counts the quote, so the asset's own value is that quote too.
  const seed = ledger('seed');
  const last = seed.snapshots.reduce((a, b) => (a.date > b.date ? a : b));
  const input: ViewInput = {
    ...seed,
    assets: [...seed.assets, { ...NEW, targetPct: 10 }],
    snapshots: seed.snapshots.map((s) =>
      s === last ? { ...s, quotes: { ...s.quotes, new: 10000 } } : s,
    ),
  };

  it("keeps its quote on all three screens, and Portfolio's Total stays the sidebar's", () => {
    expect(byId(overviewView({ ...input, period: 'all' }).rows, 'new')!.value).toBe(10000);
    expect(byId(allocationView(input).slices, 'new')!.value).toBe(10000);
    const portfolio = portfolioView(input);
    expect(byId(portfolio.rows, 'new')!.value).toBe(10000);
    expect(portfolio.totals.net).toStrictEqual(capitalView(input).net);
  });
});
