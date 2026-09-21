// Every user owns exactly one account, written in the same transaction as the user row that owns
// it. NOT A CONVENIENCE: `transaction.account_id` is NOT NULL against `account(user_id, id)`, so
// "no account yet" is not an empty state a screen can render — it is a user whose every write is
// refused, which pushes get-or-create into the WRITE path. One transaction is the whole answer to
// partial failure here, both rows living in one database; an outbox or a saga would be buying
// atomicity this cluster already gives.
//
// EAGER RELATIVE TO THIS SCHEMA, JUST-IN-TIME RELATIVE TO COGNITO. The identity is minted
// elsewhere; this database first sees a caller on their first authenticated request, which is
// already where the user row is written. So the account goes beside it, on whichever path wrote
// that row — one shape, and it survives an auth provider change.
//
// WHAT DOES NOT PROVISION: `applications.ts`. A pending row is DELETED to rekey it onto the minted
// `sub`, and `account_user_fk` is `ON DELETE restrict` — so an account hung off the placeholder
// makes every approval fail on the key. A pending row owns nothing, and `approve.test.ts` holds
// anyone to it.
import type { SqlClient } from './migrate';

/** Whether the user already holds their account, asked INSIDE the transaction that is about to
 *  write one. This read is what separates a performed insert from a suppressed one, and the reason
 *  the insert below carries no `RETURNING`: `SqlClient` promises `rows` alone — `pg` and PGlite
 *  disagree on what the count is called, which is `asset-delete.ts`'s rule — so the alternative was
 *  `RETURNING` on a suppressed `ON CONFLICT`, a COMBINATION NO PROBE HAS COVERED. `RETURNING` on
 *  its own is sent to the cluster by `asset-delete.ts` and `approve.ts`; on an insert a conflict
 *  swallowed it is not, and `migrate.ts` keeps it off `BOOTSTRAP_ROW` for exactly that reason. A
 *  Postgres guarantee is not evidence about DSQL, which is this repository's whole DDL history.
 *
 *  THE READ CAN BE STALE BY EXACTLY ONE RACE, and the cost is bounded to a word. A row committed
 *  after this snapshot is invisible to it, so the verdict says `created` for a row somebody else
 *  made. Under optimistic concurrency the insert below would conflict at COMMIT and the retry would
 *  ask again — but whether a SUPPRESSED insert is adjudicated at all is unconfirmed in either
 *  direction (`infra/docs/dsql-constraints.md`), and the retry budget is three. THE ROW IS NEVER
 *  WRONG whichever way that falls: `account_user_provider_uq` is what bounds the count at one, not
 *  this read, and the verdict is only ever reported. */
const HELD = `SELECT id FROM account WHERE user_id = $1 AND provider = 'inzhur'`;

/**
 * The only provider in use anywhere, and deliberately NOT a CHECK: `infra/schema/user.ts` forbids a
 * constraint naming a specific holding, and a CHECK added after the table exists is `NOT VALID` for
 * life, `VALIDATE CONSTRAINT` being refused — so a vocabulary widened later would be a rule the
 * rows already there were never held to. `(user_id, provider)` is unique, which is the only rule
 * the column carries and the one this insert conflicts on.
 *
 * SENT EVEN WHERE `HELD` ALREADY ANSWERED: one statement writes this row, and the clause is what
 * makes that safe whichever way the read came back.
 */
export const ACCOUNT = `INSERT INTO account (user_id, id, provider, name, created_at)
                        VALUES ($1, gen_random_uuid(), 'inzhur', 'Inzhur', now())
                        ON CONFLICT (user_id, provider) DO NOTHING`;

/** A SQLSTATE, or nothing — the shape `migrate.ts` reads one in, and for its reasons. */
const codeOf = (err: unknown): string | undefined => {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const code = (err as { code: unknown }).code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
};

/**
 * A duplicate that RAISED rather than being suppressed, and the same doubt `applications.ts`
 * carries: `infra/docs/dsql-constraints.md` measured `ON CONFLICT … DO NOTHING` reporting no rows
 * on the PRIMARY KEY, while this statement names the secondary unique index. The constraint NAME is
 * what keeps the branch safe — a `23505` on its own does not say which index refused.
 */
const isTheAccountAlready = (err: unknown): boolean =>
  codeOf(err) === '23505' &&
  typeof err === 'object' &&
  err !== null &&
  (err as { constraint?: unknown }).constraint === 'account_user_provider_uq';

/** SHORT, because this sits in a request path: the runner's teardown can wait seconds for a
 *  catalogue to settle, and somebody's first authenticated request cannot. */
const RETRY_DELAYS_MS = [20, 80, 200];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Provisioned = 'created' | 'existing';

/**
 * Writes the user row and its account together, retried on contention.
 *
 * `writeUser` MUST BE A NO-OP THE SECOND TIME — every caller's statement carries `ON CONFLICT
 * (user_id) DO NOTHING` — because both ways out of a failed attempt either run it again or abandon
 * it: a `40001` starts the transaction over, and a raised duplicate rolls back a user write that
 * had nothing left to do. The rollback loses nothing in that arm precisely because an account
 * cannot exist without the row its foreign key points at.
 *
 * `ON CONFLICT DO NOTHING` DOES NOT REMOVE THE NEED FOR THE RETRY. DSQL's optimistic concurrency
 * control marks INSERT × INSERT on one row as conflicting and reports it at COMMIT, so the clause
 * prevents a duplicate row, never a serialization failure.
 */
export async function provision(
  client: SqlClient,
  userId: string,
  writeUser: () => Promise<unknown>,
): Promise<Provisioned> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await client.query('BEGIN');
      await writeUser();
      const { rows } = await client.query(HELD, [userId]);
      await client.query(ACCOUNT, [userId]);
      await client.query('COMMIT');
      return rows.length > 0 ? 'existing' : 'created';
    } catch (err) {
      // A conflicting transaction is left OPEN rather than closed, so this is what ends it. Its own
      // failure is nothing: the transaction is already lost either way.
      await client.query('ROLLBACK').catch(() => undefined);
      if (isTheAccountAlready(err)) return 'existing';
      // COUNTED, NOT INFERRED FROM THE LOOKUP, as the runner's teardown counts: with
      // `noUncheckedIndexedAccess` off an out-of-range read types as `number`, so a guard on
      // `undefined` would read as dead code and removing it would leave this unbounded.
      if (codeOf(err) !== '40001' || attempt > RETRY_DELAYS_MS.length) throw err;
      await sleep(RETRY_DELAYS_MS[attempt - 1]);
    }
  }
}
