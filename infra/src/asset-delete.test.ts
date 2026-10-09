// The application cascade, which exists because the keys refuse to do it.
// `ON DELETE RESTRICT` is deliberate: DSQL's ceiling is 3 000 mutated rows PER
// TRANSACTION and cascaded rows count against the same ceiling, so a cascading key
// would only have hidden the batching it appears to replace. [*User schema and deletes*]
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { applyUserSchema } from './__fixtures__/user-ledger';
import { deleteAsset } from './asset-delete';
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

describe('deleteAsset', () => {
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

  const buy = (dataset: string, user: string, txId: string) =>
    db.query(
      `INSERT INTO transaction (dataset_id, id, user_id, account_id, date, type, amount,
                                asset_id, quantity, created_at)
            VALUES ($1, $2, $3, $4, '2026-08-26', 'buy', 100, $5, 1, now())`,
      [dataset, txId, user, ACCOUNT, ASSET],
    );

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
      await buy(LIVE[U], U, id(n));
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

  beforeEach(async () => {
    db = await freshDb();
    await applyUserSchema(db);
  });

  it('removes the asset and both kinds of child', async () => {
    await seed(3);
    await deleteAsset(db, U, ASSET);
    expect(await count('transaction')).toBe(0);
    expect(await count('user_price')).toBe(0);
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM asset WHERE dataset_id = $1 ORDER BY id`,
      [LIVE[U]],
    );
    expect(rows.map((r) => r.id)).toEqual([KEEP]);
  });

  // `id` IS UNIQUE ONLY WITHIN A DATASET, so an unscoped predicate would delete another
  // user's identically-keyed rows.
  it('touches no other user, even for the same asset id', async () => {
    await seed(2);
    await buy(LIVE[OTHER], OTHER, id(500));
    await deleteAsset(db, U, ASSET);
    expect(await count('transaction', LIVE[OTHER])).toBe(1);
    expect(await count('asset', LIVE[OTHER])).toBe(2);
  });

  // An import restores the same ids into a generation of its own, and only the live one is the
  // user's data until the pointer moves (#390).
  it('touches no other generation of the same user, even for the same asset id', async () => {
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
    await deleteAsset(db, U, ASSET);
    expect(await count('asset', STAGED)).toBe(1);
    expect(await count('transaction', STAGED)).toBe(1);
    expect(await count('user_price', STAGED)).toBe(1);
    expect(await count('asset')).toBe(1);
  });

  // The ceiling is per TRANSACTION, so the point is not that a batch is small but
  // that each one commits on its own.
  it('batches, and gives each batch its own statement', async () => {
    await seed(5);
    let deletes = 0;
    const counting: SqlClient = {
      query: async (text: string, values?: unknown[]) => {
        if (text.trimStart().startsWith('DELETE')) deletes += 1;
        return db.query(text, values);
      },
    };
    await deleteAsset(counting, U, ASSET, 1);
    // 5 transactions + 5 prices, one batch each, plus the terminating empty
    // batch per child that ends the loop, plus the asset itself.
    expect(deletes).toBe(5 + 1 + 5 + 1 + 1);
    expect(await count('transaction')).toBe(0);
  });

  // PARENT LAST is what makes a failure resumable: the asset is still there, so
  // the same call runs again and finishes the children it did not reach.
  it('leaves the asset behind when a child batch fails, so a re-run finishes it', async () => {
    await seed(4);
    let fail = true;
    const flaky: SqlClient = {
      query: async (text: string, values?: unknown[]) => {
        if (fail && text.includes('user_price')) {
          fail = false;
          throw Object.assign(new Error('batch died'), { code: '40001' });
        }
        return db.query(text, values);
      },
    };
    await expect(deleteAsset(flaky, U, ASSET, 2)).rejects.toThrow(/batch died/);
    expect(await count('asset')).toBe(2);
    await deleteAsset(db, U, ASSET, 2);
    expect(await count('asset')).toBe(1);
    expect(await count('transaction')).toBe(0);
    expect(await count('user_price')).toBe(0);
  });

  it('is a no-op on an asset that is already gone', async () => {
    await seed(1);
    await deleteAsset(db, U, ASSET);
    await expect(deleteAsset(db, U, ASSET)).resolves.toBeUndefined();
  });
});
