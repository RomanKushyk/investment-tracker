// Dexie database factory — imported only by repository.ts (*Core is pure*).
import { Dexie, type Table } from 'dexie';

import type { Dataset } from '@quirenote/core/backup/json';
import { SETTINGS_KEY } from './storage-keys';
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
    // v2 stamps the flag on databases seeded under v1's count()===0 heuristic, so a
    // deliberately empty dataset stops reseeding itself on the next reload.
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

export function makeDb(name: string): QuirenoteDB {
  return new QuirenoteDB(name);
}

// One database per dataset, renamed with the product and deliberately without an
// IndexedDB migration — live was empty and demo reseeds, so reseeding is the
// migration. The pre-rename databases stay on disk: a rename that also destroys
// data is two operations pretending to be one.
const DB_NAME: Record<Dataset, string> = { demo: 'quirenote', live: 'quirenote-live' };

// Resolved ONCE, synchronously, at module init — before React, the stores or any
// query exist. Switching datasets persists and reloads rather than rebinding, and
// anything but the exact 'live' literal means demo (state/settings.ts agrees).
function readDatasetFlag(): Dataset {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw !== null) {
      const state = (JSON.parse(raw) as { state?: { dataset?: unknown } }).state;
      if (state?.dataset === 'live') return 'live';
    }
  } catch {
    // No localStorage, or unparseable JSON: fall through to demo.
  }
  return 'demo';
}

export const activeDataset: Dataset = readDatasetFlag();
export const db = makeDb(DB_NAME[activeDataset]);
