import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  POSITION_MOVING,
  type Asset,
  type Snapshot,
  type Transaction,
  type TxType,
} from '../types';
import type { PriceRow } from '../valuation';
import {
  backupEnvelopeSchema,
  buildBackup,
  temporalKindAt,
  type BackupEnvelope,
  type TemporalKind,
} from './json';
import {
  classifyImportFiles,
  diffBackup,
  ISSUE_LIST_CAP,
  MAX_IMPORT_BYTES,
  validateImport,
  type PortfolioTables,
} from './import';

// Hand-built portfolio; the full seed round-trip runs through the real DB in
// src/lib/repository.test.ts — core tests must not import src/lib. *Core is pure*
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
  { date: '2026-07-24', quotes: { reit: 68560.9, energy: 60050.87 } },
  {
    date: '2026-07-25',
    quotes: { reit: 68629.36, energy: 60086.09 },
    savedAt: '2026-07-25T21:14:00',
  },
];

// The file's prices, on the two days the store's snapshots above quote.
const PRICES: PriceRow[] = [
  { assetId: 'energy', asOf: '2026-07-24', price: 10.2004 },
  { assetId: 'reit', asOf: '2026-07-24', price: 11.1228 },
  { assetId: 'energy', asOf: '2026-07-25', price: 10.2064, observedAt: '2026-07-25T21:14:00' },
  { assetId: 'reit', asOf: '2026-07-25', price: 11.1339, observedAt: '2026-07-25T21:14:00' },
];

const TRANSACTIONS: Transaction[] = [
  { id: 'd1', date: '2026-02-03', type: 'deposit', assetId: '', amount: 123844.37 },
  // A COUNT, because a position-moving row requires one at this door too.
  {
    id: 'b1',
    date: '2026-02-03',
    type: 'buy',
    assetId: 'reit',
    amount: 64628.62,
    quantity: 6164,
  },
  {
    id: 'p1',
    date: '2026-02-10',
    type: 'dividend_accrual',
    assetId: 'reit',
    amount: 580.2,
  },
];

const SETTINGS = { currency: 'UAH', usdRate: 44.83 } as const;

