# Deployment — AWS Amplify Hosting via GitHub Actions

Quirenote is a static SPA deployed to **AWS Amplify Hosting** as a **manual-deploy app**
(created with "Deploy without Git"). GitHub Actions is the entire pipeline: it runs the
quality gate, builds `dist/`, and pushes the artifact to Amplify. Amplify never builds.

Rationale and the rejected alternatives: `docs/DECISIONS.md` D15.
Design spec: `docs/superpowers/specs/2026-07-29-amplify-hybrid-deploy-design.md`.

Region: **`eu-north-1`** (Europe / Stockholm). App name: `kubushka` in the console
(cosmetic, see §1.5a). Branch label: `dev`.

The design spec proposed `eu-central-1`; the app was created in Stockholm and there is no
benefit to moving it — CloudFront fronts the content either way, and recreating the app
would change the `appId` and the site URL. `eu-north-1` is the operative value everywhere:
the IAM resource ARNs below and the `AWS_REGION` repo variable.

## 0. Live app

- URL: `https://dev.d17m4jf400my6.amplifyapp.com`
- App ID: `d17m4jf400my6` (public — it is part of the URL)
- Region: `eu-north-1`
- IAM role: `quirenote-frontend-deploy` (ARN held in the `AWS_FRONTEND_ROLE_ARN` secret; the
  account ID stays out of this file deliberately)

## 1. One-time AWS console setup

Done by hand, deliberately not automated — the CI role has no permission to change hosting
configuration.

### 1.1 Create the app

1. Amplify console → **Create new app** → **Deploy without Git** → Next.
2. App name `quirenote`, branch name `dev`.
3. Method **Drag and drop**, and upload any placeholder zip (a zip containing a one-line
   `index.html` is fine). The first workflow run replaces it.
4. Note the **App ID** (`d…`) from the app's URL or settings, and the resulting site URL
   `https://dev.<appId>.amplifyapp.com`.

### 1.2 SPA rewrite — mandatory

Left nav → **Hosting** → **Rewrites and redirects**. Use the **JSON editor** and paste
exactly this — the source is a regular expression and a typo in it silently breaks the site:

```json
[
  {
    "source": "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>",
    "status": "200",
    "target": "/index.html",
    "condition": null
  }
]
```

Without a rewrite, every non-root route (`/overview`, `/payouts`, …) returns 404 on refresh or
direct link, because those paths exist only in the client-side router.

**Do not use the naive `/<*>` → `/index.html` 200 rule.** It matches *every* path, including
`/assets/index-abc123.js`, so the browser requests the app bundle and receives `index.html`
with `Content-Type: text/html`. The result is a blank page and one console error —
`Failed to load module script: Expected a JavaScript-or-Wasm module script but the server
responded with a MIME type of "text/html"` — while `curl` still reports `200` on every URL.
The regex above is AWS's documented SPA pattern: it rewrites extensionless paths only, and
excludes the extensions this app actually ships (`js`, `css`, `woff`, `woff2`).

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
  widen the permission policy's `branches/dev` to `branches/<name>` or `branches/*`. Left
  pinned deliberately: nothing needs it yet.

Inline permission policy `quirenote-amplify-deploy` — replace `<account-id>` and `<appId>`:

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

## 2. GitHub repository configuration

Settings → Environments → **`dev`**. All three live in that environment's scope, so
`deploy-frontend.yml` declares `environment: name: dev` — without it the job reads them as empty.

| Kind | Name | Value |
|------|------|-------|
| Variable | `AMPLIFY_APP_ID` | `d17m4jf400my6` |
| Variable | `AWS_REGION` | `eu-north-1` |
| Secret | `AWS_FRONTEND_ROLE_ARN` | `arn:aws:iam::<account-id>:role/quirenote-frontend-deploy` |

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

Automatic on every push to `dev`, **except commits that touch only Markdown or `docs/`** —
those cannot change `dist/`, so `paths-ignore` skips them. A commit touching both docs and
code still deploys; `paths-ignore` skips only when every changed file matches.

Manual re-deploy without a commit — also the way to ship after a docs-only change: Actions →
**Deploy** → **Run workflow**.

The workflow fails the run if the Amplify job does not reach `SUCCEED`, so a green badge
means the artifact is live — not merely uploaded.

### 3.1 Verifying a deploy

A green run proves the artifact uploaded, **not that the site works**. Status codes and cache
headers are both satisfied by a misrouted asset, so check **content types and the browser
console** too:

