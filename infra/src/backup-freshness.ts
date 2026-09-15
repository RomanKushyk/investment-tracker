import { BackupClient, ListRecoveryPointsByBackupVaultCommand } from '@aws-sdk/client-backup';

import { backupAgeHours, type BackupAge, type RecoveryPoint } from './backup-age';

// How old prod's user-data backup is, published nightly as a number.
//
// WHY IT IS ITS OWN FUNCTION AND ITS OWN STACK. The archive's capture already
// runs this check — for the ARCHIVE, filtered by the archive cluster's own arn,
// deliberately, so that a second cluster's backup cannot make the archive look
// fresh. The other half of that decision was that prod's user cluster was
// watched by nothing: it carries `app=quirenote` and so lands in the locked
// vault, but a cluster that stops producing recovery points looks exactly like
// one that never needed any.
//
// WHAT THIS CATCHES AND WHAT IT CANNOT, stated plainly because the issue behind
// it named two failure modes and this covers one and a half. A cluster REPLACED,
// or dropped from the selection by a tag edited outside CloudFormation, keeps
// the watch deployed: the age climbs past 48 hours and the alarm fires. A deploy
// that resolved `IsProd` the other way does NOT get caught here, and cannot be —
// the tag and every resource of this watch hang off that one condition, so the
// same changeset that re-tags the cluster deletes the alarm, and a deleted alarm
// is silent. What refuses that deploy is elsewhere and is not monitoring: the
// pool's domain and the API's domain would have to move to hostnames the dev
// stack already owns, so the update fails on the collision and rolls back. Note
// what that is NOT — an ordering guarantee. Nothing sequences the cluster's tag
// after those domains, and CloudFormation updates independent resources in
// parallel, so the tag may well flip first; what restores it is the rollback,
// not the order.
//
// Teaching the capture a second cluster was the other option and is refused:
// it is the archive's function, it lives in the archive's stack, and coupling
// the two halves is what the dev/prod split exists to prevent. What the two DO
// share is the rule for reading an age out of a vault — `backup-age.ts`.
//
// AND IT IS NOT A VAULT-WIDE COUNT, which would need no code at all. There is
// one vault and one tag-matched selection, so AWS Backup's own
// `NumberOfRecoveryPointsCompleted` holds both clusters in one number: the
// archive's nightly job would keep it up while this cluster's backups had
// stopped. That is the failure this file exists for, not a lesser version of it.

/** Narrowed to the one call this file makes, so a test injects a double rather
 *  than the SDK — the shape `pre-signup.ts` takes its `IdentityClient` in. */
export type VaultReader = {
  listRecoveryPoints(input: {
    BackupVaultName: string;
    ByResourceArn: string;
  }): Promise<{ RecoveryPoints?: RecoveryPoint[] }>;
};

export interface Target {
  /** Named, not referenced: the vault is outside both stacks on purpose — one
   *  inside the stack it protects dies with it. `scripts/bootstrap-backups.sh`
   *  creates it. */
  vault: string;
  /** THE FILTER, and the whole point of the file. An unfiltered read cannot
   *  answer this question at all: one vault and one tag-matched selection hold
   *  every backed-up cluster, so the ARCHIVE's nightly points would keep a
   *  vault-wide age fresh while this cluster's had stopped. And against the other
   *  wrong filter — this cluster's OLD arn, kept across a replacement — it is what
   *  makes the replacement read as "no recovery point" that same night, where a
   *  stale arn would age out of the surviving points over the two days after. */
  clusterArn: string;
  /** The metric's `cluster` dimension. It is what keeps this series and the
   *  archive's apart under one metric name. */
  cluster: string;
}

export interface Freshness extends BackupAge {
  metric: 'backupAgeHours';
  cluster: string;
  vault: string;
}

/**
 * Read the vault, publish the age.
 *
 * THIS ONE THROWS WHERE THE CAPTURE'S EQUIVALENT DOES NOT, and the difference is
 * what each function is for. A capture must not fail because a monitoring read
 * did — it has a perishable price to write first. This function has no other
 * work, so swallowing the error would swallow the whole invocation while
 * reporting success.
 *
 * A THROW ON ITS OWN IS NOT A SIGNAL, which is why `BackupFreshnessErrorAlarm`
 * exists beside the other two: `Invocations` counts a failed invocation as
 * readily as a successful one, so the silence alarm cannot see this, and no age
 * is published, so the age alarm cannot either. Three alarms, three faults.
 *
 * AND THE FAILURE IS NOT PAPERED OVER BY PUBLISHING `NO_BACKUP_HOURS`. That value
 * means "no recovery point exists" and must not be made to mean "we could not
 * ask" — an alarm firing with the wrong first hypothesis sends whoever reads it
 * to AWS Backup when the fault is an IAM grant.
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
  // The log line IS the metric: `UserBackupAgeMetricFilter` reads `$.value` off
  // it and dimensions the datapoint by `$.cluster`. Published on every run,
  // healthy or not — a signal that appears only on failure cannot tell "fine"
  // from "the check stopped running".
  const line: Freshness = {
    metric: 'backupAgeHours',
    cluster: target.cluster,
    vault: target.vault,
    ...age,
  };
  console.log(JSON.stringify(line));
  return line;
}

/** Read per invocation rather than at module load, so a value cannot be captured
 *  by a container that started before it changed. An absent one is a broken
 *  deploy, not a state to tolerate: with no arn the read is unfiltered and would
 *  answer with the ARCHIVE's recovery points, which is the one wrong answer that
 *  looks right. */
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
