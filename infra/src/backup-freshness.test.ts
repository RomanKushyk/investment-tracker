import { describe, expect, it, vi } from 'vitest';

import { NO_BACKUP_HOURS } from './backup-age';
import { backupFreshness, type VaultReader } from './backup-freshness';

// `backup-age.test.ts` holds the RULE. This file holds the two things only the
// handler can get wrong: which recovery points it asks for, and whether a read
// it could not make is allowed to look like an answer.

const NOW = new Date('2026-09-15T12:00:00Z');
const TARGET = {
  vault: 'quirenote-backups',
  clusterArn: 'arn:aws:dsql:::cluster/user',
  cluster: 'abc',
};

const vault = (points: { Status?: string; CompletionDate?: Date }[]) => {
  const asked: { BackupVaultName: string; ByResourceArn: string }[] = [];
  const reader: VaultReader = {
    listRecoveryPoints: async (input) => {
      asked.push(input);
      return { RecoveryPoints: points };
    },
  };
  return { reader, asked };
};

describe('backupFreshness', () => {
  // THE ASSERTION THIS FILE EXISTS FOR. An unfiltered read answers with the whole
  // vault — which holds the ARCHIVE's recovery points under the same tag-matched
  // selection — so losing `ByResourceArn` would report prod's user data as freshly
  // backed up on a night none of it was. That is the one wrong answer that looks
  // right, and it is invisible to every other test here: the template can only
  // show that the arn reaches the function's environment.
  it('asks only for THIS cluster’s recovery points', async () => {
    const { reader, asked } = vault([]);
    await backupFreshness(reader, TARGET, NOW);
    expect(asked).toEqual([{ BackupVaultName: TARGET.vault, ByResourceArn: TARGET.clusterArn }]);
  });

  it('publishes the age, the cluster and the vault as one line', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { reader } = vault([
        { Status: 'COMPLETED', CompletionDate: new Date('2026-09-15T02:00:00Z') },
      ]);
      const line = await backupFreshness(reader, TARGET, NOW);
      expect(line).toEqual({
        metric: 'backupAgeHours',
        cluster: TARGET.cluster,
        vault: TARGET.vault,
        value: 10,
        completedAt: '2026-09-15T02:00:00.000Z',
      });
      // The log line IS the metric — `UserBackupAgeMetricFilter` reads `$.value`
      // off it and dimensions by `$.cluster`, so a line that stopped being
      // emitted, or stopped being JSON, would leave the alarm on an empty series
      // with nothing else reporting it.
      expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual(line);
    } finally {
      log.mockRestore();
    }
  });

  it('reports no backup at all rather than a fresh one', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { reader } = vault([]);
      expect((await backupFreshness(reader, TARGET, NOW)).value).toBe(NO_BACKUP_HOURS);
    } finally {
      log.mockRestore();
    }
  });

  // IT THROWS WHERE THE CAPTURE'S EQUIVALENT WARNS, and the difference is what
  // each function is for: a capture must not fail because a monitoring read did,
  // because it has a perishable price to write first. This one has no other work,
  // so a swallowed error would be a successful-looking invocation that measured
  // nothing — and `BackupFreshnessErrorAlarm` is what turns the throw into a
  // signal rather than a log line.
  it('lets a failed read out rather than reporting it as an answer', async () => {
    const reader: VaultReader = {
      listRecoveryPoints: async () => {
        throw new Error('AccessDeniedException');
      },
    };
    await expect(backupFreshness(reader, TARGET, NOW)).rejects.toThrow('AccessDeniedException');
  });
});
