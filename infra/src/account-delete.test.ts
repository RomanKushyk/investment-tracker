// The account deletion core over PGlite (#573): every row the account owns, its `app_user` row,
// then its identity, for whichever account it is given (*User schema and deletes*, *Auth model*).
import { randomUUID } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';
import { TERMS_VERSION } from '@quirenote/core/terms';
import { beforeEach, describe, expect, it } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import {
  applyUserSchema,
  insertUser,
  writeLedger,
  type LedgerRows,
} from './__fixtures__/user-ledger';
import {
  type AccountIdentity,
  deleteAccount,
  deleteIdentities,
  soleSuperAdmin,
} from './account-delete';
import { applications } from './applications';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import type { SqlClient } from './migrate';

const POOL = 'eu-north-1_EXAMPLE';
const ALICE = '9f1e2d3c-0000-4000-8000-0000000000a1';
const ALICE_EMAIL = 'alice@quirenote.com';
const BOB = '9f1e2d3c-0000-4000-8000-0000000000b2';
const BOB_EMAIL = 'bob@quirenote.com';
/** SHA-256 in canonical base64, as the manifest's check asks. */
const DIGEST = `${'A'.repeat(42)}A=`;

/** EVERY TABLE `MIGRATIONS` MAKES, IN ONE OF TWO LISTS, and a table in neither fails the census
 *  below: a table added later is deleted with the account or said to hold nobody's data. The
 *  archive's tables are another cluster's, provider data shared by every environment (`migrate.ts`). */
