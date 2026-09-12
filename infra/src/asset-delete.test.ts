// The application cascade, which exists because the keys refuse to do it.
//
// `ON DELETE RESTRICT` is deliberate (`docs/DECISIONS.md`, **User schema and
// deletes**): DSQL's ceiling is 3 000 mutated rows PER TRANSACTION, and cascaded
// rows count against the same ceiling, so a cascading key would not have removed
// the batching it appears to replace — it would only have hidden it.
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { deleteAsset } from './asset-delete';
import type { SqlClient } from './migrate';
import { applyFile, ensureLedger, statementsOf } from './migrate';
import { readFileSync } from 'node:fs';

import { addDays } from '../../src/core/dates';

const SCHEMA = new URL('../migrations/003_user_schema.sql', import.meta.url);

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';
const KEEP = '44444444-4444-4444-8444-444444444444';

const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

describe('deleteAsset', () => {
  let db: PGlite;

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
      // The SAME asset id under both users — `id` is unique only within a user,
      // which is the whole reason every predicate has to carry `user_id`.
      for (const asset of [ASSET, KEEP]) {
        await db.query(
          `INSERT INTO asset (user_id, id, name, code, color_slot, yield_type,
                              expected_pct, target_pct, payout_schedule,
                              first_purchase, created_at)
                VALUES ($1, $2, 'REIT', 'RE', 0, 'dividends', 10, 25, 'monthly',
                        '2026-02-03', now())`,
          [user, asset],
        );
      }
    }
    for (let n = 1; n <= rows; n += 1) {
      await db.query(
        `INSERT INTO transaction (user_id, id, account_id, date, type, amount,
                                  asset_id, quantity, created_at)
              VALUES ($1, $2, $3, '2026-08-26', 'buy', 100, $4, 1, now())`,
        [U, id(n), ACCOUNT, ASSET],
      );
      await db.query(
        `INSERT INTO user_price (user_id, asset_id, as_of, price)
              VALUES ($1, $2, $3, 10)`,
        // A DISTINCT day per row: `as_of` is in `user_price`'s primary key, so
        // a modulus would collide in the fixture rather than in the code under
        // test — and this module's whole subject is behaviour at batch
        // boundaries, which is where a big `rows` gets passed.
        [U, ASSET, addDays('2026-01-01', n)],
      );
    }
  }

  const count = async (table: string, user = U) => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`,
      [user],
    );
    return rows[0].n;
  };

  beforeEach(async () => {
    db = new PGlite();
    await ensureLedger(db);
    await applyFile(db, 'schema', statementsOf(readFileSync(SCHEMA, 'utf8')));
  });

  it('removes the asset and both kinds of child', async () => {
    await seed(3);
    await deleteAsset(db, U, ASSET);
    expect(await count('transaction')).toBe(0);
    expect(await count('user_price')).toBe(0);
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM asset WHERE user_id = $1 ORDER BY id`,
      [U],
    );
    expect(rows.map((r) => r.id)).toEqual([KEEP]);
  });

  // `id` IS UNIQUE ONLY WITHIN A USER, so an unscoped predicate would delete
  // another user's identically-keyed rows. That is the failure the composite
  // primary key exists to make possible and the scoping exists to prevent.
  it('touches no other user, even for the same asset id', async () => {
    await seed(2);
    await db.query(
      `INSERT INTO transaction (user_id, id, account_id, date, type, amount,
                                asset_id, quantity, created_at)
            VALUES ($1, $2, $3, '2026-08-26', 'buy', 100, $4, 1, now())`,
      [OTHER, id(500), ACCOUNT, ASSET],
    );
    await deleteAsset(db, U, ASSET);
    expect(await count('transaction', OTHER)).toBe(1);
    expect(await count('asset', OTHER)).toBe(2);
  });

  // The ceiling is per TRANSACTION, so the point is not that a batch is small
  // but that each one commits on its own. A batch size of 1 over 5 rows is 5
  // round trips, which is what this counts.
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
