// The application cascade, which exists because the keys refuse to do it.
// `ON DELETE RESTRICT` is deliberate: DSQL's ceiling is 3 000 mutated rows PER
// TRANSACTION and cascaded rows count against the same ceiling, so a cascading key
// would only have hidden the steps it appears to replace. [*User schema and deletes*]
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { applyUserSchema } from './__fixtures__/user-ledger';
import { deleteAsset, pruneAsset } from './asset-delete';
import type { SqlClient } from './migrate';

import { addDays } from '@quirenote/core/dates';

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';
const KEEP = '44444444-4444-4444-8444-444444444444';
const LIVE: Record<string, string> = {
  [U]: '55555555-5555-4555-8555-555555555555',
  [OTHER]: '66666666-6666-4666-8666-666666666666',
};
// U's import, staged beside the live dataset and holding the same asset id.
const STAGED = '77777777-7777-4777-8777-777777777777';

const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

let db: PGlite;

const asset = (dataset: string, assetId: string) =>
  db.query(
    `INSERT INTO asset (dataset_id, id, name, code, color_slot, yield_type,
                        expected_pct, target_pct, payout_schedule,
                        first_purchase, created_at)
          VALUES ($1, $2, 'REIT', 'RE', 0, 'dividends', 10, 25, 'monthly',
                  '2026-02-03', now())`,
    [dataset, assetId],
  );

const buy = (dataset: string, user: string, txId: string, date = '2026-08-26') =>
  db.query(
    `INSERT INTO transaction (dataset_id, id, user_id, account_id, date, type, amount,
                              asset_id, quantity, created_at)
          VALUES ($1, $2, $3, $4, $5, 'buy', 100, $6, 1, now())`,
    [dataset, txId, user, ACCOUNT, date, ASSET],
  );

/** `rows` buys of ASSET for U, a day apart, and as many prices, each on a day of its own. */
async function seed(rows: number): Promise<void> {
  for (const user of [U, OTHER]) {
    await db.query(
      `INSERT INTO app_user (user_id, email, status, role, applied_at)
            VALUES ($1, $2, 'active', 'demo', now())`,
      [user, `${user}@x.com`],
    );
    await db.query(
      `INSERT INTO account (user_id, id, provider, name, created_at)
            VALUES ($1, $2, 'inzhur', 'Inzhur', now())`,
      [user, ACCOUNT],
    );
    await db.query('INSERT INTO dataset (user_id, id, created_at) VALUES ($1, $2, now())', [
      user,
      LIVE[user],
    ]);
    await db.query('UPDATE app_user SET dataset_id = $2 WHERE user_id = $1', [user, LIVE[user]]);
    // The SAME asset id under both users, which is what the scoping below is about.
    for (const assetId of [ASSET, KEEP]) await asset(LIVE[user], assetId);
  }
  for (let n = 1; n <= rows; n += 1) {
    await buy(LIVE[U], U, id(n), addDays('2026-03-01', n));
    await db.query(
      `INSERT INTO user_price (dataset_id, asset_id, as_of, price)
            VALUES ($1, $2, $3, 10)`,
      // A DISTINCT day per row: `as_of` is in `user_price`'s primary key, so a
      // modulus would collide in the fixture rather than in the code under test.
      [LIVE[U], ASSET, addDays('2026-01-01', n)],
    );
  }
}