```bash
BASE=https://dev.d17m4jf400my6.amplifyapp.com
curl -sS -o /dev/null -w 'root=%{http_code}\n' "$BASE/"
curl -sS -o /dev/null -w 'deep=%{http_code}\n' "$BASE/overview"        # SPA rewrite
ASSET=$(curl -sS "$BASE/" | grep -o '/assets/[^"]*\.js' | head -1)
curl -sSI "$BASE$ASSET" | grep -i 'content-type'                       # MUST be javascript
curl -sSI "$BASE/index.html" | grep -i 'cache-control'                 # no-cache
```

`Content-Type: text/html` on a `.js` asset means the rewrite is swallowing static files
(§1.2). Finish by loading the site in a **fresh browser profile** and confirming zero console
errors plus the sidebar version badge — an empty IndexedDB is the only way to exercise the
seed path, and the console is the only place a MIME-type failure shows up.

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
| `configure-aws-credentials` **hangs for minutes** instead of failing | The secret holds a role NAME, not a full ARN | Observed 2026-08-11. The step normally takes seconds; the action retries the STS call with backoff, so a bad value looks like a slow runner rather than an error. **A long `configure-aws-credentials` is itself the symptom.** For OIDC the full ARN is required — the action can only expand a bare name when it already has credentials naming the account, and OIDC starts with none. Fix the value to `arn:aws:iam::<account-id>:role/<name>` and **start a new run**: secrets are read when the step executes, so editing one mid-run does not affect it |
| Same `sts:AssumeRoleWithWebIdentity` error, but the trust policy is verified correct | `AWS_FRONTEND_ROLE_ARN` is empty or set in the wrong scope | **`role-to-assume: ***` in the run log does NOT prove the secret has a value** — masking looks identical for an empty secret. Confirm the secret exists in the `dev` **environment** (not repo-level only, not the `Production` environment) and re-enter its value |
| Same error with the secret and trust policy both verified | The `sub` claim does not literally equal what the policy expects — most likely the immutable `OWNER@ID/REPO@ID` form (§1.5) | Print the real claim instead of guessing. Add a temporary step **before** `configure-aws-credentials` and compare its `sub` to the policy: `TOKEN=$(curl -sS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com" \| jq -r .value)`, then base64url-decode the second dot-segment and `jq '{iss,aud,sub}'`. **Print claims only — never the token**, which is a live credential, in a public repo |
| `AccessDeniedException` on an `amplify:` call | Resource ARN shape — the action authorizes against a sub-resource, not the branch | Read the resource ARN out of the error message; it states exactly what was wanted. `CreateDeployment` needed `…/branches/dev/deployments/*`, which is why §1.5 grants `…/branches/dev` **and** `…/branches/dev/*` |
| Site returns "Access Denied" | The zip contained the `dist` folder instead of its contents | `cd dist && zip -qr ../dist.zip .` — never `zip -r dist.zip dist` |
| A non-root route 404s | Missing or wrong rewrite | Re-check §1.2; type must be **200**, not 301/302 |
| Blank page; console shows `Failed to load module script … MIME type of "text/html"` | The rewrite is matching static assets, so `/assets/*.js` returns `index.html` | The source must be §1.2's regex, **not** `/<*>`. Confirm with `curl -sSI "$BASE/assets/<file>.js" \| grep -i content-type` — anything but `application/javascript` is this bug. Note `curl` reports `200` and the correct `Cache-Control` either way, because header rules match on path regardless of the rewrite |
| Site serves an old build after a green run | `index.html` cached | Re-check §1.3 |
| Asset still wrong after fixing a rewrite or header rule | A broken response was cached under `max-age=31536000, immutable` (§1.3), so both CloudFront and every visitor's browser hold it. Query strings do not bust it — Amplify's cache key ignores them for static assets | **CloudFront:** run any deployment; Amplify invalidates the CDN on each one (`X-Cache: Miss` confirms). **Browsers that loaded the broken build:** hard-reload (Ctrl+Shift+R), or wait for the next code change — a new content hash means a new URL, which self-heals. Confirm a real fix with `curl -sSI` on the asset, since a stale entry also returns `200` |
| `pnpm build` fails in CI on esbuild | `@esbuild/linux-x64` not resolvable from a Windows-generated lockfile | Refresh the lockfile so the Linux optional dependency is present; never drop `--frozen-lockfile` |
| Deploy step times out | Amplify job stuck | Check the job in the Amplify console; re-run the workflow. Timeout is `POLL_TIMEOUT_SECONDS` (default 600) |

## 6. Cost

Amplify's free tier is **12 months only** for new accounts (1,000 build min/mo, 15 GB
served, 5 GB CDN storage) — there is no always-free tier afterwards. Because builds run in
GitHub Actions (unlimited-free on public repos), Amplify bills only storage
(~1.8 MB ≈ $0.00004/mo) and transfer ($0.15/GB). Solo use is effectively $0/mo.
