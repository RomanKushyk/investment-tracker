#!/usr/bin/env bash
# Create the AWS Backup vault, role, plan, selection and vault lock that protect
# the DSQL price archive.
#
# One-time bootstrap. Run it in AWS CloudShell, which already has credentials —
# there are deliberately none on the development machine (see infra/README.md).
#
# Usage:  bash infra/scripts/bootstrap-backups.sh
#
# Idempotent: re-running re-applies settings and exits cleanly.
#
# WHY THIS IS NOT IN template.yaml
#
# A backup that lives inside the stack it protects is deleted by the accident it
# exists for. `sam deploy` rolling back, a stack delete, a bad changeset — each
# would take the vault and every recovery point with it, at exactly the moment
# they are wanted. Backups are deliberately outside the blast radius of the
# thing being backed up. This is the same reasoning as DeletionPolicy: Retain on
# the cluster, applied one level up.
#
# The secondary reason is smaller but real: the stack's execution role would
# need a whole new `backup:*` permission family, and that role is the one place
# in this account where widening is least reversible.
set -euo pipefail

REGION="${REGION:-eu-north-1}"
VAULT="quirenote-backups"
ROLE="quirenote-backup-service"
PLAN="quirenote-archive-daily"

# Derived, never hardcoded — this repo is PUBLIC (see bootstrap-account.sh).
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE}"

echo "region: ${REGION}"
echo "vault:  ${VAULT}"

# --- Service role -----------------------------------------------------------
#
# AWS Backup assumes this to read the cluster and to write a restored one. The
# two AWS-managed policies are the documented pair; writing them by hand buys
# nothing and drifts as AWS adds resource types.
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "-> role already exists"
else
  aws iam create-role \
    --role-name "$ROLE" \
    --description "AWS Backup service role for the Quirenote DSQL price archive." \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": { "Service": "backup.amazonaws.com" },
        "Action": "sts:AssumeRole"
      }]
    }' >/dev/null
  echo "-> role created"
fi
for p in AWSBackupServiceRolePolicyForBackup AWSBackupServiceRolePolicyForRestores; do
  aws iam attach-role-policy --role-name "$ROLE" \
    --policy-arn "arn:aws:iam::aws:policy/service-role/${p}"
done

# --- Vault ------------------------------------------------------------------
aws backup create-backup-vault --backup-vault-name "$VAULT" --region "$REGION" \
  >/dev/null 2>&1 || echo "-> vault already exists"

# --- Plan -------------------------------------------------------------------
#
# 22:45 UTC, 45 minutes after the 22:00 UTC capture (01:00 Kyiv). The gap is
# what matters: DSQL has no PITR (measured — GetCluster exposes no such field),
# so the recovery point interval IS the RPO. Backing up shortly after the one
# daily write means the window in which a captured day exists but is not yet
# backed up is ~45 minutes a day rather than ~23 hours.
#
# 35 days is the maximum retention that avoids cold storage, whose 90-day
# minimum would make a delete cost more than keeping it. ~35 MB per full
# recovery point (they are FULL, not incremental) puts 35 days near 1.2 GB.
PLAN_ID="$(aws backup list-backup-plans --region "$REGION" \
  --query "BackupPlansList[?BackupPlanName=='${PLAN}'].BackupPlanId | [0]" \
  --output text 2>/dev/null || echo None)"

if [[ "$PLAN_ID" == "None" || -z "$PLAN_ID" ]]; then
  PLAN_ID="$(aws backup create-backup-plan --region "$REGION" \
    --backup-plan '{
      "BackupPlanName": "'"${PLAN}"'",
      "Rules": [{
        "RuleName": "daily-after-capture",
        "TargetBackupVaultName": "'"${VAULT}"'",
        "ScheduleExpression": "cron(45 22 * * ? *)",
        "ScheduleExpressionTimezone": "Etc/UTC",
        "StartWindowMinutes": 60,
        "CompletionWindowMinutes": 180,
        "Lifecycle": { "DeleteAfterDays": 35 }
      }]
    }' --query BackupPlanId --output text)"
  echo "-> plan created"
fi
echo "plan:   ${PLAN_ID}"

# --- Selection --------------------------------------------------------------
#
# By TAG, not by ARN. DSQL cluster IDs are generated rather than named, so a
# recreated cluster gets a new ARN — and an ARN-pinned selection would then back
# up nothing, silently, which is the exact failure mode the alerting work of
# 2026-08-11 was about. The tag is set by template.yaml, so a replacement
# cluster is covered the moment it exists.
HAVE="$(aws backup list-backup-selections --backup-plan-id "$PLAN_ID" --region "$REGION" \
  --query "BackupSelectionsList[?SelectionName=='quirenote-dsql-by-tag'] | length(@)" \
  --output text)"