function envelope(
  dataset: 'demo' | 'live' = 'demo',
  exportedAt = '2026-08-04T12:00:00',
): BackupEnvelope {
  return buildBackup(ASSETS, PRICES, TRANSACTIONS, SETTINGS, dataset, exportedAt, 2);
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

// Which types name an asset, and which carry a count — written out rather than read
// from `targetsAsset` / `movesPosition`, because the door under test asks those
// predicates and a fixture that asked them too would agree with them however they
// answered. A `Record<TxType, …>` and not a list: a ninth type has no row here, and
// a portfolio-level one dropped into a list would be tested as though it named an asset.
const CARRIES: Record<TxType, { asset: boolean; quantity: boolean }> = {
  buy: { asset: true, quantity: true },
  sell: { asset: true, quantity: true },
  deposit: { asset: false, quantity: false },
  withdrawal: { asset: false, quantity: false },
  dividend_accrual: { asset: true, quantity: false },
  interest_payout: { asset: true, quantity: false },
  reinvest: { asset: true, quantity: true },
  redemption: { asset: true, quantity: true },
};
const everyType = Object.keys(CARRIES) as TxType[];

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

  it('does not accept .csv — export-only by decision, not a gap', () => {
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
    expect(result.envelope.prices).toEqual(PRICES);
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
  it('rejects non-JSON text with the envelope sentence as its mono detail', () => {
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

  it('rejects formatVersion 14 as a NEWER format, with the version and the detail', () => {
    const result = validateImport(mutated((env) => void (env.formatVersion = 14)));
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'format') return;
    expect(result.rejection.code).toBe('newer-format');
    expect(result.rejection.version).toBe(14);
    expect(result.rejection.detail).toBe(
      'Unsupported formatVersion 14 — this app reads formatVersion 13 only.',
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
        env.formatVersion = 14;
        (env.assets as Record<string, unknown>[])[0].createdAt = 'nonsense';
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection.kind).toBe('format');
  });

  // `String` of a parsed value can throw: an array joins itself once per level of nesting, and
  // an object whose own `toString` is not callable falls back to `valueOf` (#355). The door
  // promises a result, so each is refused with its kind named, never converted.
  describe('a format or formatVersion that is not a primitive is refused, not thrown (#355)', () => {
    const formatRefusal = (text: string) => {
      const result = validateImport(text);
      if (result.ok || result.rejection.kind !== 'format') {
        throw new Error('expected a format rejection');
      }
      return result.rejection;
    };

    it('refuses a format that is an array nested 20,000 deep as not-a-backup, naming an array', () => {
      const rejection = formatRefusal(deepArrayAt('format'));
      expect(rejection.code).toBe('not-a-backup');
      expect(rejection.detail).toBe('Not a quirenote-backup file (format: an array).');
    });

    it('refuses a format whose toString is not callable as not-a-backup, naming an object', () => {
      const rejection = formatRefusal(mutated((env) => void (env.format = { toString: 1 })));
      expect(rejection.code).toBe('not-a-backup');
      expect(rejection.detail).toBe('Not a quirenote-backup file (format: an object).');
    });

    it('refuses a format that is an array holding such an object, naming an array', () => {
      const rejection = formatRefusal(mutated((env) => void (env.format = [{ toString: 1 }])));
      expect(rejection.code).toBe('not-a-backup');
      expect(rejection.detail).toBe('Not a quirenote-backup file (format: an array).');
    });

    it('refuses a formatVersion that is an array nested 20,000 deep as unsupported-format', () => {
      const rejection = formatRefusal(deepArrayAt('formatVersion'));
      expect(rejection.code).toBe('unsupported-format');
      expect(rejection.version).toBeUndefined();
      expect(rejection.detail).toBe(
        'Unsupported formatVersion (an array) — this app reads formatVersion 13 only.',
      );
    });

    it('refuses a formatVersion whose toString is not callable as unsupported-format', () => {
      const rejection = formatRefusal(mutated((env) => void (env.formatVersion = { toString: 1 })));
      expect(rejection.code).toBe('unsupported-format');
      expect(rejection.version).toBeUndefined();
      expect(rejection.detail).toBe(
        'Unsupported formatVersion (an object) — this app reads formatVersion 13 only.',
      );
    });

    it('refuses a formatVersion that is an array holding such an object as unsupported-format', () => {
      const rejection = formatRefusal(
        mutated((env) => void (env.formatVersion = [{ toString: 1 }])),
      );
      expect(rejection.code).toBe('unsupported-format');
      expect(rejection.version).toBeUndefined();
      expect(rejection.detail).toBe(
        'Unsupported formatVersion (an array) — this app reads formatVersion 13 only.',
      );
    });
  });
});

const DEEP = 20_000;

/** The envelope with `field` set to an array nested `DEEP` levels, built as TEXT: a nesting
 *  that deep is a stack hazard to build or stringify as a value, and the door reads text. */
function deepArrayAt(field: 'format' | 'formatVersion'): string {
  return mutated((env) => void (env[field] = '__DEEP__')).replace(
    '"__DEEP__"',
    '['.repeat(DEEP) + ']'.repeat(DEEP),
  );
}

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

  it("rejects a 'Z'-suffixed datetime, which z.iso.datetime would accept", () => {
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

  it('rejects a Z-suffixed price observedAt too, addressing the price by its index', () => {
    const result = validateImport(
      mutated(
        (env) =>
          void ((env.prices as Record<string, unknown>[])[3].observedAt = '2026-07-25T21:14:00Z'),
      ),
    );
    if (result.ok || result.rejection.kind !== 'rows') throw new Error('expected a rows reject');
    expect(result.rejection.issues).toEqual([
      expect.objectContaining({
        table: 'prices',
        at: '3',
        field: 'observedAt',
        code: 'expected-datetime',
      }),
    ]);
  });

  it('codes a refused exportedAt as a timestamp, like createdAt and savedAt (#346)', () => {
    // Coded `invalid`, the report would print the validator's English in a Ukrainian app.
    const result = validateImport(mutated((env) => void (env.exportedAt = '2026-13-01T00:00:00')));
    if (result.ok || result.rejection.kind !== 'rows') throw new Error('expected a rows reject');
    expect(result.rejection.issues).toEqual([
      expect.objectContaining({
        table: 'envelope',
        field: 'exportedAt',
        code: 'expected-datetime',
      }),
    ]);
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
          // A COUNT, so the ONE reason under test is the unknown asset id.
          quantity: 1,
        }),
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'rows') return;
    expect(result.rejection.issues).toEqual([
      { table: 'transactions', at: 'tx-0007', code: 'unknown-asset-id', value: 'a-9' },
    ]);
  });

  it('rejects a position-moving row that names no asset', () => {
    // `assetId !== ''` used to skip the WHOLE check for an empty id, so this shape
    // sailed through: legitimate on a deposit, meaningless on a buy, and the exact row
    // `transaction_asset_present_ck` rejects at migration. It rendered in the ledger as
    // «Купівля · Портфель».
    const result = validateImport(
      mutated((env) =>
        (env.transactions as Record<string, unknown>[]).push({
          id: 'tx-0008',
          date: '2026-07-01',
          type: 'buy',
          assetId: '',
          amount: 100,
          quantity: 1,
        }),
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'rows') return;
    expect(result.rejection.issues).toEqual([
      { table: 'transactions', at: 'tx-0008', code: 'asset-missing-on-asset-row' },
    ]);
  });

  // THE RULE MOVED. This door used to gate on `movesPosition` — four types — so an
  // imported payout with no asset reached the store. `transaction_asset_present_ck`
  // widens to six so the store and the form agree, and the withholding is attributed
  // by the row's OWN asset — so a payout naming none would carry one past attribution
  // and then fail the CHECK at migration. The envelope gates on `targetsAsset`.
  it('accepts an empty id on the two PORTFOLIO-level types, and only those', () => {
    const asRow = (type: TxType) =>
      mutated((env) =>
        (env.transactions as Record<string, unknown>[]).push({
          id: `tx-${type}`,
          date: '2026-07-01',
          type,
          assetId: '',
          amount: 100,
          // So the only rule an asset-targeting row can break here is the one this test is
          // about.
          ...(CARRIES[type].quantity ? { quantity: 1 } : {}),
        }),
      );
    // "And only those" is asserted rather than sampled: all eight, against the table,
    // so a wrong row fails instead of leaving its type untested.
    for (const type of everyType) {
      expect(validateImport(asRow(type)).ok, type).toBe(!CARRIES[type].asset);
    }
  });

  it('BLANKS an asset a portfolio-level row names, rather than refusing the file', () => {
    // The population is a v5 file exported from a store whose deposits predate the rule:
    // the form filled `assetId` for all nine types, so a deposit carried whichever asset
    // the picker showed, and those rows are still in the store. (NOT a pre-rule FILE:
    // the version gate refuses those first.) Refusing them would leave such a store
    // unable to back itself up, for a value W7 discards anyway. The keeping half is
    // asserted on all eight in the next test; this one is about the blanking, so it
    // takes the types the table says name no asset.
    for (const type of everyType) {
      if (CARRIES[type].asset) continue;
      const result = validateImport(
        mutated((env) =>
          (env.transactions as Record<string, unknown>[]).push({
            id: `tx-blank-${type}`,
            date: '2026-07-01',
            type,
            assetId: 'reit',
            amount: 100,
          }),
        ),
      );
      expect(result.ok, type).toBe(true);
      if (!result.ok) continue;
      expect(result.envelope.transactions.find((t) => t.id === `tx-blank-${type}`)?.assetId).toBe(
        '',
      );
    }
  });

  it('KEEPS the asset on every type that names one and blanks it on the rest', () => {
    // The other side of the predicate, and the one an inverted `!` would break silently:
    // blanking a payout produced an orphaned portfolio row that no rule refused, because
    // the gate named only the four moving types. It is now caught at the door above,
    // which is why the two halves are one predicate. BOTH HALVES over all eight rather
    // than the six selected out — a `continue` turns a wrong row from a failing
    // assertion into a missing one.
    for (const type of everyType) {
      const result = validateImport(
        mutated((env) =>
          (env.transactions as Record<string, unknown>[]).push({
            id: `tx-keep-${type}`,
            date: '2026-07-01',
            type,
            assetId: 'reit',
            amount: 100,
            ...(CARRIES[type].quantity ? { quantity: 1 } : {}),
          }),
        ),
      );
      expect(result.ok, type).toBe(true);
      if (!result.ok) continue;
      // A type that names an asset keeps the one it named; a portfolio-level one is
      // blanked — the two halves of the one predicate, asserted together.
      expect(
        result.envelope.transactions.find((t) => t.id === `tx-keep-${type}`)?.assetId,
        type,
      ).toBe(CARRIES[type].asset ? 'reit' : '');
    }
  });

  it('REPORTS a dangling asset id on a portfolio-level row instead of tidying it', () => {
    // The blanking runs AFTER `integrityIssues`, never as a row transform. As a
    // transform it ran first, so this file imported clean and the `unknown-asset-id`
    // branch was never reached. A dangling id is not a value to discard — it is
    // evidence the file lost an asset row.
    const result = validateImport(
      mutated((env) =>
        (env.transactions as Record<string, unknown>[]).push({
          id: 'tx-0010',
          date: '2026-07-01',
          type: 'deposit',
          assetId: 'a-9',
          amount: 100,
        }),
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'rows') return;
    expect(result.rejection.issues).toEqual([
      { table: 'transactions', at: 'tx-0010', code: 'unknown-asset-id', value: 'a-9' },
    ]);
  });

  it('rejects a price for an asset the file does not carry', () => {
    const result = validateImport(
      mutated((env) => void ((env.prices as Record<string, unknown>[])[1].assetId = 'a-9')),
    );
    if (result.ok || result.rejection.kind !== 'rows') throw new Error('expected a rows reject');
    expect(result.rejection.issues).toEqual([
      { table: 'prices', at: '2026-07-24', code: 'unknown-asset-id', value: 'a-9' },
    ]);
  });

  it('rejects a second price for one asset and day, the store’s key', () => {
    const result = validateImport(
      mutated((env) => {
        const prices = env.prices as Record<string, unknown>[];
        prices.push({ ...prices[1], price: 12 });
      }),
    );
    if (result.ok || result.rejection.kind !== 'rows') throw new Error('expected a rows reject');
    expect(result.rejection.issues).toEqual([
      { table: 'prices', at: '2026-07-24', code: 'duplicate-price', value: 'reit' },
    ]);
  });

  it('codes a price that is not above zero as a positive amount, as the store refuses it', () => {
    for (const price of [0, -10.2]) {
      const result = validateImport(
        mutated((env) => void ((env.prices as Record<string, unknown>[])[0].price = price)),
      );
      if (result.ok || result.rejection.kind !== 'rows') throw new Error(`${price}: expected rows`);
      expect(result.rejection.issues, String(price)).toEqual([
        expect.objectContaining({
          table: 'prices',
          at: '0',
          field: 'price',
          code: 'expected-positive-amount',
        }),
      ]);
    }
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
      mutated((env) => void ((env.transactions as Record<string, unknown>[])[0].id = 7)),
    );
    if (result.ok || result.rejection.kind !== 'rows') throw new Error('expected a rows reject');
    expect(result.rejection.issues[0]).toMatchObject({
      table: 'transactions',
      at: '0',
      field: 'id',
    });
  });

  it('addresses a price by its index, its key being two fields', () => {
    const result = validateImport(
      mutated((env) => void ((env.prices as Record<string, unknown>[])[1].asOf = '24.07.2026')),
    );
    if (result.ok || result.rejection.kind !== 'rows') throw new Error('expected a rows reject');
    expect(result.rejection.issues).toEqual([
      expect.objectContaining({ table: 'prices', at: '1', field: 'asOf', code: 'expected-date' }),
    ]);
  });

  it('names a date no calendar has with the date code (#341)', () => {
    const result = validateImport(
      mutated(
        (env) => void ((env.transactions as Record<string, unknown>[])[0].date = '2026-02-30'),
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'rows') return;
    expect(result.rejection.issues).toHaveLength(1);
    expect(result.rejection.issues[0]).toMatchObject({
      table: 'transactions',
      at: 'd1',
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

  // The S3 worked illustration: yesterday's backup over today's data silently drops
  // today's snapshot and today's transaction.
  it("reports yesterday's backup over today's data as replaced + removed", () => {
    const current = tables({
      snapshots: [...SNAPSHOTS, { date: '2026-07-26', quotes: { reit: 1 } }],
      transactions: [
        ...TRANSACTIONS,
        { id: 'today', date: '2026-07-26', type: 'buy', assetId: 'reit', amount: 5 },
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
    // Transactions have no wholesale-loss sentence of their own, so their removal is
    // stated by the partial-removal line.
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
      PRICES,
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
      PRICES,
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
      PRICES,
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

describe('the units rule reaches the reader in their own language', () => {
  // The schema emits a PATH and no message; `codeFor` turns it into an `IssueCode`
  // and `import-labels.ts` owns the words. A message on the schema is carried through
  // as `issue.detail` and printed verbatim, which put an English sentence in the
  // middle of a Ukrainian report.
  const withUnitsOnAPayout = (field: 'quantity' | 'unitPrice') =>
    mutated((env) => {
      const rows = env.transactions as Record<string, unknown>[];
      const payout = rows.find((r) => !POSITION_MOVING.includes(r.type as never));
      if (payout === undefined) throw new Error('fixture has no non-position row');
      payout[field] = 12;
    });

  for (const field of ['quantity', 'unitPrice'] as const) {
    it(`codes a ${field} on a payout, rather than describing it in English`, () => {
      const result = validateImport(withUnitsOnAPayout(field));
      expect(result.ok).toBe(false);
      if (result.ok || result.rejection.kind !== 'rows') return;
      const issue = result.rejection.issues.find((i) => i.field === field);
      expect(issue?.code).toBe('units-on-non-position-row');
      // and no English rides along to be printed as the reason
      expect(issue?.detail ?? '').not.toMatch(/only valid on/);
    });
  }
});

describe('an OLDER backup is named as older, not as broken', () => {
  it('maps formatVersion 1 to `older-format`, with the version', () => {
    // A real backup from an older build must not share a sentence with a hand-edited `0`,
    // which would call it unreadable rather than superseded.
    const result = validateImport(mutated((env) => void (env.formatVersion = 1)));
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'format') return;
    expect(result.rejection.code).toBe('older-format');
    expect(result.rejection.version).toBe(1);
  });

  it('maps formatVersion 2 to `older-format` too', () => {
    // A version only `dev` ever wrote is still a real backup: `dev` deploys on every push.
    const result = validateImport(mutated((env) => void (env.formatVersion = 2)));
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'format') return;
    expect(result.rejection.code).toBe('older-format');
    expect(result.rejection.version).toBe(2);
  });

  it('maps formatVersion 9, the build before real timestamps, to `older-format` (#346)', () => {
    // A v9 build read `2026-13-01T00:00:00` as a timestamp, so its file is refused ONCE, on
    // the version, rather than once per timestamp this build cannot read.
    const result = validateImport(
      mutated((env) => {
        env.formatVersion = 9;
        env.exportedAt = '2026-13-01T00:00:00';
      }),
    );
    if (result.ok || result.rejection.kind !== 'format') {
      throw new Error('expected a format reject');
    }
    expect(result.rejection.code).toBe('older-format');
    expect(result.rejection.version).toBe(9);
  });

  it('maps formatVersion 10, the build that accepted a __proto__ key, to `older-format` (#353)', () => {
    // A v10 build dropped a `__proto__` key in silence; this one refuses it, so it accepts
    // strictly less and the version moves. The v10 file is refused once, on the version.
    const result = validateImport(mutated((env) => void (env.formatVersion = 10)));
    if (result.ok || result.rejection.kind !== 'format') {
      throw new Error('expected a format reject');
    }
    expect(result.rejection.code).toBe('older-format');
    expect(result.rejection.version).toBe(10);
  });

  it('maps formatVersion 11, the build that accepted an asset id such as `constructor`, to `older-format` (#354)', () => {
    // Refused once, on the version, even when it carries the id this build refuses.
    const result = validateImport(
      mutated((env) => {
        env.formatVersion = 11;
        (env.assets as Record<string, unknown>[])[0].id = 'constructor';
      }),
    );
    if (result.ok || result.rejection.kind !== 'format') {
      throw new Error('expected a format reject');
    }
    expect(result.rejection.code).toBe('older-format');
    expect(result.rejection.version).toBe(11);
  });

  it('maps formatVersion 12, whose snapshots carried ₴ quotes, to `older-format` (#396)', () => {
    const result = validateImport(
      mutated((env) => {
        env.formatVersion = 12;
        env.snapshots = [{ date: '2026-07-24', quotes: { reit: 68560.9 } }];
        delete env.prices;
      }),
    );
    if (result.ok || result.rejection.kind !== 'format') {
      throw new Error('expected a format reject');
    }
    expect(result.rejection.code).toBe('older-format');
    expect(result.rejection.version).toBe(12);
  });

  it('does not call a fractional version an older backup', () => {
    // `1.5` is below the current version and at least 1, so the bare `>= 1` read it as a
    // real backup from an older app and reported "version 1.5". A version counts format
    // revisions; a non-integer is a corrupt file.
    const result = validateImport(mutated((env) => void (env.formatVersion = 1.5)));
    expect(result.ok).toBe(false);
    if (result.ok || result.rejection.kind !== 'format') return;
    expect(result.rejection.code).toBe('unsupported-format');
  });

  it('keeps `unsupported-format` for a version that is not a real one', () => {
    for (const bad of [0, -1, 'v2']) {
      const result = validateImport(mutated((env) => void (env.formatVersion = bad)));
      expect(result.ok).toBe(false);
      if (result.ok || result.rejection.kind !== 'format') continue;
      expect(result.rejection.code).toBe('unsupported-format');
    }
  });

  it('carries the detail line naming BOTH versions', () => {
    // The code picks the sentence; the detail is the parser's own line, and it has to
    // say what this app reads or "no longer importable" is unactionable.
    const result = validateImport(mutated((env) => void (env.formatVersion = 1)));
    if (result.ok || result.rejection.kind !== 'format')
      throw new Error('expected a format reject');
    expect(result.rejection.detail).toContain('formatVersion 1');
    expect(result.rejection.detail).toContain('formatVersion 13');
  });
});

describe('every way a note can be wrong reports ONE localised code', () => {
  // THE DOOR THAT OWNS THE WORDS. `parseBackup` renders English for its own string
  // contract; THIS path emits codes that `import-labels.ts` turns into the reader's
  // language, so a code falling through to `invalid` prints the VALIDATOR's own
  // English verbatim into a Ukrainian report — the one thing this layer forbids.
  //
  // Both halves of this were wrong when first written: `.min(1)` beside the whitespace
  // refinement reported an empty note TWICE for one fact, and the refinement emits
  // `custom`, which the mapping did not name.
  const withNote = (note: string) =>
    validateImport(
      mutated((env) =>
        (env.transactions as Record<string, unknown>[]).push({
          id: 'tx-note',
          date: '2026-07-01',
          type: 'interest_payout',
          assetId: 'reit',
          amount: 100,
          note,
        }),
      ),
    );

  for (const [label, note] of [
    ['empty', ''],
    ['one space', ' '],
    ['whitespace only', '   '],
    ['one over the cap', 'я'.repeat(101)],
    // LONG AND BLANK AT ONCE — the shape that still doubled after the first repair,
    // because `.max(100)` and the trim check both fired on it. One predicate cannot
    // report one row twice.
    ['a hundred and one spaces', ' '.repeat(101)],
  ] as const) {
    it(`${label} → exactly one \`note-length\``, () => {
      const result = withNote(note);
      expect(result.ok, label).toBe(false);
      if (result.ok || result.rejection.kind !== 'rows') return;
      expect(result.rejection.issues, label).toHaveLength(1);
      expect(result.rejection.issues[0], label).toMatchObject({
        table: 'transactions',
        at: 'tx-note',
        field: 'note',
        code: 'note-length',
      });
    });
  }

  it('accepts a note that is exactly the cap, and one of a single character', () => {
    expect(withNote('я'.repeat(100)).ok).toBe(true);
    expect(withNote('я').ok).toBe(true);
  });
});

describe('a field is a date because of its schema, not its name (#352)', () => {
  // THE ALLOW-LIST: every field the backup carries with the date or timestamp schema, as a
  // path with arrays entered at 0. A ninth one is added here, not to a list beside the schemas.
  const TEMPORAL: Record<string, TemporalKind> = {
    'assets.0.firstPurchase': 'date',
    'assets.0.maturity': 'date',
    'assets.0.nextCoupon': 'date',
    'assets.0.createdAt': 'datetime',
    'prices.0.asOf': 'date',
    'prices.0.observedAt': 'datetime',
    'transactions.0.date': 'date',
    exportedAt: 'datetime',
  };

  // Every leaf of the envelope schema with its path, through zod's public accessors — an
  // array entered at 0, a record at one stand-in key. A schema kind not listed here throws,
  // so a wrapper the walker does not step through cannot hide a field from this test.
  const LEAF_KINDS = [z.ZodString, z.ZodISODate, z.ZodNumber, z.ZodEnum, z.ZodLiteral];
  function leaves(
    schema: z.ZodType,
    path: PropertyKey[] = [],
  ): { path: PropertyKey[]; leaf: z.ZodType }[] {
    const s = schema instanceof z.ZodOptional ? (schema.unwrap() as z.ZodType) : schema;
    if (s instanceof z.ZodObject) {
      return Object.entries(s.shape as Record<string, z.ZodType>).flatMap(([key, field]) =>
        leaves(field, [...path, key]),
      );
    }
    if (s instanceof z.ZodArray) return leaves(s.element as z.ZodType, [...path, 0]);
    if (s instanceof z.ZodRecord) return leaves(s.valueType as z.ZodType, [...path, 'reit']);
    if (!LEAF_KINDS.some((kind) => s instanceof kind)) {
      throw new Error(`a schema kind this test does not know, at ${path.join('.')}`);
    }
    return [{ path, leaf: s }];
  }

  // By what the field ACCEPTS, not by which schema object it is: the oracle the walker's
  // identity check is held to.
  const acceptsAs = (leaf: z.ZodType): TemporalKind | undefined =>
    leaf.safeParse('abc').success
      ? undefined
      : leaf.safeParse('2026-02-03').success
        ? 'date'
        : leaf.safeParse('2026-02-03T10:00:00').success
          ? 'datetime'
          : undefined;

  const temporalBy = (kindOf: (path: PropertyKey[], leaf: z.ZodType) => TemporalKind | undefined) =>
    Object.fromEntries(
      leaves(backupEnvelopeSchema).flatMap(({ path, leaf }) => {
        const kind = kindOf(path, leaf);
        return kind === undefined ? [] : [[path.join('.'), kind]];
      }),
    );

  it('finds exactly the eight by what each field accepts', () => {
    expect(temporalBy((_, leaf) => acceptsAs(leaf))).toEqual(TEMPORAL);
  });

  it('finds the same eight by walking the envelope and row schemas', () => {
    expect(temporalBy((path) => temporalKindAt(path))).toEqual(TEMPORAL);
  });

  function setAt(env: Record<string, unknown>, path: string[], value: unknown): void {
    const parent = path
      .slice(0, -1)
      .reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, env);
    parent[String(path.at(-1))] = value;
  }

  for (const [place, kind] of Object.entries(TEMPORAL)) {
    // A string no calendar has, and a number where a string belongs: #341's ruling is that
    // any fault on a date field takes the date code, so neither prints zod's English.
    for (const value of ['abc', 1]) {
      it(`codes ${JSON.stringify(value)} at ${place} as expected-${kind}`, () => {
        const path = place.split('.');
        const [table, , ...rest] = path;
        const result = validateImport(mutated((env) => setAt(env, path, value)));
        if (result.ok || result.rejection.kind !== 'rows') throw new Error('expected rows');
        expect(result.rejection.issues).toEqual([
          expect.objectContaining(
            path.length === 1
              ? { table: 'envelope', field: place, code: `expected-${kind}` }
              : { table, field: rest.join('.'), code: `expected-${kind}` },
          ),
        ]);
      });
    }
  }
});

describe('a __proto__ key is refused wherever it sits (#353)', () => {
  // `obj['__proto__'] = v` and `{ __proto__: v }` set the prototype and put no key in the file;
  // the helper defines the own key and checks the serialised text carries it.
  type Env = Record<string, unknown>;
  type Define = (target: unknown, value: unknown) => void;
  const define: Define = (target, value) =>
    void Object.defineProperty(target, '__proto__', {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  const rows = (env: Env, table: string) => env[table] as Env[];
  function withProtoKey(mutate: (env: Env, define: Define) => void): string {
    const text = mutated((env) => mutate(env, define));
    expect(text).toContain('"__proto__"');
    return text;
  }
  function theOneIssue(text: string) {
    const result = validateImport(text);
    if (result.ok || result.rejection.kind !== 'rows') throw new Error('expected a rows reject');
    expect(result.rejection.issues).toHaveLength(1);
    const [issue] = result.rejection.issues;
    expect(issue).toMatchObject({ code: 'forbidden-key', value: '__proto__' });
    return issue;
  }

  const PLACES: Record<
    string,
    { set: (env: Env, define: Define) => void; table: string; at?: string; field?: string }
  > = {
    'the envelope': { set: (env, d) => d(env, 1), table: 'envelope' },
    // Addressed as `unknown-key` addresses a stray key there.
    settings: { set: (env, d) => d(env.settings, 1), table: 'settings', field: 'settings' },
    'an asset row': {
      set: (env, d) => d(rows(env, 'assets')[0], { x: 1 }),
      table: 'assets',
      at: '0',
    },
    "an asset's inzhur": {
      set: (env, d) => {
        const asset = rows(env, 'assets')[0];
        asset.inzhur = { kind: 'fund', ref: 'x' };
        d(asset.inzhur, 1);
      },
      table: 'assets',
      at: '0',
      field: 'inzhur',
    },
    // A key on the row itself is addressed by index, as `unknown-key` is there.
    'a price row': {
      set: (env, d) => d(rows(env, 'prices')[0], 1),
      table: 'prices',
      at: '0',
    },
    'a transaction row': {
      set: (env, d) => d(rows(env, 'transactions')[0], 1),
      table: 'transactions',
      at: '0',
    },
  };

  for (const [place, { set, table, at, field }] of Object.entries(PLACES)) {
    it(`refuses the key on ${place}, naming the place`, () => {
      const issue = theOneIssue(withProtoKey(set));
      expect(issue.table).toBe(table);
      expect(issue.at).toBe(at);
      expect(issue.field).toBe(field);
    });
  }

  it('refuses an asset whose id is __proto__: a plain-object quote map cannot hold that key', () => {
    const issue = theOneIssue(
      withProtoKey((env) => void (rows(env, 'assets')[0].id = '__proto__')),
    );
    expect(issue).toMatchObject({ table: 'assets', at: '0', field: 'id' });
  });

  it('leaves a key no schema declares to the schema, whatever is below it', () => {
    const text = withProtoKey((env, d) => {
      rows(env, 'assets')[0].foo = {};
      d(rows(env, 'assets')[0].foo, 1);
    });
    const result = validateImport(text);
    if (result.ok || result.rejection.kind !== 'rows') throw new Error('expected a rows reject');
    expect(result.rejection.issues).toEqual([
      expect.objectContaining({ table: 'assets', at: '0', code: 'unknown-key', value: 'foo' }),
    ]);
  });

  it('reports a file nested past the call stack as a stray key, without throwing', () => {
    const deep = '['.repeat(20_000) + ']'.repeat(20_000);
    const text = mutated((env) => void (env.x = 0)).replace('"x":0', `"x":${deep}`);
    const result = validateImport(text);
    if (result.ok || result.rejection.kind !== 'rows') throw new Error('expected a rows reject');
    expect(result.rejection.issues).toEqual([
      expect.objectContaining({ table: 'envelope', code: 'unknown-key', value: 'x' }),
    ]);
  });
});

describe('an asset id named for a member every object inherits is refused (#354)', () => {
  // THE ALLOW-LIST: every own property name of `Object.prototype`, held against the engine;
  // a plain quote map with no own key of that name answers `quotes[id]` with the member.
  const INHERITED_NAMES = [
    '__defineGetter__',
    '__defineSetter__',
    '__lookupGetter__',
    '__lookupSetter__',
    '__proto__',
    'constructor',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
    'toString',
    'valueOf',
  ];

  it('lists exactly the names Object.prototype owns', () => {
    expect([...Object.getOwnPropertyNames(Object.prototype)].sort()).toEqual(INHERITED_NAMES);
  });

  for (const name of INHERITED_NAMES) {
    it(`refuses an asset whose id is ${name}, naming the row and its id`, () => {
      const result = validateImport(
        mutated((env) => void ((env.assets as Record<string, unknown>[])[0].id = name)),
      );
      if (result.ok || result.rejection.kind !== 'rows') throw new Error('expected a rows reject');
      // One issue: the id is refused before the row schemas and before the transactions that
      // still name the old id are checked against the table.
      expect(result.rejection.issues).toEqual([
        {
          table: 'assets',
          at: '0',
          field: 'id',
          code: 'forbidden-key',
          value: name,
          detail: expect.any(String),
        },
      ]);
    });
  }

  it('refuses the id on any row, addressed by that row’s index', () => {
    const result = validateImport(
      mutated((env) => void ((env.assets as Record<string, unknown>[])[1].id = 'constructor')),
    );
    if (result.ok || result.rejection.kind !== 'rows') throw new Error('expected a rows reject');
    expect(result.rejection.issues).toEqual([
      expect.objectContaining({ table: 'assets', at: '1', field: 'id', code: 'forbidden-key' }),
    ]);
  });

  it('refuses an id of __proto__ on an engine that deletes the accessor', () => {
    // Node's `--disable-proto=delete` does, and `Object.prototype` then owns no such name.
    const text = mutated(
      (env) => void ((env.assets as Record<string, unknown>[])[0].id = '__proto__'),
    );
    const accessor = Object.getOwnPropertyDescriptor(Object.prototype, '__proto__');
    if (accessor === undefined) throw new Error('expected the accessor');
    let owned: boolean;
    let result: ReturnType<typeof validateImport>;
    expect(Reflect.deleteProperty(Object.prototype, '__proto__')).toBe(true);
    try {
      owned = Object.hasOwn(Object.prototype, '__proto__');
      result = validateImport(text);
    } finally {
      Object.defineProperty(Object.prototype, '__proto__', accessor);
    }
    expect(owned).toBe(false);
    if (result.ok || result.rejection.kind !== 'rows') throw new Error('expected a rows reject');
    expect(result.rejection.issues).toEqual([
      expect.objectContaining({ table: 'assets', at: '0', field: 'id', code: 'forbidden-key' }),
    ]);
  });

  // Ids that only look inherited, or that another prototype owns, are ordinary ids.
  for (const id of ['prototype', 'Constructor', 'toJSON', 'name', 'length', 'call']) {
    it(`accepts an asset whose id is ${id}`, () => {
      const result = validateImport(
        mutated((env) => {
          (env.assets as Record<string, unknown>[])[1].id = id;
          for (const p of env.prices as { assetId: string }[]) {
            if (p.assetId === 'energy') p.assetId = id;
          }
        }),
      );
      if (!result.ok) throw new Error('expected the file to pass');
      expect(result.envelope.assets[1].id).toBe(id);
      expect(result.envelope.prices[0]).toEqual({ ...PRICES[0], assetId: id });
    });
  }

  it('leaves these names on a PRICE to the integrity pass, which knows no such asset', () => {
    // The names are refused as an asset ID; a price naming one is still a price for an
    // asset the file does not carry.
    const result = validateImport(
      mutated((env) => void ((env.prices as Record<string, unknown>[])[0].assetId = 'constructor')),
    );
    if (result.ok || result.rejection.kind !== 'rows') throw new Error('expected a rows reject');
    expect(result.rejection.issues).toEqual([
      expect.objectContaining({
        table: 'prices',
        code: 'unknown-asset-id',
        value: 'constructor',
      }),
    ]);
  });
});
