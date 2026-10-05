import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Asset, Settings, Snapshot, Transaction, TxType } from '../types';
import { backupEnvelopeSchema, buildBackup, parseBackup, type BackupEnvelope } from './json';

// Minimal hand-built portfolio; the full seed round-trip lives in `seed.test.ts`, because
// that claim is about the seed's rows and this file's is about the envelope.
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
  },
  {
    date: '2026-07-25',
    quotes: { reit: 68629.36, energy: 60086.09 },
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
  },
  {
    id: 'b1',
    date: '2026-02-03',
    type: 'buy',
    assetId: 'reit',
    amount: 64628.62,
    // A count is required on a position-moving row at this door too. No `unitPrice`:
    // that one keeps only the one-way rule, being derivable from `amount / quantity`.
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
    expect(env.formatVersion).toBe(11);
    expect(env.exportedAt).toBe('2026-07-28T12:00:00');
    expect(env.dbVersion).toBe(2);
    expect(env.dataset).toBe('demo');
    expect(env.settings).toEqual(SETTINGS);
  });

  it('normalizes full-ISO datetimes to the timezone-less convention', () => {
    // v1 buildNewAsset stamps toISOString() ('Z' + millis) — the app's own backup
    // must still validate.
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

// A key the model retired stays in IndexedDB: a field removal bumps no Dexie version.
function withRetired<T>(row: T, retired: Record<string, unknown>): T {
  return { ...row, ...retired };
}

const INZHUR = { kind: 'fund', ref: 'reit', units: 6164 } as const;

describe('buildBackup writes the model’s shape, not the store’s', () => {
  it('drops a retired key on every table, and the file it writes parses', () => {
    const clean = buildBackup(
      [{ ...ASSETS[0], inzhur: INZHUR }, ASSETS[1]],
      SNAPSHOTS,
      TRANSACTIONS,
      SETTINGS,
      'live',
      '2026-09-22T12:00:00',
      2,
    );
    const stored = buildBackup(
      [
        withRetired({ ...ASSETS[0], inzhur: withRetired(INZHUR, { price: 10.5 }) }, { legacy: 1 }),
        ASSETS[1],
      ],
      [withRetired(SNAPSHOTS[0], { cash: 7.75 }), SNAPSHOTS[1]],
      [withRetired(TRANSACTIONS[0], { source: 'savings' }), ...TRANSACTIONS.slice(1)],
      withRetired(SETTINGS, { theme: 'dark' }),
      'live',
      '2026-09-22T12:00:00',
      2,
    );
    expect(JSON.stringify(stored)).toBe(JSON.stringify(clean));
    expect(parseBackup(JSON.stringify(stored)).ok).toBe(true);
  });

  it('names the same keys as the model, so the projection cannot drop a field (typecheck)', () => {
    // The projection reads the row schemas; a field added to the model alone would be
    // dropped from every file in silence, and one added to a schema alone is never read.
    type Row<K extends 'assets' | 'snapshots' | 'transactions'> = BackupEnvelope[K][number];
    expectTypeOf<keyof Row<'assets'>>().toEqualTypeOf<keyof Asset>();
    expectTypeOf<keyof NonNullable<Row<'assets'>['inzhur']>>().toEqualTypeOf<
      keyof NonNullable<Asset['inzhur']>
    >();
    expectTypeOf<keyof Row<'snapshots'>>().toEqualTypeOf<keyof Snapshot>();
    expectTypeOf<keyof Row<'transactions'>>().toEqualTypeOf<keyof Transaction>();
    expectTypeOf<keyof NonNullable<BackupEnvelope['settings']>>().toEqualTypeOf<keyof Settings>();
  });

  it('keeps every key the model defines, optional ones included', () => {
    // Every optional field set, so a key the projection failed to carry shows up here.
    const asset: Asset = {
      ...ASSETS[0],
      maturity: '2027-02-03',
      couponAmount: 120,
      couponRatePct: 16.5,
      nextCoupon: '2026-08-03',
      inzhur: INZHUR,
    };
    const snapshot: Snapshot = SNAPSHOTS[1];
    const transaction: Transaction = {
      id: 'p9',
      date: '2026-03-10',
      type: 'dividend_accrual',
      assetId: 'reit',
      amount: 580.2,
      taxWithheld: 29.01,
      note: 'March payout',
    };
    const buy: Transaction = { ...TRANSACTIONS[1], unitPrice: 10.4852 };
    const env = buildBackup(
      [asset],
      [snapshot],
      [buy, transaction],
      SETTINGS,
      'live',
      '2026-09-22T12:00:00',
      2,
    );
    expect(env.assets).toStrictEqual([asset]);
    expect(env.snapshots).toStrictEqual([snapshot]);
    expect(env.transactions).toStrictEqual([buy, transaction]);
    expect(env.settings).toStrictEqual(SETTINGS);
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

  it('round-trips units and the per-unit price; a NON-MOVING row still takes neither (#31)', () => {
    // The pins above catch a field the projection drops; a round trip also catches one
    // the writer emits and the reader refuses.
    const withUnits: Transaction = {
      id: 'tx-units',
      date: '2026-08-10',
      type: 'reinvest',
      assetId: 'reit',
      amount: 484.36,
      quantity: 43.4785,
      unitPrice: 11.1389,
    };
    const env = buildBackup(
      ASSETS,
      SNAPSHOTS,
      // Mixed on purpose: the deposit carries neither field and must stay valid — a row
      // that moves no position never had units to state. The MOVING rows must carry a count.
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
    // Absent, not `undefined`: a key present with an undefined value would survive zod
    // and then serialize back as `"quantity": null`.
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

  it('rejects formatVersion 12 with a clear single issue', () => {
    const result = parseBackup(mutated((env) => void (env.formatVersion = 12)));
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/Unsupported formatVersion 12/);
    expect(result.issues[0]).toMatch(/formatVersion 11/);
  });

  it('rejects a formatVersion 5 file with ONE sentence, not a wall of row errors', () => {
    // This is what the bump buys. A v5 file may carry `{ type: 'tax' }` rows, and
    // without the version moving they would each fail the type enum — one fact reported
    // once per row, naming the row rather than the reason.
    const result = parseBackup(
      mutated((env) => {
        env.formatVersion = 5;
        (env.transactions as Record<string, unknown>[]).push({
          id: 'tax1',
          date: '2026-07-01',
          type: 'tax',
          assetId: 'reit',
          amount: 100,
        });
      }),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/Unsupported formatVersion 5/);
  });

  it('refuses a file the PREVIOUS build wrote, on the VERSION and not per row', () => {
    // A formatVersion 9 build read `2026-13-01T00:00:00` as a timestamp. Without the bump
    // its file is refused once per such field, naming a timestamp instead of the version.
    const result = parseBackup(
      mutated((env) => {
        env.formatVersion = 9;
        env.exportedAt = '2026-13-01T00:00:00';
        for (const row of env.assets as Record<string, unknown>[]) {
          row.createdAt = '2026-13-01T00:00:00';
        }
      }),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/Unsupported formatVersion 9/);
  });

  it('refuses a formatVersion 10 file on the VERSION, not on the key it let through (#353)', () => {
    // A v10 build accepted a `__proto__` key and dropped it; this build refuses it, so it
    // accepts strictly less and the version moves. The v10 file is refused once.
    const result = parseBackup(mutated((env) => void (env.formatVersion = 10)));
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/Unsupported formatVersion 10/);
  });

  it('refuses an unknown key by CODE and key list, never by the message', () => {
    // The message is locale-dependent and zod may reword it; `code` and `keys` are the
    // contract. The issue hangs on the object that carries the key, so the path names the
    // ROW rather than the key itself.
    const raw: unknown = JSON.parse(
      mutated((env) => void ((env.transactions as Record<string, unknown>[])[0].source = 'own')),
    );
    const parsed = backupEnvelopeSchema.safeParse(raw);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toContainEqual(
      expect.objectContaining({
        code: 'unrecognized_keys',
        keys: ['source'],
        path: ['transactions', 0],
      }),
    );
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

  it("rejects a 'Z'-suffixed datetime, which z.iso.datetime would accept", () => {
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
    // A VALUE the reader refuses has no key to drop, so it still builds a file that fails;
    // `useBackupDownload` refuses to offer it, and the exit is ruled. *Persistence today*
    const legacy: Transaction = {
      id: 'legacy-buy',
      date: '2026-02-03',
      type: 'buy',
      assetId: 'reit',
      amount: 1000,
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
    expect(env.formatVersion).toBe(11);
    expect(env.transactions).toHaveLength(1);
    const readBack = parseBackup(JSON.stringify(env));
    expect(readBack.ok).toBe(false);
  });

  it('refuses a position-moving row with NO count, naming the row and the field', () => {
    // BOTH WAYS AT THIS DOOR NOW. The form was the only one enforcing it, and the form
    // is not the app's only writer — `CouponDueCard` hands a `reinvest` straight to
    // `recordTransaction`. A backup that accepted what the form refuses would let the
    // gap back in through the file.
    const result = parseBackup(
      mutated((env) =>
        (env.transactions as Record<string, unknown>[]).push({
          id: 'countless',
          date: '2026-07-01',
          type: 'reinvest',
          assetId: 'reit',
          amount: 100,
        }),
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(' ')).toMatch(/quantity/);
  });

  it('BLANKS the asset a portfolio-level row names, on the way out of parseBackup', () => {
    // `parseBackup` is the OTHER funnel, and it was unpinned: the rule used to live in
    // the row schema, so both doors got it by construction; splitting it into
    // `blankPortfolioAssetIds` made them two code paths. Verified by mutation —
    // dropping the call from `parseBackup` left the whole suite green.
    const result = parseBackup(
      mutated((env) =>
        (env.transactions as Record<string, unknown>[]).push({
          id: 'borrowed',
          date: '2026-07-01',
          type: 'deposit',
          assetId: 'reit',
          amount: 100,
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
    // The order the split exists to protect: `integrityIssues` first, blanking after.
    // As a row transform the blanking ran first and this file parsed clean, losing the
    // one signal that says an asset row went missing.
    const result = parseBackup(
      mutated((env) =>
        (env.transactions as Record<string, unknown>[]).push({
          id: 'dangling',
          date: '2026-07-01',
          type: 'deposit',
          assetId: 'gone',
          amount: 100,
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
        }),
      ),
    );
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.issues).toEqual([`transactions.ghost: unknown assetId 'nope'`]);
  });

  it("accepts the portfolio-level assetId '' (deposits)", () => {
    // d1 above is a deposit with assetId '' — this documents the ∪ {''} rule explicitly.
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
  // `unitDelta` (the derivation) apply the same rule; a hand-edited backup is the
  // third door, and the only one a text editor can reach directly.
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
      // THE PATH, not the words: this layer emits paths and `import-labels.ts` owns the
      // sentence, so asserting English here would pin the rule this module exists to
      // keep. *Core is pure*
      expect(result.issues.join(' | ')).toMatch(new RegExp(`transactions[.]2[.]${field}`));
    });
  }

  it('accepts both on a row that does move one', () => {
    // Index 1 is the `buy`. The rule is one-way on purpose: a position-moving row MAY
    // lack them, because every row recorded before #31 does.
    const withUnits = parseBackup(rowAt(1, { quantity: 5800, unitPrice: 11.142866 }));
    expect(withUnits.ok).toBe(true);
    expect(parseBackup(rowAt(1, {})).ok).toBe(true);
  });

  it('names the row and the field, not just the array', () => {
    // The importer maps zod paths to a per-row message, so the path has to carry the
    // index — an issue on the array alone tells the owner the whole ledger is bad.
    const result = parseBackup(rowAt(2, { quantity: 1 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(['transactions.2.quantity: Invalid input']);
  });
});

describe('the envelope marker', () => {
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

  it('refuses a withholding on every type that takes none, and accepts the two that do', () => {
    // What the reader lets each type carry, written out rather than read from
    // `isPayout` / `targetsAsset` / `movesPosition` — it asks those predicates, so a
    // fixture that asked them too would flip with them. A `Record<TxType, …>` and not a
    // list of six: a ninth type has no row here and the build stops before this loop
    // under-tests it.
    //
    // ONLY THE `withholding` COLUMN IS ASSERTED — every type is parsed and compared
    // against it, so a wrong cell there fails. A wrong cell in the other two still
    // leaves the row refused for the withholding reason this test names; they are
    // pinned exhaustively by `schemas.test.ts` and `import.test.ts` instead.
    const CARRIES: Record<TxType, { asset: boolean; quantity: boolean; withholding: boolean }> = {
      buy: { asset: true, quantity: true, withholding: false },
      sell: { asset: true, quantity: true, withholding: false },
      deposit: { asset: false, quantity: false, withholding: false },
      withdrawal: { asset: false, quantity: false, withholding: false },
      dividend_accrual: { asset: true, quantity: false, withholding: true },
      interest_payout: { asset: true, quantity: false, withholding: true },
      reinvest: { asset: true, quantity: true, withholding: false },
      redemption: { asset: true, quantity: true, withholding: false },
    };
    for (const type of Object.keys(CARRIES) as TxType[]) {
      const result = parseBackup(
        withRow(
          payout({
            type,
            assetId: CARRIES[type].asset ? 'reit' : '',
            taxWithheld: 5,
            ...(CARRIES[type].quantity ? { quantity: 10 } : {}),
          }),
        ),
      );
      expect(result.ok, type).toBe(CARRIES[type].withholding);
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
    // The form is where "blank means absent" lives. By the time a row reaches this door,
    // `''` is a file someone hand-edited into a state the store's `transaction_note_ck`
    // would refuse — so the envelope refuses it too rather than quietly repairing a
    // file it is meant to validate.
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
  // `useBackupDownload` puts `issues[0]` in front of the user when the export guard
  // refuses a file, so these are user-visible English in a Ukrainian app — a
  // pre-existing wart this branch must not WIDEN. Nothing pinned them, so deleting a
  // message left every test green and the sentence gone.
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

describe('the backup carries a formula note as typed', () => {
  it('writes it verbatim, and a re-import writes the same bytes', () => {
    // The CSV export guards a cell that starts a formula; this file is restored into the
    // store, so a guard here would change the note on every round trip.
    const notes = [0x3d, 0x2b, 0x2d, 0x40, 0x09, 0x0d, 0x0a, 0xff1d, 0xff0b, 0xff0d, 0xff20].map(
      (c) => `${String.fromCodePoint(c)}1+2`,
    );
    const noted: Transaction[] = notes.map((note, i) => ({
      id: `f${i}`,
      date: '2026-09-30',
      type: 'interest_payout',
      assetId: 'reit',
      amount: 100,
      note,
    }));
    const text = JSON.stringify(
      buildBackup(
        ASSETS,
        SNAPSHOTS,
        [...TRANSACTIONS, ...noted],
        SETTINGS,
        'live',
        '2026-09-30T12:00:00',
        2,
      ),
    );
    for (const note of notes) expect(text, JSON.stringify(note)).toContain(JSON.stringify(note));
    const back = parseBackup(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const { assets, snapshots, transactions, settings, dataset, exportedAt, dbVersion } = back.data;
    expect(
      JSON.stringify(
        buildBackup(assets, snapshots, transactions, settings, dataset, exportedAt, dbVersion),
      ),
    ).toBe(text);
  });
});

describe('a note of whitespace is a note nobody typed', () => {
  it('refuses one, rather than storing a row that renders an empty line', () => {
    // `.min(1)` accepts a single space and so does `transaction_note_ck`'s `length > 0`.
    // The ledger draws a second line for any note that is not absent, so such a row
    // would render a blank one — for nobody.
    for (const note of [' ', '   ', '\t']) {
      const result = parseBackup(
        mutated((env) =>
          (env.transactions as Record<string, unknown>[]).push({
            id: `ws-${note.length}`,
            date: '2026-07-01',
            type: 'interest_payout',
            assetId: 'reit',
            amount: 100,
            note,
          }),
        ),
      );
      expect(result.ok, JSON.stringify(note)).toBe(false);
    }
  });
});

describe('a backup’s dates are calendar dates (#341)', () => {
  // RFC 3339 §5.7 bounds the day by its month and year: `addDays` throws on `2026-13-01`,
  // and `Date` reads `2026-02-30` as 02.03.
  type Row = Record<string, unknown>;
  // The five date fields the rows carry, one setter each.
  const FIELDS: Record<string, (env: Row, v: string) => void> = {
    'assets.0.firstPurchase': (env, v) => void ((env.assets as Row[])[0].firstPurchase = v),
    'assets.0.maturity': (env, v) => void ((env.assets as Row[])[0].maturity = v),
    'assets.0.nextCoupon': (env, v) => void ((env.assets as Row[])[0].nextCoupon = v),
    'snapshots.0.date': (env, v) => void ((env.snapshots as Row[])[0].date = v),
    'transactions.0.date': (env, v) => void ((env.transactions as Row[])[0].date = v),
  };
  const dated = (path: string, value: string) =>
    parseBackup(mutated((env) => FIELDS[path](env, value)));
  const refused = (path: string) => ({
    ok: false,
    issues: [`${path}: expected a real date (yyyy-MM-dd)`],
  });

  it('refuses a month no calendar has, naming the field', () => {
    expect(dated('assets.0.nextCoupon', '2026-13-01')).toEqual(refused('assets.0.nextCoupon'));
  });

  it('refuses a day its month does not have', () => {
    expect(dated('transactions.0.date', '2026-02-30')).toEqual(refused('transactions.0.date'));
    expect(dated('snapshots.0.date', '2026-04-31')).toEqual(refused('snapshots.0.date'));
    // The 31st itself is fine in a month that has one.
    expect(dated('snapshots.0.date', '2026-03-31').ok).toBe(true);
  });

  it('reads February 29 by the year, centuries included', () => {
    expect(dated('assets.0.maturity', '2028-02-29').ok).toBe(true);
    expect(dated('assets.0.maturity', '2000-02-29').ok).toBe(true);
    expect(dated('assets.0.maturity', '2026-02-29')).toEqual(refused('assets.0.maturity'));
    expect(dated('assets.0.maturity', '2100-02-29')).toEqual(refused('assets.0.maturity'));
  });

  it('holds each of the five date fields to the calendar', () => {
    for (const path of Object.keys(FIELDS)) {
      expect(dated(path, '2026-02-30'), path).toEqual(refused(path));
    }
  });

  it('leaves a missing date to zod’s own words', () => {
    // The sentence describes a date that cannot be; an absent one is another fault.
    const result = parseBackup(
      mutated((env) => void delete (env.assets as Row[])[0].firstPurchase),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/^assets\.0\.firstPurchase: /);
    expect(result.issues[0]).not.toMatch(/real date/);
  });
});

describe('a backup’s timestamps are real date-times (#346)', () => {
  // RFC 3339 §5.6–5.7 bounds the month, the day and the hour. `daysBetween` reads
  // `2026-13-01` as NaN, and the formatter prints it as `1 undefined 2026`.
  type Row = Record<string, unknown>;
  // The three timestamps the file carries, one setter each.
  const FIELDS: Record<string, (env: Row, v: string) => void> = {
    exportedAt: (env, v) => void (env.exportedAt = v),
    'assets.0.createdAt': (env, v) => void ((env.assets as Row[])[0].createdAt = v),
    'snapshots.0.savedAt': (env, v) => void ((env.snapshots as Row[])[0].savedAt = v),
  };
  const stamped = (path: string, value: string) =>
    parseBackup(mutated((env) => FIELDS[path](env, value)));
  const refused = (path: string) => ({
    ok: false,
    issues: [`${path}: expected a real timestamp (yyyy-MM-ddTHH:mm:ss, no time zone)`],
  });

  it('refuses a date or a time no calendar or clock has, naming the field', () => {
    for (const path of Object.keys(FIELDS)) {
      for (const value of ['2026-13-01T00:00:00', '2026-02-30T10:00:00', '2026-07-25T25:61:00']) {
        expect(stamped(path, value), `${path} ${value}`).toEqual(refused(path));
      }
    }
  });

  it('accepts the last second of a day and a leap day, and nothing past 23:59:59', () => {
    for (const path of Object.keys(FIELDS)) {
      expect(stamped(path, '2026-07-25T23:59:59').ok, path).toBe(true);
      expect(stamped(path, '2028-02-29T00:00:00').ok, path).toBe(true);
      // ECMA-262 time values carry no leap second, so `toISOString` never writes `:60`.
      for (const value of ['2026-07-25T24:00:00', '2026-06-30T23:59:60', '2026-07-25T23:59:59Z']) {
        expect(stamped(path, value), `${path} ${value}`).toEqual(refused(path));
      }
    }
  });

  it('leaves a missing or non-string timestamp to zod’s own words', () => {
    // The sentence describes a timestamp that cannot be; an absent one is another fault.
    const missing = parseBackup(mutated((env) => void delete env.exportedAt));
    if (missing.ok) throw new Error('expected a refusal');
    expect(missing.issues).toHaveLength(1);
    expect(missing.issues[0]).toMatch(/^exportedAt: /);
    expect(missing.issues[0]).not.toMatch(/real timestamp/);

    const epoch = parseBackup(
      mutated((env) => void ((env.assets as Row[])[0].createdAt = 1785488400000)),
    );
    if (epoch.ok) throw new Error('expected a refusal');
    expect(epoch.issues).toHaveLength(1);
    expect(epoch.issues[0]).toMatch(/^assets\.0\.createdAt: /);
    expect(epoch.issues[0]).not.toMatch(/real timestamp/);
  });
});

describe('a __proto__ key is refused wherever it sits (#353)', () => {
  // `obj['__proto__'] = v` and `{ __proto__: v }` set the prototype and put no key in the file;
  // only a defined own key reaches the text, and `refusedWith` checks that it did.
  type Env = Record<string, unknown>;
  const define = (target: unknown, value: unknown) =>
    void Object.defineProperty(target, '__proto__', {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  const rows = (env: Env, table: string) => env[table] as Env[];
  function refusedWith(text: string): string[] {
    expect(text).toContain('"__proto__"');
    const result = parseBackup(text);
    if (result.ok) throw new Error('expected a refusal');
    return result.issues;
  }
  const LINE = 'Forbidden key: "__proto__"';

  const PLACES: Record<string, (env: Env) => void> = {
    '(root)': (env) => define(env, 1),
    settings: (env) => define(env.settings, 1),
    'assets.0': (env) => define(rows(env, 'assets')[0], { x: 1 }),
    'assets.0.inzhur': (env) => {
      const asset = rows(env, 'assets')[0];
      asset.inzhur = { kind: 'fund', ref: 'x' };
      define(asset.inzhur, 1);
    },
    'snapshots.0': (env) => define(rows(env, 'snapshots')[0], 1),
    'snapshots.0.quotes': (env) => define(rows(env, 'snapshots')[0].quotes, 1),
    'transactions.0': (env) => define(rows(env, 'transactions')[0], 1),
    // An id is a quote key, and a plain-object quote map cannot hold this one.
    'assets.0.id': (env) => void (rows(env, 'assets')[0].id = '__proto__'),
  };

  for (const [path, set] of Object.entries(PLACES)) {
    it(`names ${path}, in one line`, () => {
      expect(refusedWith(mutated(set))).toEqual([`${path}: ${LINE}`]);
    });
  }

  it('reports the key alone when a row schema would fail too: the key is read first', () => {
    const text = mutated((env) => {
      define(rows(env, 'snapshots')[0].quotes, 1);
      rows(env, 'assets')[0].createdAt = 'nonsense';
    });
    expect(refusedWith(text)).toEqual([`snapshots.0.quotes: ${LINE}`]);
  });

  it('leaves a table of the wrong shape to the schema, an id of __proto__ in it included', () => {
    const text = mutated((env) => void (env.assets = { x: { id: '__proto__' } }));
    const result = parseBackup(text);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatch(/^assets: /);
    expect(result.issues[0]).not.toMatch(/__proto__/);
  });

  it('reports a file nested past the call stack as a stray key, without throwing', () => {
    const deep = '['.repeat(20_000) + ']'.repeat(20_000);
    const text = mutated((env) => void (env.x = 0)).replace('"x":0', `"x":${deep}`);
    const result = parseBackup(text);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.issues).toEqual(['(root): Unrecognized key: "x"']);
  });
});
