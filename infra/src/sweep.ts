// The daily sweep: what users cleared or left idle, collected through `collect.ts` with no write from
// them (*User schema and deletes*); a run out of time leaves the rest for the next (*Alerting*).
import { collect } from './collect';
import { connect } from './dsql';
import type { Budget, SqlClient } from './migrate';

/** Left unspent so the batch in flight ends before the function's timeout cuts the run line. */
const RESERVE_MS = 10_000;

// A staging is named by a pointer; how long it has idled is in `import_manifest`, which only the
// collector reads, so it takes every user with one and expires the idle ones itself.
const USERS = `SELECT u.user_id FROM app_user u
                WHERE u.import_dataset_id IS NOT NULL
                   OR EXISTS (SELECT 1 FROM dataset g WHERE g.user_id = u.user_id
                                AND g.id IS DISTINCT FROM u.dataset_id
                                AND g.id IS DISTINCT FROM u.import_dataset_id)
                ORDER BY u.user_id`;

/** Collects for each user with something to collect while `remainingMs` leaves more than the
 *  reserve; `false` when a collection failed. */
export async function sweep(client: SqlClient, remainingMs: () => number): Promise<boolean> {
  const more = () => remainingMs() > RESERVE_MS;
  const { rows } = await client.query<{ user_id: string }>(USERS);
  let clean = true;
  for (const { user_id: userId } of rows) {
    // With `more` false `collect` starts nothing, so the users left are passed over untouched.
    // `clean` last, so a failed user does not skip the next one's collection.
    clean = (await collect(client, userId, more)) && clean;
  }
  return clean;
}

export interface SweepEvent {
  /** Set by the schedule's own input alone: a hand `{}` runs the same sweep. */
  scheduled?: boolean;
}

/** The scheduled run's two lines, read by `SweepSilenceAlarm` and `SweepErrorAlarm` through
 *  metric filters: the function's own `Invocations` and `Errors` count a hand run too. [*Alerting*] */
const signal = (metric: 'sweepRun' | 'sweepRunFailed') =>
  console.log(JSON.stringify({ metric, value: 1 }));

export async function handler(event: SweepEvent, context: Budget): Promise<void> {
  const scheduled = event.scheduled === true;
  try {
    const client = await connect();
    try {
      const clean = await sweep(client, () => context.getRemainingTimeInMillis());
      if (scheduled) {
        signal('sweepRun');
        if (!clean) signal('sweepRunFailed');
      }
    } finally {
      await client.end().catch((err: unknown) => console.error('sweep disconnect failed', err));
    }
  } catch (err) {
    if (scheduled) signal('sweepRunFailed');
    throw err;
  }
}
