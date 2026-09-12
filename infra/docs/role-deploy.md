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
      "Resource": "arn:aws:lambda:eu-north-1:<account-id>:function:quirenote-backend-MigrateFunction-*"
    }
  ]
}
```

`RunMigrations` is the one statement this role holds that is not about deploying.
[`.github/workflows/migrate.yml`](../../.github/workflows/migrate.yml) assumes this
role to invoke the migration handler by hand, and the resource is that function
ALONE — deliberately not the `quirenote-backend-*` wildcard `role-cfn-exec` uses
for its own actions, which would also let a dispatch fire the capture function
and write a day's prices under whatever `as_of` the clock gave it.

`cloudformation:DescribeStacks` is already in `DriveTheStack`, which is what lets
the workflow read `MigrateFunctionName` out of the stack instead of constructing
a name SAM generates a suffix for.

**Added by hand, in the console, like everything else on this page** — a role is
not in `template.yaml`. Until it is added, a dispatch fails at the invoke step
with `AccessDeniedException`, which is the correct failure: nothing is
half-applied, because nothing ran.
