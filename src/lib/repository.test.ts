// Write-surface tests (G2) against fake-indexeddb — the one test file that
// touches IndexedDB (scoped D4 amendment, see DECISIONS). The auto import
// must come first so Dexie picks up the fake globals; db.delete()+open() in
// beforeEach gives every test a fresh, isolated database.
import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { diffBackup, validateImport } from '../core/backup/import';
import { buildBackup } from '../core/backup/json';
import { headlineKpis, headlineTotal } from '../core/derive';
import { activeDataset, db, makeDb } from './db';
import { dbVersion, ensureSeeded, repo } from './repository';
import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from './seed';
import { SYNC_CHANNEL } from './sync';
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
// docs/archive/BUILD-PLAN.md Task 2). NEXT-PHASE-PLAN's "4/174/19" was a miscount.
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

// --- Import round-trip (P4 feat/backup-import, D24) ------------------------
// The headline invariant: export → erase → import must return the dataset
// byte-identical, D5-pinned figures included. Lives here (not beside
// core/backup) because it needs the real DB and the seed — core tests may not
// import src/lib (G1).

async function exportSeedEnvelope() {
  const tables = await repo.exportAll();
  return buildBackup(
    tables.assets,
    tables.snapshots,
    tables.transactions,
    { currency: 'UAH', usdRate: 44.83 },
    'demo',
    '2026-08-04T12:00:00',
    dbVersion,
  );
}

describe('export → erase → import round-trip', () => {
  it('restores the seed byte-identically, with every D5-pinned figure intact', async () => {
    await ensureSeeded();
    const before = await repo.exportAll();
    const text = JSON.stringify(await exportSeedEnvelope());

    await repo.clearAll({ reseed: false }); // the S6 erase, mid round-trip
    expect(await db.assets.count()).toBe(0);

    const validation = validateImport(text);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    await repo.replaceAll({
      assets: validation.envelope.assets,
      snapshots: validation.envelope.snapshots,
      transactions: validation.envelope.transactions,
    });

    const after = await repo.exportAll();
    expect(after).toEqual(before);
    expect(after.assets).toHaveLength(4);
    expect(after.snapshots).toHaveLength(174);
    expect(after.transactions).toHaveLength(18);

    // D5 checkpoints, derived from the re-imported rows.
    const kpis = headlineKpis(after.snapshots, after.transactions);
    expect(kpis.total).toBeCloseTo(149016.36, 2);
    expect(kpis.net.uah).toBeCloseTo(4452.61, 2);
    expect(kpis.net.pct * 100).toBeCloseTo(3.08, 2);
    expect(headlineTotal(after.snapshots)).toBeCloseTo(149016.36, 2);
  });

  it('previews the same-dataset re-import as all-replaced, nothing lost', async () => {
    await ensureSeeded();
    const current = await repo.exportAll();
    const envelope = await exportSeedEnvelope();

    const diff = diffBackup(current, envelope, {
      dataset: 'demo',
      today: '2026-08-04',
      dbVersion,
    });
    expect(diff.assets).toEqual({ added: 0, replaced: 4, removed: 0 });
    expect(diff.snapshots).toEqual({ added: 0, replaced: 174, removed: 0 });
    expect(diff.transactions).toEqual({ added: 0, replaced: 18, removed: 0 });
    expect(diff.after).toEqual({ assets: 4, snapshots: 174, transactions: 18 });
    expect(diff.warnings).toEqual([]);
  });

  it('a rejected file writes nothing — validation happens before any write', async () => {
    await ensureSeeded();
    const before = await repo.exportAll();
    const broken = JSON.parse(JSON.stringify(await exportSeedEnvelope())) as Record<
      string,
      unknown
    >;
    (broken.assets as Record<string, unknown>[])[0].createdAt = '2026-02-03T10:00:00Z';

    expect(validateImport(JSON.stringify(broken)).ok).toBe(false);
    expect(await repo.exportAll()).toEqual(before);
    expect(await db.assets.count()).toBe(4);
  });

  /**
   * Wait until `heard` holds `count` messages, or give up after a deadline.
   *
   * `BroadcastChannel` delivery is asynchronous with NO guaranteed turnaround.
   * This test used to assume one macrotask tick was enough — which held on a
   * developer machine and did not on a loaded CI runner, failing three times
   * across two commits while every retry passed. That is the definition of a
   * flake, and retrying it would have been treating the symptom.
   *
   * Polling is strictly better than a longer fixed sleep: it returns the
   * instant the message lands (so the fast path stays fast) and still fails —
   * loudly, at the assertion below — if it never does.
   */
  async function waitForMessages(heard: unknown[], count: number): Promise<void> {
    const deadline = Date.now() + 2_000;
    while (heard.length < count && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  it('tells other tabs after a committed replace, never before', async () => {
    await ensureSeeded();
    // A second channel object stands in for a second tab: the repository's own
    // channel never delivers to itself (that is what keeps the acting tab from
    // toasting at itself).
    const otherTab = new BroadcastChannel(SYNC_CHANNEL);
    const heard: unknown[] = [];
    otherTab.onmessage = (e: MessageEvent) => void heard.push(e.data);
    try {
      const bad = { assets: SEED_ASSETS, snapshots: [], transactions: SEED_TRANSACTIONS };
      // A rejected write must stay silent: bulkAdd of transactions referencing
      // no snapshots is fine, so break it with a duplicate primary key instead.
      await expect(
        repo.replaceAll({ ...bad, assets: [...SEED_ASSETS, SEED_ASSETS[0]] }),
      ).rejects.toThrow();
      // Asserting ABSENCE, so this one must NOT wait for an arrival — it gives
      // a wrong implementation a real window to speak up and then insists on
      // silence. `await Promise.resolve()` alone would have let a broken build
      // pass simply by being slower than the assertion.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(heard).toEqual([]);

      await repo.replaceAll(bad);
      await waitForMessages(heard, 1);
      expect(heard).toEqual([{ kind: 'replace' }]);

      await repo.clearAll({ reseed: false });
      await waitForMessages(heard, 2);
      expect(heard).toEqual([{ kind: 'replace' }, { kind: 'clear' }]);
    } finally {
      otherTab.close();
    }
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

  it('binds the demo DB (quirenote) when no dataset flag is persisted', () => {
    // The node test env persists no quirenote-settings → the boot-time read
    // falls back to 'demo' (D16).
    expect(activeDataset).toBe('demo');
    expect(db.name).toBe('quirenote');
  });
});

describe('dataset boot binding (G4)', () => {
  it('binds quirenote-live and never auto-seeds it when the persisted dataset is live', async () => {
    // Re-init the module graph with a stubbed localStorage carrying the live
    // flag — the same synchronous read the browser performs before React.
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) =>
        key === 'quirenote-settings'
          ? JSON.stringify({ state: { currency: 'UAH', usdRate: 44.83, dataset: 'live' }, version: 1 })
          : null,
      setItem: () => {},
      removeItem: () => {},
    });
    try {
      const freshDb = await import('./db');
      const freshRepo = await import('./repository');

      expect(freshDb.activeDataset).toBe('live');
      expect(freshDb.db.name).toBe('quirenote-live');

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
        key === 'quirenote-settings'
          ? JSON.stringify({ state: { currency: 'UAH', usdRate: 44.83, dataset: 'live' }, version: 1 })
          : null,
      setItem: () => {},
      removeItem: () => {},
    });
    try {
      const freshDb = await import('./db');
      const freshRepo = await import('./repository');

      // a real live portfolio: the user wrote an asset into quirenote-live
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