if [[ "$HAVE" == "0" ]]; then
  aws backup create-backup-selection --backup-plan-id "$PLAN_ID" --region "$REGION" \
    --backup-selection '{
      "SelectionName": "quirenote-dsql-by-tag",
      "IamRoleArn": "'"${ROLE_ARN}"'",
      "ListOfTags": [{
        "ConditionType": "STRINGEQUALS",
        "ConditionKey": "app",
        "ConditionValue": "quirenote"
      }]
    }' >/dev/null
  echo "-> selection created"
else
  echo "-> selection already exists"
fi

# --- Vault Lock -------------------------------------------------------------
#
# Why governance rather than compliance, and why a minimum with no maximum: D89.
#
# The one thing that must not be got wrong from inside this file:
# --changeable-for-days is ABSENT on purpose. Passing it — any value, minimum 3
# — makes the lock COMPLIANCE, which nobody can lift afterwards, AWS included.
# There is no --mode argument to get wrong, so the mistake looks like a harmless
# extra flag rather than a permanent one.
#
# The floor is derived from the live plan rather than written here, because the
# plan block above only ever CREATES: on a re-run an existing plan is left alone,
# so a literal here could sit above a retention that never moved. AWS does not
# warn about floor > retention — it FAILS every nightly job in silence until
# BackupAgeHours crosses 48 two nights later.
#
# Deriving removes the route to that state THROUGH THIS FILE. It does not make
# the state unreachable, and the difference matters: editing the plan directly to
# shorten retention below the standing floor still reaches it, and nothing here
# re-derives afterwards. Shortening retention is exactly the move a cluster
# rebuild invites, so treat the floor as something to lower FIRST.
#
# min() across the rules that actually target this vault: rule order is not
# contractual, and a plan may feed a vault this script does not lock.
LOCK_FLOOR="$(aws backup get-backup-plan --backup-plan-id "$PLAN_ID" --region "$REGION" \
  --query "min(BackupPlan.Rules[?TargetBackupVaultName=='${VAULT}'].Lifecycle.DeleteAfterDays)" \
  --output text 2>/dev/null || echo None)"
WAS_LOCKED="$(aws backup describe-backup-vault --backup-vault-name "$VAULT" --region "$REGION" \
  --query 'Locked' --output text 2>/dev/null || echo None)"

if [[ "$LOCK_FLOOR" == "None" ]]; then
  echo "!! no rule targets ${VAULT} with a DeleteAfterDays — refusing to set a floor" >&2
else
  # Say which of the two this is. Re-locking a vault someone lifted ON PURPOSE —
  # the two-step act D89 designs for, used to change lifecycles during a rebuild
  # — is the one re-run that is not harmless, so it never happens silently.
  if [[ "$WAS_LOCKED" == "True" ]]; then
    echo "-> vault already locked; re-applying floor ${LOCK_FLOOR}d"
  else
    echo "-> vault was UNLOCKED; applying governance lock, floor ${LOCK_FLOOR}d"
  fi
  aws backup put-backup-vault-lock-configuration \
    --backup-vault-name "$VAULT" --region "$REGION" \
    --min-retention-days "$LOCK_FLOOR" \
    || echo "!! put-backup-vault-lock-configuration FAILED" >&2
fi

# Read back rather than announce. D89 exists because a vault everyone believed
# was protected read Locked: false, so a script that printed "lock applied" on
# any 2xx would be reproducing the defect it was written for. LockDate is the
# tell: null is governance, a date is compliance.
echo
echo "vault lock:"
aws backup describe-backup-vault --backup-vault-name "$VAULT" --region "$REGION" \
  --query '{Locked:Locked,LockDate:LockDate,Min:MinRetentionDays,Max:MaxRetentionDays}' \
  --output json

echo
echo "recovery points:"
aws backup list-recovery-points-by-backup-vault --backup-vault-name "$VAULT" \
  --region "$REGION" \
  --query 'RecoveryPoints[].[Status,BackupSizeInBytes,CreationDate]' --output text

# Assert, do not merely print — printing the state and exiting 0 regardless is
# the same defect one layer down. Last, so the diagnostics above are always
# available when this fires.
echo
NOW_LOCKED="$(aws backup describe-backup-vault --backup-vault-name "$VAULT" --region "$REGION" \
  --query 'Locked' --output text 2>/dev/null || echo None)"
if [[ "$NOW_LOCKED" != "True" ]]; then
  echo "!! ${VAULT} is NOT locked — the archive is one delete-recovery-point from loss" >&2
  exit 1
fi

echo "done"
