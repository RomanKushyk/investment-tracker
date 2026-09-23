# Deployment — AWS Amplify Hosting via GitHub Actions

Quirenote is a static SPA on **AWS Amplify Hosting** as a **manual-deploy app**; GitHub Actions is
the whole pipeline and Amplify never builds (*Deployment*). Region `eu-north-1`, app ID
`d17m4jf400my6`, console app name `kubushka` — cosmetic, the old name. `main` serves `quirenote.com`
and `www.`, `dev` serves `dev.quirenote.com`, and the `{main,dev}.d17m4jf400my6.amplifyapp.com` URLs
answer too. **Hosting config stays console-managed**: CI has no `UpdateApp`, so the rewrite (§3.1)
and the cache headers (§3.2) cannot be restored by a deploy.

## 1. The custom domain — `quirenote.com`

| Record | Name | Value |
|---|---|---|
| CNAME | `_f2385149c1ffac22fed755635002cfd6` | `_0dee0158e98c51da584fa5373ae2938c.jkddzztszm.acm-validations.aws` |
| CNAME | `@` (apex) | `d2jaridkoub072.cloudfront.net` |
| CNAME | `www` | `d2jaridkoub072.cloudfront.net` |
| CNAME | `auth` | the PROD stack's `UserPoolDomainCloudFrontAlias` output |
| CNAME | `auth.dev` | the DEV stack's — read from the stack, never constructed |
| CNAME | `api` | the PROD stack's `ApiDomainRegionalTarget` output |
| CNAME | `api.dev` | the DEV stack's — read from the stack, never constructed |

DNS is Cloudflare's, not Route 53's — Amplify issues its own free ACM certificate for third-party DNS.
**Every HTTP record is PROXIED; everything else is DNS-only**, and each exception carries its reason
because the headline rule says the opposite of what it does:

| Record | Mode | Why |
|---|---|---|
| `@`, `www`, `dev` | **proxied** | all three share one CloudFront distribution, so a grey record would publish it for all |
| every ACM validation name | dns-only | a proxied CNAME answers with Cloudflare's own address, so ACM never sees what it asked for. One pair per certificate |
| `auth`, `auth.dev` | **dns-only** | Cognito's managed-login distribution is matched by host and served under a certificate naming it; proxied, Cloudflare answers as itself and the distribution never sees the name it was built for |
| `api`, `api.dev` | **dns-only** | an API Gateway custom domain has both of those properties too, so it takes the same treatment for the same reason |
| DKIM / MX / SPF / DMARC | dns-only | mail is not HTTP |

`public/robots.txt` closes production to crawlers until sign-up ships. **Never pair `Disallow` with
`noindex`** — they cancel, because a crawler forbidden to fetch never sees the header; removing an
indexed URL means allowing the crawl and serving `X-Robots-Tag: noindex`. **The zone's SSL mode must
be Full (strict)** — `flexible` loops, since CloudFront answers plain HTTP with a 301-to-HTTPS.
**`dev` is behind HTTP basic auth** (Amplify → branch `dev` → Access control), covering both its
hostnames; the credentials live in the console, not here, and production carries none. Egress is
watched by a $5 monthly AWS Budget (alerts at $1 and $3 actual, $5 forecast) and a daily Cost
Anomaly Detection subscription, notification-only and held in no template. **A notification budget
costs nothing however many the account holds** (quota 20,000, raisable); what bills is an
action-enabled budget or a budget report, and this account uses neither.

## 2. The backend stacks, and the four states a green one hides

The environment split stops at user data (`docs/DECISIONS.md`, **Cloud target**), so the archive has
one deploying branch and user data two:

| Stack | Holds | Deployed from |
|---|---|---|
| `quirenote-backend` | the archive cluster (tagged `app=quirenote`), the capture Lambda, the schedule, the DLQ, the alarms | `dev` only |
| `quirenote-backend-user-dev` | a DSQL cluster of user data, its migration runner, and the Cognito pool at `auth.dev.quirenote.com`. Tagged `app=quirenote-dev`, so it is the one cluster the backup plan does NOT take | `dev` |
| `quirenote-backend-user-prod` | the same, tagged `app=quirenote`, at `auth.quirenote.com` — and because of that tag strictly more: two nightly Lambdas (recovery points, pool count against the free tier), each with log group, schedule and role, a metric filter, and three alarms. They hang off `IsProd`, so `dev` renders none | `main` |

