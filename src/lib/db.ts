// Dexie database factory — imported ONLY by repository.ts (see src/README.md).
import { Dexie, type Table } from 'dexie';

import type { Dataset } from '../core/backup/json';
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

  constructor(name: string) {
    super(name);
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

export function makeDb(name: string): KubushkaDB {
  return new KubushkaDB(name);
}

// Dataset split (G4/D16): one Dexie DB per dataset — the pre-split 'kubushka'
// IS the demo DB (zero migration, user-approved), 'kubushka-live' starts
// empty.
const DB_NAME: Record<Dataset, string> = { demo: 'kubushka', live: 'kubushka-live' };

// The active dataset is resolved ONCE, synchronously, at module init — before
// React, stores or queries exist — from the persisted settings JSON
// (localStorage 'kubushka-settings'; `dataset` stays top-level under `state`
// per the D11 head-script contract). Switching datasets = persist + reload
// (settings.setDataset), so a running app never rebinds. Absent or malformed
// storage (first run, node tests) falls back to 'demo' — the same
// anything-but-'live'-means-demo rule as state/settings.migrateSettings.
function readDatasetFlag(): Dataset {
  try {
    const raw = localStorage.getItem('kubushka-settings');
    if (raw !== null) {
      const state = (JSON.parse(raw) as { state?: { dataset?: unknown } }).state;
      if (state?.dataset === 'live') return 'live';
    }
  } catch {
    // No localStorage (node) or unparseable JSON — fall through to demo.
  }
  return 'demo';
}

export const activeDataset: Dataset = readDatasetFlag();
export const db = makeDb(DB_NAME[activeDataset]);
