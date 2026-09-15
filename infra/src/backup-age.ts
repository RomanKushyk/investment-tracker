// How old the newest usable backup of one resource is, in hours.
//
// TWO STACKS READ THIS, which is why it is a module rather than a private
// function. The archive publishes it for its own cluster (`capture.ts`) and the
// user stack for prod's (`backup-freshness.ts`), each filtering recovery points
// by the cluster's OWN arn so that neither can make the other look fresh. That
// filter is the whole design; the rule for turning what comes back into a
// number is the same rule twice, and two copies of it would eventually disagree
// about what "backed up" means.
//
// Pure: no SDK client, no `process.env`, no clock of its own. `now` is a
// parameter so the rule is testable without one.

/** No usable recovery point. Deliberately large rather than 0 or -1: the metric
 *  is an AGE, so "nothing" has to sit on the bad side of any threshold. A zero
 *  would read as "backed up seconds ago", which is the exact inversion that
 *  makes a broken check look healthy. */
export const NO_BACKUP_HOURS = 9999;

/** The two fields of an AWS Backup recovery point this rule reads. Narrowed to
 *  them so a test supplies a literal rather than an SDK shape. */
export type RecoveryPoint = { Status?: string; CompletionDate?: Date };

export interface BackupAge {
  /** Hours since the newest completed point, or `NO_BACKUP_HOURS` if none. */
  value: number;
  /** What that age was measured from, for the log line. Null when nothing was. */
  completedAt: string | null;
}

export function backupAgeHours(points: RecoveryPoint[], now: Date): BackupAge {
  // Only COMPLETED counts. A job sitting in CREATING or PARTIAL is not something
  // anything can be restored from, and treating it as one would reproduce the
  // very failure this check exists to catch — with a NEWER timestamp, so it
  // wins if the status goes unread.
  const newest = points
    .filter((p) => p.Status === 'COMPLETED' && p.CompletionDate !== undefined)
    .reduce<Date | undefined>(
      (best, p) => (best === undefined || p.CompletionDate! > best ? p.CompletionDate! : best),
      undefined,
    );

  if (newest === undefined) return { value: NO_BACKUP_HOURS, completedAt: null };
  return {
    value: Math.round((now.getTime() - newest.getTime()) / 3_600_000),
    completedAt: newest.toISOString(),
  };
}