The archive step is skipped off `main`, **so a `workflow_dispatch` on `main` cannot repair the archive**
— the repair path is a dispatch on `dev`. A `prod` migration is refused from any branch but `main` by the
`prod` environment's deployment branch policy, before any credential exists, on both paths — the deploy's
apply job and a hand dispatch resolve the same environment. **No reviewer stands in front of either**; what
carries a failed apply is the `notify` job, which opens an issue.

**A new POOL resolves nowhere, and a new API does not either**: the `auth` and `api` records are
Cloudflare's and manual, so until they exist the hostnames answer nothing while every stack reads
green. Their certificates differ in Region — the pool's distribution is global, so
`AUTH_CERTIFICATE_ARN` must be in **us-east-1** whatever region the pool is in, while an HTTP API
custom domain is **REGIONAL** and ACM requires `API_CERTIFICATE_ARN` in `eu-north-1`. Each covers
both of its hosts, so one ARN per pair serves both environments. The API's generated
`execute-api` hostname is left enabled, and published as the `ApiEndpoint` output, which is what
a route is verified against before the record exists. **An app client
with no managed login BRANDING STYLE serves nonfunctional pages**, branding version 2 not falling
back to the classic UI — same shape again, which is why the style is declared in the template rather
than clicked into the branding editor. **And a new user cluster is EMPTY until the deploy that made it
fills it:** the last step of the deploy job plans against the stack it just updated, and a `migrate` job
rehearses and applies whatever that plan counted as pending.

## 3. One-time AWS console setup

Done by hand, the CI role having no permission for it — the app included: **Deploy without Git**,
app name `quirenote`, branch `dev`, **Drag and drop**, any placeholder zip.

### 3.1 SPA rewrite — mandatory

**Hosting** → **Rewrites and redirects** → the **JSON editor**. The source is a regular expression and a
typo in it silently breaks the site, so paste it:

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

**Do not use the naive `/<*>` → `/index.html` rule** — it also matches `/assets/index-abc123.js`,
serving the bundle as `text/html` while `curl` still reports `200` (§6). **`html` is in that list
for a second PAGE, not an asset type:** without it the regex matches `/api-docs.html` and serves the
SPA shell instead of the page, which no status code distinguishes. With it no rule matches a `.html`
path, so Amplify serves the file when there is one — and when there is none it still does not 404,
normalising to the extensionless form (`301` → `/api-docs/`) which the rule then matches. That is
production's answer, the page not being in it.

### 3.2 Cache headers

**Hosting** → **Custom headers and cache**:

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

Safe because Vite content-hashes every asset filename, which is also why the API reference needs no
pattern for its chunks. **The third pattern is not optional:** `/api-docs.html` matches neither of
the first two, so without it a cached copy keeps pointing at a hashed chunk the next deploy removed
— a blank page that survives redeploys.

### 3.3 GitHub OIDC provider, and the deploy role

**IAM is a separate service, not part of Amplify** — `console.aws.amazon.com/iam/home#/identity_providers`,
global and with no region. Add an OpenID Connect provider with URL
`https://token.actions.githubusercontent.com` and audience `sts.amazonaws.com` if one does not exist, then
a **Custom trust policy** role named `quirenote-frontend-deploy`:

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

**The `sub` is the environment, not the branch** — the claim is `environment:dev`, not
`ref:refs/heads/dev`, and carries the repo's immutable numeric ID (§6 prints it). `environment:*` lets a new
environment assume the role with no AWS change, which is why the branch policy in §4 is what scopes it.
Inline permission policy, **named `quirenote-frontend-deployPolicy`**:

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

**Both resource lines are needed** — the actions authorize against sub-resources (`…/deployments/*`,
`…/jobs/*`) as well as the branch itself. `amplify:UpdateApp` is deliberately absent. **Add a
secret, never rename one:** a renamed secret is broken until the workflow catches up.

## 4. GitHub repository configuration

Settings → Environments → **`dev`** and **`prod`**. Each entry is scoped to its own environment — **they
are not shared**, so an entry present in `dev` and absent in `prod` fails only on the `main` push, with
an empty value rather than an error that names it.

