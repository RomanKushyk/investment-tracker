# infra — durability: backups, PITR, Vault Lock

> Moved **verbatim** from [`../README.md`](../README.md) on 2026-08-26 (D95). Measured, not assumed. **The restore was exercised** — read it before changing anything about backups.

## Durability — measured 2026-08-11, not assumed

The Phase 2 gate in `docs/superpowers/specs/2026-08-04-cloud-stack-and-cost.md`
asked whether DSQL is durable enough to hold the archive, or whether price
history belongs in S3 + CloudFront instead. It was answered by taking a real
backup and restoring it, because a backup that has never been restored is a
belief rather than a backup. **The gate passes** (D48).

| | Measured |
|---|---|
| Backup | 3 min 48 s for 34.6 MiB / 6 630 rows |
| Restore | 2 min 19 s, to a brand-new cluster |
| RTO | under ~10 min end to end, plus repointing whatever reads it |
| RPO | **one capture** — bounded by the backup schedule, not by DSQL |

Four properties of DSQL backup that are not obvious and shape everything above:

- **There is no PITR.** `GetCluster` returns no backup or PITR field of any
  kind — only status, deletion protection, KMS key and endpoint. Continuous
  backup is an AWS Backup feature for RDS/Aurora/S3; a DSQL recovery point is a
  **full** backup, never incremental. So the recovery point interval *is* the
  RPO, which is why the plan runs 45 minutes after the capture rather than at
  some round hour: it shrinks the window in which a captured day exists but is
  not yet backed up from ~23 hours to ~45 minutes.
- **Backup and restore are AWS Backup only** — not the DSQL console, not the
  DSQL API. Nothing in `aws dsql` will show you a backup.
- **Granularity is the whole cluster.** No table-level or row-level restore.
- **A restore creates a NEW cluster**; it never overwrites the source. Recovery
  is therefore always "restore, verify, repoint", and the new cluster arrives
  with deletion protection already on.

**Until 2026-08-11 the archive had no backup at all** — zero vaults, zero
plans, zero jobs — while looking entirely healthy, which is the same shape of
failure as the dead alert channel found the same day.

### First scheduled night, measured 2026-08-12

The plan fired at 01:45 Europe/Kyiv exactly as scheduled and completed in 21
minutes — against 3 min 48 s for the hand-run backup. The difference is start
latency inside the 60-minute start window, not work: the recovery point is the
same size class (36.5 MB, up 200 KB on the day's captures and the 408
observations).

**`BackupAgeHours` reads ~23 in steady state, not ~0**, and the reason is
ordering: the capture runs at 01:00 and reports the age of the backup taken at
01:45 the *previous* night. The first night read `2`, because the newest
recovery point was still the hand-run one from a few hours earlier.

That is what the 48-hour threshold actually buys: **one missed night of slack,
not two.** A skipped backup takes the value to ~47 and stays quiet; two
consecutive misses reach ~71 and alarm. This is the intended behaviour — a
daily plan with a start window must not page for a single late night — but
"48" should not be read as "two days".

Backing the archive up *before* the day's capture would make the number look
fresher and the RPO worse, so the order stays as it is.

Two traps met while proving it, both worth an hour to whoever meets them next:

- `StartRestoreJob` rejects the metadata `GetRecoveryPointRestoreMetadata`
  hands you. It returns `cluster_id`, and the restore accepts only
  `regionalconfig`, `witnessregion`, `aws:backup:request-id` and
  `usemultiregionorchestration`. `{"usemultiregionorchestration": "false"}`
  works.
- **Verifying a restore needs a read path to a cluster nothing is configured
  for.** The capture role holds `dsql:DbConnectAdmin` on exactly one ARN, so the
  check was a temporary second inline policy plus an env swap, reverted in the
  same call. Allow ~25 s for IAM propagation — a 3-second wait fails with an
  unhandled error that looks like a code fault, not a permission one.

### Vault Lock, applied 2026-08-25 (D89)

Until this date the vault had no lock: `Locked: false`, and a single
`delete-recovery-point` was all that stood between the archive and nothing.
The routine AWS sweep that found it also found the rest of the stack healthy,
which is the point — this is the same shape as D44/D49, a gap that reads green
because nothing has been attempted against it.

| Setting | Value | Why |
|---|---|---|
| Mode | **GOVERNANCE** | `LockDate: null`. Compliance is unremovable by anyone including AWS, and the schema is still moving (W3/W4) |
| `MinRetentionDays` | **35** | Read from the live plan, not written as a literal. Equal passes — AWS allows a job retention "equal to or longer" than the floor |
| `MaxRetentionDays` | **null** | Weakening retention is worth forbidding; lengthening it is not |

**What it actually buys, stated as what it is.** Deleting a recovery point stops
being one command and becomes two — lift the lock, then delete. It does **not**
stop this account's human admin, who holds
`backup:DeleteBackupVaultLockConfiguration`; nothing short of compliance mode
would, and compliance mode costs more than it buys here. It stops the accident,
and it stops every principal without that permission — which is every role in
this account other than the human one.

**Proved by attempting it, 2026-08-25** — for the same reason D48 restored a
backup rather than trusting one. The vault holds 15 recovery points: 14 nightly
ones (`CreatedBy` naming the plan) and **exactly one on-demand** at
2026-08-18 12:47, `CreatedBy: null`. It happens to be the same size as that
day's scheduled point (36 635 253 B both), so deleting it would have cost a
duplicate of a day that stays covered — the only safe target in the vault.
`delete-recovery-point` was pointed at it, as admin:

```
InvalidRequestException: RecoveryPoint cannot be deleted or updated
(Backup vault configured with Lock)
```

Refused, exit 254. Count still 15, the target still `COMPLETED`. A configured
lock and a lock that refuses are two different claims, and only the second one
is now on the record.

**Why that on-demand point exists is not recorded anywhere**, and this file will
not guess: it is not the durability-test backup, which was taken 2026-08-11 at
34.6 MiB and no longer exists. Worth knowing because it also carries **no
lifecycle at all** (`Lifecycle: {}`, no `DeleteAt`) where every scheduled point
carries `DeleteAfterDays: 35` — so unlike the other 14 it never expires, and
under the lock its lifecycle can no longer be set.

**That last part is the consequence most likely to bite.** Vault Lock does not
only stop deletion; AWS: it "prevents attempts to update the lifecycle policy
that controls the retention period of any recovery point currently stored in a
backup vault." So the existing points keep the retention they were written with
— the 14 nightly ones expire on schedule, the on-demand one never does — and
none of it can be changed while the lock stands. In the cluster-rebuild scenario
D89 names as live, draining the vault by shortening retention is exactly the
obvious move that now requires lifting the lock first.

The floor does not apply retroactively, which is a narrower statement than it
looks: AWS does not re-measure points saved before the lock against
`MinRetentionDays`. That is about enforcement, not about mutability.
