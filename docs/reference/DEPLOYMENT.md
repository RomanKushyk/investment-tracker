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
| CNAME | `auth` | the PROD stack's `UserPoolDomainCloudFrontAlias` output |
| CNAME | `auth.dev` | the DEV stack's — read from the stack, never constructed |
| CNAME | `api` | the PROD stack's `ApiDomainRegionalTarget` output |
| CNAME | `api.dev` | the DEV stack's — read from the stack, never constructed |

DNS is Cloudflare's, not Route 53's — Amplify issues its own free ACM certificate for third-party DNS. **Every HTTP record is
PROXIED; everything else is DNS-only:**

| Record | Mode | Why |
|---|---|---|
| `@`, `www`, `dev` | **proxied** | caches immutable assets, absorbs floods, hides the origin — all three share one CloudFront distribution, so a grey record would publish it for all |
| `_f2385149…` and every other ACM validation name | dns-only | a proxied CNAME answers with Cloudflare's own address, so ACM never sees what it asked for. There is one pair per certificate, and the API's certificate added its own |
| `auth`, `auth.dev` | **dns-only** | Cognito's managed-login distribution is matched by host and served under a certificate naming it; proxied, Cloudflare answers as itself and the distribution never sees the name it was built for. Same failure as the row above, one layer later |
| `api`, `api.dev` | **dns-only** | an API Gateway custom domain has both of those properties too — matched by host, served under a certificate naming it — so it takes the same treatment for the same reason. The headline rule above says the opposite, which is why this row carries its reason rather than leaving it to be rediscovered |
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
email subscriber — notification only, never an automated shutdown.

**The backend is split too, and asymmetrically** — the environment split stops at user data
(`docs/DECISIONS.md`, **Cloud target**), so the archive has one deploying branch and user data has two:

| Stack | Holds | Deployed from |
|---|---|---|
| `quirenote-backend` | the archive cluster (tagged `app=quirenote`), the capture Lambda, the schedule, the DLQ, the alarms | `dev` only |
| `quirenote-backend-user-dev` | a DSQL cluster of user data, the migration runner for it, and the Cognito pool at `auth.dev.quirenote.com`. Tagged `app=quirenote-dev`, so it is the one cluster the backup plan does NOT take | `dev` |
| `quirenote-backend-user-prod` | the same, tagged `app=quirenote`, at `auth.quirenote.com` — and, because of that tag, strictly more than its dev twin: a nightly Lambda that reads THIS cluster's recovery points, its log group, its schedule and role, a metric filter, and three alarms — one on the age it publishes, two on the function itself. They hang off `IsProd`, so `dev` renders none of them | `main` |

`deploy-backend.yml` fires on both branches and picks its environment from the ref exactly as the frontend does; the archive step
is skipped off `main`. **The consequence worth knowing before it is needed: a `workflow_dispatch` on `main` cannot repair the
archive.** The repair path is a dispatch on `dev`. `migrate.yml` takes a `target`, and a `prod` migration is refused from any
branch but `main` by the `prod` environment's own branch policy — before any credential exists.

**A new POOL resolves nowhere, and the deploy cannot finish it.** Creating the stack creates the
pool and asks Cognito for a CloudFront distribution; the `auth` record above is Cloudflare's and
manual, and until it exists managed login is a hostname that does not resolve while every stack
reads green. The distribution's name is generated, so take it from the stack's
`UserPoolDomainCloudFrontAlias` output rather than constructing it. The stack also declares a
**managed login branding style** for the app client, and that is not decoration: an app client
with no style assigned serves nonfunctional managed login pages, because branding version 2 does
not fall back to the classic UI. It is the same half-done shape as the missing record — green
stack, endpoint nobody can sign in through — which is why the style is in the template rather
than clicked into existence in the branding editor. Its certificate is in
**us-east-1** whatever region the pool is in — the distribution is global — and it covers both
`auth.quirenote.com` and `auth.dev.quirenote.com`, so one certificate serves both stacks and its
ARN is the `AUTH_CERTIFICATE_ARN` secret on both environments.

