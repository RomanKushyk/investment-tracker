// Deleting an account — its sessions, its rows, its `app_user` row, then its identity — so that
// asking again goes on from where one stopped (*User schema and deletes*, *Auth model*).
import { BATCH_ROWS } from './collect';
import type { SqlClient } from './migrate';

/** The pool's three calls a deletion makes, each of which takes the address as an alias. */
export type AccountIdentity = {
  adminUserGlobalSignOut(input: { UserPoolId: string; Username: string }): Promise<unknown>;
  adminDeleteUser(input: { UserPoolId: string; Username: string }): Promise<unknown>;
  listUsers(input: {
    UserPoolId: string;
    Filter: string;
    Limit: number;
    PaginationToken?: string;
  }): Promise<{ Users?: { Username?: string; UserStatus?: string }[]; PaginationToken?: string }>;
};

const ROLE = `SELECT role FROM app_user WHERE user_id = $1`;

/** An active super-admin with no other active one: deleting them leaves no way back in, the
 *  bootstrap refusing an address whose row has no pool user (`migrate.ts`). */
const SOLE = `SELECT EXISTS (SELECT 1 FROM app_user
                              WHERE user_id = $1 AND role = 'super_admin' AND status = 'active')
                 AND NOT EXISTS (SELECT 1 FROM app_user
                                  WHERE role = 'super_admin' AND status = 'active'
                                    AND user_id <> $1) AS sole`;

// Children first, over EVERY dataset the user owns, which `dataset-scope.test.ts` lets this module
// alone reach; each its own transaction under DSQL's row ceiling, a key-set taking the `LIMIT`.
const BATCHES = [
  `DELETE FROM user_price WHERE (dataset_id, asset_id, as_of) IN (
     SELECT p.dataset_id, p.asset_id, p.as_of FROM user_price p
       JOIN dataset g ON g.id = p.dataset_id JOIN app_user u ON u.user_id = g.user_id
      WHERE u.user_id = $1 LIMIT $2)
   RETURNING asset_id`,
  `DELETE FROM "transaction" WHERE (dataset_id, id) IN (
     SELECT t.dataset_id, t.id FROM "transaction" t
       JOIN dataset g ON g.id = t.dataset_id JOIN app_user u ON u.user_id = g.user_id
      WHERE u.user_id = $1 LIMIT $2)
   RETURNING id`,
  `DELETE FROM asset WHERE (dataset_id, id) IN (
     SELECT a.dataset_id, a.id FROM asset a
       JOIN dataset g ON g.id = a.dataset_id JOIN app_user u ON u.user_id = g.user_id
      WHERE u.user_id = $1 LIMIT $2)
   RETURNING id`,
  `DELETE FROM import_part WHERE (dataset_id, part) IN (
     SELECT x.dataset_id, x.part FROM import_part x
       JOIN dataset g ON g.id = x.dataset_id JOIN app_user u ON u.user_id = g.user_id
      WHERE u.user_id = $1 LIMIT $2)
   RETURNING part`,
  `DELETE FROM import_manifest WHERE dataset_id IN (
     SELECT m.dataset_id FROM import_manifest m
       JOIN dataset g ON g.id = m.dataset_id JOIN app_user u ON u.user_id = g.user_id
      WHERE u.user_id = $1 LIMIT $2)
   RETURNING dataset_id`,
  `DELETE FROM mutation_key WHERE (user_id, key) IN (
     SELECT k.user_id, k.key FROM mutation_key k WHERE k.user_id = $1 LIMIT $2)
   RETURNING key`,
];

// THE ROW GOES IN ONE TRANSACTION WITH WHAT IT POINTS AT; a write that raced in from another tab
// makes a key refuse it, and asking again empties that too.
const LAST = [
  `UPDATE app_user SET dataset_id = NULL, import_dataset_id = NULL WHERE user_id = $1`,
  `DELETE FROM dataset WHERE user_id = $1`,
  `DELETE FROM account WHERE user_id = $1`,
  `DELETE FROM app_user WHERE user_id = $1`,
];

/** Whether `userId` is the only active super-admin. */
export async function soleSuperAdmin(client: SqlClient, userId: string): Promise<boolean> {
  return (await client.query<{ sole: boolean }>(SOLE, [userId])).rows[0].sole;
}

/** One already gone counts as done. */
const ignoringGone = (err: unknown) => {
  if ((err as { name?: string })?.name !== 'UserNotFoundException') throw err;
};

/** Each Google profile under the address, which the alias misses and only the filter finds, read
 *  to the last page: a page may come back short before the end (`pre-signup.ts`). */
async function federated(
  idp: Pick<AccountIdentity, 'listUsers'>,
  UserPoolId: string,
  email: string,
): Promise<string[]> {
  const found: string[] = [];
  let PaginationToken: string | undefined;
  do {
    const page = await idp.listUsers({
      UserPoolId,
      Filter: `email = "${email}"`,
      Limit: 60,
      ...(PaginationToken === undefined ? {} : { PaginationToken }),
    });
    for (const { Username, UserStatus } of page.Users ?? []) {
      if (UserStatus === 'EXTERNAL_PROVIDER' && Username) found.push(Username);
    }
    PaginationToken = page.PaginationToken;
  } while (PaginationToken);
  return found;
}

/** Deletes every identity under the address and each of `also`, those named FIRST, so a
 *  `ListUsers` that fails after them leaves only the Google profiles behind. */
export async function deleteIdentities(
  idp: Pick<AccountIdentity, 'adminDeleteUser' | 'listUsers'>,
  UserPoolId: string,
  email: string,
  also: string[] = [],
): Promise<void> {
  const named = new Set([email, ...also]);
  for (const Username of named) {
    await idp.adminDeleteUser({ UserPoolId, Username }).catch(ignoringGone);
  }
  for (const Username of await federated(idp, UserPoolId, email)) {
    if (!named.has(Username))
      await idp.adminDeleteUser({ UserPoolId, Username }).catch(ignoringGone);
  }
}

/** Deletes the account, or answers why it may not, having touched nothing. */
export async function deleteAccount(
  client: SqlClient,
  idp: AccountIdentity,
  UserPoolId: string,
  // `username` is the caller's own pool username, which a profile whose address no longer matches
  // the row's is reached by alone.
  account: { userId: string; email: string; username?: string },
): Promise<'deleted' | 'demo' | 'sole_super_admin'> {
  const { userId, email } = account;
  const also = account.username === undefined ? [] : [account.username];
  // A row already gone is a deletion that stopped before its identity: nothing to refuse.
  const [row] = (await client.query<{ role: string }>(ROLE, [userId])).rows;
  if (row?.role === 'demo') return 'demo';
  if (await soleSuperAdmin(client, userId)) return 'sole_super_admin';

  // SESSIONS FIRST (ASVS 5.0.0 7.4.2); an ID token already issued is turned away by the row's
  // absence once it is gone, while registration is closed (#577).
  for (const Username of new Set([email, ...(await federated(idp, UserPoolId, email)), ...also])) {
    await idp.adminUserGlobalSignOut({ UserPoolId, Username }).catch(ignoringGone);
  }

  for (const sql of BATCHES) {
    while ((await client.query(sql, [userId, BATCH_ROWS])).rows.length > 0);
  }

  try {
    await client.query('BEGIN');
    for (const sql of LAST) await client.query(sql, [userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }

  // THE IDENTITY LAST: while it stands, its holder can sign in and ask again.
  await deleteIdentities(idp, UserPoolId, email, also);
  return 'deleted';
}
