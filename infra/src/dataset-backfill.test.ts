// `011` gives every user who holds an account a dataset, and points `app_user.dataset_id` at it:
// the expand half of #390, shipped before any code reads the pointer (*User schema and deletes*).
// The runner re-sends a DML statement whose ledger row it left open, so each statement here has
// to leave the same state when it runs twice.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { applyUserSchema, insertUser } from './__fixtures__/user-ledger';
import { statementsOf } from './migrate';
import { ACCOUNT } from './provision';

const BACKFILL = statementsOf(
  readFileSync(new URL('../migrations/011_dataset_backfill.sql', import.meta.url), 'utf8'),
);

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const SECOND = '00000000-0000-4000-8000-0000000000a2';
const PENDING = '00000000-0000-4000-8000-0000000000a3';
const REJECTED = '00000000-0000-4000-8000-0000000000a4';

let db: PGlite;

const withAccount = async (userId: string) => {
  await db.query(ACCOUNT, [userId]);
};

const backfill = async () => {
  for (const statement of BACKFILL) await db.exec(statement);
};

const state = async () => {
  const datasets = await db.query<{ user_id: string; id: string }>(
    'SELECT user_id, id FROM dataset ORDER BY user_id, id',
  );
  const users = await db.query<{
    user_id: string;
    dataset_id: string | null;
    import_dataset_id: string | null;
    data_version: string;
  }>(
    `SELECT user_id, dataset_id, import_dataset_id, data_version::text AS data_version
       FROM app_user ORDER BY user_id`,
  );
  return { datasets: datasets.rows, users: users.rows };
};

beforeEach(async () => {
  db = await freshDb();
  await applyUserSchema(db);
  await insertUser(db, OWNER, 'owner@quirenote.com', 'active', 'super_admin');
  await withAccount(OWNER);
  await insertUser(db, SECOND, 'second@quirenote.com');
  await withAccount(SECOND);
  await insertUser(db, PENDING, 'pending@quirenote.com', 'pending');
  await insertUser(db, REJECTED, 'rejected@quirenote.com', 'rejected');
});

describe('the dataset backfill', () => {
  it('gives every user holding an account one dataset, and points at it', async () => {
    await backfill();
    const { datasets, users } = await state();
    expect(datasets.map((d) => d.user_id)).toEqual([OWNER, SECOND]);
    for (const d of datasets) {
      expect(users.find((u) => u.user_id === d.user_id)?.dataset_id).toBe(d.id);
    }
  });

  it('gives a user holding no account nothing: a pending row owns nothing', async () => {
    await backfill();
    const { users } = await state();
    for (const id of [PENDING, REJECTED]) {
      expect(users.find((u) => u.user_id === id)?.dataset_id).toBeNull();
    }
  });

  // A row rewritten NULL to NULL still counts against DSQL's per-transaction row ceiling and
  // still conflicts with an approval deleting it, so the update writes only rows it points.
  it('writes no row it has nothing to point at', async () => {
    const xmin = async () =>
      (
        await db.query<{ xmin: string }>(
          'SELECT xmin::text AS xmin FROM app_user WHERE user_id = $1',
          [PENDING],
        )
      ).rows[0].xmin;
    const before = await xmin();
    await backfill();
    expect(await xmin()).toBe(before);
  });

  it('opens no import and moves no version', async () => {
    await backfill();
    for (const u of (await state()).users) {
      expect(u.import_dataset_id).toBeNull();
      expect(u.data_version).toBe('0');
    }
  });

  it('leaves the same state when every statement runs twice', async () => {
    await backfill();
    const once = await state();
    await backfill();
    expect(await state()).toEqual(once);
  });

  // Live AND staging: with two datasets, only the pointer's own guard keeps the update off this row.
  it('leaves a user who already has a dataset as they are, an import open beside it', async () => {
    const own = '00000000-0000-4000-8000-0000000000d1';
    const staged = '00000000-0000-4000-8000-0000000000d2';
    for (const id of [own, staged]) {
      await db.query('INSERT INTO dataset (user_id, id, created_at) VALUES ($1, $2, now())', [
        OWNER,
        id,
      ]);
    }
    await db.query(
      'UPDATE app_user SET dataset_id = $2, import_dataset_id = $3 WHERE user_id = $1',
      [OWNER, own, staged],
    );
    await backfill();
    const { datasets, users } = await state();
    expect(datasets.filter((d) => d.user_id === OWNER).map((d) => d.id)).toEqual([own, staged]);
    expect(users.find((u) => u.user_id === OWNER)).toMatchObject({
      dataset_id: own,
      import_dataset_id: staged,
    });
  });

  it('catches up a user who gained an account after the first run', async () => {
    await backfill();
    await insertUser(db, '00000000-0000-4000-8000-0000000000a5', 'late@quirenote.com');
    await withAccount('00000000-0000-4000-8000-0000000000a5');
    await backfill();
    const { datasets, users } = await state();
    const late = datasets.find((d) => d.user_id === '00000000-0000-4000-8000-0000000000a5');
    expect(late).toBeDefined();
    expect(users.find((u) => u.user_id === late?.user_id)?.dataset_id).toBe(late?.id);
  });
});
