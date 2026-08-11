#!/usr/bin/env bash
# Create the AWS Backup vault, role, plan and selection that protect the DSQL
# price archive.
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

echo
echo "recovery points:"
aws backup list-recovery-points-by-backup-vault --backup-vault-name "$VAULT" \
  --region "$REGION" \
  --query 'RecoveryPoints[].[Status,BackupSizeInBytes,CreationDate]' --output text

echo
echo "done"
