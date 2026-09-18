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
                 "apigateway:RemoveCertificateFromDomain",
                 "apigateway:TagResource", "apigateway:UntagResource"],
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
      "Sid": "ApiGatewayServiceLinkedRole",
      "Effect": "Allow",
      "Action": "iam:CreateServiceLinkedRole",
      "Resource": "arn:aws:iam::<account-id>:role/aws-service-role/ops.apigateway.amazonaws.com/AWSServiceRoleForAPIGateway",
      "Condition": {
        "StringEquals": { "iam:AWSServiceName": "ops.apigateway.amazonaws.com" }
      }
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

### The traps, and the grants nothing derivable states

**`ApplyTheSamTransform` is not optional and is not obvious.** `AWS::Serverless-2016-10-31` is a
macro CloudFormation expands **as the execution role**, not as the principal that ran `sam deploy`,
which is why the transform ARN appears in both policies. **`RolesTheStackOwns` must match the
stack's prefix or nothing deploys** — SAM names the function's execution role after the stack, and a
stale prefix fails on `iam:CreateRole` with an error naming the role, not the policy. Withheld
deliberately: `iam:*` outside the prefix, and anything EC2 or VPC. Expect the first deploy to refuse
once or twice: read the resource ARN out of the error and add exactly that, never `*`.

**A HALF-DONE STACK RENAME LEAVES A DELETION-PROTECTED ORPHAN CLUSTER.** The user stacks
(`quirenote-backend-user-dev`, `…-prod`) already match every `quirenote-backend-*` prefix above, so
this role needs no edit; rename either out of it and `Function`, `RolesTheStackOwns` and `Logs`
break at once. Leave BOTH role documents stale and the deploy role refuses at `CreateChangeSet`
before this role is ever assumed — no stack, no rollback, nothing left behind. Update only
`role-deploy.md` and the half-done rename is what hurts: the stack rolls back while `UserCluster`'s
`DeletionPolicy: Retain` holds the cluster, so clearing the `ROLLBACK_COMPLETE` stack and retrying
creates a SECOND cluster unless the orphan is un-protected and deleted first. `bootstrap-account.sh`
takes the stack name for that cleanup.

**The three Cognito `*` grants are `*` for three different reasons, so none generalises to a
fourth.** `CreateUserPool` creates the thing the ARN would name and a pool id is generated rather
than chosen, so there is nothing to scope it to. `DescribeUserPoolDomain` takes a domain string and
no pool id, so the pool ARN is not in the request for a policy to match; its
`Create`/`Update`/`Delete` siblings do take one and are scoped in `Identity`.
`cloudfront:UpdateDistribution` names a distribution Cognito builds and owns for a custom domain and
checks the caller's permission before building it — so it permits updating **any** distribution in
the account, and what stops this role is that nothing in either template asks.

**`cognito-idp:DeleteUserPool` is deliberately NOT granted.** It carries `DeletionPolicy: Retain`
and `DeletionProtection: ACTIVE`, so CloudFormation never issues it — and it is the one action here
that could destroy every identity in an environment. Absent, a stack delete leaves the pool
standing, as both properties already ask, at the cost of one CLI call the day one is meant to go.

**`Identity` is scoped to `userpool/*` rather than one pool**, and most wants narrowing: one role
serves both environments, so a **dev** deploy holds `UpdateUserPool` on the **prod** pool — and that
call REPLACES rather than merges ("if you don't provide a value for an attribute, Amazon Cognito
sets it to its default value"), so an omitted `AdminCreateUserConfig` RESETS
`AllowAdminCreateUserOnly`. The WebAuthn relying party has no field on that call but is reachable
through `cognito-idp:SetUserPoolMfaConfig`, on the same statement and the same wildcard, and
`COGNITO-POOL-PARAMS.md` calls that value the second irreversible decision. Wildcarding a pool is
exactly what `template-user.yaml` refuses to do in the comment above its own `PreSignUpPolicy`, which
names the real pool ARN; it is unavoidable only on the first deploy, when neither id exists yet.
**`HttpApi` splits the same difference:** `/apis/*` cannot be narrowed either, an HTTP API being
addressed by a generated id, but the two domain names are chosen rather than generated, so both are
written out and this role holds nothing on any other hostname.

**A regional custom domain makes API Gateway create a SERVICE-LINKED ROLE**, which is `iam:` rather
than any API Gateway action, and without permission the domain name fails `CREATE` with "Caller does
not have permissions to create a Service Linked Role", naming neither the role nor the service.
`RolesTheStackOwns` does not cover it (a service-linked role lives under `role/aws-service-role/…`),
so it takes its own statement, once per account.

**`apigateway:TagResource` IS NOT A DOCUMENTED IAM ACTION, so the console editor cannot add it.**
Creating the STAGE was refused as `apigateway:TagResource` on `…::/apis/<api-id>/stages`, a name
that appears nowhere in the Service Authorization Reference for API Gateway, whose documented
non-verb actions are `AddCertificateToDomain`, `RemoveCertificateFromDomain`, `SetWebACL` and
`UpdateRestApiPolicy` — the service is reporting an SDK operation name where an IAM action name
belongs. Write the JSON, through `put-role-policy`. **The tag cannot be declined instead:**
`samtranslator`'s HTTP API generator sets `tags["httpapi:createdBy"] = "SAM"` unconditionally and no
template property suppresses it, so the alternative is hand-declaring six `AWS::ApiGatewayV2::*`
resources. If IAM refuses the action outright, the bounded fallback is `apigateway:*` over THIS
statement's existing resource list — the verb broadened over narrow resources, never the resources.

**Two of the nine `apigateway` actions name no API operation**, so reading the CloudFormation
resource list never produces them: `AddCertificateToDomain` is checked on `/domainnames` when a
domain name carries the `CertificateArn` that `PublicApi`'s `Domain` block asks for, and its
`Remove` twin on the delete path — without them the first deploy rolls back into the orphan-cluster
trap above. **`apigateway:PUT` is not optional either**, though it reads as the REST import verb:
`PUT /v2/apis` is `ImportApi`, `PUT /v2/apis/{apiId}` is `ReimportApi`, and
`AWS::Serverless::HttpApi` ALWAYS produces an OpenAPI body — SAM assembles the routes and the CORS
block into one, which is the only reason `CorsConfiguration` works here. So every create and update
goes through PUT, and the ARN it fails on FIRST is a tags one rather than `/apis`.

**The live role is missing `apigateway:PUT` and the two certificate actions.** Reconcile from an
`aws iam get-role-policy` readback rather than a fresh document, because `put-role-policy` REPLACES
the whole inline document.

**Account setup:** `bash infra/scripts/bootstrap-account.sh`, idempotent, run in AWS CloudShell.
Then add `AWS_BACKEND_ROLE_ARN` to the `dev` **and `prod`** environments' secrets, the same ARN in
both: the trust policy keys on `:environment:*` so it needs no change, but environment secrets are
not shared and the `main` push fails on an empty `role-to-assume` without it. `gh secret set` works
provided `GH_CONFIG_DIR="$HOME/.quirenote/gh-config"` is set.
