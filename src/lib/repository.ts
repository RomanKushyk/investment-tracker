// The ONLY module that touches the database. UI consumes it via hooks/queries.ts.
import { activeDataset, db } from './db';
import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '@quirenote/core/seed';
import { postDbSync, withDbLock } from './sync';
import type { Asset, Snapshot, Transaction } from '@quirenote/core/types';

export interface AllTables {
  assets: Asset[];
  snapshots: Snapshot[];
  transactions: Transaction[];
}

// Re-exported rather than imported from lib/db.ts at the call site: only this
// module may reach for db.ts. Backup envelopes record it as `dbVersion`.
export const dbVersion = db.verno;

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

  // UPSERT by date — re-saving a day replaces it — and stamps savedAt.
  async saveSnapshot(s: Snapshot): Promise<void> {
    await db.snapshots.put({ ...s, savedAt: new Date().toISOString().slice(0, 19) });
  },

  async recordTransaction(tx: Transaction, newAsset?: Asset): Promise<void> {
    await db.transaction('rw', db.assets, db.transactions, async () => {
      if (newAsset) await db.assets.add(newAsset);
      await db.transactions.add(tx);
    });
  },

  async addAsset(asset: Asset): Promise<void> {
    await db.assets.add(asset);
  },

  async updateAsset(id: string, patch: Partial<Asset>): Promise<void> {
    await db.assets.update(id, patch);
  },

  // Cascade ALWAYS, atomically: the asset, its transactions and its quote key in
  // every snapshot go in one rw transaction, so no orphan row can survive.
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

  // THE ONLY UNVALIDATED WRITE PATH LEFT FOR A TRANSACTION, and it stays open only
  // because it has no caller yet: `useUpdateTransaction` is exported and unused
  // while the DDL check, the form schema and the backup importer all refuse a
  // count-less position-moving row. It takes a bare
  // `Partial<Transaction>` with no schema in front of it, so a first caller must
  // go through `transactionSchema` or repeat its rule — otherwise a position-moving
  // row can be stored without a unit count, and the export guard in
  // `useBackupDownload` becomes the only thing between that and an unrestorable
  // backup.
  async updateTransaction(id: string, patch: Partial<Transaction>): Promise<void> {
    await db.transactions.update(id, patch);
  },

  async deleteTransaction(id: string): Promise<void> {
    await db.transactions.delete(id);
  },

  async deleteSnapshot(date: string): Promise<void> {
    await db.snapshots.delete(date);
  },

  // Throws on a collision or a missing source row; either aborts the transaction.
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

  // Values are `unknown` in IndexedDB, so the caller owns the row shape and must
  // read it defensively — the cast is a convenience, not a guarantee.
  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await db.meta.get(key))?.value as T | undefined;
  },

  async setMeta(key: string, value: unknown): Promise<void> {
    await db.meta.put({ key, value });
  },

  async exportAll(): Promise<AllTables> {
    return db.transaction('r', [db.assets, db.snapshots, db.transactions], async () => ({
      assets: (await db.assets.toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      snapshots: await db.snapshots.orderBy('date').toArray(),
      transactions: await db.transactions.orderBy('date').toArray(),
    }));
  },

  // All-or-nothing: any row failure aborts the whole transaction and the previous
  // data stays. Stamps the seeded flag, because imported data must never be
  // reseeded over. Held under the cross-tab lock so a second tab cannot interleave.
  async replaceAll(data: AllTables, opts: { onBlocked?: () => void } = {}): Promise<void> {
    await withDbLock(
      () =>
        db.transaction('rw', [db.assets, db.snapshots, db.transactions, db.meta], async () => {
          await Promise.all([db.assets.clear(), db.snapshots.clear(), db.transactions.clear()]);
          await db.assets.bulkAdd(data.assets);
          await db.snapshots.bulkAdd(data.snapshots);
          await db.transactions.bulkAdd(data.transactions);
          await db.meta.put({ key: 'seeded', value: true });
        }),
      opts.onBlocked,
    );
    // Only ever after a COMMITTED write: other tabs are told the data changed, never that it might have.
    postDbSync('replace');
  },

  // reseed:false leaves the dataset deliberately empty, and the seeded flag is what
  // keeps ensureSeeded from resurrecting the seed across reloads.
  async clearAll(opts: { reseed: boolean }): Promise<void> {
    await withDbLock(() =>
      db.transaction('rw', [db.assets, db.snapshots, db.transactions, db.meta], async () => {
        await Promise.all([db.assets.clear(), db.snapshots.clear(), db.transactions.clear()]);
        if (opts.reseed) {
          await seedTables();
        } else {
          await db.meta.put({ key: 'seeded', value: true });
        }
      }),
    );
    postDbSync('clear');
  },
};

// Demo only: live starts empty and stays empty until the user writes or imports.
// Within demo, the meta flag is what makes a deliberately emptied dataset stay empty.
export async function ensureSeeded(): Promise<void> {
  if (activeDataset !== 'demo') return;
  await db.transaction('rw', [db.assets, db.snapshots, db.transactions, db.meta], async () => {
    if ((await db.assets.count()) > 0) return;
    if (await db.meta.get('seeded')) return;
    await seedTables();
  });
}
