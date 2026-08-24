import { describe, expect, it } from 'vitest';

import type { Asset, Snapshot, Transaction } from '../types';
import { buildBackup, type BackupEnvelope } from './json';
import {
  classifyImportFiles,
  diffBackup,
  ISSUE_LIST_CAP,
  MAX_IMPORT_BYTES,
  validateImport,
  type PortfolioTables,
} from './import';

// Hand-built portfolio (the 4/174/18 seed round-trip runs through the real DB
// in src/lib/repository.test.ts — core tests must not import src/lib, G1).
const ASSETS: Asset[] = [
  {
    id: 'reit',
    name: 'Inzhur REIT',
    code: 'RE',
    colorKey: 'reit',
    yieldType: 'div_cap',
    expectedPct: 14,
    targetPct: 40,
    payoutSchedule: 'monthly',
    firstPurchase: '2026-02-03',
    createdAt: '2026-02-03T10:00:00',
  },
  {
    id: 'energy',
    name: 'Inzhur Energy',
    code: 'EN',
    colorKey: 'energy',
    yieldType: 'capitalization',
    expectedPct: 10,
    targetPct: 40,
    payoutSchedule: 'none',
    firstPurchase: '2026-02-03',
    createdAt: '2026-02-03T10:00:01',
  },
];

const SNAPSHOTS: Snapshot[] = [
  { date: '2026-07-24', quotes: { reit: 68560.9, energy: 60050.87 }, cash: 7.75 },
  {
    date: '2026-07-25',
    quotes: { reit: 68629.36, energy: 60086.09 },
    cash: 7.75,
    savedAt: '2026-07-25T21:14:00',
  },
];

const TRANSACTIONS: Transaction[] = [
  { id: 'd1', date: '2026-02-03', type: 'deposit', assetId: '', amount: 123844.37, source: 'own' },
  { id: 'b1', date: '2026-02-03', type: 'buy', assetId: 'reit', amount: 64628.62, source: 'own' },
  {
    id: 'p1',
    date: '2026-02-10',
    type: 'dividend_accrual',
    assetId: 'reit',
    amount: 580.2,
    source: 'accrual',
  },
];

const SETTINGS = { currency: 'UAH', usdRate: 44.83 } as const;

function envelope(
  dataset: 'demo' | 'live' = 'demo',
  exportedAt = '2026-08-04T12:00:00',
): BackupEnvelope {
  return buildBackup(ASSETS, SNAPSHOTS, TRANSACTIONS, SETTINGS, dataset, exportedAt, 2);
}

function mutated(mutate: (env: Record<string, unknown>) => void): string {
  const env = JSON.parse(JSON.stringify(envelope())) as Record<string, unknown>;
  mutate(env);
  return JSON.stringify(env);
}

const tables = (over: Partial<PortfolioTables> = {}): PortfolioTables => ({
  assets: ASSETS,
  snapshots: SNAPSHOTS,
  transactions: TRANSACTIONS,
  ...over,
});

const CTX = { dataset: 'demo', today: '2026-08-04', dbVersion: 2 } as const;

