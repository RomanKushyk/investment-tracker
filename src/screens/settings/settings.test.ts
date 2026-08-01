import { describe, expect, it } from 'vitest';

import type { Snapshot, Transaction } from '../../core/types';
import { cascadeCounts } from './settings';

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
  { date: '2026-07-24', quotes: { reit: 68560.9, energy: 60050.87 }, cash: 7.75 },
  { date: '2026-07-25', quotes: { reit: 68629.36 }, cash: 7.75 },
  { date: '2026-07-27', quotes: { energy: 60100 }, cash: 7.75 },
];

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
