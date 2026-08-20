import { describe, expect, it } from 'vitest';

import { SEED_ASSETS, SEED_TRANSACTIONS } from '../../lib/seed';
import type { Snapshot, Transaction } from '../../core/types';
import {
  bestPerformer,
  cascadeCounts,
  incomeEngine,
  laggard,
} from './portfolio';

const VALUES = { reit: 68702.1, energy: 60086.09, ovdp8976: 15846.3, ovdp6475: 4374.12 };
const INVESTED = { reit: 65800, energy: 59208, ovdp8976: 15390, ovdp6475: 4158 };

describe('bestPerformer', () => {
  it('picks the highest yieldSinceStart — OVDP …6475 +5.20% on seed', () => {
    const r = bestPerformer(SEED_ASSETS, VALUES, INVESTED);
    expect(r?.asset.id).toBe('ovdp6475');
    expect(r?.yield).toBeCloseTo(0.052, 3);
  });

  it('returns undefined when no asset has a quote (empty DB) instead of letting the first asset win', () => {
    expect(bestPerformer(SEED_ASSETS, {}, {})).toBeUndefined();
  });
});

describe('laggard', () => {
  it('picks the lowest yieldSinceStart — Inzhur Energy +1.48% on seed', () => {
    const r = laggard(SEED_ASSETS, VALUES, INVESTED);
    expect(r?.asset.id).toBe('energy');
    expect(r?.yield).toBeCloseTo(0.0148, 3);
  });

  it('returns undefined when no asset has a quote (empty DB) instead of letting the first asset win', () => {
    expect(laggard(SEED_ASSETS, {}, {})).toBeUndefined();
  });
});

describe('incomeEngine', () => {
  it('picks the asset with the most dividend+coupon income — REIT ₴3,641.44 dividends on seed', () => {
    const r = incomeEngine(SEED_ASSETS, SEED_TRANSACTIONS);
    expect(r?.asset.id).toBe('reit');
    expect(r?.dividends).toBeCloseTo(3641.44, 2);
    expect(r?.coupons).toBe(0);
  });

  it('returns undefined when there is no income history', () => {
    expect(incomeEngine(SEED_ASSETS, [])).toBeUndefined();
  });
});

// Fixtures for `cascadeCounts`, moved with it from `settings.test.ts` (A31).
const tx = (id: string, assetId: string): Transaction => ({
  id,
  date: '2026-07-01',
  type: 'buy',
  assetId,
  amount: 100,
  source: 'own',
});

const TRANSACTIONS: Transaction[] = [
  tx('t1', 'reit'),
  tx('t2', 'reit'),
  tx('t3', 'energy'),
  tx('t4', ''), // portfolio-level deposit — belongs to no asset
];

const SNAPSHOTS: Snapshot[] = [
  {
    date: '2026-07-24',
    quotes: { reit: 68560.9, energy: 60050.87 },
    cash: 7.75,
  },
  { date: '2026-07-25', quotes: { reit: 68629.36 }, cash: 7.75 },
  { date: '2026-07-27', quotes: { energy: 60100 }, cash: 7.75 },
];

// Moved from `screens/settings/settings.test.ts` by A31, with the function it
// covers. Not one assertion changed.
describe('cascadeCounts (delete-asset confirm dialog)', () => {
  it('counts the asset transactions and the days holding a quote for it', () => {
    expect(cascadeCounts('reit', TRANSACTIONS, SNAPSHOTS)).toEqual({
      transactions: 2,
      quoteDays: 2,
    });
    expect(cascadeCounts('energy', TRANSACTIONS, SNAPSHOTS)).toEqual({
      transactions: 1,
      quoteDays: 2,
    });
  });

  it('returns zeros for an asset with no history and never counts portfolio-level rows', () => {
    expect(cascadeCounts('ghost', TRANSACTIONS, SNAPSHOTS)).toEqual({
      transactions: 0,
      quoteDays: 0,
    });
    // the assetId '' deposit is not attributed to any asset
    expect(cascadeCounts('', TRANSACTIONS, SNAPSHOTS).transactions).toBe(1);
  });
});
