# Deployment — AWS Amplify Hosting via GitHub Actions

Quirenote is a static SPA on **AWS Amplify Hosting** as a **manual-deploy app**. GitHub Actions is the entire pipeline: it runs
the quality gate, builds `dist/`, and pushes the artifact to Amplify — Amplify never builds (rationale: `docs/DECISIONS.md` §
Deployment). Region: **`eu-north-1`** (Stockholm). App name: `kubushka` in the console — cosmetic.

## 0. Live app

- **Production:** `https://quirenote.com` (and `www.`) — served from the **`main`** branch
- **Development:** `https://dev.quirenote.com` — served from the **`dev`** branch
- App ID: `d17m4jf400my6` — Amplify URLs also work:
  `https://main.d17m4jf400my6.amplifyapp.com`, `https://dev.d17m4jf400my6.amplifyapp.com`
- Region: `eu-north-1`
- IAM role: `quirenote-frontend-deploy` (ARN held in the `AWS_FRONTEND_ROLE_ARN` secret)

**Hosting config stays console-managed** — CI has no `UpdateApp`; the SPA rewrite and cache headers live in §1, not the workflow.

## 0a. The custom domain — `quirenote.com`

| Record | Name | Value |
|---|---|---|
| CNAME | `_f2385149c1ffac22fed755635002cfd6` | `_0dee0158e98c51da584fa5373ae2938c.jkddzztszm.acm-validations.aws` |
| CNAME | `@` (apex) | `d2jaridkoub072.cloudfront.net` |
| CNAME | `www` | `d2jaridkoub072.cloudfront.net` |

DNS is Cloudflare's, not Route 53's — Amplify issues its own free ACM certificate for third-party DNS. **Every HTTP record is
PROXIED; everything else is DNS-only:**

| Record | Mode | Why |
|---|---|---|
| `@`, `www`, `dev` | **proxied** | caches immutable assets, absorbs floods, hides the origin — all three share one CloudFront distribution, so a grey record would publish it for all |
| `_f2385149…` (ACM validation) | dns-only | a proxied CNAME answers with Cloudflare's own address, so ACM never sees what it asked for |
| DKIM / MX / SPF / DMARC | dns-only | mail is not HTTP |

`public/robots.txt` carries `User-agent: * / Disallow: /` — production is closed to crawlers until sign-up ships. **Never pair
`Disallow` with `noindex`** — they cancel: a crawler forbidden to fetch never sees the header. If a URL is ever indexed, the fix
is the opposite of a stricter rule — allow crawling and serve `X-Robots-Tag: noindex`, the only instrument that removes an entry.
The SPA rewrite (§1.2) excludes `txt`, so `/robots.txt` is served as a file, not swallowed into `index.html`. **TLS:**
Cloudflare's Universal SSL certificate to the visitor, ACM `*.quirenote.com` from Cloudflare to CloudFront; the zone's SSL mode
must be **Full (strict)** — `flexible` would loop, since CloudFront answers plain HTTP with a 301-to-HTTPS.

| Host | Amplify branch | Git branch |
|---|---|---|
| `quirenote.com`, `www.quirenote.com` | `main` (stage PRODUCTION) | `main` |
| `dev.quirenote.com` | `dev` (stage DEVELOPMENT) | `dev` |

**`dev` is behind HTTP basic auth** (Amplify → branch `dev` → Access control), covering both `dev.quirenote.com` and
`dev.d17m4jf400my6.amplifyapp.com`; credentials live in the Amplify console, not here. Production carries none. **Its protection
is a pipeline, not a gate:** lint/format/test/build all run before the job assumes any AWS credential; `prod` accepts only `main`;
the role touches nothing but two Amplify branches; the ruleset blocks force-push/delete on `main`. Egress cost is watched by a $5
monthly AWS Budget (alerts at $1 and $3 actual, $5 forecast) plus a daily Cost Anomaly Detection subscription, both with a live
email subscriber — notification only, never an automated shutdown. **The split is the frontend's only:** there is one AWS backend
stack, and `deploy-backend.yml` triggers on `dev` alone, so the backend a production visitor reaches is whatever `dev` last
deployed.

## 1. One-time AWS console setup

Done by hand — the CI role has no permission to change hosting configuration.

### 1.1 Create the app

1. Amplify console → **Create new app** → **Deploy without Git** → Next.
2. App name `quirenote`, branch name `dev`.
3. Method **Drag and drop**, and upload any placeholder zip (a zip containing a one-line
   `index.html` is fine). The first workflow run replaces it.
