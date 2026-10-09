// Deleting an asset, which the `ON DELETE RESTRICT` keys refuse to do (*User schema and deletes*):
// inside the caller's one transaction and budget, every statement joining the live pointer.
import type { SqlClient } from './migrate';

const COUNT_TRANSACTIONS = `SELECT count(*)::int AS n
                              FROM "transaction" t JOIN app_user u ON u.dataset_id = t.dataset_id
                             WHERE u.user_id = $1 AND t.asset_id = $2`;
const COUNT_PRICES = `SELECT count(*)::int AS n
                        FROM user_price p JOIN app_user u ON u.dataset_id = p.dataset_id
                       WHERE u.user_id = $1 AND p.asset_id = $2`;
// Keyed `(dataset_id, asset_id, as_of)`: the asset is IN the key, so the key-set carries three.
const PRUNE_PRICES = `DELETE FROM user_price
                       WHERE (dataset_id, asset_id, as_of) IN (
                         SELECT p.dataset_id, p.asset_id, p.as_of
                           FROM user_price p JOIN app_user u ON u.dataset_id = p.dataset_id
                          WHERE u.user_id = $1 AND p.asset_id = $2 LIMIT $3)
                      RETURNING as_of`;
// Newest first; `id` breaks a tie, since the rows of one request share its clock.
const PRUNE_TRANSACTIONS = `DELETE FROM "transaction"
                             WHERE (dataset_id, id) IN (
                               SELECT t.dataset_id, t.id
                                 FROM "transaction" t JOIN app_user u ON u.dataset_id = t.dataset_id
                                WHERE u.user_id = $1 AND t.asset_id = $2
                                ORDER BY t.date DESC, t.created_at DESC, t.id DESC LIMIT $3)
                            RETURNING id`;
const DELETE_ASSET = `DELETE FROM asset
                       WHERE (dataset_id, id) IN (
                         SELECT a.dataset_id, a.id FROM asset a JOIN app_user u ON u.dataset_id = a.dataset_id
                          WHERE u.user_id = $1 AND a.id = $2)
                      RETURNING id`;

async function children(client: SqlClient, userId: string, assetId: string): Promise<number> {
  let n = 0;
  for (const sql of [COUNT_TRANSACTIONS, COUNT_PRICES]) {
    n += (await client.query<{ n: number }>(sql, [userId, assetId])).rows[0].n;
  }
  return n;
}

/** Up to `budget` of the asset's children, prices first. `RETURNING`, because `SqlClient` promises
 *  only `rows`. */
async function take(client: SqlClient, userId: string, assetId: string, budget: number) {
  let taken = 0;
  for (const statement of [PRUNE_PRICES, PRUNE_TRANSACTIONS]) {
    if (budget - taken <= 0) break;
    const { rows } = await client.query(statement, [userId, assetId, budget - taken]);
    taken += rows.length;
  }
  return taken;
}

/** The asset and its children, when they fit in `budget` rows; otherwise nothing, and how many
 *  rows it needs (AIP-135's FAILED_PRECONDITION while children are present). */
export async function deleteAsset(
  client: SqlClient,
  userId: string,
  assetId: string,
  budget: number,
): Promise<{ deleted: number } | { needs: number }> {
  const needs = (await children(client, userId, assetId)) + 1;
  if (needs > budget) return { needs };
  const taken = await take(client, userId, assetId, needs - 1);
  const { rows } = await client.query(DELETE_ASSET, [userId, assetId]);
  return { deleted: taken + rows.length };
}

/** Up to `budget` of the asset's children, and how many it still has. */
export async function pruneAsset(
  client: SqlClient,
  userId: string,
  assetId: string,
  budget: number,
): Promise<{ deleted: number; remaining: number }> {
  const before = await children(client, userId, assetId);
  const deleted = await take(client, userId, assetId, Math.min(budget, before));
  return { deleted, remaining: before - deleted };
}