/** Rows of `table` in the dataset given, the live one of `U` unless another is named. */
const count = async (table: string, dataset = LIVE[U]) => {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE dataset_id = $1`,
    [dataset],
  );
  return rows[0].n;
};

const transactionIds = async () =>
  (
    await db.query<{ id: string }>(`SELECT id FROM transaction WHERE dataset_id = $1 ORDER BY id`, [
      LIVE[U],
    ])
  ).rows.map((r) => r.id);

beforeEach(async () => {
  db = await freshDb();
  await applyUserSchema(db);
});

describe('deleteAsset', () => {
  it('removes the asset and both kinds of child, and counts the rows it took', async () => {
    await seed(3);
    expect(await deleteAsset(db, U, ASSET, 100)).toEqual({ deleted: 7 });
    expect(await count('transaction')).toBe(0);
    expect(await count('user_price')).toBe(0);
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM asset WHERE dataset_id = $1 ORDER BY id`,
      [LIVE[U]],
    );
    expect(rows.map((r) => r.id)).toEqual([KEEP]);
  });

  // AIP-135's FAILED_PRECONDITION while children are present: the request stays one transaction,
  // and the client empties the asset first.
  it('refuses an asset whose rows pass the budget, naming the rows it needs, and deletes nothing', async () => {
    await seed(3);
    expect(await deleteAsset(db, U, ASSET, 6)).toEqual({ needs: 7 });
    expect([await count('asset'), await count('transaction'), await count('user_price')]).toEqual([
      2, 3, 3,
    ]);
    expect(await deleteAsset(db, U, ASSET, 7)).toEqual({ deleted: 7 });
  });

  // `id` IS UNIQUE ONLY WITHIN A DATASET, so an unscoped predicate would delete another
  // user's identically-keyed rows.
  it('touches no other user, even for the same asset id', async () => {
    await seed(2);
    await buy(LIVE[OTHER], OTHER, id(500));
    await deleteAsset(db, U, ASSET, 100);
    expect(await count('transaction', LIVE[OTHER])).toBe(1);
    expect(await count('asset', LIVE[OTHER])).toBe(2);
  });

  // An import restores the same ids into a generation of its own, and only the live one is the
  // user's data until the pointer moves (#390). The budget is exactly the live rows, so a count
  // that read the staged ones would refuse.
  it('counts and touches no other generation of the same user, even for the same asset id', async () => {
    await seed(2);
    await db.query('INSERT INTO dataset (user_id, id, created_at) VALUES ($1, $2, now())', [
      U,
      STAGED,
    ]);
    await db.query('UPDATE app_user SET import_dataset_id = $2 WHERE user_id = $1', [U, STAGED]);
    await asset(STAGED, ASSET);
    await buy(STAGED, U, id(600));
    await db.query(
      `INSERT INTO user_price (dataset_id, asset_id, as_of, price) VALUES ($1, $2, '2026-01-01', 10)`,
      [STAGED, ASSET],
    );
    expect(await deleteAsset(db, U, ASSET, 5)).toEqual({ deleted: 5 });
    expect(await count('asset', STAGED)).toBe(1);
    expect(await count('transaction', STAGED)).toBe(1);
    expect(await count('user_price', STAGED)).toBe(1);
    expect(await count('asset')).toBe(1);
  });

  // The request's one transaction is the caller's: a step committing on its own would land a
  // request in part.
  it('runs inside the caller’s transaction, opening and closing none', async () => {
    await seed(2);
    const sent: string[] = [];
    const watched: SqlClient = {
      query: (text, values) => {
        sent.push(text.trim().split(/\s+/)[0]);
        return db.query(text, values) as never;
      },
    };
    await deleteAsset(watched, U, ASSET, 100);
    await pruneAsset(watched, U, KEEP, 100);
    expect(sent.filter((s) => !['SELECT', 'DELETE'].includes(s))).toEqual([]);
  });
});

describe('pruneAsset', () => {
  it('takes prices first, then transactions newest first, and says what remains', async () => {
    await seed(3);
    expect(await pruneAsset(db, U, ASSET, 4)).toEqual({ deleted: 4, remaining: 2 });
    expect(await count('user_price')).toBe(0);
    // Newest first, so what is left is the ledger's earlier part, still a ledger.
    expect(await transactionIds()).toEqual([id(1), id(2)]);
    expect(await count('asset')).toBe(2);
  });

  it('breaks a tie of date and time by id, so the order is the same on every run', async () => {
    await seed(0);
    for (const n of [3, 1, 2]) await buy(LIVE[U], U, id(n), '2026-05-05');
    await db.query(`UPDATE transaction SET created_at = '2026-05-05T10:00:00Z'`);
    expect(await pruneAsset(db, U, ASSET, 1)).toEqual({ deleted: 1, remaining: 2 });
    expect(await transactionIds()).toEqual([id(1), id(2)]);
  });

  it('empties an asset larger than the budget in steps, after which a delete fits', async () => {
    await seed(5);
    expect(await pruneAsset(db, U, ASSET, 4)).toEqual({ deleted: 4, remaining: 6 });
    expect(await pruneAsset(db, U, ASSET, 4)).toEqual({ deleted: 4, remaining: 2 });
    expect(await deleteAsset(db, U, ASSET, 2)).toEqual({ needs: 3 });
    expect(await deleteAsset(db, U, ASSET, 3)).toEqual({ deleted: 3 });
  });

  it('takes nothing with no budget left, and nothing from an empty asset', async () => {
    await seed(2);
    expect(await pruneAsset(db, U, ASSET, 0)).toEqual({ deleted: 0, remaining: 4 });
    expect(await pruneAsset(db, U, KEEP, 10)).toEqual({ deleted: 0, remaining: 0 });
  });

  it('prunes no other user and no other generation', async () => {
    await seed(1);
    await buy(LIVE[OTHER], OTHER, id(500));
    await db.query('INSERT INTO dataset (user_id, id, created_at) VALUES ($1, $2, now())', [
      U,
      STAGED,
    ]);
    await asset(STAGED, ASSET);
    await buy(STAGED, U, id(600));
    expect(await pruneAsset(db, U, ASSET, 10)).toEqual({ deleted: 2, remaining: 0 });
    expect(await count('transaction', LIVE[OTHER])).toBe(1);
    expect(await count('transaction', STAGED)).toBe(1);
  });
});
