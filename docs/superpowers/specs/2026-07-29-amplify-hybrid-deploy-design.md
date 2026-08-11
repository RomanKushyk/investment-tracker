# Design — Amplify Hosting deploy, GitHub Actions hybrid (2026-07-29)

Deploy Kubushka to AWS Amplify Hosting with a truthful deployment-status badge in the
root `README.md`. Approved 2026-07-29. Implementation branch: `infra/amplify-hybrid-deploy`.

## 1. Context

The app is a pure client-side SPA — React 19 + Vite 7, `pnpm build` → `dist/` (1.8 MB;
1.2 MB main chunk), React Router v7, all state in IndexedDB via Dexie. No server, no
env vars, no secrets. So this is **Amplify Hosting only**: no Amplify Gen 2 backend.

Repo is **public**, single branch `dev` (also the default and base branch), remote
`origin` → `github-personal:RomanKushyk/investment-tracker`. No CI existed before this.

## 2. Decision: build in GitHub Actions, deploy the artifact to a manual-deploy Amplify app

Rejected: git-connected Amplify (Amplify builds on push). Rejected: console drag-and-drop.

Rationale, from verified facts rather than assumption:

- **Amplify Hosting has no build-status badge.** Build badges are a CodeBuild feature. A
  git-connected app therefore cannot surface deploy status in the README; the best
  available substitutes are a separate CI badge ("code compiles") or a shields.io
  website-up badge ("host responds") — neither is deployment status.
- **A GitHub Actions workflow badge is real deployment status** when the workflow itself
  performs the deployment and waits for the Amplify job to finish.
- **The two models are mutually exclusive per app.** `CreateDeployment` and
  `StartDeployment` are documented as applying to *manually deployed apps not connected
  to a Git repository*. There is no supported conversion, so switching later means a new
  `appId` and a new default URL. Chosen deliberately, once.
- **Cost.** Amplify's free tier is 12-month-only for new accounts (1,000 build min/mo,
  15 GB served, 5 GB CDN storage); there is no always-free tier after that. GitHub Actions
  standard runners are unlimited-free on public repos. Building in Actions removes the
  only non-trivial post-free-tier line item: builds. Residual Amplify cost for solo use is
  storage (1.8 MB ≈ $0.00004/mo) plus transfer at $0.15/GB — effectively $0/mo, versus
  roughly $0.50/mo if Amplify ran the builds. **The cost delta is under $1/mo and was not
  the deciding factor** — the badge was.
- **Secondary benefit:** pnpm is not present in the Amplify build container and would need
  an explicit install step in `amplify.yml`. Building in Actions uses the same Node 26 +
  pnpm 11.10.0 toolchain as local development, removing that divergence entirely.

