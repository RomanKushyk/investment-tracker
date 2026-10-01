import { readFileSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import { PERIOD_OPTIONS } from '../period';
import type { Asset } from '../types';
import { allocationView } from './allocation';
import { attributesView } from './attributes';
import { balancesView } from './balances';
import { capitalView } from './capital';
import { overviewView } from './overview';
import { payoutsView } from './payouts';
import { portfolioView } from './portfolio';
import { seasonalityView } from './seasonality';
import { TEST_LEDGERS } from './test-ledgers';
import { windowView } from './window';
import { yieldView } from './yield';

// Every composer's whole output, pinned: the `.snap` was written by the screens' own inline
// code before it moved here, so it characterizes what the app showed (#287).

const WINDOWED = ['window', 'overview', 'yield', 'seasonality'] as const;
const INVARIANT = [
  'payouts',
  'portfolio',
  'allocation',
  'attributes',
  'balances',
  'capital',
] as const;

// An asset prints as its id: a row carries the input object itself, and its fields
// are the fixture's, not a figure.
const ASSETS = new Set<unknown>(TEST_LEDGERS.flatMap((l) => l.input.assets));
expect.addSnapshotSerializer({
  test: (v) => ASSETS.has(v),
  serialize: (v: Asset) => `Asset ${v.id}`,
});

// Read, never written: locally vitest writes a missing snapshot and passes, so a renamed
// test or a deleted file would re-pin whatever the code computes now.
beforeAll(() => {
  const snap = readFileSync(
    new URL('./__snapshots__/golden.test.ts.snap', import.meta.url),
    'utf8',
  );
  const keys = [...snap.matchAll(/^exports\[`(.+)`\] = /gm)].map((m) => m[1]).sort();
  const expected = TEST_LEDGERS.flatMap(({ name }) => [
    ...PERIOD_OPTIONS.flatMap((p) => WINDOWED.map((c) => `${name} > ${p} > ${c} 1`)),
    ...INVARIANT.map((c) => `${name} > ${c} 1`),
  ]).sort();
  expect(keys).toEqual(expected);
});

describe.each(TEST_LEDGERS.map((l) => [l.name, l.input] as const))('%s', (_, input) => {
  describe.each(PERIOD_OPTIONS)('%s', (period) => {
    const at = { ...input, period };
    it('window', () => {
      expect(windowView(at)).toMatchSnapshot();
    });
    it('overview', () => {
      expect(overviewView(at)).toMatchSnapshot();
    });
    it('yield', () => {
      expect(yieldView(at)).toMatchSnapshot();
    });
    it('seasonality', () => {
      expect(seasonalityView(at)).toMatchSnapshot();
    });
  });
  it('payouts', () => {
    expect(payoutsView(input)).toMatchSnapshot();
  });
  it('portfolio', () => {
    expect(portfolioView(input)).toMatchSnapshot();
  });
  it('allocation', () => {
    expect(allocationView(input)).toMatchSnapshot();
  });
  it('attributes', () => {
    expect(attributesView(input)).toMatchSnapshot();
  });
  it('balances', () => {
    expect(balancesView(input)).toMatchSnapshot();
  });
  it('capital', () => {
    expect(capitalView(input)).toMatchSnapshot();
  });
});

// Each extra ledger exists to reach one branch; this says it still does.
describe('the ledgers reach the branches they exist for', () => {
  const ledger = (name: string) => TEST_LEDGERS.find((l) => l.name === name)!.input;

  it('linked solves a YTM at purchase', () => {
    const cards = attributesView(ledger('linked')).cards;
    expect(cards.some((c) => c.kind === 'bond' && c.ytm !== undefined)).toBe(true);
  });
  it('sold-and-unquoted holds a sale and an asset no snapshot quotes', () => {
    const input = ledger('sold-and-unquoted');
    expect(input.transactions.some((t) => t.type === 'sell')).toBe(true);
    const rows = yieldView({ ...input, period: 'all' }).rows;
    expect(rows.find((r) => r.asset.id === 'fresh')?.value).toBeUndefined();
  });
  it('cash-short is short', () => {
    expect(portfolioView(ledger('cash-short')).cashShort).toBe(true);
  });
  it('empty has no window', () => {
    expect(windowView({ ...ledger('empty'), period: 'all' })).toBeUndefined();
  });
});
