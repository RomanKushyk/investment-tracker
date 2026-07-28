// Dexie database — imported ONLY by repository.ts (see src/README.md).
import { Dexie, type Table } from 'dexie';

import type { Asset, Snapshot, Transaction } from '../core/types';

// Key-value side table (G2): seeding flag now; later the mirror file handle
// and the Inzhur last-good cache.
export interface MetaRow {
  key: string;
  value: unknown;
}

// Versioning policy (G2): bump the Dexie version ONLY for stores/index
// changes (new table, new/changed index, changed primary key). New OPTIONAL
// object fields never bump — IndexedDB stores whole objects, so optional
// fields need no schema change.
class KubushkaDB extends Dexie {
  assets!: Table<Asset, string>;
  snapshots!: Table<Snapshot, string>; // primary key: date
  transactions!: Table<Transaction, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('kubushka');
    this.version(1).stores({
      assets: 'id',
      snapshots: 'date',
      transactions: 'id, date, assetId',
    });
    // v2 adds the meta table. Existing DBs that already hold assets were
    // seeded under v1's count()===0 heuristic — stamp the flag so deliberate
    // emptiness (clearAll/delete-last-asset) survives reloads from now on.
    this.version(2)
      .stores({ meta: 'key' })
      .upgrade(async (tx) => {
        const assetCount = await tx.table('assets').count();
        if (assetCount > 0) {
          await tx.table('meta').put({ key: 'seeded', value: true });
        }
      });
  }
}

export const db = new KubushkaDB();