describe('classifyImportFiles (S2 file gate)', () => {
  it('accepts one .json file of a sane size', () => {
    expect(
      classifyImportFiles([{ name: 'kubushka-backup-2026-08-04.json', size: 300_000 }]),
    ).toEqual({
      ok: true,
      kind: 'json',
      name: 'kubushka-backup-2026-08-04.json',
      size: 300_000,
    });
  });

  it('is case-insensitive about the extension', () => {
    expect(classifyImportFiles([{ name: 'BACKUP.JSON', size: 10 }]).ok).toBe(true);
  });

  it('rejects the wrong type, an empty file, an oversized file and a multi-drop', () => {
    expect(classifyImportFiles([{ name: 'notes.txt', size: 10 }])).toEqual({
      ok: false,
      code: 'type',
    });
    expect(classifyImportFiles([{ name: 'a.json', size: 0 }])).toEqual({
      ok: false,
      code: 'empty',
    });
    expect(classifyImportFiles([{ name: 'a.json', size: MAX_IMPORT_BYTES + 1 }])).toEqual({
      ok: false,
      code: 'size',
    });
    expect(
      classifyImportFiles([
        { name: 'a.json', size: 1 },
        { name: 'b.json', size: 1 },
      ]),
    ).toEqual({ ok: false, code: 'count' });
  });

  it('treats a drag carrying no file as a wrong-type mistake', () => {
    expect(classifyImportFiles([])).toEqual({ ok: false, code: 'type' });
  });

  it('does not accept .csv — export-only by decision (D29), not a gap', () => {
    expect(classifyImportFiles([{ name: 'snapshots.csv', size: 500 }])).toEqual({
      ok: false,
      code: 'type',
    });
  });
});

describe('validateImport — accepted', () => {
  it('accepts a freshly built envelope and returns it losslessly', () => {
    const result = validateImport(JSON.stringify(envelope()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.envelope.assets).toEqual(ASSETS);
    expect(result.envelope.snapshots).toEqual(SNAPSHOTS);
    expect(result.envelope.transactions).toEqual(TRANSACTIONS);
    expect(result.envelope.settings).toEqual(SETTINGS);
  });

  it('accepts an envelope with no settings block', () => {
    const env = buildBackup(ASSETS, [], [], undefined, 'live', '2026-08-04T12:00:00', 2);
    const result = validateImport(JSON.stringify(env));
    expect(result.ok).toBe(true);
  });
});

describe('validateImport — format-level rejections (S4 single reason)', () => {
  it('rejects non-JSON text with the D12 sentence as its mono detail', () => {
    const result = validateImport('{ nope');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.kind).toBe('format');
    if (result.rejection.kind !== 'format') return;
    expect(result.rejection.code).toBe('not-json');
    expect(result.rejection.detail).toMatch(/^Not valid JSON: /);
  });

  it('rejects a file with no accepted format marker', () => {
    const result = validateImport(JSON.stringify({ format: 'other', formatVersion: 1 }));
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'format') return;
    expect(result.rejection.code).toBe('not-a-backup');
    expect(result.rejection.detail).toBe("Not a quirenote-backup file (format: 'other').");
  });

  it('rejects a JSON array as not-a-backup rather than crashing', () => {
    const result = validateImport('[]');
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'format') return;
    expect(result.rejection.code).toBe('not-a-backup');
  });

  it('rejects formatVersion 2 as a NEWER format, with the version and the detail', () => {
    const result = validateImport(mutated((env) => void (env.formatVersion = 2)));
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'format') return;
    expect(result.rejection.code).toBe('newer-format');
    expect(result.rejection.version).toBe(2);
    expect(result.rejection.detail).toBe(
      'Unsupported formatVersion 2 — this app reads formatVersion 1 only.',
    );
  });

  it('never calls a non-numeric or older version "newer"', () => {
    const zero = validateImport(mutated((env) => void (env.formatVersion = 0)));
    if (zero.ok || zero.rejection.kind !== 'format') throw new Error('expected a format rejection');
    expect(zero.rejection.code).toBe('unsupported-format');
    expect(zero.rejection.version).toBe(0);

    const text = validateImport(mutated((env) => void (env.formatVersion = 'v2')));
    if (text.ok || text.rejection.kind !== 'format') throw new Error('expected a format rejection');
    expect(text.rejection.code).toBe('unsupported-format');
    expect(text.rejection.version).toBeUndefined();
  });

  it('gates the version BEFORE the row schemas — one reason, not a wall', () => {
    const result = validateImport(
      mutated((env) => {
        env.formatVersion = 3;
        (env.assets as Record<string, unknown>[])[0].createdAt = 'nonsense';
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.kind).toBe('format');
  });
});

