// One row at a time: the rules the envelope holds a row to, without the envelope, in the import's
// codes. The mutation surface validates through this door.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type { Asset, Transaction } from '../types';
import { rowIssueCodes } from './import';
import {
  assetRecordSchema,
  backupEnvelopeSchema,
  buildBackup,
  priceRowSchema,
  transactionRecordSchema,
} from './json';

const ASSET = {
  id: 'a',
  name: 'REIT',
  code: 'RE',
  colorKey: 'reit',
  yieldType: 'dividends',
  expectedPct: 10,
  targetPct: 25,
  payoutSchedule: 'monthly',
  firstPurchase: '2026-03-02',
  createdAt: '2026-03-02T09:00:00',
} as const satisfies Asset;
const BUY = {
  id: 'b',
  date: '2026-03-02',
  type: 'buy',
  assetId: 'a',
  amount: 1000,
  quantity: 10,
} as const satisfies Transaction;
const PAYOUT = {
  id: 'p',
  date: '2026-04-01',
  type: 'interest_payout',
  assetId: 'a',
  amount: 50,
} as const satisfies Transaction;
const DEPOSIT = {
  id: 'd',
  date: '2026-03-01',
  type: 'deposit',
  assetId: '',
  amount: 2000,
} as const satisfies Transaction;

const codes = (
  table: 'assets' | 'prices' | 'transactions',
  schema: z.ZodType,
  row: unknown,
): ReturnType<typeof rowIssueCodes> => {
  const parsed = schema.safeParse(row);
  return parsed.success ? [] : rowIssueCodes(table, parsed.error.issues);
};
const tx = (row: unknown) => codes('transactions', transactionRecordSchema, row);

describe('a transaction at the row door', () => {
  it('accepts a buy with its count, a payout with a withholding below it, and a deposit', () => {
    expect([tx(BUY), tx({ ...PAYOUT, taxWithheld: 9 }), tx(DEPOSIT)]).toEqual([[], [], []]);
  });

  it('refuses a moving row without its count, at quantity', () => {
    const noCount: Record<string, unknown> = { ...BUY };
    delete noCount.quantity;
    expect(tx(noCount)).toEqual([{ field: 'quantity', code: 'units-missing-on-position-row' }]);
  });

  it('refuses a count or a price on a row that moves nothing', () => {
    expect(tx({ ...DEPOSIT, quantity: 3 })).toEqual([
      { field: 'quantity', code: 'units-on-non-position-row' },
    ]);
    expect(tx({ ...PAYOUT, unitPrice: 3 })).toEqual([
      { field: 'unitPrice', code: 'units-on-non-position-row' },
    ]);
  });

  it('refuses a withholding that is not below the payout, or on a row that is not one', () => {
    expect(tx({ ...PAYOUT, taxWithheld: 50 })).toEqual([
      { field: 'taxWithheld', code: 'withholding-above-amount' },
    ]);
    expect(tx({ ...BUY, taxWithheld: 5 })).toEqual([
      { field: 'taxWithheld', code: 'withholding-on-non-payout-row' },
    ]);
  });

  it('names a date that is no date, and a key the row does not take', () => {
    expect(tx({ ...BUY, date: '2026-02-30' })).toEqual([{ field: 'date', code: 'expected-date' }]);
    expect(tx({ ...BUY, surplus: 1 })).toEqual([{ code: 'unknown-key', value: 'surplus' }]);
  });
});

describe('an asset at the row door', () => {
  const asset = (row: unknown) => codes('assets', assetRecordSchema, row);

  it('accepts an asset linked to a provider by its kind and its ref', () => {
    expect(asset({ ...ASSET, inzhur: { kind: 'fund', ref: 'reit' } })).toEqual([]);
  });

  // No column holds it, so a stored asset could never give it back.
  it('refuses the legacy unit count on the provider link', () => {
    expect(asset({ ...ASSET, inzhur: { kind: 'fund', ref: 'reit', units: 5 } })).toEqual([
      { field: 'inzhur', code: 'unknown-key', value: 'units' },
    ]);
  });

  it('names a timestamp that carries a zone', () => {
    expect(asset({ ...ASSET, createdAt: '2026-03-02T09:00:00.000Z' })).toEqual([
      { field: 'createdAt', code: 'expected-datetime' },
    ]);
  });

  // The store's own CHECKs, so a row this door takes is one the store takes.
  it.each([
    ['code', 'ABC'],
    ['code', 'R'],
    ['expectedPct', -1],
    ['targetPct', -1],
    ['targetPct', 101],
  ])('refuses a %s of %j at its field, as the store would', (field, value) => {
    expect(asset({ ...ASSET, [field]: value })).toEqual([{ field, code: 'invalid' }]);
  });

  // Three UTF-16 units, two characters: counted as JavaScript counts a string, it would be refused.
  it('counts a code in characters, as the store does', () => {
    expect(asset({ ...ASSET, code: '😀A' })).toEqual([]);
  });
});

// The staged import validates a price row by itself, as the file holds it.
describe('a price at the row door', () => {
  const price = (row: unknown) => codes('prices', priceRowSchema, row);
  const PRICE = { assetId: 'a', asOf: '2026-03-05', price: 11.1339 };

  it('accepts a price with and without its witness time', () => {
    expect([price(PRICE), price({ ...PRICE, observedAt: '2026-03-05T21:14:00' })]).toEqual([
      [],
      [],
    ]);
  });

  it('refuses a price not above zero, a day that is none, and a witness time with a zone', () => {
    expect(price({ ...PRICE, price: 0 })).toEqual([
      expect.objectContaining({ field: 'price', code: 'expected-positive-amount' }),
    ]);
    expect(price({ ...PRICE, asOf: '2026-02-30' })).toEqual([
      expect.objectContaining({ field: 'asOf', code: 'expected-date' }),
    ]);
    expect(price({ ...PRICE, observedAt: '2026-03-05T21:14:00Z' })).toEqual([
      expect.objectContaining({ field: 'observedAt', code: 'expected-datetime' }),
    ]);
  });
});

describe('the envelope reports a file’s rows as it did', () => {
  it('lists every withholding before every count', () => {
    const env = buildBackup(
      [ASSET],
      [],
      [
        { ...DEPOSIT, quantity: 3 },
        { ...PAYOUT, taxWithheld: 60 },
      ],
      undefined,
      'live',
      '2026-07-28T12:00:00',
      2,
    );
    const parsed = backupEnvelopeSchema.safeParse(env);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path.join('.'))).toEqual([
      'transactions.1.taxWithheld',
      'transactions.0.quantity',
    ]);
  });
});