Sources: [manual deploys](https://docs.aws.amazon.com/amplify/latest/userguide/manual-deploys.html) ·
[CreateDeployment](https://docs.aws.amazon.com/amplify/latest/APIReference/API_CreateDeployment.html) ·
[StartDeployment](https://docs.aws.amazon.com/amplify/latest/APIReference/API_StartDeployment.html) ·
[pnpm in the build container](https://docs.aws.amazon.com/amplify/latest/userguide/monorepo-configuration.html) ·
[redirects & rewrites](https://docs.aws.amazon.com/amplify/latest/userguide/redirects.html) ·
[custom headers](https://docs.aws.amazon.com/amplify/latest/userguide/custom-headers.html) ·
[Amplify pricing](https://aws.amazon.com/amplify/pricing/) ·
[Actions billing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions)

## 3. Architecture

Amplify is a dumb CDN origin. GitHub Actions is the whole pipeline.

```
push to dev (or workflow_dispatch)
  └─ .github/workflows/deploy.yml — one job, sequential
       ├─ corepack enable; pnpm install --frozen-lockfile
       ├─ pnpm lint · pnpm test                         ← quality gate
       ├─ pnpm build  (runs tsc --noEmit itself)        → dist/
       ├─ zip the CONTENTS of dist/ (not the folder)    → dist.zip
       ├─ configure-aws-credentials via OIDC            → assume IAM role
       ├─ aws amplify create-deployment                 → jobId + zipUploadUrl
       ├─ curl -T dist.zip "$zipUploadUrl"
       ├─ aws amplify start-deployment --job-id "$jobId"
       └─ poll aws amplify get-job until SUCCEED; any other terminal status → exit 1
```

Three properties this buys, each load-bearing:

- **The poll is what makes the badge honest.** `StartDeployment` returns as soon as the job
  is accepted. Without waiting for `SUCCEED`, a green badge would mean "upload accepted",
  not "live".
- **Zip the contents, not the folder.** AWS documents that zipping the top-level output
  folder yields an "Access Denied" site, because the root directory is never initialized.
- **Concurrency group `deploy-dev` with `cancel-in-progress: true`**, so the badge always
  reflects the newest push rather than whichever run finished last.

`workflow_dispatch` is included so the site can be redeployed without an empty commit.

## 4. One-time AWS setup — console, deliberately not automated

Region **`eu-central-1`**.

1. Amplify app **`kubushka`**, created via **"Deploy without Git"**, branch label **`dev`**
   (matches the git branch; the resulting URL is `https://dev.<appId>.amplifyapp.com`).
   The initial console deployment may use any placeholder zip — the first workflow run
   replaces it.
2. **Rewrite rule**: source `/<*>`, target `/index.html`, type **200 (Rewrite)**. Mandatory —
   without it every non-root route such as `/transactions` 404s on refresh or direct link.
3. **Custom headers** (App settings → Custom headers; the console path works for
   manual-deploy apps):
   - `/index.html` → `Cache-Control: no-cache`
   - `/assets/**` → `Cache-Control: public, max-age=31536000, immutable`
   Safe because Vite content-hashes every asset filename. Setting these explicitly avoids
   relying on undocumented default cache behavior, whose failure mode is a permanently
   stale `index.html` pinning visitors to an old build.
4. **IAM — GitHub OIDC provider** (`token.actions.githubusercontent.com`, audience
   `sts.amazonaws.com`) plus a role whose trust policy restricts `sub` to
   `repo:RomanKushyk/investment-tracker:ref:refs/heads/dev`. Branch-scoped, so a fork or
   another branch cannot assume it. `workflow_dispatch` runs on `dev` produce the same
   `sub` and are covered.
5. **Role policy — least privilege**, on the single app's ARNs only:
   `amplify:CreateDeployment`, `amplify:StartDeployment`, `amplify:GetBranch` on
   `arn:aws:amplify:eu-central-1:<account>:apps/<appId>/branches/dev`, and
   `amplify:GetJob` on `.../branches/dev/jobs/*`. **`amplify:UpdateApp` is deliberately
   excluded** — rewrites and headers stay console-managed, so CI cannot reconfigure
   hosting. If the first run returns `UnauthorizedException`, widen the resource to
   `apps/<appId>/*` before widening the action list, and record which ARN shape was needed
   in `docs/reference/DEPLOYMENT.md`.

Repo configuration: variables `AMPLIFY_APP_ID`, `AWS_REGION`; secret `AWS_ROLE_ARN`.
No long-lived AWS keys are stored anywhere.

## 5. Workflow — reference shape

Intended shape; exact pinning of action versions happens at implementation.

```yaml
name: Deploy
on:
  push:
    branches: [dev]
  workflow_dispatch:

concurrency:
  group: deploy-dev
  cancel-in-progress: true

permissions:
  id-token: write   # OIDC
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 26        # must match local Node
      - run: corepack enable      # honors packageManager: pnpm@11.10.0
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build          # already runs tsc --noEmit
      - run: cd dist && zip -r ../dist.zip .
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION }}
      - name: Deploy to Amplify and wait
        run: ./scripts/deploy-amplify.sh    # create → upload → start → poll get-job
        env:
          AMPLIFY_APP_ID: ${{ vars.AMPLIFY_APP_ID }}
          AMPLIFY_BRANCH: dev
```

There is no separate `pnpm typecheck` step: `pnpm build` is `tsc --noEmit && vite build`, so
type errors already fail the run. Running both would duplicate the slowest check.

The deploy step lives in a small `scripts/deploy-amplify.sh` rather than inline YAML so the
create → upload → start → poll sequence can be read, and run by hand for recovery, as one
unit. It exits non-zero on any terminal job status other than `SUCCEED`, and has a poll
timeout so a stuck job fails the run instead of hanging.

## 6. Badge

Top of root `README.md`, beside a plain link to the live site:

```markdown
[![Deploy](https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy.yml/badge.svg?branch=dev)](https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy.yml)
```

Renders queued / in-progress / passing / failing and links to live logs. GitHub's native
workflow badge is used rather than shields.io — no third party, and it works because the
repo is public.

## 7. Repo and docs changes

| Path | Change |
|------|--------|
| `.github/workflows/deploy.yml` | New — the pipeline. |
| `scripts/deploy-amplify.sh` | New — create/upload/start/poll. Needs a `scripts/README.md` per the per-folder-README rule. |
| `docs/reference/DEPLOYMENT.md` | New runbook: console steps, trust policy + role policy JSON, rollback, failure playbook, cost notes. |
| `docs/decisions/README.md` | Append **D15** — this decision and its rationale. Append-only. |
| `docs/README.md` | Add the `DEPLOYMENT.md` row; note `superpowers/specs/` holds dated design specs. |
| `CLAUDE.md` | One pointer line to `docs/reference/DEPLOYMENT.md`. |
| `README.md` (root) | Badge + live URL. |
| `navigation-map.md` | Note that checkpoints may also be run against the deployed URL. |

## 8. Verification

The task is done when all of these hold:

1. Workflow run on `dev` is green and the badge renders green in the README.
2. Every check step precedes the `configure-aws-credentials` step in `deploy.yml`, so a
   failing gate cannot reach Amplify. Verified by reading the step order, not by a red run.
3. `https://dev.<appId>.amplifyapp.com/` loads the dashboard.
4. **Deep link** to a non-root route loads the app rather than 404 — proves the rewrite.
5. `index.html` responds with `Cache-Control: no-cache` and a hashed asset with
   `max-age=31536000, immutable`.
6. Sidebar version badge reads `v1.1.0` (matches `package.json`).
7. In a **fresh browser profile**, the seed loads and the `navigation-map.md` per-route
   expected values match, confirming derivation-from-seed works off a cold IndexedDB.
8. `pnpm lint` and `pnpm typecheck` pass locally.

## 9. Risks and failure modes

- **esbuild binary on Linux.** `pnpm-workspace.yaml` sets `allowBuilds: esbuild: false`, and
  the lockfile was generated on Windows. If `@esbuild/linux-x64` does not resolve in CI,
  `vite build` fails. First-run watch item; fix by ensuring the platform optional
  dependency is in the lockfile, not by disabling `--frozen-lockfile`.
- **Node 26 availability** in `setup-node`. If unavailable, pin the current LTS and record
  the divergence from local Node in `docs/reference/DEPLOYMENT.md`.
- **Job ARN shape** for `amplify:GetJob` may not match the assumed pattern — handled by the
  documented widening step in §4.5.
- **Deployment is not atomic per file**; a failed mid-deploy could leave mixed assets.
  Mitigated by immutable hashed asset names plus a no-cache `index.html`: a re-run
  restores consistency, and rollback is a re-deploy of a previous artifact.
- **One-way door** on the manual-deploy choice (§2). Accepted.

## 10. Out of scope

PR previews and branch deploys (unavailable on manual-deploy apps, and this is a solo
project), custom domain, IaC for the Amplify app itself, Amplify Gen 2 backend, and any
change to application code.

## 11. Privacy note

The site is public, but every figure is derived in-browser from IndexedDB and nothing is
transmitted — there is no backend to transmit to. A public URL therefore exposes only the
demo seed; the Phase 2 `kubushka-live` dataset never leaves the owner's browser. No auth
is needed, and adding it would not protect anything.
