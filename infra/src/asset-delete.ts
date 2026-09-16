// Deleting an asset, which the foreign keys deliberately refuse to do for us.
//
// The keys are `ON DELETE RESTRICT`, never `CASCADE` (*User schema and deletes*), because DSQL
// allows 3 000 mutated rows PER TRANSACTION and AWS counts cascaded rows against that ceiling.
// One asset's saved prices can exceed it alone, so cascading would have hidden the batching
// behind a statement that fails at scale and cannot be resumed.
//
// THREE PROPERTIES A PARAPHRASE LOSES: every predicate is user-scoped, because `id` is unique
// only within a user; each step batches through a key-set sub-select, because Postgres accepts no
// `LIMIT` on a `DELETE` and DSQL does accept the `(user_id, id) IN (SELECT … LIMIT $n)` form
// (measured, `infra/docs/dsql-constraints.md`); and each batch is its own transaction, so this
// must never be wrapped in `BEGIN`. Children first, parent last, so a failure leaves the asset in
// place and the same call finishes what it did not reach.
import type { SqlClient } from './migrate';

/** Well under DSQL's 3 000-row ceiling, whose accounting we do not control — 500 is not measured
 *  as optimal, only as safely below it. `deleteAsset`'s `batch` is for tests, not for callers. */
const BATCH = 500;

const CHILDREN = [
  // Keyed `(user_id, id)`; the asset is a nullable column on it.
  `DELETE FROM transaction
     WHERE (user_id, id) IN (
       SELECT user_id, id FROM transaction
        WHERE user_id = $1 AND asset_id = $2 LIMIT $3)`,
  // Keyed `(user_id, asset_id, as_of)` — the asset is IN the key, so the key-set carries three.
  `DELETE FROM user_price
     WHERE (user_id, asset_id, as_of) IN (
       SELECT user_id, asset_id, as_of FROM user_price
        WHERE user_id = $1 AND asset_id = $2 LIMIT $3)`,
];

/** A no-op on an asset that is not there, which is what makes a resumed call safe. */
export async function deleteAsset(
  client: SqlClient,
  userId: string,
  assetId: string,
  batch = BATCH,
): Promise<void> {
  for (const statement of CHILDREN) {
    // `RETURNING`, because `SqlClient` promises only `rows`: `pg` and PGlite disagree on the name.
    for (;;) {
      const { rows } = await client.query<Record<string, unknown>>(
        `${statement} RETURNING user_id`,
        [userId, assetId, batch],
      );
      // `=== 0`, never `< batch`. A row inserted between two batches would make a short batch
      // look like the last one, and the parent step would then fail `23503`.
      if (rows.length === 0) break;
    }
  }
  await client.query('DELETE FROM asset WHERE user_id = $1 AND id = $2', [userId, assetId]);
}
