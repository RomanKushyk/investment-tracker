// Dexie database — imported ONLY by repository.ts (see src/README.md).
import { Dexie, type Table } from 'dexie';

import type { Asset, Snapshot, Transaction } from './types';

class KubushkaDB extends Dexie {
  assets!: Table<Asset, string>;
  snapshots!: Table<Snapshot, string>; // primary key: date
  transactions!: Table<Transaction, string>;

  constructor() {
    super('kubushka');
    this.version(1).stores({
      assets: 'id',
      snapshots: 'date',
      transactions: 'id, date, assetId',
    });
  }
}

export const db = new KubushkaDB();
