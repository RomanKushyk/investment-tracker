// An account with rows in every per-user table, the census that finds them, and a pool that holds
// its identities: what a deletion is tested against, the core's own tests and the admin route's.
import { randomUUID } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';

import type { AccountIdentity } from '../account-delete';
import { insertUser, writeLedger, type LedgerRows } from './user-ledger';

/** SHA-256 in canonical base64, as the manifest's check asks. */
const DIGEST = `${'A'.repeat(42)}A=`;

/** The tables a deletion empties of the account: `account-delete.test.ts`'s census holds every
 *  table the migrations make to this list or to the shared one. */
export const PER_USER = [
  'account',
  'app_user',
  'asset',
  'dataset',
  'import_manifest',
  'import_part',
  'mutation_key',
  'transaction',
  'user_price',
];

export const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** One asset, a deposit and `prices` daily prices of it, numbered from `n`. */
export const ledger = (n: number, prices = 2): LedgerRows => ({
  assets: [
    {
      id: u(n),
      name: 'REIT',
      code: 'RE',
      colorKey: 'reit',
      yieldType: 'dividends',
      expectedPct: 10,
      targetPct: 25,
      payoutSchedule: 'monthly',
      firstPurchase: '2026-03-02',
      createdAt: '2026-03-02T09:00:00',
    },
  ],
  transactions: [{ id: u(n + 1), date: '2026-03-01', type: 'deposit', assetId: '', amount: 1_000 }],
  userPrices: Array.from({ length: prices }, (_, i) => ({
    assetId: u(n),
    asOf: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
    price: 5,
  })),
});

/** A user with rows in every per-user table: a live dataset, a cleared one the sweep has not
 *  reached, a staged import with a part in, and an idempotency key. */
export async function seedAccount(
  db: PGlite,
  userId: string,
  email: string,
  n: number,
  { prices = 2, status = 'active' }: { prices?: number; status?: string } = {},
): Promise<void> {
  await insertUser(db, userId, email, status);
  await writeLedger(db, userId, ledger(n, prices));
  const dead = randomUUID();
  await db.query('INSERT INTO dataset (user_id, id, created_at) VALUES ($1, $2, now())', [
    userId,
    dead,
  ]);
  await writeLedger(db, userId, ledger(n + 100), dead);
  const staged = randomUUID();
  await db.query('INSERT INTO dataset (user_id, id, created_at) VALUES ($1, $2, now())', [
    userId,
    staged,
  ]);
  await writeLedger(db, userId, ledger(n + 200), staged);
  await db.query(
    `INSERT INTO import_manifest (dataset_id, digest, assets, transactions, prices, staged_at)
     VALUES ($1, $2, 1, 1, 2, now())`,
    [staged, DIGEST],
  );
  await db.query('INSERT INTO import_part (dataset_id, part, digest) VALUES ($1, 1, $2)', [
    staged,
    DIGEST,
  ]);
  await db.query('UPDATE app_user SET import_dataset_id = $2 WHERE user_id = $1', [userId, staged]);
  await db.query(
    `INSERT INTO mutation_key (user_id, key, fingerprint, token, claimed_at, in_progress_until,
                               expires_at)
     VALUES ($1, gen_random_uuid(), $2, gen_random_uuid(), now(), now() + interval '20 seconds',
             now() + interval '24 hours')`,
    [userId, 'a'.repeat(64)],
  );
}

/** The dataset ids a user owns, read before the deletion takes the `dataset` rows away. */
export async function datasetsOf(db: PGlite, userId: string): Promise<string[]> {
  return (
    await db.query<{ id: string }>('SELECT id FROM dataset WHERE user_id = $1', [userId])
  ).rows.map((r) => r.id);
}

/** What each per-user table holds of the user, found by the column the table keys its owner by:
 *  `user_id`, or `dataset_id` for the tables a generation keys. */
export async function held(
  db: PGlite,
  userId: string,
  datasets: string[],
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of PER_USER) {
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
          AND column_name IN ('user_id', 'dataset_id')`,
      [table],
    );
    const columns = rows.map((r) => r.column_name);
    const sql = columns.includes('user_id')
      ? `SELECT count(*)::int AS n FROM "${table}" WHERE user_id = $1`
      : `SELECT count(*)::int AS n FROM "${table}" WHERE dataset_id = ANY($1::uuid[])`;
    if (columns.length === 0) throw new Error(`${table} names no owner column`);
    counts[table] = (
      await db.query<{ n: number }>(sql, [columns.includes('user_id') ? userId : datasets])
    ).rows[0].n;
  }
  return counts;
}

export const nothing = Object.fromEntries(PER_USER.map((t) => [t, 0]));

/** `sub` is the identity's own, which only the `sub` filter finds it by. */
export type Profile = { email: string; external?: boolean; sub?: string };

/** A pool that holds `profiles`, keyed by the username an admin call takes: the address for a
 *  local account, which the API accepts as an alias, and `google_…` for a federated profile. Every
 *  call is logged in order. */
export const pool = (profiles: Record<string, Profile>) => {
  const users = new Map(Object.entries(profiles));
  const log: string[] = [];
  const missing = () =>
    Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' });
  const idp: AccountIdentity = {
    adminUserGlobalSignOut: async ({ Username }) => {
      log.push(`signOut ${Username}`);
      if (!users.has(Username)) throw missing();
      return {};
    },
    adminDeleteUser: async ({ Username }) => {
      log.push(`delete ${Username}`);
      if (!users.delete(Username)) throw missing();
      return {};
    },
    listUsers: async ({ Filter }) => {
      const [, name, value] = /^(email|sub) = "(.*)"$/.exec(Filter) ?? [];
      return {
        Users: [...users]
          .filter(([, p]) => (name === 'sub' ? p.sub : p.email) === value)
          .map(([Username, p]) => ({
            Username,
            UserStatus: p.external ? 'EXTERNAL_PROVIDER' : 'CONFIRMED',
          })),
      };
    },
  };
  return { idp, users, log };
};