**A new API resolves nowhere either, and for the same reason one step along.** The stack creates
the HTTP API and its custom domain; the `api` record is Cloudflare's and manual, and until it
exists the hostname resolves nowhere while the stack reads green. The regional endpoint's name is
generated, so take it from the stack's `ApiDomainRegionalTarget` output rather than constructing
it. What differs from the pool is the certificate's Region: an HTTP API custom domain is
**REGIONAL**, and ACM requires the certificate in the API's own Region — **eu-north-1**, not
us-east-1. It covers `api.quirenote.com` and `api.dev.quirenote.com`, so one certificate serves
both stacks and its ARN is the `API_CERTIFICATE_ARN` secret on both environments. Meanwhile the
API's generated `execute-api` hostname is left enabled and is what the route is verified against
before the record exists; the stack publishes it as `ApiEndpoint`.

**A new user cluster is EMPTY, and the deploy does not fill it.** Creating the stack creates the database and the runner; the
schema arrives only when someone dispatches `migrate.yml` against it — `rehearse`, then `dry-run`, then `apply`. Until that
happens the stack is green and the database has no tables, which is the one state where everything looks deployed and nothing
works.

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
    "source": "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|html)$)([^.]+$)/>",
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

**`html` is in that list for a second PAGE, not for an asset type.** Without it the regex's second alternative matches
`/api-docs.html`, which is then served the SPA shell instead of the page — `200 text/html`, and a status code alone cannot tell
the two apart. With it, no rule matches a `.html` path, so Amplify serves the file when there is one — the behaviour `/robots.txt`
already relies on, `txt` being in the same list. **When there is NO such file it does not 404**: Amplify normalises the path to
its extensionless form (`/api-docs.html` → `301` → `/api-docs/`), which the rule above then matches, so the answer is the SPA
shell after a redirect. That is what production returns for this page, and §3.1 checks for it.
Nothing regresses: every SPA route is extensionless and the router declares no path parameter, so no route can acquire a dot;
the only other change is that `GET /index.html` is served as a file rather than rewritten to itself, which is the same bytes.
**The rule set is APP-LEVEL, so this reaches production too** — where the page is not in the artifact, so the paragraph above is
what happens there: a redirect to `/api-docs/` and the SPA shell, never the reference. §3.1 checks that.

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
  - pattern: '/api-docs.html'
    headers:
      - key: 'Cache-Control'
        value: 'no-cache'
