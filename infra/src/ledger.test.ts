// The caller's rows as core reads them, read back from the schema a fixture wrote them into: one
// mapping each way, so a field either side drops or misreads shows as a difference.
import type { PGlite } from '@electric-sql/pglite';
import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { asPriceRows } from '@quirenote/core/view/test-ledgers';
import { beforeEach, describe, expect, it } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import {
  applyUserSchema,
  insertUser,
  withUuids,
  writeLedger,
  type LedgerRows,
} from './__fixtures__/user-ledger';
import { SCHEMA_TYPE, dataTag, readLedger, readRows } from './ledger';
import type { SqlClient } from './migrate';

const OWNER = '9f1e2d3c-0000-4000-8000-0000000000a1';
const OTHER = '9f1e2d3c-0000-4000-8000-0000000000b2';

// Every field `Asset` can carry that the schema stores: a coupon rate, a link, the bond fields.
const LINKED: Asset = {
  id: 'linked',
  name: 'OVDP UA4000238976',
  code: 'GB',
  colorKey: 'ovdp6475',
  yieldType: 'fixed_coupon',
  expectedPct: 16.4,
  targetPct: 0,
  payoutSchedule: 'semiannual',
  firstPurchase: '2026-08-12',
  createdAt: '2026-08-12T09:30:15',
  maturity: '2027-02-25',
  couponRatePct: 16.25,
  couponAmount: 81.25,
  nextCoupon: '2027-02-25',
  inzhur: { kind: 'bond', ref: 'UA4000238976' },
};

// The two types the seed never writes, a withholding, a note and a unit price.
const EXTRA: Transaction[] = [
  { id: 'x1', date: '2026-08-12', type: 'deposit', assetId: '', amount: 20_000 },
  {
    id: 'x2',
    date: '2026-08-12',
    type: 'buy',
    assetId: 'linked',
    amount: 10_576.7,
    quantity: 10,
    unitPrice: 1057.67,
    note: 'перша купівля',
  },
  { id: 'x3', date: '2026-08-20', type: 'sell', assetId: 'linked', amount: 1062.3, quantity: 1 },
  {
    id: 'x4',
    date: '2026-09-01',
    type: 'dividend_accrual',
    assetId: 'reit',
    amount: 500.5,
    taxWithheld: 96.1,
  },
  {
    id: 'x5',
    date: '2026-09-02',
    type: 'redemption',
    assetId: 'linked',
    amount: 1000.01,
    quantity: 1,
  },
];

const LEDGER: LedgerRows = withUuids({
  assets: [...SEED_ASSETS, LINKED],
  transactions: [...SEED_TRANSACTIONS, ...EXTRA],
  userPrices: asPriceRows(buildSeedSnapshots(), SEED_TRANSACTIONS)!,
});

