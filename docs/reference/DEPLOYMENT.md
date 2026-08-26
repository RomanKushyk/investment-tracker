# Deployment — AWS Amplify Hosting via GitHub Actions

Quirenote is a static SPA deployed to **AWS Amplify Hosting** as a **manual-deploy app**
(created with "Deploy without Git"). GitHub Actions is the entire pipeline: it runs the
quality gate, builds `dist/`, and pushes the artifact to Amplify. Amplify never builds.

Rationale and the rejected alternatives: `docs/decisions/README.md` D15.
Design spec: `docs/superpowers/specs/2026-07-29-amplify-hybrid-deploy-design.md`.

Region: **`eu-north-1`** (Europe / Stockholm). App name: `kubushka` in the console
(cosmetic, see §1.5a in [`deployment/iam-role.md`](deployment/iam-role.md)). Branch label: `dev`.

The design spec proposed `eu-central-1`; the app was created in Stockholm and there is no
benefit to moving it — CloudFront fronts the content either way, and recreating the app
would change the `appId` and the site URL. `eu-north-1` is the operative value everywhere:
the IAM resource ARNs below and the `AWS_REGION` repo variable.

## 0. Live app

- **Production:** `https://quirenote.com` (and `www.`) — served from the **`main`** branch
- **Development:** `https://dev.quirenote.com` — served from the **`dev`** branch
- App ID: `d17m4jf400my6` (public — it is part of the Amplify URLs, which all keep working:
  `https://main.d17m4jf400my6.amplifyapp.com`, `https://dev.d17m4jf400my6.amplifyapp.com`)
- Region: `eu-north-1`
- IAM role: `quirenote-frontend-deploy` (ARN held in the `AWS_FRONTEND_ROLE_ARN` secret; the
  account ID stays out of this file deliberately)

## The one-time setup is in `deployment/`

**Split 2026-08-26 (D95)** — everything below §0 that is done once and never
again moved **verbatim** into [`deployment/`](deployment/), so the file you open
during a deploy is the deploy. Nothing was rewritten, and a rebuild still has
every step.

| File | Was | Read it when |
|---|---|---|
| [`deployment/custom-domain.md`](deployment/custom-domain.md) | §0a | DNS, the certificate or the prod/dev host split is in question |
| [`deployment/aws-setup.md`](deployment/aws-setup.md) | §1.1–1.4 | Rebuilding the Amplify app, the SPA rewrite, cache headers or the OIDC provider |
| [`deployment/iam-role.md`](deployment/iam-role.md) | §1.5, §1.5a | The deploy role's trust policy or permissions are the suspect |
| [`deployment/github-config.md`](deployment/github-config.md) | §2 | A secret or variable the workflow reads is missing |

**Hosting config stays console-managed** — CI has no `UpdateApp` (D15). That is
why the SPA rewrite and the cache headers live in a setup document rather than
in the workflow.

## 3. Deploying

**`dev` is continuous, `main` is a release.** One workflow serves both: it deploys on every
push to either branch, reads the Amplify branch straight from `github.ref_name`, and picks
the matching environment. Nothing else distinguishes them — the difference in cadence comes
from how often a merge into `main` happens, not from a second pipeline that could drift.

Production is therefore promoted by merging `dev` into `main` and pushing it, **fast-forward
only**. It happens **when a new stable version is cut — MAJOR, MINOR or PATCH — or on
demand** (D67; this replaces the "at most weekly" target D59 set). There is no minimum
interval and no maximum: the gate is a judgment someone already made when they bumped
`package.json`, not a date that happens to fall. `docs/reference/VERSIONING.md` defines when
each part bumps, and under this rule that table is what sets production's cadence.

`dev` deploys on every push, **except commits that touch only Markdown or
`docs/`** — those cannot change `dist/`, so `paths-ignore` skips them. A commit touching both
docs and code still deploys; `paths-ignore` skips only when every changed file matches.
**That exclusion bites harder on `main` now:** a release whose only change is documentation
deploys nothing, so it needs the manual run below.

Concurrency is keyed per branch (`deploy-frontend-${{ github.ref_name }}`), so a dev push
cannot cancel a production deploy in flight.

Manual re-deploy without a commit — also the way to ship after a docs-only change: Actions →
**Deploy** → **Run workflow**.

The workflow fails the run if the Amplify job does not reach `SUCCEED`, so a green badge
means the artifact is live — not merely uploaded.

### 3.1 Verifying a deploy

A green run proves the artifact uploaded, **not that the site works**. Status codes and cache
headers are both satisfied by a misrouted asset, so check **content types and the browser
console** too:

```bash
BASE=https://quirenote.com      # or https://dev.quirenote.com for the dev branch
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

> **Section numbers in this table point outside this file.** §1.2 (SPA rewrite)
> and §1.3 (cache headers) are in [`deployment/aws-setup.md`](deployment/aws-setup.md);
> §1.5 and §1.5a (the deploy role) are in [`deployment/iam-role.md`](deployment/iam-role.md).
> The numbers did not change on the move — only the file did.

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
