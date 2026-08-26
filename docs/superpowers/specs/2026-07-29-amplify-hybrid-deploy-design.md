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

## The rest of it is in `amplify-design/`

**Split 2026-08-26 (D95)** — moved **verbatim** so no file exceeds 200 lines. Nothing was summarised.

| File | Holds |
|---|---|
| [`amplify-design/workflow-and-verification.md`](amplify-design/workflow-and-verification.md) | 5. Workflow — reference shape · 6. Badge · 7. Repo and docs changes · 8. Verification · 9. Risks and failure modes |

## 10. Out of scope

PR previews and branch deploys (unavailable on manual-deploy apps, and this is a solo
project), custom domain, IaC for the Amplify app itself, Amplify Gen 2 backend, and any
change to application code.

## 11. Privacy note

The site is public, but every figure is derived in-browser from IndexedDB and nothing is
transmitted — there is no backend to transmit to. A public URL therefore exposes only the
demo seed; the Phase 2 `kubushka-live` dataset never leaves the owner's browser. No auth
is needed, and adding it would not protect anything.
