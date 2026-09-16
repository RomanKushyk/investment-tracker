import { BackupClient, ListRecoveryPointsByBackupVaultCommand } from '@aws-sdk/client-backup';

import { backupAgeHours, type BackupAge, type RecoveryPoint } from './backup-age';

// How old prod's user-data backup is, published nightly as a number.
//
// AN UNFILTERED READ CANNOT ANSWER THIS QUESTION AT ALL: one vault and one tag-matched selection
// hold every backed-up cluster, so AWS Backup's own vault-wide count would stay fresh on the
// ARCHIVE's nightly points while this cluster's had stopped. WHAT THIS WATCH CANNOT CATCH, and
// cannot be made to, is a deploy that resolved `IsProd` the other way — every resource of the
// watch hangs off that condition, so the same changeset deletes the alarm (*Alerting*).

/** Narrowed to the one call this file makes, so a test injects a double rather than the SDK. */
export type VaultReader = {
  listRecoveryPoints(input: {
    BackupVaultName: string;
    ByResourceArn: string;
  }): Promise<{ RecoveryPoints?: RecoveryPoint[] }>;
};

export interface Target {
  /** Named, not referenced: the vault is outside both stacks on purpose — one inside the stack it
   *  protects dies with it. `scripts/bootstrap-backups.sh` creates it. */
  vault: string;
  /** THE FILTER. Against the other wrong filter — this cluster's OLD arn, kept across a
   *  replacement — it is what makes the replacement read as "no recovery point" that same night. */
  clusterArn: string;
  /** The metric dimension that keeps this series and the archive's apart under one metric name. */
  cluster: string;
}

export interface Freshness extends BackupAge {
  metric: 'backupAgeHours';
  cluster: string;
  vault: string;
}

/**
 * This throws where the capture's equivalent does not: a capture has a perishable price to write
 * first, while this has no other work, so swallowing the error would swallow the invocation while
 * reporting success. A throw is no signal on its own — hence `BackupFreshnessErrorAlarm` beside
 * the other two — and the failure is not papered over by publishing `NO_BACKUP_HOURS`, which
 * means "no recovery point exists", never "we could not ask".
 */
export async function backupFreshness(
  backup: VaultReader,
  target: Target,
  now = new Date(),
): Promise<Freshness> {
  const page = await backup.listRecoveryPoints({
    BackupVaultName: target.vault,
    ByResourceArn: target.clusterArn,
  });
  const age = backupAgeHours(page.RecoveryPoints ?? [], now);
  // The log line IS the metric: `UserBackupAgeMetricFilter` reads `$.value` off it and dimensions
  // by `$.cluster`. Published on every run, or it cannot tell "fine" from "it stopped running".
  const line: Freshness = {
    metric: 'backupAgeHours',
    cluster: target.cluster,
    vault: target.vault,
    ...age,
  };
  console.log(JSON.stringify(line));
  return line;
}

/** Read per invocation, so a container that started before a value changed cannot hold it. An
 *  absent arn is worse than broken: the read would be unfiltered and answer with the ARCHIVE's. */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

const client = new BackupClient({});

const sdk: VaultReader = {
  listRecoveryPoints: (input) => client.send(new ListRecoveryPointsByBackupVaultCommand(input)),
};

export const handler = () =>
  backupFreshness(sdk, {
    vault: required('BACKUP_VAULT_NAME'),
    clusterArn: required('DSQL_CLUSTER_ARN'),
    cluster: required('DSQL_CLUSTER_ID'),
  });
