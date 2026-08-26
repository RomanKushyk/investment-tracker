# Deployment — the deploy IAM role (§1.5)

> Moved **verbatim** from [`../DEPLOYMENT.md`](../DEPLOYMENT.md) on 2026-08-26 (D95). The role CI assumes, its trust policy and its permissions, plus why it is named what it is (D42).

### 1.5 IAM role

Create a role with **Custom trust policy**, name it `quirenote-frontend-deploy`.

Trust policy — replace `<account-id>`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:RomanKushyk@97728952/investment-tracker@1313804031:environment:*"
        }
      }
    }
  ]
}
```

**The `sub` is the environment, not the branch.** Because `deploy-frontend.yml`'s job declares
`environment: dev`, GitHub replaces the branch ref in the token's `sub` claim with
`environment:dev` — a trust policy pinned to `ref:refs/heads/dev` never matches and fails
with `Not authorized to perform sts:AssumeRoleWithWebIdentity`. The two forms are mutually
exclusive: a job either has an environment or it does not.

**The owner and repo carry immutable numeric IDs.** GitHub repositories created after
2026-07-15 use the immutable subject format `repo:OWNER@OWNER-ID/REPO@REPO-ID:…`, and those
IDs cannot be removed from the claim. This repo's real subject is
`repo:RomanKushyk@97728952/investment-tracker@1313804031:environment:dev`, so a policy written
as `repo:RomanKushyk/investment-tracker:…` never matches — it fails identically to a wrong
branch/environment, with no hint as to why. Verify the actual claim rather than assuming the
name-only form (§5 has the one-step diagnostic).

Pinning the IDs is also strictly better than pinning names: it survives a repo or account
rename and cannot be impersonated by a similarly-named account.

**Why `environment:*` rather than `environment:dev`.** A new GitHub environment then needs no
AWS change at all — it can assume the role the moment it exists. `StringLike` is required for
the wildcard (`StringEquals` does not glob); `aud` stays an exact match. The boundaries that
still hold are the ones that matter: **this repo only** (the ID-pinned `sub` prefix) and
**this Amplify app's `dev` branch only** (the permission policy below). Widening trust does
not widen reach.

Two consequences, both deliberate:

- **Every new environment is implicitly trusted.** The discipline moves to GitHub: give each
  environment a deployment branch policy when you create it (§2). Without one, a job on any
  branch can target that environment and assume this role.
- **A new environment that deploys a different Amplify branch still needs one AWS edit** —
  widen the permission policy's `branches/dev` to `branches/<name>` or `branches/*`. **Done
  2026-08-14** for the production split: the policy now names `main` and `dev` explicitly
  rather than `branches/*`, so a third branch is still a deliberate edit.

Inline permission policy — **named `quirenote-frontend-deployPolicy` in the console**, which
is what `aws iam get-role-policy --policy-name` needs. Replace `<account-id>` and `<appId>`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AmplifyManualDeploy",
      "Effect": "Allow",
      "Action": [
        "amplify:CreateDeployment",
        "amplify:StartDeployment",
        "amplify:GetBranch",
        "amplify:GetJob"
      ],
      "Resource": [
        "arn:aws:amplify:eu-north-1:<account-id>:apps/<appId>/branches/main",
        "arn:aws:amplify:eu-north-1:<account-id>:apps/<appId>/branches/main/*",
        "arn:aws:amplify:eu-north-1:<account-id>:apps/<appId>/branches/dev",
        "arn:aws:amplify:eu-north-1:<account-id>:apps/<appId>/branches/dev/*"
      ]
    }
  ]
}
```

**Both resource lines are needed.** The actions do not all act on the branch itself:
`CreateDeployment` authorizes against `…/branches/dev/deployments/*` (AWS names it explicitly
in the `AccessDeniedException`), `GetJob` against `…/branches/dev/jobs/*`, while `GetBranch`
acts on `…/branches/dev`. Pinning only the branch fails on the very first call. The pair
covers the branch and every sub-resource under it, which is tighter than the `apps/<appId>/*`
that the design spec offered as the fallback — other branches and app-level operations stay
out of reach.

`amplify:UpdateApp` is deliberately absent: rewrites and headers stay console-managed, so a
compromised workflow cannot reconfigure hosting. If a future `AccessDeniedException` names a
resource outside this branch, add that exact ARN rather than broadening to `apps/<appId>/*` —
the error message always states the resource it wanted.

### 1.5a Why the role is named that (D42)

It was `kubushka-github-deploy` until 2026-08-11, and the rename fixed more than
the product name. **The old name described the mechanism, not the target.** Its
sibling on the backend was `kubushka-backend-deploy` — named for what it
deploys. Both roles are assumed by GitHub Actions, so "github" distinguished
nothing: noise in one name, absent from the other. The scheme is now
`quirenote-<target>-<function>`:

```
quirenote-frontend-deploy     → Amplify hosting
quirenote-backend-deploy      → the CloudFormation stack
quirenote-backend-cfn-exec    → CloudFormation's own execution role
```

The secrets follow the same scheme: `AWS_FRONTEND_ROLE_ARN` and
`AWS_BACKEND_ROLE_ARN`, both in the **`dev` environment** scope.

**Two things that cutover taught, worth keeping for the next one:**

- **Add a secret, never rename one.** A renamed secret is broken from the moment
  of the rename until the workflow catches up, and the workflow cannot be
  changed atomically with it. Both must coexist until the new path is verified.
- **`role-to-assume` needs the full ARN.** A bare role name does not error — the
  action retries the STS call with backoff, so the step hangs for minutes and
  reads as a slow runner. See §5.

**The Amplify app's own name** is still `kubushka` in the console. It is
cosmetic, and the **App ID does not change**, so
`https://dev.d17m4jf400my6.amplifyapp.com` is unaffected either way. Renaming
the app does not move the site; the URL changes only when the custom domain
from `PLAN-NOW.md` A11 lands.

