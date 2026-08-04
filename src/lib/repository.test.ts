// Write-surface tests (G2) against fake-indexeddb — the one test file that
// touches IndexedDB (scoped D4 amendment, see DECISIONS). The auto import
// must come first so Dexie picks up the fake globals; db.delete()+open() in
// beforeEach gives every test a fresh, isolated database.
import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { activeDataset, db, makeDb } from './db';
import { dbVersion, ensureSeeded, repo } from './repository';
import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from './seed';
import type { Snapshot } from '../core/types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('dbVersion (backup envelopes)', () => {
  it('exposes the declared Dexie schema version', () => {
    expect(dbVersion).toBe(2);
  });
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

describe('meta accessors (P3 Inzhur last-good cache)', () => {
  it('round-trips an arbitrary value and overwrites it in place', async () => {
    expect(await repo.getMeta('inzhur:lastFetch')).toBeUndefined();

    await repo.setMeta('inzhur:lastFetch', { payload: [{ slug: 'inzhur-reit' }], fetchedAt: 'x' });
    expect(await repo.getMeta('inzhur:lastFetch')).toEqual({
      payload: [{ slug: 'inzhur-reit' }],
      fetchedAt: 'x',
    });

    await repo.setMeta('inzhur:lastFetch', { payload: [], fetchedAt: 'y' });
    expect(await repo.getMeta('inzhur:lastFetch')).toEqual({ payload: [], fetchedAt: 'y' });
    expect(await db.meta.count()).toBe(1);
  });

  it('leaves the seeding flag alone', async () => {
    await ensureSeeded();
    await repo.setMeta('inzhur:lastFetch', { payload: [], fetchedAt: 'z' });

    expect(await repo.getMeta('seeded')).toBe(true);
  });
});

// --- Dataset split (G4/D16) ------------------------------------------------

describe('makeDb factory (G4)', () => {
  it('returns an independent instance per name — rows never bleed across', async () => {
    const a = makeDb('kubushka-test-a');
    const b = makeDb('kubushka-test-b');
    try {
      expect(a).not.toBe(b);
      expect(a.name).toBe('kubushka-test-a');
      expect(b.name).toBe('kubushka-test-b');

      await a.assets.add(SEED_ASSETS[0]);
      expect(await a.assets.count()).toBe(1);
      expect(await b.assets.count()).toBe(0);
    } finally {
      await a.delete();
      await b.delete();
    }
  });

  it('binds the demo DB (kubushka) when no dataset flag is persisted', () => {
    // The node test env persists no kubushka-settings → the boot-time read
    // falls back to 'demo', whose DB name is the pre-split 'kubushka'
    // (zero-migration rule, D16).
    expect(activeDataset).toBe('demo');
    expect(db.name).toBe('kubushka');
  });
});

describe('dataset boot binding (G4)', () => {
  it('binds kubushka-live and never auto-seeds it when the persisted dataset is live', async () => {
    // Re-init the module graph with a stubbed localStorage carrying the live
    // flag — the same synchronous read the browser performs before React.
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'kubushka-settings'
          ? JSON.stringify({ state: { currency: 'UAH', usdRate: 44.83, dataset: 'live' }, version: 1 })
          : null,
    });
    try {
      const freshDb = await import('./db');
      const freshRepo = await import('./repository');

      expect(freshDb.activeDataset).toBe('live');
      expect(freshDb.db.name).toBe('kubushka-live');

      await freshRepo.ensureSeeded(); // must be a no-op against live
      expect(await freshDb.db.assets.count()).toBe(0);
      expect(await freshDb.db.snapshots.count()).toBe(0);
      expect(await freshDb.db.transactions.count()).toBe(0);
      expect(await freshDb.db.meta.count()).toBe(0); // not even the seeded flag

      await freshDb.db.delete();
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  // The S6 "Erase live data" flow (feat/clear-data): clearAll({reseed:false})
  // against the live binding leaves the app truly empty across reloads.
  it('erase — clearAll({reseed:false}) on live stays empty across re-inits', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'kubushka-settings'
          ? JSON.stringify({ state: { currency: 'UAH', usdRate: 44.83, dataset: 'live' }, version: 1 })
          : null,
    });
    try {
      const freshDb = await import('./db');
      const freshRepo = await import('./repository');

      // a real live portfolio: the user wrote an asset into kubushka-live
      await freshDb.db.assets.add(SEED_ASSETS[0]);
      expect(await freshDb.db.assets.count()).toBe(1);

      await freshRepo.repo.clearAll({ reseed: false });
      await freshRepo.ensureSeeded(); // simulated reload — no-op on live

      expect(await freshDb.db.assets.count()).toBe(0);
      expect(await freshDb.db.snapshots.count()).toBe(0);
      expect(await freshDb.db.transactions.count()).toBe(0);

      await freshDb.db.delete();
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
