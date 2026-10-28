# infra — Role 2, `quirenote-backend-cfn-exec-dev` and `-prod`, the boundaries, and the traps

One execution role per environment, and one permissions boundary per environment. Each deploy role
passes CloudFormation only its own environment's execution role (`role-deploy.md`), and that role
reaches only its environment's resources: clusters and pools by the `env` tag, everything named by
its generated name. The archive stack is dev's — it deploys from `dev` alone — so dev's role holds
the archive's grants too and production's holds none of them.

Trust policy, the same for both — CloudFormation only:

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

The inline permission policies are the files, applied as written:

- [`infra/iam/quirenote-backend-cfn-exec-dev.json`](../iam/quirenote-backend-cfn-exec-dev.json)
- [`infra/iam/quirenote-backend-cfn-exec-prod.json`](../iam/quirenote-backend-cfn-exec-prod.json)

`src/stack-split.test.ts` holds each file to the services the resource types that environment
deploys name in their schema handlers, three statements to one action each while a template still
needs it, the Deny statements to a closed list, and every statement the two files share to the same
actions — the resources and the conditions are where they differ, by design. Production alone
carries `StateMachine`, for the archive operations' workflow, a service no type dev deploys uses.

```bash
aws iam create-role --role-name quirenote-backend-cfn-exec-<env> --assume-role-policy-document file://trust.json
aws iam put-role-policy --role-name quirenote-backend-cfn-exec-<env> \
  --policy-name quirenote-backend-cfn-exec-<env>Policy \
  --policy-document "$(cat infra/iam/quirenote-backend-cfn-exec-<env>.json)"
```

### What separates the two environments

**Clusters and pools, by tag.** Their ids are generated, so no name pattern tells production's from
dev's. Every cluster and pool carries `env`: `dev`, `prod`, or `archive` on the archive cluster.
`app` could not be the key, production and the archive sharing `app=quirenote` for the backup
selection. The Service Authorization Reference lists `aws:ResourceTag/${TagKey}` on every `dsql`
cluster action and on every `cognito-idp` pool action the files grant, `aws:RequestTag/${TagKey}`
on `dsql:CreateCluster`, `dsql:TagResource`, `cognito-idp:CreateUserPool`, `UpdateUserPool` and
`TagResource` — and no key at all on `cognito-idp:DescribeUserPoolDomain`, which stays a `*` grant.
So `Database` and `Identity` are conditioned on the resource's tag, `CreateOwnCluster` and
`CreateOwnPool` on the request's, dev's set being `[dev, archive]` and production's `prod`.
`TagANewCluster` and `TagANewPool` allow the create's own `TagResource` under the same request-tag
condition, and only on a resource that carries no `env` yet (`Null`): without that, either role
could retag the other environment's existing cluster or pool into its own. A statement of their own,
because Cognito lists `aws:ResourceTag` on `CreateUserPool` too, and the key would refuse a create.
`KeepTheClusterTag` and `KeepThePoolTag` deny a request that carries an `env` value outside the
role's own set — a pool's set is its environment alone, so dev cannot tag a pool `archive` — and
`KeepTheEnvironmentTagKey` denies removing the key: a template that could retag its own cluster
into the other environment would hand it over, and one that could untag it would lock it out of
both roles until a hand repair. The Denies are conditioned with `Null` and `StringNotEquals`, never
`StringNotEqualsIfExists`: that operator is true when the key is absent, so in a Deny it would
refuse every update that sends no tag at all. The tag has to be on a resource BEFORE the role that requires it
deploys that resource, which is the rollout order below. A cluster or pool with no `env` — one
restored from a recovery point, say — is claimable by whichever role tags it first, so tag it by
hand before any deploy touches it.

**Functions, roles, log groups, queues, alarms and schedules, by name.** CloudFormation generates
`<stack>-<LogicalId>-<suffix>` and TRUNCATES THE STACK NAME inside it: the live production roles
include `quirenote-backend-user-pr-BackupFreshnessFunctionRo-…` and
`quirenote-backend-user-pro-ApplicationsFunctionRole-…`, so `quirenote-backend-user-prod-*` misses
them. The two stack names first differ at `quirenote-backend-user-d` / `quirenote-backend-user-p`,
and every truncation observed keeps more than that, so production's pattern is
`quirenote-backend-user-p*`. The archive's names carry no prefix of their own
(`quirenote-backend-CaptureFunction-…`, `quirenote-backend-archive-reader`), so dev's wildcard is
`quirenote-backend-*` and `NotProductionsNames` denies production's pattern back out across the six
services, `iam` included — which is what keeps dev's `iam:PassRole` off production's roles. Read
the physical names before changing a prefix: a role in the account that matches neither pattern
is a role neither environment can deploy.

