# infra/ — the AWS backend

Phase 1 only: a daily job that captures the Inzhur price feed into Aurora DSQL.
Design and rationale live in `docs/superpowers/specs/` —
`2026-08-04-cloud-stack-and-cost.md` (why this stack) and
`2026-08-04-data-model.md` (what is stored and why).

**The app does not read any of this yet.** Nothing in `src/` knows the backend
exists. Phase 1 buys one thing: prices stop being lost on days the app is not
opened, because the provider publishes no history and a missed day is
permanently unrecoverable.

## Layout

| Path | What |
|---|---|
| `template.yaml` | SAM stack: DSQL cluster, capture Lambda, schedule, DLQ, alarms |
| `src/capture.ts` | The handler. Imports the parser from `src/core` — never a second copy |
| `migrations/` | Reference DDL. The handler applies it idempotently on cold start |
| `scripts/bootstrap-backups.sh` | AWS Backup vault, role, plan, selection — deliberately outside the stack |

## Local rules

- **Never add a VPC.** A NAT Gateway is ~$33/month — roughly 1600× the rest of
  the stack. DSQL is a public IAM-authenticated endpoint and Lambda has internet
  egress by default, so nothing here needs one.
- **Never enable provisioned concurrency or SnapStart.** Both void Lambda's
  always-free tier for that function. Fix cold starts with `Timeout`, not these.
- **The parser is imported from `src/core`, never reimplemented.** Two parsers
  eventually disagree about a price, and only one of them is tested.
- **One DDL statement per transaction, and DDL never shares a transaction with
  DML** — a DSQL constraint, not a style choice. Same for `CREATE INDEX ASYNC`.
- **`price_capture` rows are append-only.** A row is written on every run,
  including failures: this table, not the absence of a price row, is what
  answers "did the job run".
- **Backups stay OUT of `template.yaml`.** A vault inside the stack it protects
  is destroyed by the accident it exists for. See `scripts/bootstrap-backups.sh`.
- **The backup selection matches on the `app=quirenote` TAG, never an ARN.**
  DSQL cluster IDs are generated, so a recreated cluster gets a new ARN and an
  ARN-pinned selection would back up nothing without saying so.

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

## Deploying

Region: **`eu-north-1`** — same as Amplify. Aurora DSQL is available there
(`dsql.eu-north-1.api.aws`); DSQL is PostgreSQL 16 compatible.

Deployed by GitHub Actions, not from a developer machine — there are no AWS
credentials locally and there should not be. See `docs/reference/DEPLOYMENT.md`.

The backend uses its **own** OIDC role, separate from `quirenote-frontend-deploy`,
so the existing frontend deploy role stays unable to touch hosting config
(D15).

### One-time console setup

Two roles, deliberately. The GitHub role can do almost nothing by itself — it
may only drive CloudFormation on one named stack and hand it the execution
role. The broad permissions live on the execution role, which only
CloudFormation can assume. This is what keeps a compromised workflow from
creating arbitrary resources, and it is the reason not to use CDK here: CDK's
bootstrap execution role is `AdministratorAccess` by default.

The OIDC provider already exists from the frontend setup
(`docs/reference/DEPLOYMENT.md` §1.4) — do not create a second one.

The two roles below are the ones in use. They replaced a `kubushka-backend-*`
pair on 2026-08-11 (D42/D46); the old pair is deleted and only these exist.
Replace `<account-id>` with the account's own id — it is deliberately not
written down in this repository, which is public.

Three things about their shape are worth knowing, and one is a trap:

- the exec policy scopes **eight** ARN patterns — `cloudformation`, `lambda`,
  `iam`, `logs`, `sqs`, `sns`, `cloudwatch`, `scheduler` — and every one of
  them carries the `quirenote-backend-*` prefix SAM derives from the stack
  name;
- the SAM artifacts bucket is `quirenote-sam-artifacts-<account-id>`, holding
  only disposable upload artifacts;
- **the DSQL resource stays `cluster/*`** — DSQL cluster IDs are generated, not
  named, so there is no prefix to change. A consequence worth knowing during E3:
  the new exec role can therefore reach the *old* cluster too. CloudFormation
  will not touch it, because it is not in the new stack, but the teardown does
  not need extra permission either.

The trust policy keys on the **environment** rather than the branch, and the
owner/repo carry immutable numeric IDs. Both traps are documented at length in
`docs/reference/DEPLOYMENT.md` §1.5.

### The artifacts bucket, if the account is ever rebuilt

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws s3api create-bucket \
  --bucket "quirenote-sam-artifacts-${ACCOUNT_ID}" \
  --region eu-north-1 \
  --create-bucket-configuration LocationConstraint=eu-north-1