describe('validateImport — row-addressed rejections (S4 list)', () => {
  it('rejects an unknown key on a row (strictObject) and names the key', () => {
    const result = validateImport(
      mutated((env) => void ((env.assets as Record<string, unknown>[])[0].foo = 'bar')),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'rows') return;
    expect(result.rejection.issues).toContainEqual(
      expect.objectContaining({ table: 'assets', at: '0', code: 'unknown-key', value: 'foo' }),
    );
  });

  it("rejects a 'Z'-suffixed datetime (plain-regex convention, not z.iso.datetime)", () => {
    const result = validateImport(
      mutated(
        (env) =>
          void ((env.assets as Record<string, unknown>[])[1].createdAt = '2026-02-03T10:00:01Z'),
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'rows') return;
    // Assets are addressed by INDEX (the header rule) — "assets.1.createdAt".
    expect(result.rejection.issues).toEqual([
      expect.objectContaining({
        table: 'assets',
        at: '1',
        field: 'createdAt',
        code: 'expected-datetime',
      }),
    ]);
  });

  it('rejects a Z-suffixed snapshot savedAt too, addressed by the snapshot date', () => {
    const result = validateImport(
      mutated(
        (env) =>
          void ((env.snapshots as Record<string, unknown>[])[1].savedAt = '2026-07-25T21:14:00Z'),
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'rows') return;
    expect(result.rejection.issues[0]).toMatchObject({
      table: 'snapshots',
      at: '2026-07-25',
      field: 'savedAt',
      code: 'expected-datetime',
    });
  });

  it('rejects a transaction pointing at an unknown asset, addressed by its id', () => {
    const result = validateImport(
      mutated((env) =>
        (env.transactions as Record<string, unknown>[]).push({
          id: 'tx-0007',
          date: '2026-07-01',
          type: 'buy',
          assetId: 'a-9',
          amount: 100,
          source: 'own',
        }),
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'rows') return;
    expect(result.rejection.issues).toEqual([
      { table: 'transactions', at: 'tx-0007', code: 'unknown-asset-id', value: 'a-9' },
    ]);
  });

  it('rejects a quote for an asset the file does not carry', () => {
    const result = validateImport(
      mutated(
        (env) =>
          void (((env.snapshots as Record<string, unknown>[])[0].quotes as Record<string, number>)[
            'a-9'
          ] = 1),
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'rows') return;
    expect(result.rejection.issues).toEqual([
      { table: 'snapshots', at: '2026-07-24', code: 'unknown-quote-asset', value: 'a-9' },
    ]);
  });

  it('rejects a duplicate snapshot date (the primary key)', () => {
    const result = validateImport(
      mutated((env) => {
        const snaps = env.snapshots as Record<string, unknown>[];
        snaps.push({ ...snaps[0] });
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'rows') return;
    expect(result.rejection.issues).toEqual([
      { table: 'snapshots', field: 'date', code: 'duplicate-key', value: '2026-07-24' },
    ]);
  });

  it('rejects duplicate asset and transaction ids (bulkAdd would abort blindly)', () => {
    const dupAsset = validateImport(
      mutated((env) => {
        const assets = env.assets as Record<string, unknown>[];
        assets.push({ ...assets[0] });
      }),
    );
    if (dupAsset.ok || dupAsset.rejection.kind !== 'rows') throw new Error('expected rows');
    expect(dupAsset.rejection.issues).toContainEqual({
      table: 'assets',
      field: 'id',
      code: 'duplicate-key',
      value: 'reit',
    });

    const dupTx = validateImport(
      mutated((env) => {
        const txs = env.transactions as Record<string, unknown>[];
        txs.push({ ...txs[0] });
      }),
    );
    if (dupTx.ok || dupTx.rejection.kind !== 'rows') throw new Error('expected rows');
    expect(dupTx.rejection.issues).toContainEqual({
      table: 'transactions',
      field: 'id',
      code: 'duplicate-key',
      value: 'd1',
    });
  });

  it('flags a non-positive amount as such (the sign lives in the TxType)', () => {
    const result = validateImport(
      mutated((env) => void ((env.transactions as Record<string, unknown>[])[1].amount = -500)),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'rows') return;
    expect(result.rejection.issues[0]).toMatchObject({
      table: 'transactions',
      at: 'b1',
      field: 'amount',
      code: 'expected-positive-amount',
    });
  });

  it('addresses a row by index when the key itself is the invalid field', () => {
    const result = validateImport(
      mutated((env) => void ((env.snapshots as Record<string, unknown>[])[0].date = '24.07.2026')),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'rows') return;
    expect(result.rejection.issues[0]).toMatchObject({
      table: 'snapshots',
      at: '0',
      field: 'date',
      code: 'expected-date',
    });
  });

  it('keeps envelope-level and settings issues out of the row tables', () => {
    const result = validateImport(mutated((env) => void (env.dataset = 'staging')));
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'rows') return;
    expect(result.rejection.issues[0]).toMatchObject({ table: 'envelope', field: 'dataset' });

    const bad = validateImport(
      mutated((env) => void (env.settings = { currency: 'PLN', usdRate: 44.83 })),
    );
    if (bad.ok || bad.rejection.kind !== 'rows') throw new Error('expected rows');
    expect(bad.rejection.issues[0]).toMatchObject({
      table: 'settings',
      field: 'settings.currency',
    });
  });

  it('caps the list at 10 and still reports the exact total', () => {
    const result = validateImport(
      mutated((env) => {
        const txs = env.transactions as Record<string, unknown>[];
        for (let i = 0; i < 12; i += 1) {
          txs.push({
            id: `ghost-${i}`,
            date: '2026-07-01',
            type: 'buy',
            assetId: 'a-9',
            amount: 1,
            source: 'own',
          });
        }
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'rows') return;
    expect(result.rejection.total).toBe(12);
    expect(result.rejection.issues).toHaveLength(ISSUE_LIST_CAP);
  });
});

describe('diffBackup', () => {
  it('counts a same-dataset re-import as all-replaced, nothing added or removed', () => {
    const diff = diffBackup(tables(), envelope(), CTX);
    expect(diff.assets).toEqual({ added: 0, replaced: 2, removed: 0 });
    expect(diff.snapshots).toEqual({ added: 0, replaced: 2, removed: 0 });
    expect(diff.transactions).toEqual({ added: 0, replaced: 3, removed: 0 });
    expect(diff.after).toEqual({ assets: 2, snapshots: 2, transactions: 3 });
    expect(diff.hasSettings).toBe(true);
    expect(diff.warnings).toEqual([]);
  });

  // The S3 worked illustration: yesterday's backup over today's data silently
  // drops today's snapshot and today's transaction.
  it("reports yesterday's backup over today's data as replaced + removed", () => {
    const current = tables({
      snapshots: [...SNAPSHOTS, { date: '2026-07-26', quotes: { reit: 1 }, cash: 0 }],
      transactions: [
        ...TRANSACTIONS,
        { id: 'today', date: '2026-07-26', type: 'buy', assetId: 'reit', amount: 5, source: 'own' },
      ],
    });
    const diff = diffBackup(current, envelope(), CTX);
    expect(diff.snapshots).toEqual({ added: 0, replaced: 2, removed: 1 });
    expect(diff.transactions).toEqual({ added: 0, replaced: 3, removed: 1 });
    expect(diff.after.snapshots).toBe(2);
    expect(diff.warnings).toContainEqual({
      code: 'rows-removed',
      assets: 0,
      snapshots: 1,
      transactions: 1,
    });
  });

  it('counts rows the file brings as added', () => {
    const diff = diffBackup(
      tables({ assets: [ASSETS[0]], snapshots: [], transactions: [] }),
      envelope(),
      CTX,
    );
    expect(diff.assets).toEqual({ added: 1, replaced: 1, removed: 0 });
    expect(diff.snapshots).toEqual({ added: 2, replaced: 0, removed: 0 });
    expect(diff.transactions).toEqual({ added: 3, replaced: 0, removed: 0 });
    expect(diff.warnings).toEqual([]);
  });

  it('warns once when the file empties a table — never twice for the same rows', () => {
    const env = buildBackup(ASSETS, [], TRANSACTIONS, SETTINGS, 'demo', '2026-08-04T12:00:00', 2);
    const diff = diffBackup(tables(), env, CTX);
    expect(diff.snapshots).toEqual({ added: 0, replaced: 0, removed: 2 });
    expect(diff.warnings).toEqual([{ code: 'no-snapshots', current: 2 }]);
  });

  it('warns that an asset-less file empties the dataset', () => {
    const env = buildBackup([], [], [], SETTINGS, 'demo', '2026-08-04T12:00:00', 2);
    const diff = diffBackup(tables(), env, CTX);
    expect(diff.warnings).toContainEqual({ code: 'no-assets' });
    expect(diff.warnings).toContainEqual({ code: 'no-snapshots', current: 2 });
    // Transactions have no wholesale-loss sentence of their own, so their
    // removal is stated by the partial-removal line.
    expect(diff.warnings).toContainEqual({
      code: 'rows-removed',
      assets: 0,
      snapshots: 0,
      transactions: 3,
    });
    expect(diff.after).toEqual({ assets: 0, snapshots: 0, transactions: 0 });
  });

  it('warns about a file from the other dataset', () => {
    const diff = diffBackup(tables(), envelope('live'), CTX);
    expect(diff.warnings).toEqual([{ code: 'other-dataset', dataset: 'live' }]);
  });

  it('warns about age only from a week out, and never about the future', () => {
    expect(diffBackup(tables(), envelope('demo', '2026-07-29T09:02:00'), CTX).warnings).toEqual([]);
    expect(diffBackup(tables(), envelope('demo', '2026-07-28T09:02:00'), CTX).warnings).toEqual([
      { code: 'exported-long-ago', days: 7, date: '2026-07-28' },
    ]);
    expect(diffBackup(tables(), envelope('demo', '2026-07-23T09:02:00'), CTX).warnings).toEqual([
      { code: 'exported-long-ago', days: 12, date: '2026-07-23' },
    ]);
    expect(diffBackup(tables(), envelope('demo', '2026-08-09T09:02:00'), CTX).warnings).toEqual([]);
  });

  it('warns about a file from a newer database version, never an older one', () => {
    const newer = buildBackup(
      ASSETS,
      SNAPSHOTS,
      TRANSACTIONS,
      SETTINGS,
      'demo',
      '2026-08-04T12:00:00',
      3,
    );
    expect(diffBackup(tables(), newer, CTX).warnings).toContainEqual({
      code: 'newer-db-version',
      file: 3,
      app: 2,
    });
    const older = buildBackup(
      ASSETS,
      SNAPSHOTS,
      TRANSACTIONS,
      SETTINGS,
      'demo',
      '2026-08-04T12:00:00',
      1,
    );
    expect(diffBackup(tables(), older, CTX).warnings).toEqual([]);
  });

  it('reports a missing settings block so the opt-in can step aside', () => {
    const env = buildBackup(
      ASSETS,
      SNAPSHOTS,
      TRANSACTIONS,
      undefined,
      'demo',
      '2026-08-04T12:00:00',
      2,
    );
    expect(diffBackup(tables(), env, CTX).hasSettings).toBe(false);
  });

  it('says nothing at all about an empty dataset receiving its first import', () => {
    const diff = diffBackup({ assets: [], snapshots: [], transactions: [] }, envelope(), CTX);
    expect(diff.warnings).toEqual([]);
    expect(diff.after).toEqual({ assets: 2, snapshots: 2, transactions: 3 });
  });
});
