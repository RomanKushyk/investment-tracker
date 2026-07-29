# Deployment — AWS Amplify Hosting via GitHub Actions

Kubushka is a static SPA deployed to **AWS Amplify Hosting** as a **manual-deploy app**
(created with "Deploy without Git"). GitHub Actions is the entire pipeline: it runs the
quality gate, builds `dist/`, and pushes the artifact to Amplify. Amplify never builds.

Rationale and the rejected alternatives: `docs/DECISIONS.md` D15.
Design spec: `docs/superpowers/specs/2026-07-29-amplify-hybrid-deploy-design.md`.

Region: **`eu-north-1`** (Europe / Stockholm). App name: `kubushka`. Branch label: `dev`.

The design spec proposed `eu-central-1`; the app was created in Stockholm and there is no
benefit to moving it — CloudFront fronts the content either way, and recreating the app
would change the `appId` and the site URL. `eu-north-1` is the operative value everywhere:
the IAM resource ARNs below and the `AWS_REGION` repo variable.

## 0. Live app

- URL: `https://dev.d17m4jf400my6.amplifyapp.com`
- App ID: `d17m4jf400my6` (public — it is part of the URL)
- Region: `eu-north-1`
- IAM role: `kubushka-github-deploy` (ARN held in the `AWS_ROLE_ARN` repo secret; the
  account ID stays out of this file deliberately)

## 1. One-time AWS console setup

Done by hand, deliberately not automated — the CI role has no permission to change hosting
configuration.

### 1.1 Create the app

1. Amplify console → **Create new app** → **Deploy without Git** → Next.
2. App name `kubushka`, branch name `dev`.
3. Method **Drag and drop**, and upload any placeholder zip (a zip containing a one-line
   `index.html` is fine). The first workflow run replaces it.
4. Note the **App ID** (`d…`) from the app's URL or settings, and the resulting site URL
   `https://dev.<appId>.amplifyapp.com`.

### 1.2 SPA rewrite — mandatory

Left nav → **Hosting** → **Rewrites and redirects** → add rule:

| Source | Target | Type |
|--------|--------|------|
| `/<*>` | `/index.html` | 200 (Rewrite) |

Without this, every non-root route (`/overview`, `/payouts`, …) returns 404 on refresh or
direct link, because those paths exist only in the client-side router.

### 1.3 Cache headers

Left nav → **Hosting** → **Custom headers and cache**:

```yaml
customHeaders:
  - pattern: '/index.html'
    headers:
      - key: 'Cache-Control'
        value: 'no-cache'
  - pattern: '/assets/**'
    headers:
      - key: 'Cache-Control'
        value: 'public, max-age=31536000, immutable'
```

Safe because Vite content-hashes every asset filename. Set these explicitly rather than
relying on undocumented defaults: the failure mode is a permanently stale `index.html`
pinning visitors to an old build.

### 1.4 GitHub OIDC provider

**IAM is a separate AWS service, not part of Amplify** — nothing in the Amplify app's left
nav leads to it. Reach it from the console search bar (`Alt+S` → `IAM`) or directly at
`https://console.aws.amazon.com/iam/home#/identity_providers`. IAM is global: the region
selector does not apply.

IAM → Identity providers → **Add provider** → OpenID Connect:

- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

Skip if the account already has this provider.

### 1.5 IAM role

