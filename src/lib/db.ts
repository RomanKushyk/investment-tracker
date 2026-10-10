// Dexie database factory — imported only by repository.ts (*Core is pure*).
import { Dexie, type Table } from 'dexie';

import type { Asset, Snapshot, Transaction } from '@quirenote/core/types';

export interface MetaRow {
  key: string;
  value: unknown;
}

// Bump the Dexie version ONLY for a stores/index change. A new optional field
// never bumps: IndexedDB stores whole objects.
class QuirenoteDB extends Dexie {
  assets!: Table<Asset, string>;
  snapshots!: Table<Snapshot, string>; // primary key: date
  transactions!: Table<Transaction, string>;
  meta!: Table<MetaRow, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      assets: 'id',
      snapshots: 'date',
      transactions: 'id, date, assetId',
    });
    this.version(2).stores({ meta: 'key' });
  }
}

export function makeDb(name: string): QuirenoteDB {
  return new QuirenoteDB(name);
}

// The one local database, empty until the person writes or imports. A database an earlier build
// bound under another name stays on disk, as it did through the product's rename: unbinding it is
// not deleting it, and a delete that rides with a rename is two operations pretending to be one.
export const db = makeDb('quirenote-live');