const PER_USER = [
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
const SHARED = ['archive_operation', 'official_rate'];

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** One asset, a deposit and `prices` daily prices of it, numbered from `n`. */
const ledger = (n: number, prices = 2): LedgerRows => ({
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

let db: PGlite;
const cluster: SqlClient = { query: (text, values) => db.query(text, values) };

/** A user with rows in every per-user table: a live dataset, a cleared one the sweep has not
 *  reached, a staged import with a part in, and an idempotency key. */
const seed = async (userId: string, email: string, n: number, prices = 2) => {
  await insertUser(db, userId, email);
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
};

/** The dataset ids a user owns, read before the deletion takes the `dataset` rows away. */
const datasetsOf = async (userId: string) =>
  (await db.query<{ id: string }>('SELECT id FROM dataset WHERE user_id = $1', [userId])).rows.map(
    (r) => r.id,
  );

/** What each per-user table holds of the user, found by the column the table keys its owner by:
 *  `user_id`, or `dataset_id` for the tables a generation keys. */
const held = async (userId: string, datasets: string[]) => {
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
};

const nothing = Object.fromEntries(PER_USER.map((t) => [t, 0]));

type Profile = { email: string; external?: boolean };

/** A pool that holds `profiles`, keyed by the username an admin call takes: the address for a
 *  local account, which the API accepts as an alias, and `google_…` for a federated profile. Every
 *  call is logged in order. */
const pool = (profiles: Record<string, Profile>) => {
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
      const email = /^email = "(.*)"$/.exec(Filter)?.[1];
      return {
        Users: [...users]
          .filter(([, p]) => p.email === email)
          .map(([Username, p]) => ({
            Username,
            UserStatus: p.external ? 'EXTERNAL_PROVIDER' : 'CONFIRMED',
          })),
      };
    },
  };
  return { idp, users, log };
};

beforeEach(async () => {
  db = await freshDb();
  await applyUserSchema(db);
});

describe('the census: every table the migrations make is classified', () => {
  it('lists each table once, as per-user or as shared', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([...PER_USER, ...SHARED].sort());
  });

  it('keys no shared table by a user or a dataset', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT DISTINCT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name IN ('user_id', 'dataset_id')`,
    );
    expect(rows.map((r) => r.table_name).filter((t) => SHARED.includes(t))).toEqual([]);
  });
});

describe('deleting an account', () => {
  it('leaves nothing of it in any per-user table, every generation included', async () => {
    await seed(BOB, BOB_EMAIL, 1_000);
    const datasets = await datasetsOf(BOB);
    expect(datasets).toHaveLength(3);
    const { idp } = pool({ [BOB_EMAIL]: { email: BOB_EMAIL } });

    expect(await deleteAccount(cluster, idp, POOL, { userId: BOB, email: BOB_EMAIL })).toBe(
      'deleted',
    );

    expect(await held(BOB, datasets)).toEqual(nothing);
  });

  it('deletes the account it is given and leaves another one whole', async () => {
    await seed(ALICE, ALICE_EMAIL, 1_000);
    await seed(BOB, BOB_EMAIL, 2_000);
    const alices = await datasetsOf(ALICE);
    const before = await held(ALICE, alices);
    const { idp, users } = pool({
      [ALICE_EMAIL]: { email: ALICE_EMAIL },
      [BOB_EMAIL]: { email: BOB_EMAIL },
    });

    await deleteAccount(cluster, idp, POOL, { userId: BOB, email: BOB_EMAIL });

    expect(await held(ALICE, alices)).toEqual(before);
    expect([...users.keys()]).toEqual([ALICE_EMAIL]);
  });

  it('removes more rows than one batch holds within the one call', async () => {
    await seed(BOB, BOB_EMAIL, 1_000, 1_200);
    const datasets = await datasetsOf(BOB);
    const { idp } = pool({ [BOB_EMAIL]: { email: BOB_EMAIL } });

    await deleteAccount(cluster, idp, POOL, { userId: BOB, email: BOB_EMAIL });

    expect(await held(BOB, datasets)).toEqual(nothing);
  });

  it('ends every session, then deletes the identity and every Google profile under the address', async () => {
    await seed(BOB, BOB_EMAIL, 1_000);
    const { idp, users, log } = pool({
      [BOB_EMAIL]: { email: BOB_EMAIL },
      google_1234: { email: BOB_EMAIL, external: true },
    });

    await deleteAccount(cluster, idp, POOL, { userId: BOB, email: BOB_EMAIL });

    expect(log.filter((l) => l.startsWith('signOut')).sort()).toEqual([
      `signOut ${BOB_EMAIL}`,
      'signOut google_1234',
    ]);
    expect(users.size).toBe(0);
  });

  it('ends the sessions first and deletes the identity after the row, last', async () => {
    await seed(BOB, BOB_EMAIL, 1_000);
    const { idp } = pool({ [BOB_EMAIL]: { email: BOB_EMAIL } });
    const order: string[] = [];
    const logged: AccountIdentity = {
      adminUserGlobalSignOut: (input) => (order.push('signOut'), idp.adminUserGlobalSignOut(input)),
      adminDeleteUser: (input) => (order.push('deleteUser'), idp.adminDeleteUser(input)),
      listUsers: (input) => idp.listUsers(input),
    };
    const watched: SqlClient = {
      query: (text, values) => {
        if (/^\s*DELETE FROM app_user/.test(text)) order.push('app_user');
        if (/^\s*DELETE FROM user_price/.test(text) && !order.includes('data')) order.push('data');
        return db.query(text, values);
      },
    };

    await deleteAccount(watched, logged, POOL, { userId: BOB, email: BOB_EMAIL });

    expect(order).toEqual(['signOut', 'data', 'app_user', 'deleteUser']);
  });

  it('lets the address apply again, as a pending application like any new one', async () => {
    await seed(BOB, BOB_EMAIL, 1_000);
    const { idp } = pool({ [BOB_EMAIL]: { email: BOB_EMAIL } });
    await deleteAccount(cluster, idp, POOL, { userId: BOB, email: BOB_EMAIL });

    const res = await applications(cluster, {
      body: JSON.stringify({ email: BOB_EMAIL, botCheck: 'X', termsVersion: TERMS_VERSION }),
      isBase64Encoded: false,
    });

    expect(res.statusCode).toBe(202);
    const { rows } = await db.query<{ user_id: string; status: string }>(
      'SELECT user_id, status FROM app_user WHERE email = $1',
      [BOB_EMAIL],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].user_id).not.toBe(BOB);
  });

  it('finishes an account whose row is already gone, by its identity alone', async () => {
    const { idp, users } = pool({ [BOB_EMAIL]: { email: BOB_EMAIL } });

    expect(await deleteAccount(cluster, idp, POOL, { userId: BOB, email: BOB_EMAIL })).toBe(
      'deleted',
    );
    expect(users.size).toBe(0);
  });
});

describe('deleteIdentities, which a decline shares', () => {
  it('deletes the local account before it lists the Google profiles', async () => {
    const { idp, users } = pool({ [BOB_EMAIL]: { email: BOB_EMAIL } });
    const failing: AccountIdentity = {
      ...idp,
      listUsers: async () => {
        throw new Error('TooManyRequestsException');
      },
    };

    await expect(deleteIdentities(failing, POOL, BOB_EMAIL)).rejects.toThrow();
    expect(users.size).toBe(0);
  });

  it('deletes the usernames it is named before it lists, too', async () => {
    const { idp, users } = pool({ Google_9: { email: 'drifted@quirenote.com', external: true } });
    const failing: AccountIdentity = {
      ...idp,
      listUsers: async () => {
        throw new Error('TooManyRequestsException');
      },
    };

    await expect(deleteIdentities(failing, POOL, BOB_EMAIL, ['Google_9'])).rejects.toThrow();
    expect(users.size).toBe(0);
  });

  it('reads every page the pool hands back, a short one included', async () => {
    const { idp, users } = pool({
      [BOB_EMAIL]: { email: BOB_EMAIL },
      google_1: { email: BOB_EMAIL, external: true },
      google_2: { email: BOB_EMAIL, external: true },
    });
    // One profile a page, each but the last naming the next.
    const paged: AccountIdentity = {
      ...idp,
      listUsers: async (input) => {
        const { Users = [] } = await idp.listUsers(input);
        const at = Number(input.PaginationToken ?? 0);
        return {
          Users: Users.slice(at, at + 1),
          ...(at + 1 < Users.length ? { PaginationToken: String(at + 1) } : {}),
        };
      },
    };

    await deleteIdentities(paged, POOL, BOB_EMAIL);
    expect(users.size).toBe(0);
  });
});

describe('a deletion cut short completes when asked again', () => {
  /** Fails the `at`-th call of either kind, once, and counts every call it sees. */
  const failingAt = (at: number, idp: AccountIdentity) => {
    let calls = 0;
    const tick = () => {
      calls += 1;
      if (calls === at) throw new Error('cut short');
    };
    const client: SqlClient = {
      query: async (text, values) => {
        tick();
        return db.query(text, values);
      },
    };
    const identity: AccountIdentity = {
      adminUserGlobalSignOut: async (input) => (tick(), idp.adminUserGlobalSignOut(input)),
      adminDeleteUser: async (input) => (tick(), idp.adminDeleteUser(input)),
      listUsers: async (input) => (tick(), idp.listUsers(input)),
    };
    return { client, identity, calls: () => calls };
  };

  it('from a cut at every step it takes', async () => {
    let cuts = 0;
    for (let at = 1; ; at += 1) {
      const userId = u(900_000 + at);
      const email = `cut-${at}@quirenote.com`;
      await seed(userId, email, at * 1_000);
      const datasets = await datasetsOf(userId);
      const { idp, users } = pool({
        [email]: { email },
        [`google_${at}`]: { email, external: true },
      });
      const cut = failingAt(at, idp);

      const first = await deleteAccount(cut.client, cut.identity, POOL, { userId, email }).then(
        () => 'finished',
        () => 'cut',
      );
      if (first === 'finished') {
        // Past the last call: the cut never landed, and every earlier one did.
        expect(cut.calls()).toBe(at - 1);
        break;
      }
      cuts += 1;

      expect(await deleteAccount(cluster, idp, POOL, { userId, email })).toBe('deleted');
      expect(await held(userId, datasets)).toEqual(nothing);
      expect(users.size).toBe(0);
    }
    expect(cuts).toBeGreaterThan(20);
  });
});

describe('the refusals, asked before anything is touched', () => {
  it('refuses the demo identity', async () => {
    await insertUser(db, DEMO_USER_ID, DEMO_USER_EMAIL, 'active', 'demo');
    await writeLedger(db, DEMO_USER_ID, ledger(1_000));
    const datasets = await datasetsOf(DEMO_USER_ID);
    const before = await held(DEMO_USER_ID, datasets);
    const { idp, log } = pool({});

    expect(
      await deleteAccount(cluster, idp, POOL, { userId: DEMO_USER_ID, email: DEMO_USER_EMAIL }),
    ).toBe('demo');

    expect(await held(DEMO_USER_ID, datasets)).toEqual(before);
    expect(log).toEqual([]);
  });

  it('refuses the only super-admin', async () => {
    await insertUser(db, ALICE, ALICE_EMAIL, 'active', 'super_admin');
    const { idp, log } = pool({ [ALICE_EMAIL]: { email: ALICE_EMAIL } });

    expect(await deleteAccount(cluster, idp, POOL, { userId: ALICE, email: ALICE_EMAIL })).toBe(
      'sole_super_admin',
    );

    expect(log).toEqual([]);
    expect(
      (await db.query('SELECT 1 FROM app_user WHERE user_id = $1', [ALICE])).rows,
    ).toHaveLength(1);
  });

  it('deletes a super-admin while another active one remains', async () => {
    await insertUser(db, ALICE, ALICE_EMAIL, 'active', 'super_admin');
    await insertUser(db, BOB, BOB_EMAIL, 'active', 'super_admin');
    const { idp } = pool({ [ALICE_EMAIL]: { email: ALICE_EMAIL } });

    expect(await deleteAccount(cluster, idp, POOL, { userId: ALICE, email: ALICE_EMAIL })).toBe(
      'deleted',
    );
  });

  it('counts a rejected super-admin as no other one', async () => {
    await insertUser(db, ALICE, ALICE_EMAIL, 'active', 'super_admin');
    await insertUser(db, BOB, BOB_EMAIL, 'rejected', 'super_admin');
    const { idp } = pool({ [ALICE_EMAIL]: { email: ALICE_EMAIL } });

    expect(await deleteAccount(cluster, idp, POOL, { userId: ALICE, email: ALICE_EMAIL })).toBe(
      'sole_super_admin',
    );
  });
});

describe('soleSuperAdmin', () => {
  it('says so for the only active super-admin, and for nobody else', async () => {
    await insertUser(db, ALICE, ALICE_EMAIL, 'active', 'super_admin');
    await insertUser(db, BOB, BOB_EMAIL);
    expect(await soleSuperAdmin(cluster, ALICE)).toBe(true);
    expect(await soleSuperAdmin(cluster, BOB)).toBe(false);

    await insertUser(db, u(7), 'second@quirenote.com', 'active', 'super_admin');
    expect(await soleSuperAdmin(cluster, ALICE)).toBe(false);
  });
});
