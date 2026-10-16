// Keeps prod's user cluster Active for its nightly backup: AWS Backup refuses an Idle DSQL cluster,
// and a connection is what wakes one. Read-only and rolled back, so the session changes nothing.
//
// IT THROWS: a wake that did not happen is retried by Lambda, and a missed wake that costs a
// backup shows as `UserBackupAgeAlarm` (*Alerting*).
import { connect } from './dsql';
import type { SqlClient } from './migrate';

export async function wake(client: SqlClient): Promise<void> {
  await client.query('START TRANSACTION READ ONLY');
  await client.query('SELECT 1');
  await client.query('ROLLBACK');
}

export async function handler(): Promise<void> {
  const client = await connect();
  try {
    await wake(client);
  } finally {
    await client.end().catch((err: unknown) => console.error('backup-wake disconnect failed', err));
  }
}