```

Safe because Vite content-hashes every asset filename — which is also why the API reference needs no pattern of its own for
its chunks: they land in `/assets/**` like the app's and are immutable for the same reason. **The third pattern is not
optional.** `/api-docs.html` matches neither of the first two, so without it the page falls to Amplify's default, and a cached
copy keeps pointing at a hashed chunk the next deploy removed — a blank page that survives redeploys, which is the failure
this section exists to prevent. It is an entry document like `/index.html` and takes the same `no-cache`.

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
== 'main' && 'prod' || 'dev'`), and `deploy-backend.yml` picks it the same way. Each entry is scoped to its own environment —
**they are not shared**, so an entry present in `dev` and absent in `prod` fails only on the `main` push, with an empty value
rather than an error that names it. What else differs is the branch policy (`dev` → `dev`, `prod` → `main`) and the Amplify
branch written to:

| Kind | Name | Value | In |
|------|------|-------|----|
| Variable | `AMPLIFY_APP_ID` | `d17m4jf400my6` | both |
| Variable | `AWS_REGION` | `eu-north-1` | both |
| Secret | `AWS_ACCOUNT_ID` | the account number | both |
| Secret | `AWS_FRONTEND_ROLE_ARN` | `arn:aws:iam::<account-id>:role/quirenote-frontend-deploy` | both |
| Secret | `AWS_BACKEND_ROLE_ARN` | `arn:aws:iam::<account-id>:role/quirenote-backend-deploy` | both — `prod` needs it since the backend split |

**Deployment branch policy — required, not cosmetic.** Settings → Environments → `<env>` → **Deployment branches and tags** →
*Selected branches and tags* → add the one branch that environment deploys. Since the IAM trust `sub` keys on the environment
rather than the branch (§1.5), this is the only thing preventing a job on another branch from assuming the deploy role — set it at
creation time for every environment added later.

The `gh` CLI works only under the right account, and the way to get there is the CONFIG DIR, never a switch: every `gh` call
here runs with `GH_CONFIG_DIR="$HOME/.quirenote/gh-config"`. **`gh auth switch` is forbidden** (`docs/DECISIONS.md`, **Git
model**) — two accounts share one keyring, so switching signs the other repository's session out from under it. Check with
`gh auth status`, confirm with `gh api repos/RomanKushyk/investment-tracker --jq .permissions` before any write. Writes do work
from here: `gh secret set AWS_BACKEND_ROLE_ARN --env prod --body <arn>` is how that secret was set.

## 3. Deploying

**`dev` is continuous, `main` is a release.** One workflow serves both, deploying on every push and reading the Amplify branch
from `github.ref_name`. Production is promoted by merging `dev` into `main`, **fast-forward only**, when a version is cut or on
demand (`docs/reference/VERSIONING.md` defines the bump).

`dev` deploys on every push **except commits that touch only Markdown, `infra/` or the backend workflow** (via `paths-ignore`,
skipped only when every
changed file matches) — that bites harder on `main`, where a docs-only release deploys nothing and needs a manual run. **`docs/`
is not on that list, and its absence is deliberate:** everything under it is Markdown except `docs/reference/openapi.json`, which
the API reference page is compiled from, so `**/*.md` covers the rest while a regenerated spec correctly triggers a deploy —
otherwise the hosted page would go stale in silence. A spec change therefore also runs on `main`, where the page is not built: the
artifact is byte-identical, though the run still assumes the role and creates a real Amplify deployment. Concurrency is keyed per
branch
(`deploy-frontend-${{ github.ref_name }}`). Manual re-deploy: Actions → **Deploy** → **Run workflow**. The run fails if the
Amplify job does not reach `SUCCEED`.

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

**The API reference is on `dev` ONLY**, and both halves of that are checked — that it is there, and that it is not on production.
It is a second Vite build (`pnpm build:api-docs`) that `deploy-frontend.yml` skips when the ref is `main`, so its absence from
production is a property of the artifact, not of a link or a rule. The basic auth in front of it is the branch's (§0a), which is
also why the first line matters: the page must not be reachable without credentials.

```bash
curl -sSI https://dev.quirenote.com/api-docs.html                          # 401 — branch basic auth
curl -sSI -u "$DEV_USER:$DEV_PASS" https://dev.quirenote.com/api-docs.html # 200, text/html, no-cache
curl -sS  -u "$DEV_USER:$DEV_PASS" https://dev.quirenote.com/api-docs.html | grep -c 'id="swagger-ui"'
curl -sSI https://quirenote.com/api-docs.html | head -1                     # 301 — no such file there
curl -sSL https://quirenote.com/api-docs.html | grep -c 'id="swagger-ui"'   # 0 — never the page
```

**Production's answer is a redirect, not a 404** (§1.2): the file is not in that artifact, so Amplify normalises the path to
`/api-docs/` and the SPA rule serves the shell. What matters is the last line — the reference must never appear there. `-L` is
there to follow that redirect to whatever finally answers; if the page ever did reach production there would be no redirect to
follow, and the grep would return `1` with or without it. Read the DEV side as the positive check: if that one returns the shell
instead of the page, the `html` entry is missing from §1.2 and the rewrite is swallowing the path. Status codes cannot separate
those cases, which is why both sides fetch a body.

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
