// The ONLY module that touches the database. UI consumes it via hooks/queries.ts.
import { db } from './db';
import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from './seed';
import type { Asset, Snapshot, Transaction } from '../core/types';

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
};

// Seeds the reference dataset on first run (no-op once assets exist).
export async function ensureSeeded(): Promise<void> {
  const count = await db.assets.count();
  if (count > 0) return;
  await db.transaction('rw', db.assets, db.snapshots, db.transactions, async () => {
    await db.assets.bulkAdd(SEED_ASSETS);
    await db.snapshots.bulkAdd(buildSeedSnapshots());
    await db.transactions.bulkAdd(SEED_TRANSACTIONS);
  });
}