aws s3api put-public-access-block \
  --bucket "quirenote-sam-artifacts-${ACCOUNT_ID}" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

`bootstrap-account.sh` does this; the commands are here because a bucket that
does not exist fails the deploy with an error that names S3 rather than the
missing bucket.

### Role 1 — `quirenote-backend-deploy`

Trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": "repo:RomanKushyk@97728952/investment-tracker@1313804031:environment:*" }
    }
  }]
}
```

Inline permission policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DriveTheStack",
      "Effect": "Allow",
      "Action": ["cloudformation:CreateStack", "cloudformation:UpdateStack",
                 "cloudformation:DescribeStacks", "cloudformation:DescribeStackEvents",
                 "cloudformation:DescribeStackResources", "cloudformation:GetTemplateSummary",
                 "cloudformation:CreateChangeSet", "cloudformation:DescribeChangeSet",
                 "cloudformation:ExecuteChangeSet", "cloudformation:DeleteChangeSet",
                 "cloudformation:ListStackResources"],
      "Resource": ["arn:aws:cloudformation:eu-north-1:<account-id>:stack/quirenote-backend/*",
                   "arn:aws:cloudformation:eu-north-1:aws:transform/Serverless-2016-10-31"]
    },
    {
      "Sid": "HandOffToCloudFormationOnly",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::<account-id>:role/quirenote-backend-cfn-exec",
      "Condition": { "StringEquals": { "iam:PassedToService": "cloudformation.amazonaws.com" } }
    },
    {
      "Sid": "SamArtifacts",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::quirenote-sam-artifacts-<account-id>",
                   "arn:aws:s3:::quirenote-sam-artifacts-<account-id>/*"]
    }
  ]
}
```

### Role 2 — `quirenote-backend-cfn-exec`

Trust policy — CloudFormation only:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "cloudformation.amazonaws.com" },
    "Action": "sts:AssumeRole",
    "Condition": { "StringEquals": { "aws:SourceAccount": "<account-id>" } }
  }]
}
```

Inline permission policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Database",
      "Effect": "Allow",
      "Action": ["dsql:CreateCluster", "dsql:GetCluster", "dsql:UpdateCluster",
                 "dsql:DeleteCluster", "dsql:TagResource", "dsql:UntagResource",
                 "dsql:ListTagsForResource", "dsql:PutMultiRegionProperties",
                 "dsql:GetClusterPolicy", "dsql:PutClusterPolicy",
                 "dsql:DeleteClusterPolicy", "dsql:GetVpcEndpointServiceName"],
      "Resource": "arn:aws:dsql:eu-north-1:<account-id>:cluster/*"
    },
    {
      "Sid": "Function",
      "Effect": "Allow",
      "Action": ["lambda:CreateFunction", "lambda:DeleteFunction", "lambda:GetFunction",
                 "lambda:GetFunctionConfiguration", "lambda:UpdateFunctionCode",
                 "lambda:UpdateFunctionConfiguration", "lambda:AddPermission",
                 "lambda:RemovePermission", "lambda:GetPolicy",
                 "lambda:PutFunctionConcurrency", "lambda:DeleteFunctionConcurrency",
                 "lambda:TagResource", "lambda:UntagResource", "lambda:ListTags"],
      "Resource": "arn:aws:lambda:eu-north-1:<account-id>:function:quirenote-backend-*"
    },
    {
      "Sid": "RolesTheStackOwns",
      "Effect": "Allow",
      "Action": ["iam:CreateRole", "iam:DeleteRole", "iam:GetRole",
                 "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy",
                 "iam:AttachRolePolicy", "iam:DetachRolePolicy",
                 "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
                 "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole",
                 "iam:PassRole"],
      "Resource": "arn:aws:iam::<account-id>:role/quirenote-backend-*"
    },
    {
      "Sid": "Logs",
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup", "logs:DeleteLogGroup",
                 "logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy",
                 "logs:TagResource", "logs:UntagResource", "logs:ListTagsForResource",
                 "logs:PutMetricFilter", "logs:DeleteMetricFilter",
                 "logs:DescribeMetricFilters"],
      "Resource": "arn:aws:logs:eu-north-1:<account-id>:log-group:/aws/lambda/quirenote-backend-*"
    },
    {
      "Sid": "DeadLetterQueue",
      "Effect": "Allow",
      "Action": ["sqs:CreateQueue", "sqs:DeleteQueue", "sqs:GetQueueAttributes",
                 "sqs:SetQueueAttributes", "sqs:GetQueueUrl", "sqs:TagQueue",
                 "sqs:UntagQueue", "sqs:ListQueueTags"],
      "Resource": "arn:aws:sqs:eu-north-1:<account-id>:quirenote-backend-*"
    },
    {
      "Sid": "AlertTopic",
      "Effect": "Allow",
      "Action": ["sns:CreateTopic", "sns:DeleteTopic", "sns:GetTopicAttributes",
                 "sns:SetTopicAttributes", "sns:Subscribe", "sns:Unsubscribe",
                 "sns:ListSubscriptionsByTopic", "sns:TagResource",
                 "sns:UntagResource", "sns:ListTagsForResource"],
      "Resource": "arn:aws:sns:eu-north-1:<account-id>:quirenote-backend-*"
    },
    {
      "Sid": "Alarms",
      "Effect": "Allow",
      "Action": ["cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms",
                 "cloudwatch:TagResource", "cloudwatch:UntagResource",
                 "cloudwatch:ListTagsForResource"],
      "Resource": "arn:aws:cloudwatch:eu-north-1:<account-id>:alarm:quirenote-backend-*"
    },
    {
      "Sid": "Schedule",
      "Effect": "Allow",
      "Action": ["scheduler:CreateSchedule", "scheduler:GetSchedule",
                 "scheduler:UpdateSchedule", "scheduler:DeleteSchedule",
                 "scheduler:TagResource", "scheduler:UntagResource",
                 "scheduler:ListTagsForResource"],
      "Resource": "arn:aws:scheduler:eu-north-1:<account-id>:schedule/default/quirenote-backend-*"
    },
    {
      "Sid": "ReadTemplateAndArtifacts",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:GetObjectVersion"],
      "Resource": "arn:aws:s3:::quirenote-sam-artifacts-<account-id>/*"
    },
    {
      "Sid": "ApplyTheSamTransform",
      "Effect": "Allow",
      "Action": "cloudformation:CreateChangeSet",
      "Resource": "arn:aws:cloudformation:eu-north-1:aws:transform/Serverless-2016-10-31"
    },
    {
      "Sid": "NoResourceLevelSupport",
      "Effect": "Allow",
      "Action": ["cloudwatch:DescribeAlarms", "logs:DescribeLogGroups",
                 "scheduler:ListSchedules", "dsql:ListClusters"],
      "Resource": "*"
    }
  ]
}
```

