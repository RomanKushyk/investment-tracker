// `src/core/types.ts` is INDEPENDENT of the schema until W7. This test covers
// the seam that independence leaves: names, nullability and enum values. The
// leading primary-key column is checked more strongly elsewhere —
// `infra/src/user-schema.test.ts` asserts it for all five tables, from
// `information_schema` — so it is not repeated here.
import { readFileSync } from 'node:fs';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { asset } from '../../infra/schema/user';
import { COLOR_KEYS } from './colors';
import type { Asset, TxType } from './types';

const SQL = readFileSync('infra/migrations/drafts/003_user_schema.sql', 'utf8');

/** The quoted values inside a named `CHECK (... IN (...))` in the generated SQL. */
function checkValues(constraint: string): string[] {
  const m = new RegExp(`"?${constraint}"?[^(]*CHECK\\s*\\([^)]*IN\\s*\\(([^)]*)\\)`, 'i').exec(SQL);
  if (!m) throw new Error(`no CHECK named ${constraint} in the generated SQL`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

// Every TxType must name its spec counterpart. `Record<TxType, …>` is the point:
// adding a tenth type to core/types.ts fails the BUILD here, before this test
// can quietly compare two sets that both forgot it.
const SPEC_NAME = {
  buy: 'buy',
  sell: 'sell',
  deposit: 'deposit',
  withdrawal: 'withdrawal',
  dividend_accrual: 'dividend_payout',
  interest_payout: 'interest_payout',
  reinvest: 'reinvest',
  redemption: 'redemption',
  tax: 'tax',
} satisfies Record<TxType, string>;

// The keys of T that are NOT optional — TS includes `undefined` in `T[K]` for
// an optional K, so this is the same trick `SPEC_NAME` above plays with
// `TxType`, applied to `Asset`'s own required/optional split.
type RequiredKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? never : K }[keyof T];

// `Asset`'s ten required fields, mapped to the schema property that stores
// each one. `satisfies Record<RequiredKeys<Asset>, …>` means a new required
// `Asset` field fails the BUILD here, before this test can quietly go on
// checking only the fields it already knew about. `colorKey` is the one
// non-trivial mapping: the app's enum becomes the schema's palette index,
// `colorSlot`.
const REQUIRED_ASSET_COLUMNS = {
  id: 'id',
  name: 'name',
  code: 'code',
  colorKey: 'colorSlot',
  yieldType: 'yieldType',
  expectedPct: 'expectedPct',
  targetPct: 'targetPct',
  payoutSchedule: 'payoutSchedule',
  firstPurchase: 'firstPurchase',
  createdAt: 'createdAt',
} satisfies Record<RequiredKeys<Asset>, keyof typeof asset>;

describe('the schema agrees with the app model', () => {
  it('accepts every TxType the app can produce, under the spec name', () => {
    expect(new Set(checkValues('transaction_type_ck'))).toEqual(new Set(Object.values(SPEC_NAME)));
  });

  it('makes required app fields NOT NULL', () => {
    const columns = getTableColumns(asset);
    for (const [field, columnKey] of Object.entries(REQUIRED_ASSET_COLUMNS)) {
      const column = columns[columnKey as keyof typeof columns];
      expect(column, `asset has no column named ${columnKey}`).toBeDefined();
      expect(column.notNull, `${field} (${columnKey}) must be NOT NULL`).toBe(true);
    }
  });

  it('bounds color_slot by the real palette', () => {
    // COLOR_KEYS has four entries and new assets cycle `% 4`. A bound above that
    // admits an unpainted chart series, silently.
    expect(SQL).toContain(`color_slot" < ${COLOR_KEYS.length}`);
  });
});