Create a role with **Custom trust policy**, name it `kubushka-github-deploy`.

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
          "token.actions.githubusercontent.com:sub": "repo:RomanKushyk/investment-tracker:environment:*"
        }
      }
    }
  ]
}
```

**The `sub` is the environment, not the branch.** Because `deploy.yml`'s job declares
`environment: dev`, GitHub replaces the branch ref in the token's `sub` claim with
`environment:dev` — a trust policy pinned to `ref:refs/heads/dev` never matches and fails
with `Not authorized to perform sts:AssumeRoleWithWebIdentity`. The two forms are mutually
exclusive: a job either has an environment or it does not.

**Why `environment:*` rather than `environment:dev`.** A new GitHub environment then needs no
AWS change at all — it can assume the role the moment it exists. `StringLike` is required for
the wildcard (`StringEquals` does not glob); `aud` stays an exact match. The boundaries that
still hold are the ones that matter: **this repo only** (the `sub` prefix) and **this Amplify
app's `dev` branch only** (the permission policy below). Widening trust does not widen reach.

Two consequences, both deliberate:

- **Every new environment is implicitly trusted.** The discipline moves to GitHub: give each
  environment a deployment branch policy when you create it (§2). Without one, a job on any
  branch can target that environment and assume this role.
- **A new environment that deploys a different Amplify branch still needs one AWS edit** —
  widen the permission policy's `branches/dev` to `branches/<name>` or `branches/*`. Left
  pinned deliberately: nothing needs it yet.

Inline permission policy `kubushka-amplify-deploy` — replace `<account-id>` and `<appId>`:

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
        "amplify:GetBranch"
      ],
      "Resource": "arn:aws:amplify:eu-north-1:<account-id>:apps/<appId>/branches/dev"
    },
    {
      "Sid": "AmplifyJobStatus",
      "Effect": "Allow",
      "Action": "amplify:GetJob",
      "Resource": "arn:aws:amplify:eu-north-1:<account-id>:apps/<appId>/branches/dev/jobs/*"
    }
  ]
}
```

`amplify:UpdateApp` is deliberately absent: rewrites and headers stay console-managed, so a
compromised workflow cannot reconfigure hosting. If a run fails with
`UnauthorizedException`, widen the **resource** to `apps/<appId>/*` first — widen the action
list only if that is not enough — and record what was needed in §5.

## 2. GitHub repository configuration

Settings → Environments → **`dev`**. All three live in that environment's scope, so
`deploy.yml` declares `environment: name: dev` — without it the job reads them as empty.

| Kind | Name | Value |
|------|------|-------|
| Variable | `AMPLIFY_APP_ID` | `d17m4jf400my6` |
| Variable | `AWS_REGION` | `eu-north-1` |
| Secret | `AWS_ROLE_ARN` | `arn:aws:iam::<account-id>:role/kubushka-github-deploy` |

Repo-level (Settings → Secrets and variables → Actions) would work too — a job with an
environment can still read repo-scoped values; environment-scoped ones just take precedence.

**Deployment branch policy — required, not cosmetic.** Settings → Environments → `dev` →
**Deployment branches and tags** → *Selected branches and tags* → add `dev`. Since the IAM
trust `sub` keys on the environment rather than the branch (§1.5), this policy is the only
thing preventing a job on another branch from targeting environment `dev` and assuming the
deploy role.

**This applies to every environment you add later.** The trust policy accepts
`environment:*`, so a new environment is trusted the moment it exists — its branch policy is
the whole of its branch restriction. Set it at creation time, not afterwards.

Use the **web UI**. The `gh` CLI on the development machine is authenticated as a different
GitHub account with read-only access to this repo, so `gh secret set` returns 403.

The role ARN is a secret only because it embeds the AWS account ID; it grants nothing
without the OIDC trust. The app ID is a variable because it is already public in the site
URL.

## 3. Deploying

Automatic on every push to `dev`. Manual re-deploy without a commit: Actions →
**Deploy** → **Run workflow**.

The workflow fails the run if the Amplify job does not reach `SUCCEED`, so a green badge
means the artifact is live — not merely uploaded.

## 4. Rollback

Amplify keeps previous manual deployments per branch. Either:

- **Amplify console** → the app → `dev` → deployment history → redeploy an earlier
  deployment; or
- re-run the workflow from the last good commit (Actions → the run → **Re-run all jobs**),
  which rebuilds and redeploys that tree.

Because assets are content-hashed and immutable while `index.html` is `no-cache`, a rollback
takes effect on the next page load without a cache purge.

## 5. Failure playbook

| Symptom | Cause | Fix |
|---------|-------|-----|
| Run fails at `configure-aws-credentials` with `Not authorized to perform sts:AssumeRoleWithWebIdentity` | Trust policy `sub` does not match, or `permissions: id-token: write` missing | The job declares `environment: dev`, so the `sub` must be `repo:RomanKushyk/investment-tracker:environment:dev` — **not** `…:ref:refs/heads/dev` (§1.5). Also confirm the workflow declares `id-token: write` |
| Same `sts:AssumeRoleWithWebIdentity` error, but the trust policy is verified correct | `AWS_ROLE_ARN` is empty or set in the wrong scope | **`role-to-assume: ***` in the run log does NOT prove the secret has a value** — masking looks identical for an empty secret. Confirm the secret exists in the `dev` **environment** (not repo-level only, not the `Production` environment) and re-enter its value |
| `UnauthorizedException` on an `amplify:` call | Resource ARN shape | Widen resource to `apps/<appId>/*` per §1.5, record it here |
| Site returns "Access Denied" | The zip contained the `dist` folder instead of its contents | `cd dist && zip -qr ../dist.zip .` — never `zip -r dist.zip dist` |
| A non-root route 404s | Missing or wrong rewrite | Re-check §1.2; type must be **200**, not 301/302 |
| Site serves an old build after a green run | `index.html` cached | Re-check §1.3 |
| `pnpm build` fails in CI on esbuild | `@esbuild/linux-x64` not resolvable from a Windows-generated lockfile | Refresh the lockfile so the Linux optional dependency is present; never drop `--frozen-lockfile` |
| Deploy step times out | Amplify job stuck | Check the job in the Amplify console; re-run the workflow. Timeout is `POLL_TIMEOUT_SECONDS` (default 600) |

## 6. Cost

Amplify's free tier is **12 months only** for new accounts (1,000 build min/mo, 15 GB
served, 5 GB CDN storage) — there is no always-free tier afterwards. Because builds run in
GitHub Actions (unlimited-free on public repos), Amplify bills only storage
(~1.8 MB ≈ $0.00004/mo) and transfer ($0.15/GB). Solo use is effectively $0/mo.
