# infra — Roles 1, `quirenote-backend-deploy-dev` and `quirenote-backend-deploy-prod`

One role per environment. Each is assumed only by a job in its own environment on its own branch,
and reaches only what that environment deploys. The dev role also drives the archive, which deploys
from `dev` alone. The frontend's two roles follow the same pattern (`docs/reference/DEPLOYMENT.md`
§3.3).

Trust policy, with `<env>`/`<branch>` as `dev`/`dev` and `prod`/`main`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:RomanKushyk@97728952/investment-tracker@1313804031:environment:<env>",
        "token.actions.githubusercontent.com:ref": "refs/heads/<branch>"
      }
    }
  }]
}
```

Inline permission policy, named `quirenote-backend-deploy-<env>Policy`. For `dev`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DriveTheStack",
      "Effect": "Allow",
      "Action": ["cloudformation:DescribeStacks", "cloudformation:DescribeStackEvents",
                 "cloudformation:GetTemplateSummary", "cloudformation:CreateChangeSet",
                 "cloudformation:DescribeChangeSet", "cloudformation:ExecuteChangeSet"],
      "Resource": ["arn:aws:cloudformation:eu-north-1:<account-id>:stack/quirenote-backend/*",
                   "arn:aws:cloudformation:eu-north-1:<account-id>:stack/quirenote-backend-user-dev/*",
                   "arn:aws:cloudformation:eu-north-1:aws:transform/Serverless-2016-10-31"]
    },
    {
      "Sid": "HandOffToCloudFormationOnly",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::<account-id>:role/quirenote-backend-cfn-exec-dev",
      "Condition": { "StringEquals": { "iam:PassedToService": "cloudformation.amazonaws.com" } }
    },
    {
      "Sid": "SamArtifacts",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::quirenote-sam-artifacts-<account-id>/dev/*"
    },
    {
      "Sid": "RunMigrations",
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:eu-north-1:<account-id>:function:quirenote-backend-user-dev-MigrateFunction-*"
    }
  ]
}
```

For `prod`, the same with four substitutions: `stack/quirenote-backend-user-prod/*` replaces the
two dev stacks, because the archive deploys from `dev` alone; the role passed is
`quirenote-backend-cfn-exec-prod`; the object prefix is `prod/*`; and the runner is
`quirenote-backend-user-prod-MigrateFunction-*`. And one statement more, because the
production deploy still READS the archive, for the identifier it passes as `ArchiveClusterId`:

```json
{
  "Sid": "ReadTheArchiveIdentifier",
  "Effect": "Allow",
  "Action": "cloudformation:DescribeStacks",
  "Resource": "arn:aws:cloudformation:eu-north-1:<account-id>:stack/quirenote-backend/*"
}
```

A statement of its own rather than a line in `DriveTheStack`, which would let a `main` run update
the archive. The dev role reads it through `DriveTheStack` already.

**Each action is a call a workflow makes.** `DriveTheStack` is what `sam deploy` sends, read in the
SAM CLI's `samcli/lib/deploy/deployer.py`; the workflow's own `describe-stacks` steps need nothing
more. `sam deploy` reads the stack, takes the template summary, then creates, waits on and
executes a change set while it reads the stack events. It never calls
`CreateStack` or `UpdateStack`; those belong to `sam sync`. The `update-stack` that
`deploy-backend.yml` prints as a repair is run by hand. `SamArtifacts` is the upload:
`s3_uploader.py` heads each key and puts it when the head fails. It reads any refusal as "not
there", so the role holds no `s3:ListBucket`. A key that exists is still found, and a missing one
is put, exactly as with a 404. `HandOffToCloudFormationOnly` is `--role-arn`, and `RunMigrations`
is the invoke below.

**The trust names the environment AND the branch, and each closes a gap the other leaves.** The `sub`
a job in an environment carries is `…:environment:<env>`, never `ref:refs/heads/…`. `ref` is a claim
IAM reads on its own, so a job on another branch gets nothing even if the environment's branch policy
is edited. **Never `environment:*`**: it matches an environment a workflow merely names, which GitHub
creates, when it does not exist, with no protection rules.

**What one role per environment buys.** Any step in a job holding `id-token: write` can mint the
token — which is why the deploy workflows grant it only to jobs that run no dependency code, the suite
running one job earlier without it. So a job in `dev` can no longer, with its own credentials,
deploy the production stack or invoke production's runner, whose `bootstrap` mode mints a
super-admin.

**What the execution role per environment buys.** Each deploy role passes CloudFormation only its
own environment's execution role, and that role reaches only its environment's clusters and pools
by tag and its generated names by pattern (`role-cfn-exec.md`). So a template deployed to
`quirenote-backend-user-dev` reaches production through none of the three doors one shared role
left open: a role it creates carries dev's boundary, which connects to no production cluster and
administers no production pool; the role's own grants put no `AWS::Lambda::Permission` on
production's runner and add no client to production's pool; and `iam:PassRole` is denied on
production's roles by name. `iam:PassRole` takes no `iam:PermissionsBoundary` key, which is why that
last one is a name Deny and not a condition. The archive is dev's, so a role a user-dev template
creates still reaches the archive cluster as dev's boundary allows. An account per environment
would add the account's limits and the `*` grants to the split; it is not what closes the doors above.

**The artifacts are split by prefix, not just by stack.** `sam deploy` skips an upload whose
md5-named key already exists, and `main` ships the very bundles `dev` shipped. In one shared
namespace a `dev` job could plant the object a production deploy then reuses. Each role writes under
its own prefix alone, and the workflow passes `--s3-prefix` from the same ref rule that picks the
role. Each execution role reads its own prefix alone.

**`RunMigrations` is the one statement here that is not about deploying.** Both
[`deploy-backend.yml`](../../.github/workflows/deploy-backend.yml) and
[`migrate.yml`](../../.github/workflows/migrate.yml) assume the environment's role to invoke its
migration handler. The resource is that one function, never the `quirenote-backend-*` wildcard
`role-cfn-exec.md` uses, which would also let a run fire the capture and write a day's prices under
whatever `as_of` the clock gave it. **The invoke itself is written once**, in
[`.github/actions/invoke-migration`](../../.github/actions/invoke-migration/action.yml), where the
target resolves to a stack and the three verdicts are read. `src/stack-split.test.ts` pins it as the
only file under `.github/` carrying an `aws lambda invoke`. **Nothing here asks a human first**: the
apply runs unattended, and what answers for it is the `notify` job opening an issue on a failure.

**Stack ARNs written out, never wildcarded.** `stack/quirenote-backend*` would cover these and
every stack anyone later names with that prefix, which is the opposite of what a resource list is
for. `cloudformation:DescribeStacks` in `DriveTheStack` is what lets the shared action read
`MigrateFunctionName` out of the stack instead of constructing a name SAM generates a suffix for.

**Added by hand, like everything else on this page.** No role is in a template, so nothing in this
repository puts one there and nothing here will notice if it goes. `put-role-policy` REPLACES the
whole inline document, so every edit starts from a `get-role-policy` readback with the change
applied to what came back. Without `RunMigrations` a deploy or a dispatch fails at the invoke step
with `AccessDeniedException`, which is the correct failure: nothing is half-applied, because nothing
ran.