| Kind | Name | Value | In |
|------|------|-------|----|
| Variable | `AMPLIFY_APP_ID` | `d17m4jf400my6` | both |
| Variable | `AWS_REGION` | `eu-north-1` | both |
| Variable | `OPEN_REGISTRATION` | `open`, to admit sign-ups | neither — unset deploys `closed` |
| Secret | `AWS_ACCOUNT_ID` | the account number | both |
| Secret | `AWS_FRONTEND_ROLE_ARN` | `arn:aws:iam::<account-id>:role/quirenote-frontend-deploy` | both |
| Secret | `AWS_BACKEND_ROLE_ARN` | `arn:aws:iam::<account-id>:role/quirenote-backend-deploy` | both — `prod` needs it since the backend split |
| Secret | `AUTH_CERTIFICATE_ARN` | the ACM certificate for both `auth.` hosts, in **us-east-1** | both |
| Secret | `API_CERTIFICATE_ARN` | the ACM certificate for both `api.` hosts, in `eu-north-1` | both |
| Secret | `GOOGLE_CLIENT_ID` | the Google OAuth client's id | both — with its secret or not at all: one alone fails the deploy, neither switches Google sign-in off |
| Secret | `GOOGLE_CLIENT_SECRET` | that client's secret | both — as above |

**The migration needs no environment of its own, and a `migrate-prod` pair was built and deleted.** A
required reviewer gates a whole environment, and `prod` also admits `deploy-frontend.yml` — put one there
and every production release waits on a click — so the gate had to live somewhere else. The reviewer was
then dropped on its merits (*User schema and deletes*), and the two environments went with it: the apply
resolves plain `prod`/`dev`, whose branch policies were always the thing refusing a prod migration from
another branch. **If you ever name an environment a workflow does not already have, create it FIRST** —
GitHub's words are that an implicitly created one "will not have any protection rules or secrets
configured", and entries here are not shared with the repository, so it would come up with no branch
policy and no `AWS_BACKEND_ROLE_ARN`.

**Deployment branch policy — required, not cosmetic.** Settings → Environments → `<env>` →
**Deployment branches and tags** → *Selected branches and tags* → the one branch that environment
deploys. Since the trust `sub` keys on the environment rather than the branch, this is the only
thing stopping a job on another branch from assuming the deploy role; set it when an environment is
created. Every `gh` call here runs with `GH_CONFIG_DIR="$HOME/.quirenote/gh-config"`, and **`gh auth
switch` is forbidden** (*Git model*): two accounts share one keyring.

## 5. Deploying and verifying

**`dev` is continuous, `main` is a release**, promoted by merging `dev` into `main` fast-forward
only (`docs/reference/VERSIONING.md` defines the bump). The workflow's `paths-ignore` bites hardest
on `main`: **a release whose every changed file is Markdown deploys nothing and needs a manual run**
— `docs/**` is deliberately not on that list, so a regenerated `openapi.json` still deploys. A green
run proves the artifact uploaded, **not that the site works** — a misrouted asset satisfies both the
status code and the cache header, so fetch an asset and read its `Content-Type` (§6). **The API
reference is on `dev` ONLY**, and both halves are checked — a second Vite build (`pnpm
build:api-docs`) the workflow skips on `main`, so its absence from production is a property of the
artifact, not of a link or a rule. Fetch a body on both sides, status codes not separating the
failures: `dev` answers `401` unauthenticated and serves `id="swagger-ui"` with credentials — the
shell instead means the `html` entry is missing from §3.1 — while production must redirect and never
serve that marker, `curl -L` following the redirect to whatever answers. **Rollback** is an earlier
manual deployment redeployed from the console, or the workflow re-run from the last good commit;
assets are content-hashed and `index.html` is `no-cache`, so it takes effect on the next load.

## 6. Failure playbook