**HTTP APIs, by id.** An API's child resources carry no tags in API Gateway V2 and its id is
generated, so each file allows `/apis/*` and `NotTheOtherApi` denies the other environment's id,
its children and its `/tags/` path. The two domain names are chosen, so each file allows its own
alone and denies the other's, with its `/tags/` path. The ids are in the files; the account id is
not. **A REPLACED API IS A SILENT HOLE**: dev's `/apis/*` covers whatever new id production's API
gets, so after any replacement of either API rewrite both files' ids from `aws apigatewayv2
get-apis` before the next dev deploy.

**What stays shared.** The `*` grants — `cloudfront:UpdateDistribution`, `DescribeUserPoolDomain`,
the API Gateway service-linked role, the list calls — and the account's limits. The artifacts bucket
is read by prefix: each role reads `<env>/*`, the prefix its deploy role writes.

### The boundary every stack role carries

**Each role creates or changes no role that lacks ITS OWN ENVIRONMENT'S boundary.** Without that
condition a template could create a role holding `AdministratorAccess` and hand it to a function it
also creates. AWS's least-privilege guidance for CloudFormation says it plainly: "An IAM principal
with permissions to create a role and attach any policy can escalate their own permissions." The
condition sits on every action that changes a role, and each of them takes the
`iam:PermissionsBoundary` key (Service Authorization Reference). Every role a template creates
names its environment's policy: SAM's generated ones through `PermissionsBoundary` on the function,
the state machine or in `Globals`, the declared ones in their own properties — `quirenote-backend-boundary-${Environment}`
in the user template, `quirenote-backend-boundary-dev` in the archive's.

**The boundaries are
[`infra/iam/quirenote-backend-boundary-dev.json`](../iam/quirenote-backend-boundary-dev.json) and
[`infra/iam/quirenote-backend-boundary-prod.json`](../iam/quirenote-backend-boundary-prod.json),
made by hand and never by a stack.** A role able to edit one could lift it, so neither execution
role holds a policy-editing action at all, and no `DeleteRolePermissionsBoundary`. Each allows
exactly the actions that environment's stack roles are granted — the archive's and the dev arm of
the user template for dev, the `IsProd` arm for production — plus the two managed policies SAM
attaches; `src/stack-split.test.ts` holds each file to that. Each scopes clusters and pools by the
`env` tag and the rest by name, the same way as the execution roles, dev's with the same
`NotProductionsNames` Deny. **A grant added to a template therefore needs the boundary widened and
applied BEFORE the deploy that ships it.** Deployed first, the grant is refused at the function's
first call, while the deploy itself goes green. Create each once, then change it by version:

```bash
aws iam create-policy --policy-name quirenote-backend-boundary-<env> \
  --policy-document "$(cat infra/iam/quirenote-backend-boundary-<env>.json)"
aws iam create-policy-version --set-as-default \
  --policy-arn arn:aws:iam::<account-id>:policy/quirenote-backend-boundary-<env> \
  --policy-document "$(cat infra/iam/quirenote-backend-boundary-<env>.json)"
```

A policy keeps five versions, so delete the oldest non-default one before a sixth. **Every file
under `infra/iam/` writes the account field as `*`**, keeping the id out of this public repository.
IAM refuses a policy variable there ("failed legacy parsing") although Access Analyzer passes it, and
`RolesTheStackOwns` compares the boundary ARN with `ArnLike`, the one operator that reads that `*`
as a wildcard — under `StringEquals` the condition never matches and nothing deploys. So no file
pins an account. What keeps a role in this one is the trust policy's `aws:SourceAccount`,
its own grants, and any other account's resource policy, which would have to admit it. Where a
template names a resource it writes the account with `${AWS::AccountId}` or a `!GetAtt`.

**`NotTheRolesThatDeploy` is the Deny both files carry whatever the environment.** The execution
roles and the deploy roles all match `role/quirenote-backend-*` but carry no boundary. Its pattern
is `cfn-exec*`, no hyphen, so it also covers any execution role named before the split. The condition
alone would let a stack IMPORT one of them, put a boundary on it, and then rewrite its trust.

### Rolling a change out

Each role and boundary exists before the deploy that names it, and nothing is tightened until every
role carries its new boundary. Tags first: a cluster or pool without `env` is reachable by neither
role. Then the policies and roles from the files, then the deploy roles' `PassRole` targets, then
each stack re-bounded by a change set through its environment's role, then the old role and
boundary deleted once no stack's `RoleARN` and no role's boundary names them. Edit from a readback:
`put-role-policy` REPLACES the whole inline document.

### The traps, and the grants nothing derivable states

**`ApplyTheSamTransform` is not optional and is not obvious.** `AWS::Serverless-2016-10-31` is a
macro CloudFormation expands **as the execution role**, not as the principal that ran `sam deploy`,
which is why the transform ARN appears in the deploy roles' policies too. **`RolesTheStackOwns`
must match the stack's prefix, and every role must name the boundary, or nothing deploys.** SAM
names the function's execution role after the stack, and either miss fails on `iam:CreateRole` with
an error naming the role, not the policy. Withheld deliberately: `iam:*` outside the prefix, and
anything EC2 or VPC. Expect the first deploy to refuse once or twice: read the resource ARN out of
the error and add exactly that, never `*`.

**A HALF-DONE STACK RENAME LEAVES A DELETION-PROTECTED ORPHAN CLUSTER.** The user stacks
(`quirenote-backend-user-dev`, `…-prod`) are what the two name patterns above are cut from; rename
either and `Function`, `RolesTheStackOwns` and `Logs` break at once. Leave BOTH role documents stale
and the deploy role refuses at `CreateChangeSet` before the execution role is ever assumed — no
stack, no rollback, nothing left behind. Update only `role-deploy.md` and the half-done rename is
what hurts: the stack rolls back while `UserCluster`'s `DeletionPolicy: Retain` holds the cluster,
so clearing the `ROLLBACK_COMPLETE` stack and retrying creates a SECOND cluster unless the orphan is
un-protected and deleted first. `bootstrap-account.sh` takes the stack name for that cleanup.

**The Cognito `*` grants are `*` for different reasons, so none generalises to another.**
`CreateUserPool` creates the thing the ARN would name and a pool id is generated rather than chosen,
so there is nothing to scope it to but the request's tag. `DescribeUserPoolDomain` takes a domain
string and no pool id, so the pool ARN is not in the request for a policy to match; its
`Create`/`Update`/`Delete` siblings do take one and are scoped in `Identity`.
`cloudfront:UpdateDistribution` names a distribution Cognito builds and owns for a custom domain and
checks the caller's permission before building it — so it permits updating **any** distribution in
the account, and what stops the role is that nothing in either template asks.

**`cognito-idp:DeleteUserPool` is deliberately NOT granted.** The pool carries `DeletionPolicy:
Retain` and `DeletionProtection: ACTIVE`, so CloudFormation never issues it — and it is the one
action here that could destroy every identity in an environment. Absent, a stack delete leaves the
pool standing, as both properties already ask, at the cost of one CLI call the day one is meant to go.

**`Identity` is `userpool/*` WITH the tag condition, and the condition is what narrows it.**
`UpdateUserPool` REPLACES rather than merges ("if you don't provide a value for an attribute, Amazon
Cognito sets it to its default value"), so an omitted `AdminCreateUserConfig` RESETS
`AllowAdminCreateUserOnly`; the WebAuthn relying party is reachable through
`cognito-idp:SetUserPoolMfaConfig` on the same statement, and `COGNITO-POOL-PARAMS.md` calls that
value the second irreversible decision. The tag keeps a dev deploy off production's pool. **`HttpApi`
splits the same difference by id**, an HTTP API being addressed by a generated one.

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

**A custom resource is invoked AS THE EXECUTION ROLE, so `InvokeTheGrantProvider` is the one invoke
dev's holds, and production's holds none.** CloudFormation calls the function behind
`ArchiveReaderGrant` with the stack's service role, not as a service principal; without the grant
the custom resource fails `CREATE` with `User:
arn:aws:sts::<account-id>:assumed-role/quirenote-backend-cfn-exec-dev/AWSCloudFormation is not
authorized to perform: lambda:InvokeFunction on resource: …`. The resource is that one function's
name prefix, never `function:quirenote-backend-*`, which would let a template point a custom
resource at a migration runner. **`ConfigureAsyncInvocation` is what an `EventInvokeConfig` takes**,
the four actions the `AWS::Lambda::EventInvokeConfig` type's create, read, update and delete
handlers name, on the name prefix of each function that caps its event age: the grant provider's,
so a late event never runs after CloudFormation has stopped waiting, and the capture's, so a late
one never runs past Inzhur's refresh.

**A grant is for a call a declared resource type's schema handlers name, or it is one of three
statements:** `InvokeTheGrantProvider` for the custom resource, `ApplyTheSamTransform` for the
transform and `ApiGatewayServiceLinkedRole` for the regional domain. `src/stack-split.test.ts`
holds every other statement's services to what those handlers name, and each of the three to its
one action while a template the environment deploys still needs it. It reads services and actions,
never a resource or a condition.

**Account setup:** `bash infra/scripts/bootstrap-account.sh`, idempotent, run in AWS CloudShell,
then the boundaries and the roles above. Set each environment's `AWS_BACKEND_ROLE_ARN` secret to
that environment's own deploy role (`role-deploy.md`). Environment secrets are not shared, and the
`main` push fails on an empty `role-to-assume` without it. `gh secret set` works provided
`GH_CONFIG_DIR="$HOME/.quirenote/gh-config"` is set.
