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
  return buildBackup(ASSETS, SNAPSHOTS, TRANSACTIONS, SETTINGS, 'demo', '2026-07-28T12:00:00', 2);
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
    expect(env.format).toBe('quirenote-backup');
    expect(env.formatVersion).toBe(2);
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

  it('round-trips units and the per-unit price, and still takes rows without them (#31)', () => {
    // THE BREAK THIS GUARDS: `buildBackup` passes transactions through
    // unchanged and the row schema is a `strictObject`, so before `quantity`
    // and `unitPrice` were declared the app could write a backup its own
    // parser refused. A round trip is the only test that catches that — a
    // serializer test alone stays green while the reader rejects the file.
    const withUnits: Transaction = {
      id: 'tx-units',
      date: '2026-08-10',
      type: 'reinvest',
      assetId: 'reit',
      amount: 484.36,
      source: 'reinvest_reit',
      quantity: 43.4785,
      unitPrice: 11.1389,
    };
    const env = buildBackup(
      ASSETS,
      SNAPSHOTS,
      // Mixed on purpose: the legacy rows carry neither field, which is the
      // state of every transaction recorded before #31 and must stay valid.
      [...TRANSACTIONS, withUnits],
      SETTINGS,
      'demo',
      '2026-07-28T12:00:00',
      2,
    );
    const result = parseBackup(JSON.stringify(env));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transactions.at(-1)).toEqual(withUnits);
    // Absent, not `undefined`: a key present with an undefined value would
    // survive zod and then serialize back as `"quantity": null`.
    expect(result.data.transactions[0]).not.toHaveProperty('quantity');
  });

  it('accepts a hand-injected inzhur link on a raw envelope (P2 field)', () => {
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

  it('round-trips an inzhur-linked asset losslessly (fund + bond kinds)', () => {
    const linked: Asset[] = [
      {
        ...ASSETS[0],
        inzhur: { kind: 'fund', ref: 'inzhur-reit', units: 6164 },
      },
      {
        ...ASSETS[1],
        id: 'ovdp8976',
        name: 'OVDP UA4000238976',
        yieldType: 'fixed_coupon',
        payoutSchedule: 'semiannual',
        inzhur: { kind: 'bond', ref: 'UA4000238976', units: 15 },
      },
    ];
    const env = buildBackup(linked, [], [], SETTINGS, 'live', '2026-08-01T12:00:00', 2);
    const result = parseBackup(JSON.stringify(env));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.assets).toEqual(linked);
    expect(result.data.assets[0].inzhur).toEqual({
      kind: 'fund',
      ref: 'inzhur-reit',
      units: 6164,
    });
    expect(result.data.assets[1].inzhur).toEqual({
      kind: 'bond',
      ref: 'UA4000238976',
      units: 15,
    });
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
    const result = parseBackup(JSON.stringify({ format: 'other', formatVersion: 1 }));
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues[0]).toMatch(/Not a quirenote-backup file/);
  });

  it('rejects formatVersion 3 with a clear single issue', () => {
    const result = parseBackup(mutated((env) => void (env.formatVersion = 3)));
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/Unsupported formatVersion 3/);
    expect(result.issues[0]).toMatch(/formatVersion 2/);
  });

  it('rejects an unknown key on an asset row (strictObject)', () => {
    const result = parseBackup(
      mutated((env) => void ((env.assets as Record<string, unknown>[])[0].foo = 'bar')),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues.some((i) => i.startsWith('assets.0') && /nrecognized key/.test(i))).toBe(
      true,
    );
  });

  it("rejects a 'Z'-suffixed datetime (plain-regex convention, not z.iso.datetime)", () => {
    const result = parseBackup(
      mutated(
        (env) =>
          void ((env.assets as Record<string, unknown>[])[0].createdAt = '2026-02-03T10:00:00Z'),
      ),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues.some((i) => i.startsWith('assets.0.createdAt'))).toBe(true);
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
    expect(result.issues).toEqual([`transactions.ghost: unknown assetId 'nope'`]);
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
            (env.snapshots as Record<string, unknown>[])[0].quotes as Record<string, number>
          ).ghost = 1),
      ),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues).toEqual([`snapshots.2026-07-24: quote for unknown asset 'ghost'`]);
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
      mutated((env) => void ((env.transactions as Record<string, unknown>[])[0].amount = -500)),
    );
    expect(negative).toMatchObject({ ok: false });
    if (negative.ok) return;
    expect(negative.issues.some((i) => i.startsWith('transactions.0.amount'))).toBe(true);

    const zero = parseBackup(
      mutated((env) => void ((env.transactions as Record<string, unknown>[])[0].amount = 0)),
    );
    expect(zero).toMatchObject({ ok: false });
  });

  it('rejects an unknown key inside inzhur (nested strictObject) and a bad kind', () => {
    const extraKey = parseBackup(
      mutated(
        (env) =>
          void ((env.assets as Record<string, unknown>[])[0].inzhur = {
            kind: 'fund',
            ref: 'inzhur-reit',
            units: 6164,
            price: 11.1389,
          }),
      ),
    );
    expect(extraKey).toMatchObject({ ok: false });
    if (extraKey.ok) return;
    expect(extraKey.issues.some((i) => i.startsWith('assets.0.inzhur'))).toBe(true);

    const badKind = parseBackup(
      mutated(
        (env) =>
          void ((env.assets as Record<string, unknown>[])[0].inzhur = {
            kind: 'etf',
            ref: 'x',
            units: 1,
          }),
      ),
    );
    expect(badKind).toMatchObject({ ok: false });
    if (badKind.ok) return;
    expect(badKind.issues.some((i) => i.startsWith('assets.0.inzhur.kind'))).toBe(true);
  });

  it('rejects an unknown dataset value', () => {
    const result = parseBackup(mutated((env) => void (env.dataset = 'staging')));
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues.some((i) => i.startsWith('dataset'))).toBe(true);
  });
});

