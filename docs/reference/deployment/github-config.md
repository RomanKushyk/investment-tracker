# Deployment — GitHub repository configuration (§2)

> Moved **verbatim** from [`../DEPLOYMENT.md`](../DEPLOYMENT.md) on 2026-08-26 (D95). Secrets, variables and what the workflow expects to find.

## 2. GitHub repository configuration

Settings → Environments → **`dev`** and **`prod`**. Every value lives in an environment's
scope, so `deploy-frontend.yml` picks the environment from the branch
(`github.ref_name == 'main' && 'prod' || 'dev'`) — without an environment the job reads them
as empty. **Both environments carry the same three entries**, because each environment sees
only its own:

| Kind | Name | Value |
|------|------|-------|
| Variable | `AMPLIFY_APP_ID` | `d17m4jf400my6` |
| Variable | `AWS_REGION` | `eu-north-1` |
| Secret | `AWS_FRONTEND_ROLE_ARN` | `arn:aws:iam::<account-id>:role/quirenote-frontend-deploy` |

The two environments deploy the same app with the same role — what differs is the branch
policy (`dev` → `dev`, `prod` → `main`) and the Amplify branch the job writes to.

Repo-level (Settings → Secrets and variables → Actions) would work too — a job with an
environment can still read repo-scoped values; environment-scoped ones just take precedence.

**Deployment branch policy — required, not cosmetic.** Settings → Environments → `<env>` →
**Deployment branches and tags** → *Selected branches and tags* → add the one branch that
environment deploys (`dev` → `dev`, `prod` → `main`). Since the IAM trust `sub` keys on the
environment rather than the branch (§1.5), this policy is the only thing preventing a job on
another branch from targeting an environment and assuming the deploy role — **including a
dev-branch job targeting `prod`**.

**This applies to every environment you add later.** The trust policy accepts
`environment:*`, so a new environment is trusted the moment it exists — its branch policy is
the whole of its branch restriction. Set it at creation time, not afterwards.

The `gh` CLI works, but only under the right account: the development machine has **two**
GitHub accounts in its keyring and the active one flips between sessions. The work account
has read-only access here, so `gh secret set` returns 403 under it. Check with
`gh auth status`, switch with `gh auth switch --user RomanKushyk`, and confirm with
`gh api repos/RomanKushyk/investment-tracker --jq .permissions` before any write. The web UI
is always available as the fallback.

The role ARN is a secret only because it embeds the AWS account ID; it grants nothing
without the OIDC trust. The app ID is a variable because it is already public in the site
URL.