4. Note the **App ID** (`d…`) from the app's URL or settings, and the resulting site URL
   `https://dev.<appId>.amplifyapp.com`.

### 1.2 SPA rewrite — mandatory

Left nav → **Hosting** → **Rewrites and redirects**. Use the **JSON editor** and paste exactly this — the source is a regular
expression and a typo in it silently breaks the site:

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

Without a rewrite, every non-root route (`/overview`, `/payouts`, …) 404s on refresh or a direct link. **Do not use the naive
`/<*>` → `/index.html` 200 rule** — it also matches `/assets/index-abc123.js`, producing `Content-Type: text/html` on the bundle
and the console error `Failed to load module script: … MIME type of "text/html"`, while `curl` still reports `200`. The regex
above rewrites extensionless paths only.

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

Safe because Vite content-hashes every asset filename.

### 1.4 GitHub OIDC provider

**IAM is a separate AWS service, not part of Amplify** — reach it at `https://console.aws.amazon.com/iam/home#/identity_providers`
(global, no region). IAM → Identity providers → **Add provider** → OpenID Connect (skip if it already exists):

- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

### 1.5 IAM role

Create a role with **Custom trust policy**, name it `quirenote-frontend-deploy`. Trust policy — replace `<account-id>`:

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

**The `sub` is the environment, not the branch** — the token's `sub` claim is `environment:dev`, not `ref:refs/heads/dev`, with
the repo's immutable numeric ID included (real subject: `repo:RomanKushyk@97728952/investment-tracker@1313804031:environment:dev`;
§5 has the verification diagnostic). `environment:*` lets a new environment assume the role with no AWS change, but it still needs
a deployment branch policy (§2).

Inline permission policy — **named `quirenote-frontend-deployPolicy`**. Replace `<account-id>` and `<appId>`:

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

**Both resource lines are needed** — `CreateDeployment` authorizes against `…/branches/dev/deployments/*`, `GetJob` against
`…/branches/dev/jobs/*`, `GetBranch` against `…/branches/dev`. `amplify:UpdateApp` is deliberately absent. **Add a secret, never
rename one** — a renamed secret is broken until the workflow catches up.

## 2. GitHub repository configuration

Settings → Environments → **`dev`** and **`prod`** — `deploy-frontend.yml` picks the environment from the branch (`github.ref_name
== 'main' && 'prod' || 'dev'`). **Both environments carry the same three entries**, each scoped to itself; what differs is the
branch policy (`dev` → `dev`, `prod` → `main`) and the Amplify branch written to:

| Kind | Name | Value |
|------|------|-------|
| Variable | `AMPLIFY_APP_ID` | `d17m4jf400my6` |
| Variable | `AWS_REGION` | `eu-north-1` |
| Secret | `AWS_FRONTEND_ROLE_ARN` | `arn:aws:iam::<account-id>:role/quirenote-frontend-deploy` |

**Deployment branch policy — required, not cosmetic.** Settings → Environments → `<env>` → **Deployment branches and tags** →
*Selected branches and tags* → add the one branch that environment deploys. Since the IAM trust `sub` keys on the environment
rather than the branch (§1.5), this is the only thing preventing a job on another branch from assuming the deploy role — set it at
creation time for every environment added later.

The `gh` CLI works only under the right account: check with `gh auth status`, switch with `gh auth switch --user RomanKushyk`,
confirm with `gh api repos/RomanKushyk/investment-tracker --jq .permissions` before any write.

## 3. Deploying

**`dev` is continuous, `main` is a release.** One workflow serves both, deploying on every push and reading the Amplify branch
from `github.ref_name`. Production is promoted by merging `dev` into `main`, **fast-forward only**, when a version is cut or on
demand (`docs/reference/VERSIONING.md` defines the bump).

`dev` deploys on every push **except commits that touch only Markdown or `docs/`** (via `paths-ignore`, skipped only when every
changed file matches) — that bites harder on `main`, where a docs-only release deploys nothing and needs a manual run. Concurrency
is keyed per branch (`deploy-frontend-${{ github.ref_name }}`). Manual re-deploy: Actions → **Deploy** → **Run workflow**. The run
fails if the Amplify job does not reach `SUCCEED`.

### 3.1 Verifying a deploy

A green run proves the artifact uploaded, **not that the site works** — status codes and cache headers are both satisfied by a
misrouted asset, so check content types too:

