import { describe, expect, it } from 'vitest';

import type { Asset, Snapshot, Transaction } from '../types';
import { buildBackup, parseBackup, type BackupEnvelope } from './json';

// Minimal hand-built portfolio (the full 4/174/18 seed round-trip lives in
// src/lib/seed.test.ts — core tests must not import src/lib, G1).
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
    payoutSchedule: 'none', // seed-only 'none' must validate
    firstPurchase: '2026-02-03',
    createdAt: '2026-02-03T10:00:01',
  },
];

const SNAPSHOTS: Snapshot[] = [
  {
    date: '2026-07-24',
    quotes: { reit: 68560.9, energy: 60050.87 },
    cash: 7.75,
  },
  {
    date: '2026-07-25',
    quotes: { reit: 68629.36, energy: 60086.09 },
    cash: 7.75,
    savedAt: '2026-07-25T21:14:00',
  },
];

const TRANSACTIONS: Transaction[] = [
  {
    id: 'd1',
    date: '2026-02-03',
    type: 'deposit',
    assetId: '',
    amount: 123844.37,
    source: 'own',
  },
  {
    id: 'b1',
    date: '2026-02-03',
    type: 'buy',
    assetId: 'reit',
    amount: 64628.62,
    source: 'own',
  },
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

function envelope(): BackupEnvelope {
  return buildBackup(
    ASSETS,
    SNAPSHOTS,
    TRANSACTIONS,
    SETTINGS,
    'demo',
    '2026-07-28T12:00:00',
    2,
  );
}

// Serialize a hand-mutated envelope for the rejection fixtures.
function mutated(mutate: (env: Record<string, unknown>) => void): string {
  const env = JSON.parse(JSON.stringify(envelope())) as Record<string, unknown>;
  mutate(env);
  return JSON.stringify(env);
}

describe('buildBackup', () => {
  it('assembles the pinned envelope shape', () => {
    const env = envelope();
    expect(env.format).toBe('kubushka-backup');
    expect(env.formatVersion).toBe(1);
    expect(env.exportedAt).toBe('2026-07-28T12:00:00');
    expect(env.dbVersion).toBe(2);
    expect(env.dataset).toBe('demo');
    expect(env.settings).toEqual(SETTINGS);
  });

  it('normalizes full-ISO datetimes to the timezone-less convention', () => {
    // v1 buildNewAsset stamps toISOString() ('Z' + millis) — the app's own
    // backup must still validate.
    const created: Asset = {
      ...ASSETS[0],
      id: 'x',
      createdAt: '2026-07-28T09:30:15.123Z',
    };
    const env = buildBackup(
      [...ASSETS, created],
      SNAPSHOTS,
      TRANSACTIONS,
      SETTINGS,
      'demo',
      '2026-07-28T12:00:00',
      2,
    );
    expect(env.assets[2].createdAt).toBe('2026-07-28T09:30:15');
    const parsed = parseBackup(JSON.stringify(env));
    expect(parsed.ok).toBe(true);
  });

  it('omits the settings key entirely when none are passed', () => {
    const env = buildBackup(
      ASSETS,
      SNAPSHOTS,
      TRANSACTIONS,
      undefined,
      'live',
      '2026-07-28T12:00:00',
      2,
    );
    expect('settings' in env).toBe(false);
    expect(parseBackup(JSON.stringify(env)).ok).toBe(true);
  });
});

describe('parseBackup round-trip', () => {
  it('stringify → parse returns deep-equal tables', () => {
    const result = parseBackup(JSON.stringify(envelope()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.assets).toEqual(ASSETS);
    expect(result.data.snapshots).toEqual(SNAPSHOTS);
    expect(result.data.transactions).toEqual(TRANSACTIONS);
    expect(result.data.settings).toEqual(SETTINGS);
  });

  it('accepts the forward-compatible inzhur asset link (P2 field)', () => {
    const text = mutated((env) => {
      (env.assets as Record<string, unknown>[])[0].inzhur = {
        kind: 'fund',
        ref: 'inzhur-reit',
        units: 6164,
      };
    });
    const result = parseBackup(text);
    expect(result.ok).toBe(true);
  });
});

describe('parseBackup rejections', () => {
  it('rejects non-JSON text', () => {
    const result = parseBackup('not json at all');
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues[0]).toMatch(/Not valid JSON/);
  });

  it('rejects a foreign format with a clear issue', () => {
    const result = parseBackup(
      JSON.stringify({ format: 'other', formatVersion: 1 }),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues[0]).toMatch(/Not a kubushka-backup file/);
  });

  it('rejects formatVersion 2 with a clear single issue', () => {
    const result = parseBackup(mutated((env) => void (env.formatVersion = 2)));
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/Unsupported formatVersion 2/);
    expect(result.issues[0]).toMatch(/formatVersion 1/);
  });

  it('rejects an unknown key on an asset row (strictObject)', () => {
    const result = parseBackup(
      mutated(
        (env) =>
          void ((env.assets as Record<string, unknown>[])[0].foo = 'bar'),
      ),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(
      result.issues.some(
        (i) => i.startsWith('assets.0') && /nrecognized key/.test(i),
      ),
    ).toBe(true);
  });

  it("rejects a 'Z'-suffixed datetime (plain-regex convention, not z.iso.datetime)", () => {
    const result = parseBackup(
      mutated(
        (env) =>
          void ((env.assets as Record<string, unknown>[])[0].createdAt =
            '2026-02-03T10:00:00Z'),
      ),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues.some((i) => i.startsWith('assets.0.createdAt'))).toBe(
      true,
    );
  });

  it('rejects a transaction pointing at an unknown asset', () => {
    const result = parseBackup(
      mutated((env) =>
        (env.transactions as Record<string, unknown>[]).push({
          id: 'ghost',
          date: '2026-07-01',
          type: 'buy',
          assetId: 'nope',
          amount: 100,
          source: 'own',
        }),
      ),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues).toEqual([
      `transactions.ghost: unknown assetId 'nope'`,
    ]);
  });

  it("accepts the portfolio-level assetId '' (deposits)", () => {
    // d1 above is a deposit with assetId '' — the round-trip already passes,
    // so this documents the ∪ {''} rule explicitly.
    const result = parseBackup(JSON.stringify(envelope()));
    expect(result.ok).toBe(true);
  });

  it('rejects a snapshot quote key that is not an asset id', () => {
    const result = parseBackup(
      mutated(
        (env) =>
          void ((
            (env.snapshots as Record<string, unknown>[])[0].quotes as Record<
              string,
              number
            >
          ).ghost = 1),
      ),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues).toEqual([
      `snapshots.2026-07-24: quote for unknown asset 'ghost'`,
    ]);
  });

  it('rejects duplicate snapshot dates', () => {
    const result = parseBackup(
      mutated((env) => {
        const snaps = env.snapshots as Record<string, unknown>[];
        snaps.push({ ...snaps[0] });
      }),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues).toEqual([
      `snapshots: duplicate date '2026-07-24' (date is the primary key)`,
    ]);
  });

  it('rejects a non-positive transaction amount (sign lives in the TxType)', () => {
    // A hand-edited {type:'withdrawal', amount:-500} would otherwise INCREASE
    // netDeposits/freeCashFromLedger (double sign flip).
    const negative = parseBackup(
      mutated(
        (env) =>
          void ((env.transactions as Record<string, unknown>[])[0].amount =
            -500),
      ),
    );
    expect(negative).toMatchObject({ ok: false });
    if (negative.ok) return;
    expect(
      negative.issues.some((i) => i.startsWith('transactions.0.amount')),
    ).toBe(true);

    const zero = parseBackup(
      mutated(
        (env) =>
          void ((env.transactions as Record<string, unknown>[])[0].amount = 0),
      ),
    );
    expect(zero).toMatchObject({ ok: false });
  });

  it('rejects an unknown dataset value', () => {
    const result = parseBackup(
      mutated((env) => void (env.dataset = 'staging')),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues.some((i) => i.startsWith('dataset'))).toBe(true);
  });
});
