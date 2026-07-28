// Write-surface tests (G2) against fake-indexeddb — the one test file that
// touches IndexedDB (scoped D4 amendment, see DECISIONS). The auto import
// must come first so Dexie picks up the fake globals; db.delete()+open() in
// beforeEach gives every test a fresh, isolated database.
import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { db } from './db';
import { ensureSeeded, repo } from './repository';
import { buildSeedSnapshots, SEED_TRANSACTIONS } from './seed';
import type { Snapshot } from '../core/types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('deleteAsset cascade', () => {
  it('atomically removes the asset, its transactions and its quote keys — nothing else', async () => {
    await ensureSeeded();
    await repo.deleteAsset('reit');

    const assets = await repo.listAssets();
    expect(assets.map((a) => a.id)).toEqual(['energy', 'ovdp8976', 'ovdp6475']);

    const txs = await repo.listTransactions();
    expect(txs.some((t) => t.assetId === 'reit')).toBe(false);
    expect(txs).toHaveLength(SEED_TRANSACTIONS.filter((t) => t.assetId !== 'reit').length);

    // Every snapshot equals the seed row minus exactly the reit quote key.
    const expected = buildSeedSnapshots().map((s) => {
      const quotes = { ...s.quotes };
      delete quotes.reit;
      return { ...s, quotes };
    });
    expect(await repo.listSnapshots()).toEqual(expected);
  });
});

describe('ensureSeeded meta guard', () => {
  it('does NOT reseed after the last asset is deleted', async () => {
    await ensureSeeded();
    for (const a of await repo.listAssets()) await repo.deleteAsset(a.id);

    await ensureSeeded();
    expect(await repo.listAssets()).toEqual([]);
  });

  it('stays empty after clearAll({ reseed: false }) and a re-init', async () => {
    await ensureSeeded();
    await repo.clearAll({ reseed: false });

    await ensureSeeded(); // simulated reload
    expect(await db.assets.count()).toBe(0);
    expect(await db.snapshots.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);
  });
});

// Seed row counts: 4 assets / 174 snapshots / 18 transactions (3 deposits +
// 4 buys + 6 dividends + 2 coupons + 3 reinvests — D5; browser-verified in
// docs/BUILD-PLAN.md Task 2). NEXT-PHASE-PLAN's "4/174/19" was a miscount.
describe('clearAll({ reseed: true })', () => {
  it('restores the exact seed counts 4/174/18 after divergence', async () => {
    await ensureSeeded();
    await repo.deleteAsset('reit'); // diverge from the seed
    await repo.clearAll({ reseed: true });

    expect(await db.assets.count()).toBe(4);
    expect(await db.snapshots.count()).toBe(174);
    expect(await db.transactions.count()).toBe(18);
  });
});

describe('replaceAll', () => {
  it('is all-or-nothing: a later row violating the PK commits nothing', async () => {
    await ensureSeeded();
    const before = await repo.exportAll();

    const bad = {
      assets: before.assets,
      // a later row duplicates the first snapshot's primary-key date
      snapshots: [...before.snapshots.slice(0, 3), { ...before.snapshots[0] }],
      transactions: before.transactions,
    };
    await expect(repo.replaceAll(bad)).rejects.toThrow();

    expect(await db.assets.count()).toBe(4);
    expect(await db.snapshots.count()).toBe(174);
    expect(await db.transactions.count()).toBe(18);
    expect(await repo.exportAll()).toEqual(before);
  });

  it('replaces every table atomically when the data is valid', async () => {
    await ensureSeeded();
    const seed = await repo.exportAll();
    const snapshot: Snapshot = { date: '2026-08-01', quotes: { reit: 1 }, cash: 0 };
    const data = {
      assets: [seed.assets[0]],
      snapshots: [snapshot],
      transactions: [seed.transactions[0]],
    };

    await repo.replaceAll(data);
    expect(await repo.exportAll()).toEqual(data);
  });
});

describe('moveSnapshotDate', () => {
  it('throws on collision and writes nothing', async () => {
    await ensureSeeded();
    await expect(repo.moveSnapshotDate('2026-07-25', '2026-07-27')).rejects.toThrow();

    expect(await db.snapshots.count()).toBe(174);
    const s25 = await db.snapshots.get('2026-07-25');
    expect(s25?.quotes).toEqual({
      reit: 68629.36,
      energy: 60086.09,
      ovdp8976: 15846.3,
      ovdp6475: 4374.12,
    });
    const s27 = await db.snapshots.get('2026-07-27');
    expect(s27?.quotes).toEqual({ reit: 68702.1 });
  });

  it('moves a snapshot to a free date in one transaction', async () => {
    await ensureSeeded();
    await repo.moveSnapshotDate('2026-07-27', '2026-07-26');

    expect(await db.snapshots.get('2026-07-27')).toBeUndefined();
    const moved = await db.snapshots.get('2026-07-26');
    expect(moved).toEqual({ date: '2026-07-26', quotes: { reit: 68702.1 }, cash: 7.75 });
    expect(await db.snapshots.count()).toBe(174);
  });
});

describe('exportAll', () => {
  it('returns all three tables with the seed row counts', async () => {
    await ensureSeeded();
    const all = await repo.exportAll();

    expect(all.assets).toHaveLength(4);
    expect(all.snapshots).toHaveLength(174);
    expect(all.transactions).toHaveLength(18);
  });
});