### The two traps, restated because they cost eight CI cycles last time

**`ApplyTheSamTransform` is not optional and is not obvious.**
`AWS::Serverless-2016-10-31` is a macro CloudFormation expands **as the
execution role**, not as the principal that ran `sam deploy`. Granting
`CreateChangeSet` on the transform to the deploy role alone is not enough — it
must be on this role too, which is why the ARN appears in both policies.

**`RolesTheStackOwns` must match the new prefix or nothing deploys.** SAM
creates the function's execution role named after the stack, so it becomes
`quirenote-backend-*`. If this statement still said `kubushka-backend-*` the
stack would fail on role creation — and the message names the role, not the
policy, which is what makes it slow to diagnose.

Two grants this policy still deliberately withholds: **`iam:*` outside the
prefix** (unprefixed IAM write on an execution role is account-admin by another
name) and **anything EC2 or VPC**.


**Expect the first deploy to fail once or twice on `AccessDeniedException`.**
Read the resource ARN out of the error — AWS always states exactly what it
wanted — and add that ARN, rather than broadening to `*`. This is the same
discipline `docs/reference/DEPLOYMENT.md` §5 already documents for the frontend role, and
it is why the policy above is a starting point rather than a guarantee.

**Create the SAM artifact bucket.** Run this in AWS CloudShell, which already has
credentials:

```bash
bash infra/scripts/bootstrap-account.sh
```

It derives the account ID from `sts get-caller-identity`, creates
`quirenote-sam-artifacts-<account-id>` in `eu-north-1`, blocks public access, and
adds a 30-day expiry rule — without which every Lambda bundle ever pushed
(~330 KB per deploy) accumulates forever. Idempotent, so it is safe to re-run.

**GitHub:** add `AWS_BACKEND_ROLE_ARN` to the `dev` environment's secrets. Use
the web UI — the local `gh` CLI is authenticated as a different account and
returns 403 on writes to this repo.

## Field notes — things only the first deploy revealed

Nine runs, eight failures. Recorded because none of these are in the docs that
were read beforehand, and each cost a cycle.

- **`sam build` cannot see sibling directories.** Both the builtin esbuild
  builder and the makefile builder copy `CodeUri` into a sandbox first, so the
  handler's `../../src/core` imports resolve to nothing. The workflow therefore
  runs esbuild itself and hands SAM a finished bundle (`CodeUri: dist/`, no
  `BuildMethod`).
