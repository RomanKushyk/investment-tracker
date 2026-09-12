// Deleting an asset, which the foreign keys deliberately refuse to do for us.
//
// The keys are `ON DELETE RESTRICT`, never `CASCADE` (`docs/DECISIONS.md`,
// **User schema and deletes**), and the reason is a ceiling rather than a
// preference: DSQL allows 3 000 mutated rows PER TRANSACTION, and AWS's own
// `CREATE TABLE` guidance says cascaded rows count against that same ceiling.
// One asset's saved prices are one row per day and can exceed it on their own,
// so a cascading key would not have removed the batching — it would have hidden
// it behind a statement that fails at scale and cannot be resumed.
//
// THREE PROPERTIES, and a paraphrase of this loses all three:
//
//   1. EVERY PREDICATE IS USER-SCOPED. `id` is unique only within a user —
//      every per-user table is keyed `(user_id, id)` — so `WHERE asset_id = $1`
//      alone would reach into another user's rows. There is a test for exactly
//      that, with the same asset id under two users.
//   2. EACH STEP BATCHES THROUGH A KEY-SET SUB-SELECT, because Postgres accepts
//      no `LIMIT` on a `DELETE`. The `(user_id, id) IN (SELECT … LIMIT $n)`
//      form is accepted by DSQL — measured, `infra/docs/dsql-constraints.md`.
//   3. EACH BATCH IS ITS OWN TRANSACTION. The ceiling is per transaction, so a
//      loop inside one would not clear it. Every `client.query` here is its own
//      transaction because nothing opens one; that is the property, and it is
//      why this must not be wrapped in `BEGIN`.
//
// CHILDREN FIRST, PARENT LAST, and that ordering is the whole resume story: a
// failure leaves the asset in place, so the same call runs again and finishes
// the children it did not reach. Deleting the parent first would leave orphans
// that reads running parent-to-child cannot see. The two children may go in
// either order — neither references the other.
import type { SqlClient } from './migrate';

/**
 * Well under DSQL's 3 000-row ceiling, and not a tuning knob.
 *
 * The margin is for the ceiling counting more than the rows this statement
 * names; there is no measurement here saying 500 is optimal, only that it is
 * safely below a limit whose accounting we do not control.
 *
 * `deleteAsset`'s `batch` parameter exists so a test can drive the loop over a
 * handful of rows, NOT so a caller can tune it. Zero drains nothing and turns a
 * well-defined delete into a bare `23503` from the parent step; a negative is
 * `2201W` from inside the loop.
 */
const BATCH = 500;

/** `transaction` and `user_price` — each keyed differently, both scoped alike. */
const CHILDREN = [
  // Keyed `(user_id, id)`; the asset is a nullable column on it.
  `DELETE FROM transaction
     WHERE (user_id, id) IN (
       SELECT user_id, id FROM transaction
        WHERE user_id = $1 AND asset_id = $2 LIMIT $3)`,
  // Keyed `(user_id, asset_id, as_of)` — the asset is IN the key, so the
  // key-set carries all three columns.
  `DELETE FROM user_price
     WHERE (user_id, asset_id, as_of) IN (
       SELECT user_id, asset_id, as_of FROM user_price
        WHERE user_id = $1 AND asset_id = $2 LIMIT $3)`,
];

/**
 * Remove one user's asset and everything that points at it.
 *
 * A no-op on an asset that is not there, which is what makes a resumed call
 * safe: the second run finds fewer children and no parent, and says nothing.
 */
export async function deleteAsset(
  client: SqlClient,
  userId: string,
  assetId: string,
  batch = BATCH,
): Promise<void> {
  for (const statement of CHILDREN) {
    // Drain, one batch per statement, until a batch removes nothing. The
    // terminating empty batch is a real round trip and is counted as one.
    //
    // `RETURNING` rather than a row count, because the two clients disagree
    // about the name: `pg` reports `rowCount` and PGlite `affectedRows`, and
    // `SqlClient` deliberately promises only `rows` so the same code can be
    // driven by either. A returned column is the portable way a `DELETE` says
    // how much it did.
    for (;;) {
      const { rows } = await client.query<Record<string, unknown>>(
        `${statement} RETURNING user_id`,
        [userId, assetId, batch],
      );
      // `=== 0`, never `< batch`. A row inserted between two batches would
      // make a short batch look like the last one, and the loop would exit with
      // children still present — the parent step then fails `23503` for a
      // reason that reads like a key defect. The extra round trip is the price
      // of a terminator that means what it says.
      if (rows.length === 0) break;
    }
  }
  await client.query('DELETE FROM asset WHERE user_id = $1 AND id = $2', [userId, assetId]);
}