describe('the import boundary enforces W7’s quantity CHECKs (#31)', () => {
  // `transactionRowsSchema.superRefine`. `transactionSchema` (the form) and
  // `unitDelta` (the derivation) apply the same rule; a hand-edited backup is
  // the third door, and it is the only one an attacker of the app’s own data
  // — a text editor — can reach directly.
  const rowAt = (i: number, patch: Record<string, unknown>) =>
    mutated((env) => {
      const rows = env.transactions as Record<string, unknown>[];
      Object.assign(rows[i], patch);
    });

  // Index 2 is the `dividend_accrual`: a payout, so it moves no position.
  for (const field of ['quantity', 'unitPrice'] as const) {
    it(`rejects ${field} on a row that moves no position`, () => {
      const result = parseBackup(rowAt(2, { [field]: 12 }));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // THE PATH, not the words. This layer emits paths and lets
      // `import-labels.ts` own the sentence (D8), so asserting English here
      // would pin the rule this module exists to keep.
      expect(result.issues.join(' | ')).toMatch(new RegExp(`transactions[.]2[.]${field}`));
    });
  }

  it('accepts both on a row that does move one', () => {
    // Index 1 is the `buy`. The rule is one-way on purpose (D112): a
    // position-moving row MAY lack them, because every row recorded before #31
    // does.
    const withUnits = parseBackup(rowAt(1, { quantity: 5800, unitPrice: 11.142866 }));
    expect(withUnits.ok).toBe(true);
    expect(parseBackup(rowAt(1, {})).ok).toBe(true);
  });

  it('names the row and the field, not just the array', () => {
    // The importer maps zod paths to a per-row message, so the path has to
    // carry the index — an issue on the array alone tells the owner the whole
    // ledger is bad and nothing more.
    const result = parseBackup(rowAt(2, { quantity: 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(['transactions.2.quantity: Invalid input']);
  });
});

describe('the envelope marker (D42)', () => {
  it('writes quirenote-backup on export', () => {
    expect(envelope().format).toBe('quirenote-backup');
  });
});