```bash
BASE=https://quirenote.com      # or https://dev.quirenote.com for the dev branch
curl -sS -o /dev/null -w 'root=%{http_code}\n' "$BASE/"
curl -sS -o /dev/null -w 'deep=%{http_code}\n' "$BASE/overview"        # SPA rewrite
ASSET=$(curl -sS "$BASE/" | grep -o '/assets/[^"]*\.js' | head -1)
curl -sSI "$BASE$ASSET" | grep -i 'content-type'                       # MUST be javascript
curl -sSI "$BASE/index.html" | grep -i 'cache-control'                 # no-cache
```

`Content-Type: text/html` on a `.js` asset means the rewrite is swallowing static files (§1.2). Finish with a fresh browser
profile: zero console errors, sidebar version badge.

## 4. Rollback

Amplify keeps previous manual deployments per branch. Either use the **Amplify console** → the app → `dev` → deployment history →
redeploy an earlier deployment, or re-run the workflow from the last good commit (Actions → the run → **Re-run all jobs**). Assets
are content-hashed and immutable while `index.html` is `no-cache`, so a rollback takes effect on the next page load with no cache
purge.

## 5. Failure playbook

| Symptom | Cause | Fix |
|---------|-------|-----|
| `configure-aws-credentials` fails or hangs on `sts:AssumeRoleWithWebIdentity` | One of: trust policy `sub` mismatch or missing `id-token: write`; secret holds a role NAME not ARN; `AWS_FRONTEND_ROLE_ARN` empty or wrong scope; the immutable `OWNER@ID/REPO@ID` subject form not matched (§1.5) | Escalate in order: (1) `sub` must be `repo:RomanKushyk/investment-tracker:environment:dev`, **not** `…:ref:refs/heads/dev`, and the workflow must declare `id-token: write`; (2) the value must be a full ARN (`arn:aws:iam::<account-id>:role/<name>`) — a bare name hangs for minutes instead of erroring, and secrets are read when the step executes, so start a new run after fixing it; (3) `role-to-assume: ***` in the run log does NOT prove the secret has a value — confirm it exists in the `dev` **environment** and re-enter it; (4) print the real claim: add a step **before** `configure-aws-credentials`: `TOKEN=$(curl -sS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com" \| jq -r .value)`, base64url-decode the second dot-segment, `jq '{iss,aud,sub}'` — **print claims only, never the token** |
| `AccessDeniedException` on an `amplify:` call | Resource ARN shape — the action authorizes against a sub-resource, not the branch | Read the resource ARN out of the error message. `CreateDeployment` needed `…/branches/dev/deployments/*`, which is why §1.5 grants `…/branches/dev` **and** `…/branches/dev/*` |
| Site returns "Access Denied" | The zip contained the `dist` folder instead of its contents | `cd dist && zip -qr ../dist.zip .` — never `zip -r dist.zip dist` |
| A non-root route 404s, or a blank page with `Failed to load module script … MIME type of "text/html"` | Missing/wrong rewrite (404), or the rewrite matching static assets so `/assets/*.js` returns `index.html` (blank page) | Re-check §1.2 — type must be **200**, source must be its regex, not `/<*>`. Confirm with `curl -sSI "$BASE/assets/<file>.js" \| grep -i content-type` — anything but `application/javascript` is the MIME bug |
| Site serves an old build after a green run, or an asset is still wrong after fixing a rewrite/header rule | `index.html` cached, or a broken response was cached under `max-age=31536000, immutable` (§1.3) — CloudFront and every visitor's browser hold it; query strings do not bust it | Re-check §1.3. **CloudFront:** run any deployment; Amplify invalidates the CDN each time (`X-Cache: Miss` confirms). **Browsers:** hard-reload (Ctrl+Shift+R), or wait for the next code change |
| `pnpm build` fails in CI on esbuild | `@esbuild/linux-x64` not resolvable from a Windows-generated lockfile | Refresh the lockfile so the Linux optional dependency is present; never drop `--frozen-lockfile` |
| Deploy step times out | Amplify job stuck | Check the job in the Amplify console; re-run the workflow. Timeout is `POLL_TIMEOUT_SECONDS` (default 600) |

## 6. Cost

Amplify's free tier is 12 months only (1,000 build min/mo, 15 GB served, 5 GB CDN storage). Builds run in GitHub Actions
(unlimited-free on public repos), so Amplify bills only storage (~1.8 MB ≈ $0.00004/mo) and transfer ($0.15/GB) — effectively
$0/mo solo.
