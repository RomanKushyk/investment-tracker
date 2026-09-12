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
    // D125 requires a count on a position-moving row at this door too. No
    // `unitPrice`: that one keeps only the one-way rule, since it is derivable
    // from `amount / quantity`.
    quantity: 6164,
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
    expect(env.formatVersion).toBe(6);
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

  it('round-trips units and the per-unit price; a NON-MOVING row still takes neither (#31, D125)', () => {
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
      // Mixed on purpose: the deposit carries neither field and must stay valid
      // — a row that moves no position never had units to state. Since D125 the
      // MOVING rows must carry a count, so `b1` does.
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

  it('rejects formatVersion 7 with a clear single issue', () => {
    const result = parseBackup(mutated((env) => void (env.formatVersion = 7)));
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/Unsupported formatVersion 7/);
    expect(result.issues[0]).toMatch(/formatVersion 6/);
  });

  it('rejects a formatVersion 5 file with ONE sentence, not a wall of row errors', () => {
    // This is what the bump buys. A v5 file may carry `{ type: 'tax' }` rows,
    // and without the version moving they would each fail the type enum — one
    // fact reported once per row, naming the row rather than the reason.
    const result = parseBackup(
      mutated((env) => {
        env.formatVersion = 5;
        (env.transactions as Record<string, unknown>[]).push({
          id: 'tax1',
          date: '2026-07-01',
          type: 'tax',
          assetId: 'reit',
          amount: 100,
          source: 'own',
        });
      }),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/Unsupported formatVersion 5/);
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

  it('CAN BUILD an envelope it cannot parse — which is why the export re-reads its own output', () => {
    // THE HOLE D125 OPENED, pinned rather than described. `buildBackup` passes
    // transactions through unchanged and validates nothing, so a store created
    // before this branch — pre-#31 rows with no `quantity`, which nothing can
    // backfill because those counts are unrecoverable — exports a
    // `formatVersion: 5` file that passes the version gate and then fails row by
    // row. The owner's only restore path (D12), unusable, discovered at the one
    // moment it mattered.
    //
    // `useBackupDownload` closes it by parsing what it just built and refusing
    // to offer a file that comes back rejected. This test is what makes that
    // guard necessary rather than defensive — delete the guard and this
    // asymmetry is what ships.
    //
    // The hole widened with the type retirement and the guard did not have to
    // move: a live store holding `{ type: 'tax' }` rows exports a file this
    // build refuses too. That store is ruled EXPENDABLE rather than migrated,
    // which is what keeps the widening from being D126's deadlock again.
    const legacy: Transaction = {
      id: 'legacy-buy',
      date: '2026-02-03',
      type: 'buy',
      assetId: 'reit',
      amount: 1000,
      source: 'own',
    };
    const env = buildBackup(
      ASSETS,
      SNAPSHOTS,
      [legacy],
      SETTINGS,
      'live',
      '2026-09-01T12:00:00',
      2,
    );
    expect(env.formatVersion).toBe(6);
    expect(env.transactions).toHaveLength(1);
    const readBack = parseBackup(JSON.stringify(env));
    expect(readBack.ok).toBe(false);
  });

  it('refuses a position-moving row with NO count, naming the row and the field (D125)', () => {
    // BOTH WAYS AT THIS DOOR NOW. The form was the only one enforcing it
    // (D124), and the form is not the app's only writer — `CouponDueCard` hands
    // a `reinvest` straight to `recordTransaction`. A backup that accepted what
    // the form refuses would let the gap back in through the file.
    const result = parseBackup(
      mutated((env) =>
        (env.transactions as Record<string, unknown>[]).push({
          id: 'countless',
          date: '2026-07-01',
          type: 'reinvest',
          assetId: 'reit',
          amount: 100,
          source: 'reinvest_reit',
        }),
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(' ')).toMatch(/quantity/);
  });

  it('BLANKS the asset a portfolio-level row names, on the way out of parseBackup (D129)', () => {
    // `parseBackup` is the OTHER funnel, and it was unpinned: the rule used to
    // live in the row schema, so both doors got it by construction; splitting it
    // into `blankPortfolioAssetIds` made them two code paths. Verified by
    // mutation — dropping the call from `parseBackup` left the whole suite
    // green, and `useBackupDownload`'s export guard is its only other consumer.
    const result = parseBackup(
      mutated((env) =>
        (env.transactions as Record<string, unknown>[]).push({
          id: 'borrowed',
          date: '2026-07-01',
          type: 'deposit',
          assetId: 'reit',
          amount: 100,
          source: 'own',
        }),
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.transactions.find((t) => t.id === 'borrowed')?.assetId).toBe('');
    // And a row that DOES target an asset keeps it.
    expect(result.data.transactions.find((t) => t.type === 'buy')?.assetId).not.toBe('');
  });

  it('REPORTS a dangling id on a portfolio-level row rather than blanking it away', () => {
    // The order the split exists to protect: `integrityIssues` first, blanking
    // after. As a row transform the blanking ran first and this file parsed
    // clean, losing the one signal that says an asset row went missing.
    const result = parseBackup(
      mutated((env) =>
        (env.transactions as Record<string, unknown>[]).push({
          id: 'dangling',
          date: '2026-07-01',
          type: 'deposit',
          assetId: 'gone',
          amount: 100,
          source: 'own',
        }),
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(' ')).toMatch(/unknown assetId 'gone'/);
  });

  it('still accepts a NON-MOVING row with no count — it never had units to state', () => {
    const result = parseBackup(
      mutated((env) =>
        (env.transactions as Record<string, unknown>[]).push({
          id: 'payout1',
          date: '2026-07-01',
          type: 'interest_payout',
          assetId: 'reit',
          amount: 100,
          source: 'own',
        }),
      ),
    );
    expect(result.ok).toBe(true);
  });

  it('refuses the retired `tax` type by NAME, at the enum', () => {
    const result = parseBackup(
      mutated((env) =>
        (env.transactions as Record<string, unknown>[]).push({
          id: 'tax1',
          date: '2026-07-01',
          type: 'tax',
          assetId: 'reit',
          amount: 100,
          source: 'own',
        }),
      ),
    );
    expect(result.ok).toBe(false);
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
          // A COUNT, so the ONE reason under test is the unknown asset id.
          quantity: 1,
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

describe('the withholding and the note at the envelope door', () => {
  const AT_CAP =
    'Звірено з випискою банку за вересень: виплату затримали на три дні та зарахували разом із наступною.';
  const OVER_CAP =
    'Звірено із випискою банку за вересень: виплату затримали на три дні та зарахували разом із наступною.';

  const withRow = (row: Record<string, unknown>) =>
    mutated((env) => (env.transactions as Record<string, unknown>[]).push(row));

  const payout = (extra: Record<string, unknown> = {}) => ({
    id: 'p-new',
    date: '2026-07-01',
    type: 'interest_payout',
    assetId: 'reit',
    amount: 100,
    source: 'own',
    ...extra,
  });

  it('round-trips a payout carrying a withholding and a note', () => {
    const result = parseBackup(withRow(payout({ taxWithheld: 18, note: AT_CAP })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.data.transactions.find((t) => t.id === 'p-new')!;
    expect(row.taxWithheld).toBe(18);
    expect(row.note).toBe(AT_CAP);
  });

  it('refuses a withholding that is not BELOW the amount — and says which rule', () => {
    // `expect(ok).toBe(false)` alone would pass today for the wrong reason: a
    // strictObject answers an unrecognised key. Assert the sentence.
    for (const taxWithheld of [100, 120]) {
      const result = parseBackup(withRow(payout({ taxWithheld })));
      expect(result.ok, String(taxWithheld)).toBe(false);
      if (result.ok) continue;
      expect(result.issues.join(' '), String(taxWithheld)).toMatch(
        /transactions\.\d+\.taxWithheld/,
      );
    }
  });

  it('refuses a withholding on any of the six types that take none', () => {
    for (const type of ['buy', 'sell', 'deposit', 'withdrawal', 'reinvest', 'redemption']) {
      const moving = ['buy', 'sell', 'reinvest', 'redemption'].includes(type);
      const result = parseBackup(
        withRow(
          payout({
            type,
            assetId: type === 'deposit' || type === 'withdrawal' ? '' : 'reit',
            taxWithheld: 5,
            ...(moving ? { quantity: 10 } : {}),
          }),
        ),
      );
      expect(result.ok, type).toBe(false);
      if (result.ok) continue;
      expect(result.issues.join(' '), type).toMatch(/transactions\.\d+\.taxWithheld/);
    }
  });

  it('refuses a withholding of zero or below — NULL is the only spelling of none', () => {
    for (const taxWithheld of [0, -5]) {
      expect(parseBackup(withRow(payout({ taxWithheld }))).ok, String(taxWithheld)).toBe(false);
    }
  });

  it('accepts a note AT the cap and refuses one a single character over', () => {
    expect(AT_CAP).toHaveLength(100);
    expect(OVER_CAP).toHaveLength(101);
    expect(parseBackup(withRow(payout({ note: AT_CAP }))).ok).toBe(true);
    const result = parseBackup(withRow(payout({ note: OVER_CAP })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(' ')).toMatch(/transactions\.\d+\.note/);
  });

  it('refuses an EMPTY note rather than normalizing it away', () => {
    // The form is where "blank means absent" lives. By the time a row reaches
    // this door, `''` is a file someone hand-edited into a state the store's
    // `transaction_note_ck` would refuse — so the envelope refuses it too
    // rather than quietly repairing a file it is meant to validate.
    const result = parseBackup(withRow(payout({ note: '' })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(' ')).toMatch(/transactions\.\d+\.note/);
  });

  it('a payout with neither field is unchanged — both are absent, not empty', () => {
    const result = parseBackup(withRow(payout()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.data.transactions.find((t) => t.id === 'p-new')!;
    expect('taxWithheld' in row).toBe(false);
    expect('note' in row).toBe(false);
  });
});

describe('the sentences `parseBackup` prints are a contract', () => {
  // `useBackupDownload` puts `issues[0]` in front of the user when the export
  // guard refuses a file, so these are user-visible English in a Ukrainian app —
  // a pre-existing wart for every code, and one this branch must not WIDEN by
  // adding rules that say only "Invalid input". Nothing pinned them, so deleting
  // a message left every test green and the sentence gone.
  const rowIssue = (row: Record<string, unknown>) => {
    const result = parseBackup(
      mutated((env) => (env.transactions as Record<string, unknown>[]).push(row)),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return '';
    return result.issues.join(' ');
  };

  const payout = (extra: Record<string, unknown>) => ({
    id: 'p-msg',
    date: '2026-07-01',
    type: 'interest_payout',
    assetId: 'reit',
    amount: 100,
    source: 'own',
    ...extra,
  });

  it('names the rule for a withholding on a type that carries none', () => {
    expect(rowIssue(payout({ type: 'deposit', assetId: '', taxWithheld: 5 }))).toMatch(
      /only a dividend accrual or an interest payout carries a withholding/,
    );
  });

  it('names the rule for a withholding that is not below its amount', () => {
    expect(rowIssue(payout({ taxWithheld: 120 }))).toMatch(
      /a withholding must be smaller than the payout it was taken from/,
    );
  });

  it('names the rule for every way a note is wrong', () => {
    for (const note of ['', '   ', 'я'.repeat(101)]) {
      expect(rowIssue(payout({ note })), JSON.stringify(note)).toMatch(
        /a note needs 1 to 100 characters of text/,
      );
    }
  });
});

describe('a note of whitespace is a note nobody typed', () => {
  it('refuses one, rather than storing a row that renders an empty line', () => {
    // `.min(1)` accepts a single space and so does `transaction_note_ck`'s
    // `length > 0`. The ledger draws a second line for any note that is not
    // absent, so such a row would render a blank one — for nobody.
    for (const note of [' ', '   ', '\t']) {
      const result = parseBackup(
        mutated((env) =>
          (env.transactions as Record<string, unknown>[]).push({
            id: `ws-${note.length}`,
            date: '2026-07-01',
            type: 'interest_payout',
            assetId: 'reit',
            amount: 100,
            source: 'own',
            note,
          }),
        ),
      );
      expect(result.ok, JSON.stringify(note)).toBe(false);
    }
  });
});
