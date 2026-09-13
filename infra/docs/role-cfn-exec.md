# infra — Role 2, `quirenote-backend-cfn-exec`, and the three traps

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
      "Sid": "Identity",
      "Effect": "Allow",
      "Action": ["cognito-idp:DescribeUserPool", "cognito-idp:UpdateUserPool",
                 "cognito-idp:SetUserPoolMfaConfig", "cognito-idp:GetUserPoolMfaConfig",
                 "cognito-idp:CreateUserPoolClient", "cognito-idp:DescribeUserPoolClient",
                 "cognito-idp:UpdateUserPoolClient", "cognito-idp:DeleteUserPoolClient",
                 "cognito-idp:ListUserPoolClients",
                 "cognito-idp:CreateUserPoolDomain", "cognito-idp:UpdateUserPoolDomain",
                 "cognito-idp:DeleteUserPoolDomain",
                 "cognito-idp:CreateIdentityProvider", "cognito-idp:DescribeIdentityProvider",
                 "cognito-idp:UpdateIdentityProvider", "cognito-idp:DeleteIdentityProvider",
                 "cognito-idp:ListIdentityProviders",
                 "cognito-idp:CreateManagedLoginBranding",
                 "cognito-idp:DescribeManagedLoginBranding",
                 "cognito-idp:DescribeManagedLoginBrandingByClient",
                 "cognito-idp:UpdateManagedLoginBranding",
                 "cognito-idp:DeleteManagedLoginBranding",
                 "cognito-idp:TagResource", "cognito-idp:UntagResource",
                 "cognito-idp:ListTagsForResource"],
      "Resource": "arn:aws:cognito-idp:eu-north-1:<account-id>:userpool/*"
    },
    {
      "Sid": "HttpApi",
      "Effect": "Allow",
      "Action": ["apigateway:GET", "apigateway:POST", "apigateway:PATCH",
                 "apigateway:PUT", "apigateway:DELETE",
                 "apigateway:AddCertificateToDomain",
                 "apigateway:RemoveCertificateFromDomain"],
      "Resource": ["arn:aws:apigateway:eu-north-1::/apis",
                   "arn:aws:apigateway:eu-north-1::/apis/*",
                   "arn:aws:apigateway:eu-north-1::/domainnames",
                   "arn:aws:apigateway:eu-north-1::/domainnames/api.quirenote.com",
                   "arn:aws:apigateway:eu-north-1::/domainnames/api.quirenote.com/*",
                   "arn:aws:apigateway:eu-north-1::/domainnames/api.dev.quirenote.com",
                   "arn:aws:apigateway:eu-north-1::/domainnames/api.dev.quirenote.com/*",
                   "arn:aws:apigateway:eu-north-1::/tags/*"]
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
                 "scheduler:ListSchedules", "dsql:ListClusters",
                 "cognito-idp:CreateUserPool", "cognito-idp:DescribeUserPoolDomain",
                 "cloudfront:UpdateDistribution"],
      "Resource": "*"
    }
  ]
}
```

### The three traps, restated because the first two cost eight CI cycles last time

**`ApplyTheSamTransform` is not optional and is not obvious.** `AWS::Serverless-2016-10-31` is a macro CloudFormation expands **as the execution role**, not as the principal that ran `sam deploy` — granting `CreateChangeSet` on the transform to the deploy role alone is not enough, which is why the ARN appears in both policies. **`RolesTheStackOwns` must match the stack's prefix or nothing deploys** — SAM names the function's execution role after the stack, so a stale prefix here fails the stack on role creation, and the error message names the role, not the policy. Two grants this policy still deliberately withholds: `iam:*` outside the prefix, and anything EC2 or VPC.

**The user stacks are named `quirenote-backend-user-dev` and `quirenote-backend-user-prod` SO THIS ROLE NEEDS NO EDIT AT ALL** — they already match every `quirenote-backend-*` prefix above, and `dsql:*` was already `cluster/*`. Rename either one out of that prefix and three statements break at once — `Function`, `RolesTheStackOwns` and `Logs`, which is every prefix-scoped statement a user stack touches — on `iam:CreateRole` first — but only if `role-deploy.md`'s list was updated and this one was not. Both stale, and the DEPLOY role refuses at `CreateChangeSet` before this role is ever assumed: no stack, no rollback, nothing left behind. It is the HALF-DONE rename that hurts, and it hurts like this: the stack rolls back, its `UserCluster` carries `DeletionPolicy: Retain`, so a deletion-protected orphan is left behind, and clearing the `ROLLBACK_COMPLETE` stack and retrying creates a SECOND cluster unless the orphan is un-protected and deleted first. `bootstrap-account.sh` takes the stack name as its first argument for exactly that cleanup.

**Expect the first deploy to fail once or twice on `AccessDeniedException`.** Read the resource ARN out of the error — AWS always states exactly what it wanted — and add that ARN, rather than broadening to `*`.

**The three Cognito grants that are `*`, and why each one has to be.** They are in
`NoResourceLevelSupport` for three different reasons, so none of them generalises to a fourth:
`CreateUserPool` creates the thing the ARN would name, and a pool id is generated rather than
chosen, so there is nothing to scope it to — the same shape as `dsql:ListClusters` beside it.
`DescribeUserPoolDomain` takes a domain string and no pool id at all, so the pool ARN is not
in the request for a policy to match; its `Create`/`Update`/`Delete` siblings do take one and
are scoped in `Identity`. `cloudfront:UpdateDistribution` is not a resource this account
manages: a custom domain is fronted by a distribution Cognito builds and owns, and the caller's
permission is what it checks before building it — the distribution cannot be named in advance,
so the grant is genuinely unscopable. Be honest about what that buys the holder: it permits
updating **any** distribution in the account, and what stops this role doing so is that nothing
in either template asks it to, not the policy.

**`cognito-idp:DeleteUserPool` is deliberately NOT granted.** The pool carries
`DeletionPolicy: Retain` and `DeletionProtection: ACTIVE`, so CloudFormation never issues it —
and it is the one action in this file that could destroy every identity in an environment.
Absent, a stack delete leaves the pool standing, which is the outcome both properties already
ask for. The cost is one deliberate CLI call on the day a pool is genuinely meant to go.

**`Identity` is scoped to `userpool/*` rather than one pool**, and this is the statement that
most wants narrowing. One role serves both environments (`deploy-backend.yml` passes the same
`--role-arn` for dev and prod), so as written a **dev** deploy holds `UpdateUserPool` on the
**prod** pool. The reach is worse than "modify": `UpdateUserPool` REPLACES rather than merges
("if you don't provide a value for an attribute, Amazon Cognito sets it to its default
value"), so an omitted `AdminCreateUserConfig` RESETS `AllowAdminCreateUserOnly`. The WebAuthn
relying party is not reachable through that call at all — it has no WebAuthn field — but it is
reachable through `cognito-idp:SetUserPoolMfaConfig`, granted in the same statement and on the
same wildcard, and `template-user.yaml` calls that value effectively permanent — which is exactly what `template-user.yaml` refuses to do three lines from its
own `PreSignUpPolicy`. It is unavoidable only on the first deploy, when neither id exists yet;
afterwards both ARNs are known and can be enumerated here, which is what the paragraph above
prescribes for every other resource. Left as a wildcard for now, knowingly, and narrowing it is
the follow-up rather than a thing this file pretends is already done.

**`HttpApi` splits the difference the paragraph above could not, and half of it is narrowed.**
`/apis/*` cannot be: an HTTP API is addressed by a generated id rather than by the name the stack
gives it, so there is nothing stable to enumerate — the same compromise `Identity` makes with
`userpool/*`, for the same reason and with the same reach across both environments. The DOMAIN
NAMES are different in kind: `api.quirenote.com` and `api.dev.quirenote.com` are chosen rather
than generated, so both are written out and this role holds nothing on any other hostname. That
is the whole of what the split buys, and it is worth having: a domain name is the part an
attacker would want.

**Two of the seven actions are not HTTP verbs at all, and nothing about the template hints at
them.** `AddCertificateToDomain` and `RemoveCertificateFromDomain` are permission-only actions —
they name no API operation, so reading the CloudFormation resource list never produces them.
API Gateway checks `AddCertificateToDomain` on `/domainnames` when a domain name is created
carrying a `CertificateArn`, which is exactly what `PublicApi`'s `Domain` block asks for, and the
`Remove` twin on the delete path. Without them the FIRST deploy fails on
`apigateway:AddCertificateToDomain`, the stack rolls back, and `UserCluster`'s `Retain` leaves
behind the deletion-protected orphan the rename trap above describes.

**`apigateway:PUT` IS NOT OPTIONAL HERE EITHER, and the reason is not obvious enough to leave
implicit.**
It reads as the REST import verb, which is why it was left out at first. But `PUT /v2/apis` is
`ImportApi` and `PUT /v2/apis/{apiId}` is `ReimportApi`, both of which take an OpenAPI `body` —
and `AWS::Serverless::HttpApi` ALWAYS produces one: SAM assembles the routes and the CORS block
into a definition body, which is the only reason `CorsConfiguration` works on this resource at
all. So every create and every update of this API goes through PUT. Without it the deploy fails
`apigateway:PUT on arn:aws:apigateway:eu-north-1::/apis`, and the second failure — on
`/apis/<id>` — waits for the first update that changes a route. Established by running the SAM
transform over `template-user.yaml` and reading the generated `Body`, rather than by watching a
deploy fail.

**Added by hand from a readback, so RECONCILE THIS STATEMENT BEFORE THE FIRST DEPLOY.** The grant
went on the role before the branch that needed it, written from a `get-role-policy` readback with
the change applied to what came back — the practice [`role-deploy.md`](role-deploy.md) states,
because `put-role-policy` REPLACES the whole inline document. The three actions above were then
reasoned out from the transform's own output and from what a certificate-carrying domain name
checks, AFTER that grant was written, so the live policy is likely to be missing them. One
`aws iam get-role-policy` against `quirenote-backend-cfn-execPolicy` settles what is actually
there, and the fix is the same readback. A statement live in the account and absent from this
page is the worse of the two failures — an incomplete page fails a deploy loudly, while a wrong
one is what the next reader plans against. `acm:DescribeCertificate` on the two certificate ARNs
is the likeliest fourth if the domain name still fails after these: this role holds no `acm:*` at
all, and sources disagree about whether API Gateway checks it as the caller or looks it up itself.

**Create the SAM artifact bucket.** Run this in AWS CloudShell, which already has credentials:

```bash
bash infra/scripts/bootstrap-account.sh
```

It derives the account ID from `sts get-caller-identity`, creates `quirenote-sam-artifacts-<account-id>` in `eu-north-1`, blocks public access, and adds a 30-day expiry rule. Idempotent, so it is safe to re-run.

**GitHub:** add `AWS_BACKEND_ROLE_ARN` to the `dev` **and `prod`** environments' secrets — the same role ARN in both; the trust policy keys on `:environment:*`, so it needs no change, but environment secrets are not shared and the `main` push fails on an empty `role-to-assume` without it. `gh secret set AWS_BACKEND_ROLE_ARN --env prod --body <arn>` works, provided `GH_CONFIG_DIR="$HOME/.quirenote/gh-config"` is set — which every `gh` call in this repository already requires. The 403 this line used to warn about was the DEFAULT config dir answering as the other account, not a permission this token lacks.
