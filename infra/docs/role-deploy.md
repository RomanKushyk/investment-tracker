# infra — Role 1, `quirenote-backend-deploy`

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
                   "arn:aws:cloudformation:eu-north-1:<account-id>:stack/quirenote-backend-user-dev/*",
                   "arn:aws:cloudformation:eu-north-1:<account-id>:stack/quirenote-backend-user-prod/*",
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
    },
    {
      "Sid": "RunMigrations",
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": ["arn:aws:lambda:eu-north-1:<account-id>:function:quirenote-backend-user-dev-MigrateFunction-*",
                   "arn:aws:lambda:eu-north-1:<account-id>:function:quirenote-backend-user-prod-MigrateFunction-*"]
    }
  ]
}
```

`RunMigrations` is the one statement this role holds that is not about deploying.
[`.github/workflows/migrate.yml`](../../.github/workflows/migrate.yml) assumes this
role to invoke the migration handler by hand, and the resources are those two
functions ALONE — deliberately not the `quirenote-backend-*` wildcard
`role-cfn-exec` uses for its own actions, which would also let a dispatch fire the
capture function and write a day's prices under whatever `as_of` the clock gave
it. Both patterns still exclude it: the capture function is
`quirenote-backend-CaptureFunction-*`, which matches neither.

**ONE ROLE HOLDS INVOKE ON BOTH RUNNERS, so the separation between the two user
databases is the WORKFLOW's, not this role's.** A job running in the `dev`
environment can invoke prod's migration function; what stops it is `migrate.yml`
resolving its environment from `target`, and the `prod` environment admitting
`main` alone. Note the SURFACE that protects: that workflow, and no other. A new
workflow, or a `run:` step added to `deploy-backend.yml`, inherits invoke on prod's
runner with no gate in front of it — so the gate is a property of what is written,
not of what is permitted. The Lambda-level grant — each runner holds `dsql:DbConnectAdmin` on
its own cluster and no other — is the part that IS structural. Accepted rather than
overlooked: a role per environment would make it structural here too, and is the
change to make if this repository ever has a second person in it.

**Three stack ARNs, written out rather than wildcarded.** `stack/quirenote-backend*`
would cover the same three and every stack anyone names with that prefix later,
which is the opposite of what a resource list is for.

**The migration function is not in `quirenote-backend` any more.** It moved to
`template-user.yaml` with the schema it applies, so the old
`quirenote-backend-MigrateFunction-*` resource was REPLACED rather than added to —
leaving it would have granted invoke on a function that no longer exists.

`cloudformation:DescribeStacks` is already in `DriveTheStack`, which is what lets
the workflow read `MigrateFunctionName` out of the stack instead of constructing
a name SAM generates a suffix for.

**Added by hand, like everything else on this page** — a role is not in
`template.yaml`, so nothing in this repository puts it there and nothing here
will notice if it goes. `RunMigrations` went on by CLI rather than in the
console, and the split's two edits — the stack ARNs and the migrate-function ARNs
— went the same way, which makes the readback rule the normal practice on this
page rather than a deviation: `put-role-policy` REPLACES the whole inline
document, so it is written from a `get-role-policy` readback with the change
applied to what came back, never typed fresh.

Without it a dispatch fails at the invoke step with `AccessDeniedException`,
which is the correct failure: nothing is half-applied, because nothing ran.
