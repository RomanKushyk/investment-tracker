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

## Deploying

Region: **`eu-north-1`** — same as Amplify. Aurora DSQL is available there
(`dsql.eu-north-1.api.aws`); DSQL is PostgreSQL 16 compatible.

Deployed by GitHub Actions, not from a developer machine — there are no AWS
credentials locally and there should not be. See `docs/DEPLOYMENT.md`.

The backend uses its **own** OIDC role, separate from `kubushka-github-deploy`,
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
(`docs/DEPLOYMENT.md` §1.4) — do not create a second one.

**Role 1 — `kubushka-backend-deploy`.** Trust policy (replace `<account-id>`):

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

The `sub` keys on the **environment**, not the branch, because the job declares
one — and the owner/repo carry immutable numeric IDs. Both traps are documented
at length in `docs/DEPLOYMENT.md` §1.5; the same values apply here.

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
      "Resource": ["arn:aws:cloudformation:eu-north-1:<account-id>:stack/kubushka-backend/*",
                   "arn:aws:cloudformation:eu-north-1:aws:transform/Serverless-2016-10-31"]
    },
    {
      "Sid": "HandOffToCloudFormationOnly",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::<account-id>:role/kubushka-backend-cfn-exec",
      "Condition": { "StringEquals": { "iam:PassedToService": "cloudformation.amazonaws.com" } }
    },
    {
      "Sid": "SamArtifacts",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": ["arn:aws:s3:::kubushka-sam-artifacts-<account-id>",
                   "arn:aws:s3:::kubushka-sam-artifacts-<account-id>/*"]
    }
  ]
}
```

**Role 2 — `kubushka-backend-cfn-exec`.** Trusted only by CloudFormation:

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

Inline permission policy. Everything is scoped to the `kubushka-backend-*` name
prefix that SAM derives from the stack name, except the four read-only actions
at the end that AWS does not support resource-level permissions for.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Database",
      "Effect": "Allow",
      "Action": ["dsql:CreateCluster", "dsql:GetCluster", "dsql:UpdateCluster",
                 "dsql:DeleteCluster", "dsql:TagResource", "dsql:UntagResource",
                 "dsql:ListTagsForResource", "dsql:PutMultiRegionProperties"],
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
      "Resource": "arn:aws:lambda:eu-north-1:<account-id>:function:kubushka-backend-*"
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
      "Resource": "arn:aws:iam::<account-id>:role/kubushka-backend-*"
    },
    {
      "Sid": "Logs",
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup", "logs:DeleteLogGroup",
                 "logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy",
                 "logs:TagResource", "logs:UntagResource", "logs:ListTagsForResource"],
      "Resource": "arn:aws:logs:eu-north-1:<account-id>:log-group:/aws/lambda/kubushka-backend-*"
    },
    {
      "Sid": "DeadLetterQueue",
      "Effect": "Allow",
      "Action": ["sqs:CreateQueue", "sqs:DeleteQueue", "sqs:GetQueueAttributes",
                 "sqs:SetQueueAttributes", "sqs:GetQueueUrl", "sqs:TagQueue",
                 "sqs:UntagQueue", "sqs:ListQueueTags"],
      "Resource": "arn:aws:sqs:eu-north-1:<account-id>:kubushka-backend-*"
    },
    {
      "Sid": "AlertTopic",
      "Effect": "Allow",
      "Action": ["sns:CreateTopic", "sns:DeleteTopic", "sns:GetTopicAttributes",
                 "sns:SetTopicAttributes", "sns:Subscribe", "sns:Unsubscribe",
                 "sns:ListSubscriptionsByTopic", "sns:TagResource",
                 "sns:UntagResource", "sns:ListTagsForResource"],
      "Resource": "arn:aws:sns:eu-north-1:<account-id>:kubushka-backend-*"
    },
    {
      "Sid": "Alarms",
      "Effect": "Allow",
      "Action": ["cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms",
                 "cloudwatch:TagResource", "cloudwatch:UntagResource",
                 "cloudwatch:ListTagsForResource"],
      "Resource": "arn:aws:cloudwatch:eu-north-1:<account-id>:alarm:kubushka-backend-*"
    },
    {
      "Sid": "Schedule",
      "Effect": "Allow",
      "Action": ["scheduler:CreateSchedule", "scheduler:GetSchedule",
                 "scheduler:UpdateSchedule", "scheduler:DeleteSchedule",
                 "scheduler:TagResource", "scheduler:UntagResource",
                 "scheduler:ListTagsForResource"],
      "Resource": "arn:aws:scheduler:eu-north-1:<account-id>:schedule/default/kubushka-backend-*"
    },
    {
      "Sid": "ReadTemplateAndArtifacts",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:GetObjectVersion"],
      "Resource": "arn:aws:s3:::kubushka-sam-artifacts-<account-id>/*"
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

`ApplyTheSamTransform` is non-obvious and was missing from the first version:
`AWS::Serverless-2016-10-31` is a macro that CloudFormation expands, and it
expands it **as the execution role**, not as the principal that called
`sam deploy`. Granting `CreateChangeSet` to the GitHub role alone is not enough.
The failure is explicit — *"not authorized to perform: cloudformation:CreateChangeSet
on resource: .../transform/Serverless-2016-10-31"* — which is exactly the
read-the-ARN-out-of-the-error loop described below.

Two things this policy deliberately does **not** grant, and must never:

- **`iam:*` outside the `kubushka-backend-*` prefix.** Unprefixed IAM write
  permission on an execution role is account-admin by another name.
- **Anything EC2 or VPC.** No `ec2:CreateNatGateway`, no VPC actions at all.
  The stack does not need them, and a NAT Gateway is ~$33/month against a
  ~$0.02 baseline. Withholding the permission is a stronger guarantee than
  remembering not to add one.

**Expect the first deploy to fail once or twice on `AccessDeniedException`.**
Read the resource ARN out of the error — AWS always states exactly what it
wanted — and add that ARN, rather than broadening to `*`. This is the same
discipline `docs/DEPLOYMENT.md` §5 already documents for the frontend role, and
it is why the policy above is a starting point rather than a guarantee.

**Create the SAM artifact bucket.** Run this in AWS CloudShell, which already has
credentials:

```bash
bash infra/scripts/bootstrap-account.sh
```

It derives the account ID from `sts get-caller-identity`, creates
`kubushka-sam-artifacts-<account-id>` in `eu-north-1`, blocks public access, and
adds a 30-day expiry rule — without which every Lambda bundle ever pushed
(~330 KB per deploy) accumulates forever. Idempotent, so it is safe to re-run.

**GitHub:** add `AWS_BACKEND_ROLE_ARN` to the `dev` environment's secrets. Use
the web UI — the local `gh` CLI is authenticated as a different account and
returns 403 on writes to this repo.

## Phase 2 gate

After ~3 weeks of captures, the raw archive answers what a schema decision would
otherwise guess: weekend and holiday refresh behaviour, yield stability, fund
NAV cadence, payload byte-stability, outage shape. Only then is the observation
schema written, and backfilled from the payloads already stored.

Free observation already scheduled: **2026-09-23**, the cum/ex boundary on
UA4000238976 (≈1081.82 cum vs ≈1003.42 ex).
