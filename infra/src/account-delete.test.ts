// The account deletion core over PGlite (#573): every row the account owns, its `app_user` row,
// then its identity, for whichever account it is given (*User schema and deletes*, *Auth model*).
import type { PGlite } from '@electric-sql/pglite';
import { TERMS_VERSION } from '@quirenote/core/terms';
import { beforeEach, describe, expect, it } from 'vitest';

import { userDb } from './__fixtures__/pglite';
import {
  PER_USER,
  datasetsOf as datasetsIn,
  held as heldIn,
  ledger,
  nothing,
  pool,
  seedAccount,
  u,
} from './__fixtures__/account-rows';
import { insertUser, writeLedger } from './__fixtures__/user-ledger';
import {
  type AccountIdentity,
  deleteAccount,
  deleteIdentities,
  soleSuperAdmin,
} from './account-delete';
import { applications } from './applications';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import type { SqlClient } from './migrate';
import { provision } from './provision';

const POOL = 'eu-north-1_EXAMPLE';
const ALICE = '9f1e2d3c-0000-4000-8000-0000000000a1';
const ALICE_EMAIL = 'alice@quirenote.com';
const BOB = '9f1e2d3c-0000-4000-8000-0000000000b2';
const BOB_EMAIL = 'bob@quirenote.com';

/** EVERY TABLE `MIGRATIONS` MAKES, IN ONE OF TWO LISTS, and a table in neither fails the census
 *  below: a table added later is deleted with the account or said to hold nobody's data. The
 *  archive's tables are another cluster's, provider data shared by every environment (`migrate.ts`). */
const SHARED = ['archive_operation', 'official_rate'];

let db: PGlite;
const cluster: SqlClient = { query: (text, values) => db.query(text, values) };

const seed = (userId: string, email: string, n: number, prices = 2) =>
  seedAccount(db, userId, email, n, { prices });
const datasetsOf = (userId: string) => datasetsIn(db, userId);
const held = (userId: string, datasets: string[]) => heldIn(db, userId, datasets);

beforeEach(async () => {
  db = await userDb();
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

    expect(order).toEqual(['signOut', 'data', 'app_user', 'deleteUser', 'app_user']);
  });

  // ANOTHER TAB'S REQUEST LANDS AFTER THE ROW TRANSACTION, while the identity still stands, so
  // an open window's gate provisions it a fresh row; the pass after the identity takes it (#577).
  it('takes a row provisioned between its row transaction and its identity deletion', async () => {
    await seed(BOB, BOB_EMAIL, 1_000);
    const { idp } = pool({ [BOB_EMAIL]: { email: BOB_EMAIL } });
    let raced: string[] = [];
    const racing: AccountIdentity = {
      ...idp,
      adminDeleteUser: async (input) => {
        if (raced.length === 0) {
          await provision(cluster, BOB, () => insertUser(db, BOB, BOB_EMAIL));
          raced = await datasetsOf(BOB);
        }
        return idp.adminDeleteUser(input);
      },
    };

    expect(await deleteAccount(cluster, racing, POOL, { userId: BOB, email: BOB_EMAIL })).toBe(
      'deleted',
    );

    expect(raced).toHaveLength(1);
    expect(await held(BOB, raced)).toEqual(nothing);
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
    // A seeded account and two deletions at every step outgrow the default timeout under load.
  }, 15_000);
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
