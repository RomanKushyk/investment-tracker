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
      "Sid": "InvokeTheGrantProvider",
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:eu-north-1:<account-id>:function:quirenote-backend-ArchiveReaderGrantFunction-*"
    },
    {
      "Sid": "ConfigureTheGrantProvidersInvocation",
      "Effect": "Allow",
      "Action": ["lambda:PutFunctionEventInvokeConfig", "lambda:GetFunctionEventInvokeConfig",
                 "lambda:UpdateFunctionEventInvokeConfig", "lambda:DeleteFunctionEventInvokeConfig"],
      "Resource": "arn:aws:lambda:eu-north-1:<account-id>:function:quirenote-backend-ArchiveReaderGrantFunction-*"
    },
    {
      "Sid": "RolesTheStackOwns",
      "Effect": "Allow",
      "Action": ["iam:CreateRole", "iam:DeleteRole",
                 "iam:PutRolePolicy", "iam:DeleteRolePolicy",
                 "iam:AttachRolePolicy", "iam:DetachRolePolicy",
                 "iam:UpdateAssumeRolePolicy", "iam:PutRolePermissionsBoundary"],
      "Resource": "arn:aws:iam::<account-id>:role/quirenote-backend-*",
      "Condition": { "StringEquals": {
        "iam:PermissionsBoundary": "arn:aws:iam::<account-id>:policy/quirenote-backend-boundary"
      } }
    },
    {
      "Sid": "ReadTagAndPassStackRoles",
      "Effect": "Allow",
      "Action": ["iam:GetRole", "iam:GetRolePolicy",
                 "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
                 "iam:TagRole", "iam:UntagRole", "iam:PassRole"],
      "Resource": "arn:aws:iam::<account-id>:role/quirenote-backend-*"
    },
    {
      "Sid": "NotTheRolesThatDeploy",
      "Effect": "Deny",
      "Action": "iam:*",
      "Resource": ["arn:aws:iam::<account-id>:role/quirenote-backend-cfn-exec",
                   "arn:aws:iam::<account-id>:role/quirenote-backend-deploy-*"]
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

### The boundary every stack role carries

**This role creates or changes no role that lacks `quirenote-backend-boundary`.** Without that
condition a template could create a role holding `AdministratorAccess` and hand it to a function it
also creates. AWS's least-privilege guidance for CloudFormation says it plainly: "An IAM principal
with permissions to create a role and attach any policy can escalate their own permissions." The
condition sits on every action that changes a role, and each of them takes the
`iam:PermissionsBoundary` key (Service Authorization Reference). Every role the two templates create
names the policy: SAM's generated ones through `PermissionsBoundary` on the function or in
`Globals`, the declared ones in their own properties.

**The boundary is [`infra/iam/quirenote-backend-boundary.json`](../iam/quirenote-backend-boundary.json),
made by hand and never by a stack.** A role able to edit it could lift it, so this role holds no
policy-editing action at all, and no `DeleteRolePermissionsBoundary`. It allows exactly the actions
the stack roles are granted: `src/stack-split.test.ts` holds the file to the templates' grants plus
the two managed policies SAM attaches. **A grant added to a template therefore needs the boundary
widened and applied BEFORE the deploy that ships it.** Deployed first, the grant is refused at the
function's first call, while the deploy itself goes green. Create it once, then change it by version:

```bash
aws iam create-policy --policy-name quirenote-backend-boundary \
  --policy-document "$(cat infra/iam/quirenote-backend-boundary.json)"
aws iam create-policy-version --set-as-default \
  --policy-arn arn:aws:iam::<account-id>:policy/quirenote-backend-boundary \
  --policy-document "$(cat infra/iam/quirenote-backend-boundary.json)"
```

A policy keeps five versions, so delete the oldest non-default one before a sixth. **The file writes
the account field as `*`**, keeping the id out of this public repository. IAM refuses a policy
variable there ("failed legacy parsing") although Access Analyzer passes it. So the boundary pins
no account. What keeps a stack role in this one is its own grants, and any other account's resource
policy, which would have to admit it. Where a template names a resource it writes the account with
`${AWS::AccountId}` or a `!GetAtt`. The `*` grants name no account: the alert-channel reads, and the
logging and tracing policies SAM attaches.

**`NotTheRolesThatDeploy` is the one Deny.** This role and the deploy roles all match
`role/quirenote-backend-*` but carry no boundary. The condition alone would let a stack IMPORT one of
them, put the boundary on it, and then rewrite its trust.

### The traps, and the grants nothing derivable states

**`ApplyTheSamTransform` is not optional and is not obvious.** `AWS::Serverless-2016-10-31` is a
macro CloudFormation expands **as the execution role**, not as the principal that ran `sam deploy`,
which is why the transform ARN appears in both policies. **`RolesTheStackOwns` must match the
stack's prefix, and every role must name the boundary, or nothing deploys.** SAM names the
function's execution role after the stack, and either miss fails on `iam:CreateRole` with an error
naming the role, not the policy. Withheld deliberately: `iam:*` outside the prefix, and anything
EC2 or VPC. Expect the first deploy to refuse once or twice: read the resource ARN out of the error
and add exactly that, never `*`.

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

**A custom resource is invoked AS THIS ROLE, so `InvokeTheGrantProvider` is the one invoke it
holds.** CloudFormation calls the function behind `ArchiveReaderGrant` with the stack's service role,
not as a service principal; without the grant the custom resource fails `CREATE` with `User:
arn:aws:sts::<account-id>:assumed-role/quirenote-backend-cfn-exec/AWSCloudFormation is not authorized
to perform: lambda:InvokeFunction on resource: …`. The resource is that one function's name prefix,
never `function:quirenote-backend-*`, which would let a template deployed from `dev` point a custom
resource at production's migration runner. **`ConfigureTheGrantProvidersInvocation` is what that
function's `EventInvokeConfig` takes**, the four actions the `AWS::Lambda::EventInvokeConfig` type's
create, read, update and delete handlers name: the invocation is asynchronous, and capping an
event's age is what keeps a late one from running after CloudFormation has stopped waiting.

**Edit from a readback.** Write every change from an `aws iam get-role-policy` readback rather than
a fresh document, because `put-role-policy` REPLACES the whole inline document.

**Account setup:** `bash infra/scripts/bootstrap-account.sh`, idempotent, run in AWS CloudShell,
then the boundary above. Set each environment's `AWS_BACKEND_ROLE_ARN` secret to that environment's
own role (`role-deploy.md`). Environment secrets are not shared, and the `main` push fails on an
empty `role-to-assume` without it. `gh secret set` works provided
`GH_CONFIG_DIR="$HOME/.quirenote/gh-config"` is set.
