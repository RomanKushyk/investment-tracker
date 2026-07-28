// The ONLY module that touches the database. UI consumes it via hooks/queries.ts.
import { db } from './db';
import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from './seed';
import type { Asset, Snapshot, Transaction } from '../core/types';

export interface AllTables {
  assets: Asset[];
  snapshots: Snapshot[];
  transactions: Transaction[];
}

async function seedTables(): Promise<void> {
  await db.assets.bulkAdd(SEED_ASSETS);
  await db.snapshots.bulkAdd(buildSeedSnapshots());
  await db.transactions.bulkAdd(SEED_TRANSACTIONS);
  await db.meta.put({ key: 'seeded', value: true });
}

export const repo = {
  async listAssets(): Promise<Asset[]> {
    const assets = await db.assets.toArray();
    return assets.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async listSnapshots(): Promise<Snapshot[]> {
    return db.snapshots.orderBy('date').toArray(); // ascending by date
  },

  async listTransactions(): Promise<Transaction[]> {
    return db.transactions.orderBy('date').toArray(); // ascending by date
  },

  // UPSERT by date (re-saving a day replaces it — §9); stamps savedAt.
  async saveSnapshot(s: Snapshot): Promise<void> {
    await db.snapshots.put({ ...s, savedAt: new Date().toISOString().slice(0, 19) });
  },

  // One atomic transaction: create the asset (if given), then the record.
  async recordTransaction(tx: Transaction, newAsset?: Asset): Promise<void> {
    await db.transaction('rw', db.assets, db.transactions, async () => {
      if (newAsset) await db.assets.add(newAsset);
      await db.transactions.add(tx);
    });
  },

  // --- Write surface (G2) -------------------------------------------------

  async addAsset(asset: Asset): Promise<void> {
    await db.assets.add(asset);
  },

  async updateAsset(id: string, patch: Partial<Asset>): Promise<void> {
    await db.assets.update(id, patch);
  },

  // Cascade ALWAYS, atomically: the asset, its transactions, and its quote
  // key in every snapshot go in one rw transaction — no orphan rows.
  async deleteAsset(id: string): Promise<void> {
    await db.transaction('rw', [db.assets, db.transactions, db.snapshots], async () => {
      await db.assets.delete(id);
      await db.transactions.where('assetId').equals(id).delete();
      const affected = (await db.snapshots.toArray())
        .filter((s) => id in s.quotes)
        .map((s) => {
          const quotes = { ...s.quotes };
          delete quotes[id];
          return { ...s, quotes };
        });
      if (affected.length > 0) await db.snapshots.bulkPut(affected);
    });
  },

  async updateTransaction(id: string, patch: Partial<Transaction>): Promise<void> {
    await db.transactions.update(id, patch);
  },

  async deleteTransaction(id: string): Promise<void> {
    await db.transactions.delete(id);
  },

  async deleteSnapshot(date: string): Promise<void> {
    await db.snapshots.delete(date);
  },

  // Delete+put in one rw transaction; throws on collision or a missing
  // source row — either aborts the transaction, so no partial write.
  async moveSnapshotDate(from: string, to: string): Promise<void> {
    await db.transaction('rw', db.snapshots, async () => {
      if (await db.snapshots.get(to)) {
        throw new Error(`moveSnapshotDate: a snapshot already exists on ${to}`);
      }
      const snap = await db.snapshots.get(from);
      if (!snap) {
        throw new Error(`moveSnapshotDate: no snapshot on ${from}`);
      }
      await db.snapshots.delete(from);
      await db.snapshots.put({ ...snap, date: to });
    });
  },

  // One consistent read of all three tables (backup export basis).
  async exportAll(): Promise<AllTables> {
    return db.transaction('r', [db.assets, db.snapshots, db.transactions], async () => ({
      assets: (await db.assets.toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      snapshots: await db.snapshots.orderBy('date').toArray(),
      transactions: await db.transactions.orderBy('date').toArray(),
    }));
  },

  // All-or-nothing replace: clear all three tables + bulkAdd in ONE rw
  // transaction — any row failure aborts the whole thing, previous data
  // stays. Stamps the seeded flag (imported data must never be reseeded over).
  async replaceAll(data: AllTables): Promise<void> {
    await db.transaction('rw', [db.assets, db.snapshots, db.transactions, db.meta], async () => {
      await Promise.all([db.assets.clear(), db.snapshots.clear(), db.transactions.clear()]);
      await db.assets.bulkAdd(data.assets);
      await db.snapshots.bulkAdd(data.snapshots);
      await db.transactions.bulkAdd(data.transactions);
      await db.meta.put({ key: 'seeded', value: true });
    });
  },

  // reseed:true → reset to the reference seed; reseed:false → deliberately
  // empty, and the seeded flag keeps ensureSeeded() from resurrecting the
  // seed across reloads.
  async clearAll(opts: { reseed: boolean }): Promise<void> {
    await db.transaction('rw', [db.assets, db.snapshots, db.transactions, db.meta], async () => {
      await Promise.all([db.assets.clear(), db.snapshots.clear(), db.transactions.clear()]);
      if (opts.reseed) {
        await seedTables();
      } else {
        await db.meta.put({ key: 'seeded', value: true });
      }
    });
  },
};

// Seeds the reference dataset on first run only: assets empty AND never
// seeded before (meta flag) — so deliberate emptiness stays empty.
export async function ensureSeeded(): Promise<void> {
  await db.transaction('rw', [db.assets, db.snapshots, db.transactions, db.meta], async () => {
    if ((await db.assets.count()) > 0) return;
    if (await db.meta.get('seeded')) return;
    await seedTables();
  });
}
