// Dead generations — datasets of the caller that neither pointer names — removed a bounded batch
// at a time by the requests that write, never on a schedule (*User schema and deletes*).
import { codeOf } from './dsql';
import type { SqlClient } from './migrate';

/** AWS's DSQL guidance on batch size, well under the row ceiling. */
export const BATCH_ROWS = 500;
/** As Azure keeps uncommitted blocks and GCS a resumable session: a week without a part. */
export const IDLE_LIMIT = '7 days';

const EXPIRE = `UPDATE app_user u SET import_dataset_id = NULL
                 WHERE u.user_id = $1 AND u.import_dataset_id IN (
                   SELECT m.dataset_id FROM import_manifest m
                    WHERE m.staged_at <= now() - $2::interval)
             RETURNING u.user_id`;
const DEAD = `SELECT g.id FROM dataset g JOIN app_user u ON u.user_id = g.user_id
               WHERE u.user_id = $1 AND g.id IS DISTINCT FROM u.dataset_id
                 AND g.id IS DISTINCT FROM u.import_dataset_id
               LIMIT 1`;
// One per table, children first as the keys require, each checking its generation is dead. `IS
// DISTINCT FROM`, because `<>` against a NULL pointer is NULL.
const BATCHES: { sql: string; limited: boolean }[] = [
  {
    limited: true,
    sql: `DELETE FROM user_price WHERE (dataset_id, asset_id, as_of) IN (
     SELECT p.dataset_id, p.asset_id, p.as_of FROM user_price p
       JOIN dataset g ON g.id = p.dataset_id JOIN app_user u ON u.user_id = g.user_id
      WHERE u.user_id = $1 AND g.id = $2::uuid AND g.id IS DISTINCT FROM u.dataset_id
        AND g.id IS DISTINCT FROM u.import_dataset_id LIMIT $3)
   RETURNING asset_id`,
  },
  {
    limited: true,
    sql: `DELETE FROM "transaction" WHERE (dataset_id, id) IN (
     SELECT t.dataset_id, t.id FROM "transaction" t
       JOIN dataset g ON g.id = t.dataset_id JOIN app_user u ON u.user_id = g.user_id
      WHERE u.user_id = $1 AND g.id = $2::uuid AND g.id IS DISTINCT FROM u.dataset_id
        AND g.id IS DISTINCT FROM u.import_dataset_id LIMIT $3)
   RETURNING id`,
  },
  {
    limited: true,
    sql: `DELETE FROM asset WHERE (dataset_id, id) IN (
     SELECT a.dataset_id, a.id FROM asset a
       JOIN dataset g ON g.id = a.dataset_id JOIN app_user u ON u.user_id = g.user_id
      WHERE u.user_id = $1 AND g.id = $2::uuid AND g.id IS DISTINCT FROM u.dataset_id
        AND g.id IS DISTINCT FROM u.import_dataset_id LIMIT $3)
   RETURNING id`,
  },
  {
    limited: true,
    sql: `DELETE FROM import_part WHERE (dataset_id, part) IN (
     SELECT x.dataset_id, x.part FROM import_part x
       JOIN dataset g ON g.id = x.dataset_id JOIN app_user u ON u.user_id = g.user_id
      WHERE u.user_id = $1 AND g.id = $2::uuid AND g.id IS DISTINCT FROM u.dataset_id
        AND g.id IS DISTINCT FROM u.import_dataset_id LIMIT $3)
   RETURNING part`,
  },
  {
    limited: false,
    sql: `DELETE FROM import_manifest WHERE dataset_id IN (
     SELECT m.dataset_id FROM import_manifest m
       JOIN dataset g ON g.id = m.dataset_id JOIN app_user u ON u.user_id = g.user_id
      WHERE u.user_id = $1 AND g.id = $2::uuid AND g.id IS DISTINCT FROM u.dataset_id
        AND g.id IS DISTINCT FROM u.import_dataset_id)
   RETURNING dataset_id`,
  },
  {
    limited: false,
    sql: `DELETE FROM dataset WHERE id IN (
     SELECT g.id FROM dataset g JOIN app_user u ON u.user_id = g.user_id
      WHERE u.user_id = $1 AND g.id = $2::uuid AND g.id IS DISTINCT FROM u.dataset_id
        AND g.id IS DISTINCT FROM u.import_dataset_id)
   RETURNING id`,
  },
];

/** One bounded batch from the first table holding rows of a dead generation; `false` when none
 *  is dead, or when a late child refuses the dataset's delete, which the next batch retries. */
async function batch(client: SqlClient, userId: string, rows: number): Promise<boolean> {
  const [dead] = (await client.query<{ id: string }>(DEAD, [userId])).rows;
  if (dead === undefined) return false;
  for (const { sql, limited } of BATCHES) {
    const values = limited ? [userId, dead.id, rows] : [userId, dead.id];
    try {
      if ((await client.query(sql, values)).rows.length > 0) return true;
    } catch (err) {
      if (codeOf(err) !== '23503') throw err;
      return false;
    }
  }
  return false;
}

/** A budget of exactly one batch, what each write after a commit's own carries. */
export const once = (): (() => boolean) => {
  let spent = false;
  return () => !spent && (spent = true);
};

/** Clears an idle import, then collects a batch at a time while `more` allows. NEVER THE ANSWER:
 *  a failure is logged and the request answers as it would have. */
export async function collect(
  client: SqlClient,
  userId: string,
  more: () => boolean,
  rows = BATCH_ROWS,
): Promise<void> {
  if (!more()) return;
  try {
    await client.query(EXPIRE, [userId, IDLE_LIMIT]);
    do {
      if (!(await batch(client, userId, rows))) return;
    } while (more());
  } catch (err) {
    console.error('collection failed', err);
  }
}