const byId = <T extends { id: string }>(rows: T[]) =>
  [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const byKey = (rows: LedgerRows['userPrices']) =>
  [...rows].sort((a, b) => `${a.assetId} ${a.asOf}`.localeCompare(`${b.assetId} ${b.asOf}`));
/** A price without its witness time, which the fixture stamps at write. */
const bare = (rows: LedgerRows['userPrices']) =>
  byKey(rows).map(({ assetId, asOf, price }) => ({ assetId, asOf, price }));

let db: PGlite;
const client = () => db as unknown as SqlClient;

beforeEach(async () => {
  db = await freshDb();
  await applyUserSchema(db);
  await insertUser(db, OWNER, 'owner@quirenote.com');
  await insertUser(db, OTHER, 'other@quirenote.com');
  await writeLedger(db, OWNER, LEDGER);
});

describe('readLedger', () => {
  it('reads back every asset as core holds it', async () => {
    expect(byId((await readLedger(client(), OWNER)).assets)).toEqual(byId(LEDGER.assets));
  });

  it('reads back every transaction as core holds it, each of the eight types included', async () => {
    const { transactions } = await readLedger(client(), OWNER);
    expect(byId(transactions)).toEqual(byId(LEDGER.transactions));
    expect(new Set(transactions.map((t) => t.type))).toEqual(
      new Set([
        'buy',
        'sell',
        'deposit',
        'withdrawal',
        'dividend_accrual',
        'interest_payout',
        'reinvest',
        'redemption',
      ]),
    );
  });

  // ABSENT IS THE ONLY SPELLING OF NONE: a `null` key would reach every composer that asks
  // `=== undefined`, and `''` is the one spelling of a portfolio-level row's asset.
  it('leaves an optional field absent rather than null', async () => {
    const { assets, transactions } = await readLedger(client(), OWNER);
    const rows: object[] = [...assets, ...transactions];
    expect(rows.flatMap((r) => Object.entries(r).filter(([, v]) => v === null))).toEqual([]);
    expect(transactions.find((t) => t.type === 'deposit')?.assetId).toBe('');
  });

  it('reads back every stored price, per unit, exactly', async () => {
    expect(bare((await readLedger(client(), OWNER)).userPrices)).toEqual(bare(LEDGER.userPrices));
  });

  // Each price's own witness time, in the backup's form; absent is the only spelling of none.
  it('reads each price’s witness time, to the second, and none for a price with none', async () => {
    const [first] = LEDGER.userPrices;
    const sameDay = LEDGER.userPrices.find((p) => p.asOf === first.asOf && p !== first)!;
    // The fixture witnesses every price; one with none is what is checked.
    await db.query('UPDATE user_price SET observed_at = NULL');
    await db.query(
      `UPDATE user_price SET observed_at = '2026-06-01T18:30:05.900Z'
        WHERE asset_id = $1 AND as_of = $2::date`,
      [first.assetId, first.asOf],
    );
    const read = (await readLedger(client(), OWNER)).userPrices;
    expect(read.filter((p) => Object.hasOwn(p, 'observedAt'))).toEqual([
      { ...first, observedAt: '2026-06-01T18:30:05' },
    ]);
    expect(read.find((p) => p.assetId === sameDay.assetId && p.asOf === sameDay.asOf)).toEqual(
      sameDay,
    );
  });

  it('reads the version the rows were read at, as text', async () => {
    expect((await readLedger(client(), OWNER)).dataVersion).toBe('0');
    await db.query('UPDATE app_user SET data_version = 9007199254740993 WHERE user_id = $1', [
      OWNER,
    ]);
    // Past 2^53, which a number would round.
    expect((await readLedger(client(), OWNER)).dataVersion).toBe('9007199254740993');
  });

  // An import stages a whole dataset beside the live one, the same ids included; the pointer is
  // what decides which one is read (#390).
  it('reads the live generation alone, a staged one beside it', async () => {
    const staged = '9f1e2d3c-0000-4000-8000-0000000000c3';
    await db.query('INSERT INTO dataset (user_id, id, created_at) VALUES ($1, $2, now())', [
      OWNER,
      staged,
    ]);
    await db.query('UPDATE app_user SET import_dataset_id = $2 WHERE user_id = $1', [
      OWNER,
      staged,
    ]);
    // The same ids, other content: a read of the wrong generation shows in every field.
    await writeLedger(
      db,
      OWNER,
      {
        assets: LEDGER.assets.map((a) => ({ ...a, name: `staged ${a.name}` })),
        transactions: LEDGER.transactions.slice(0, 1),
        userPrices: LEDGER.userPrices.map((p) => ({ ...p, price: p.price + 1 })),
      },
      staged,
    );
    const read = await readLedger(client(), OWNER);
    expect(byId(read.assets)).toEqual(byId(LEDGER.assets));
    expect(byId(read.transactions)).toEqual(byId(LEDGER.transactions));
    expect(bare(read.userPrices)).toEqual(bare(LEDGER.userPrices));
  });

  it('reads the generation the pointer names once it moves', async () => {
    const next = '9f1e2d3c-0000-4000-8000-0000000000c4';
    await db.query('INSERT INTO dataset (user_id, id, created_at) VALUES ($1, $2, now())', [
      OWNER,
      next,
    ]);
    await writeLedger(
      db,
      OWNER,
      { assets: [LEDGER.assets[0]], transactions: [], userPrices: [] },
      next,
    );
    await db.query('UPDATE app_user SET dataset_id = $2 WHERE user_id = $1', [OWNER, next]);
    const read = await readLedger(client(), OWNER);
    expect(read.assets).toEqual([LEDGER.assets[0]]);
    expect(read.transactions).toEqual([]);
  });

  it('reads the caller’s rows and nobody else’s', async () => {
    const other = await readLedger(client(), OTHER);
    expect(other).toEqual({
      dataVersion: '0',
      assets: [],
      transactions: [],
      userPrices: [],
    });
  });

  // ONE SNAPSHOT: the tag's version and the body come from one read, so a write between the
  // statements cannot pair an old version with new rows.
  it('reads inside one read-only transaction, and closes it', async () => {
    const sent: string[] = [];
    const watched: SqlClient = {
      query: (text, values) => {
        sent.push(text.trim().split(/\s+/).slice(0, 3).join(' '));
        return client().query(text, values);
      },
    };
    await readLedger(watched, OWNER);
    expect(sent[0]).toBe('START TRANSACTION READ');
    expect(sent.at(-1)).toBe('COMMIT');
    expect(sent.filter((s) => s.startsWith('SELECT'))).toHaveLength(4);
  });

  it('reads the rows a write needs inside the caller’s own transaction, opening none', async () => {
    const sent: string[] = [];
    const watched: SqlClient = {
      query: (text, values) => {
        sent.push(text.trim().split(/\s+/)[0]);
        return client().query(text, values);
      },
    };
    const rows = await readRows(watched, OWNER);
    const read = await readLedger(client(), OWNER);
    expect(rows).toEqual({ assets: read.assets, transactions: read.transactions });
    expect(sent).toEqual(['SELECT', 'SELECT']);
  });

  it('rolls back and rethrows when a read fails, leaving no transaction open', async () => {
    const failing: SqlClient = {
      query: (text, values) =>
        text.includes('user_price')
          ? Promise.reject(new Error('the cluster said no'))
          : client().query(text, values),
    };
    await expect(readLedger(failing, OWNER)).rejects.toThrow('the cluster said no');
    // Still `on` while the read-only transaction is open.
    const { rows } = await db.query<{ transaction_read_only: string }>(
      'SHOW transaction_read_only',
    );
    expect(rows[0].transaction_read_only).toBe('off');
  });
});

describe('the write half of the vocabulary', () => {
  // The schema keeps the spec's name for the one type core renamed.
  it('names each of core’s eight types as the schema spells it', () => {
    expect(SCHEMA_TYPE).toEqual({
      buy: 'buy',
      sell: 'sell',
      deposit: 'deposit',
      withdrawal: 'withdrawal',
      dividend_accrual: 'dividend_payout',
      interest_payout: 'interest_payout',
      reinvest: 'reinvest',
      redemption: 'redemption',
    });
  });

  // RFC 9110 §8.8.3: a strong tag is a quoted opaque string.
  it('tags a version as the strong tag a write sends back', () => {
    expect([dataTag('0'), dataTag('9007199254740993')]).toEqual(['"0"', '"9007199254740993"']);
  });
});