- **Bundle as CJS, not ESM.** `pg` is CommonJS and requires node builtins; an
  ESM bundle dies at first invoke on `Dynamic require of "events"`.
- **Do not mark `@aws-sdk/*` external.** `dsql-signer` is recent and assuming the
  Lambda runtime ships it is an untested bet. Bundling costs ~800 KB.
- **DSQL rejects `DESC` in index keys** — *"specifying sort order not supported
  for index keys"*. Not in the documented compatibility differences.
- **DSQL needs a service-linked role** (`AWSServiceRoleForAuroraDsql`). Creating
  a cluster normally creates it, but only if the caller holds
  `iam:CreateServiceLinkedRole`. Created once in `bootstrap-account.sh` instead
  of widening the execution role.
- **Metric filters are their own permission family.** `logs:PutMetricFilter`, `DeleteMetricFilter` and `DescribeMetricFilters` are not covered by the log-group actions a Lambda needs; adding a metric filter failed on `DescribeMetricFilters` alone.
- **The DSQL CloudFormation handler calls more than the template uses** —
  `GetClusterPolicy`, `GetVpcEndpointServiceName` — regardless of whether the
  template sets those properties. Grant a handler its whole surface, not the
  minimum the property docs imply.
- **The SAM transform is expanded by the EXECUTION role**, so it needs
  `cloudformation:CreateChangeSet` on
  `arn:aws:cloudformation:<region>:aws:transform/Serverless-2016-10-31`.
  Granting it to the calling role is not enough.
- **A new AWS account cannot use `ReservedConcurrentExecutions`** — reserving any
  concurrency drops the unreserved pool below the required floor of 10.
- **A stack that fails its first create lands in `ROLLBACK_COMPLETE`** and cannot
  be updated; the next deploy fails with a misleading "cannot be updated".
  `bootstrap-account.sh` clears it.

### 2026-08-11 — the rename, and three things it uncovered

The stack moved from `kubushka-backend` to `quirenote-backend` by deploying the
new one **beside** the old and deleting the old only after verification. That
order is the whole reason the day was uneventful: the new stack ran alongside
for about an hour while two code defects were found and the alert channel was
rebuilt from nothing. Under a delete-first order each of those is an incident.

- **`DeletionPolicy: Retain` leaves a cluster behind when a stack CREATE rolls
  back.** Two orphaned DSQL clusters from the failed deploys of 2026-08-10 were
  sitting deletion-protected and owned by nothing. Nobody knew. If a deploy ever
  fails at cluster creation again, check `dsql list-clusters` afterwards.
- **The alerting was dead and every indicator said healthy.** Zero failed
  notifications means nothing was *attempted*, not that anything succeeded. SNS
  had deactivated the email subscription; three replacements died within seconds
  of confirmation, across two topic ARNs. Email is abandoned — delivery is now
  EventBridge → AWS User Notifications → Console Mobile App, and the capture
  reports its own channel count on every run (D44, D45, D47).
- **A subscription SNS has deactivated cannot be removed via CloudFormation.**
  CFN calls `Unsubscribe` with the ARN it stored, which SNS has replaced with
  the literal string `Deleted`, and the deploy fails with *"An ARN must have at
  least 6 elements, not 1"*. The only way out is deleting the topic.
- **CloudWatch publishes alarm state changes to EventBridge for every alarm,
  regardless of `AlarmActions`.** The stack now has six alarms and no SNS topic
  at all, and alerting works.
- **`role-to-assume` needs a full ARN, and a bare role name does not error** —
  `configure-aws-credentials` retries the STS call with backoff, so the step
  hangs for minutes and reads as a slow runner. A long
  `configure-aws-credentials` is itself the symptom.
- **The notifications API answers only in `us-east-1`** and refuses the call
  elsewhere by name.

Cost of the move, measured: two days of Inzhur captures (`as_of` 2026-08-09 and
2026-08-10). The NBU half regenerated in full from its public archive.

Verified live 2026-08-10: `{"ok":true,"asOf":"2026-08-09","entries":35}`, one row
in `price_capture`. **The alerting claim in that line was wrong** — see the
2026-08-11 notes below.

## Phase 2 gate

After ~3 weeks of captures, the raw archive answers what a schema decision would
otherwise guess: weekend and holiday refresh behaviour, yield stability, fund
NAV cadence, payload byte-stability, outage shape. Only then is the observation
schema written, and backfilled from the payloads already stored.

Free observation already scheduled: **2026-09-23**, the cum/ex boundary on
UA4000238976 (≈1081.82 cum vs ≈1003.42 ex).