| Symptom | Cause | Fix |
|---------|-------|-----|
| `configure-aws-credentials` fails or hangs on `sts:AssumeRoleWithWebIdentity` | trust policy `sub` mismatch or missing `id-token: write`; the secret holds a role NAME not an ARN; the secret is empty or wrongly scoped | In order: (1) the `sub` must be the `environment:` form, **not** `ref:refs/heads/…`, and the workflow must declare `id-token: write`; (2) a bare name hangs for minutes instead of erroring, and secrets are read when the step executes, so start a new run after fixing it; (3) `role-to-assume: ***` in the log does NOT prove the secret has a value — confirm it in the environment and re-enter it; (4) print the real claim from a step **before** `configure-aws-credentials`: fetch the OIDC token from `$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com`, base64url-decode the second dot-segment, `jq '{iss,aud,sub}'` — **print claims only, never the token** |
| `AccessDeniedException` on an `amplify:` call | the action authorizes against a sub-resource, not the branch | Read the resource ARN out of the error message; §3.3 grants `…/branches/dev` **and** `…/branches/dev/*` for this reason |
| Site returns "Access Denied" | the zip contained the `dist` folder instead of its contents | `cd dist && zip -qr ../dist.zip .` — never `zip -r dist.zip dist` |
| A non-root route 404s, or a blank page with `Failed to load module script … MIME type of "text/html"` | missing rewrite (404), or the rewrite matching static assets (blank page) | Re-check §3.1 — type **200**, source the regex, not `/<*>`. `curl -sSI "$BASE/assets/<file>.js" \| grep -i content-type`: anything but `application/javascript` is the MIME bug |
| Site serves an old build after a green run, or an asset stays wrong after fixing a rule | `index.html` cached, or a broken response cached under `immutable` (§3.2) — query strings do not bust it | **CloudFront:** run any deployment; Amplify invalidates the CDN each time (`X-Cache: Miss` confirms). **Browsers:** hard-reload, or wait for the next code change |
| `pnpm build` fails in CI on esbuild | `@esbuild/linux-x64` not resolvable from a Windows-generated lockfile | Refresh the lockfile so the Linux optional dependency is present; never drop `--frozen-lockfile` |
| Deploy step times out | Amplify job stuck | Check the job in the console and re-run; the bound is `POLL_TIMEOUT_SECONDS` (default 600) |

## 7. Watched by hand

Amplify bills only storage and transfer ($0.15/GB), builds running in GitHub Actions, so cost is
effectively $0/mo solo. The two guardrails below are console artefacts, `quirenote-backend-cfn-exec`
granting neither `budgets:*` nor `cloudwatch:PutDashboard`. **Nothing re-creates either one.
Deleted, they are a repair by hand, and this section is the whole of the instructions.**

**1. The Cognito usage budget — NOT YET CREATED.** A **usage** budget, not a cost budget, named
`cognito-free-tier`, alerting at 100% actual with the owner's email as the only subscriber. The free
tier is 10,000 monthly active users on Essentials, per ACCOUNT rather than per pool, and **the usage
type follows the pool's TIER** — this pool is `UserPoolTier: ESSENTIALS`. AWS's public pricing offer
file (`https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCognito/current/index.json`)
carries ours as `EUN1-CognitoEssentialsMAU`, $0.015/MAU from unit 0, beside
`Global-CognitoFreeTierMAU`, a 0–10,000 quantity range at $0.00. Two traps beside them: the singular
regional `EUN1-CognitoUserPoolMAU` **does not exist** — the regional classic type is plural,
`EUN1-CognitoUserPoolsMAU` at $0.0055/MAU over 0–50,000 — and AWS's Free Tier tracking documentation
still lists `CognitoUserPoolMAU`, that legacy 50,000 line, not the 10,000 this budget is about. Read
which line carries non-zero usage before choosing the usage type — paired wrong, the budget reads
zero across the whole range it watches; `aws ce get-dimension-values --dimension USAGE_TYPE
--search-string Cognito` settles it. Usage on the Essentials meter while the bill is $0 means the
free tier is applied as a credit and the limit is 10,000; usage on the `Global-` line instead means
only the excess is billed, so the limit is near zero — any billable Essentials MAU says the
allowance is gone. **If the console offers no Cognito usage line yet** — possible while the pool is
nearly empty — the budget cannot be created honestly; say so rather than guessing, and lean
meanwhile on `Quirenote/PoolUsers` and its alarm, which are in the stack. AWS also mails at 85% of a
Free Tier limit, to the account root user's address unless changed under Billing → Preferences →
Alert preferences, automatic for an individual account but opt-in for an Organizations management
account. **The thing to verify is that somebody reads it.** `PoolUsersAlarm` sits at 80% of the same
10,000, ahead of that mail **for prod's share of the allowance** — not for the account's, since
dev's pool spends the same 10,000 and nothing here measures it.

**2. The free-tier dashboard — NOT YET CREATED.** Two widgets in `eu-north-1`: `Quirenote` /
`PoolUsers`, annotated at 8,000 where the alarm sits, and `AWS/Cognito` / `SignUpSuccesses` for the
prod pool, whose dimensions should be confirmed against the console rather than assumed. **Title
each with what it is not: neither is MAU.** `PoolUsers` is total identities, an upper bound useful
early and wrong as a measurement; `SignUpSuccesses` shows the risk open registration adds, and has
datapoints only once somebody signs up.
