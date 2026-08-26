# Amplify Hybrid Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy Kubushka to AWS Amplify Hosting from GitHub Actions, with a README badge that turns green only when the artifact is actually live.

**Architecture:** Amplify Hosting is a manual-deploy ("Deploy without Git") app used as a dumb CDN origin. A single GitHub Actions workflow on `dev` runs the quality gate, builds `dist/`, zips its contents, and pushes the artifact through Amplify's `CreateDeployment` → upload → `StartDeployment` → `GetJob` poll sequence. Authentication is GitHub OIDC into a branch-scoped IAM role; no AWS keys are stored.

**Tech Stack:** GitHub Actions, AWS CLI v2 (in the runner), AWS Amplify Hosting, bash, Node 26 + pnpm 11.10.0, Vite 7.

Spec: `docs/superpowers/specs/2026-07-29-amplify-hybrid-deploy-design.md` (commit `dbe63e8`). Branch `infra/amplify-hybrid-deploy` already exists.

## Global Constraints

- **No application code changes.** Nothing under `src/` is touched by this plan.
- Region: **`eu-central-1`**. Amplify app name **`kubushka`**, created via **"Deploy without Git"**, branch label **`dev`**. Resulting URL: `https://dev.<appId>.amplifyapp.com`.
- **Zip the CONTENTS of `dist/`, never the folder** — zipping the folder produces an "Access Denied" site because the root directory is never initialized.
- Poll until job status is **`SUCCEED`**; any other terminal status (`FAILED`, `CANCELLED`, `CANCELLING`) exits non-zero. Amplify job statuses are `PENDING | PROVISIONING | RUNNING | FAILED | SUCCEED | CANCELLING | CANCELLED`.
- Quality gate order in the workflow: `pnpm lint` → `pnpm test` → `pnpm build`, **all before** `configure-aws-credentials`. **No separate `pnpm typecheck` step** — `pnpm build` is `tsc --noEmit && vite build`.
- Workflow concurrency: group `deploy-dev`, `cancel-in-progress: true`.
- IAM role gets `amplify:CreateDeployment`, `amplify:StartDeployment`, `amplify:GetBranch`, `amplify:GetJob` only. **`amplify:UpdateApp` is deliberately excluded** so CI cannot reconfigure hosting.
- Node in CI: **`26`** (matches local `v26.4.0`). pnpm comes from `corepack enable` honoring `"packageManager": "pnpm@11.10.0"`.
- `docs/decisions/README.md` is **append-only** — add `D15` at the bottom, never rewrite earlier entries.
- Every new top-level folder needs its own `README.md` (this plan creates `scripts/`).
- Git: conventional commits, **no Jira key**, **no AI-attribution trailers or footers**. Repo-local identity `RomanKushyk <romankushyk0@gmail.com>`.
- `pnpm lint` and `pnpm typecheck` must pass before any task is considered done.

## Known environment hazards (read before starting)

1. **The local `gh` CLI is authenticated as the work account `rkushyk`, which has read-only access to `RomanKushyk/investment-tracker`** (`admin: false, push: false`). `gh secret set` and `gh variable set` **will fail with 403**. Repo variables and secrets must be set in the GitHub **web UI**. `git push` is unaffected — it uses the `github-personal` SSH alias. Reading workflow runs (`gh run list`, `gh run watch`) works because the repo is public.
2. **No AWS CLI on this machine** — every AWS call in this plan happens inside the GitHub runner. Task 2's console work is done by hand in a browser.
3. **`shellcheck` is not installed** — script verification uses `bash -n` plus real error-path runs.
4. **esbuild on Linux:** `pnpm-workspace.yaml` sets `allowBuilds: esbuild: false` and `pnpm-lock.yaml` was generated on Windows. If `@esbuild/linux-x64` fails to resolve in CI, `pnpm build` breaks. Fix it lockfile-side (Task 4 Step 6) — **never by dropping `--frozen-lockfile`**.

## File Structure

| Path | Responsibility |
|------|----------------|
| `docs/reference/DEPLOYMENT.md` | **Create.** The operational runbook: one-time console/IAM procedure, the two IAM policy documents, GitHub config, rollback, failure playbook. The human executes this in Task 2. |
| `docs/decisions/README.md` | **Modify** (append `D15`). Why hybrid over git-connected; the one-way door. |
| `docs/README.md` | **Modify.** Add the `DEPLOYMENT.md` table row; note what `superpowers/` holds. |
| `CLAUDE.md` | **Modify.** One pointer line so future sessions see the deploy doc. |
| `scripts/deploy-amplify.sh` | **Create.** create → upload → start → poll, as one readable unit runnable by hand for recovery. |
| `scripts/README.md` | **Create.** Local rules for the new folder. |
| `.github/workflows/deploy.yml` | **Create.** Gate + build + OIDC + call the script. |
| `README.md` (root) | **Modify.** Badge and live URL under the H1. |
| `navigation-map.md` | **Modify.** Note that checkpoints can be run against the deployed URL. |

Task order is dependency-forced: the runbook (Task 1) is what the human follows in Task 2; the script (Task 3) is what the workflow calls (Task 4); the badge (Task 5) is only meaningful once a run is green.

---

### Task 1: Runbook and decision record

Docs only. No AWS account values exist yet — this task writes the *procedure*, Task 2 fills in the concrete IDs.

**Files:**
- Create: `docs/reference/DEPLOYMENT.md`
- Modify: `docs/decisions/README.md` (append at end)
- Modify: `docs/README.md` (table + conventions list)
- Modify: `CLAUDE.md` (Working agreements list)

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/reference/DEPLOYMENT.md` §1–§3, the checklist the human executes in Task 2. Task 2 appends a "Live app" section to it. Task 4 records the actual Node version and any IAM widening in its §5.

- [ ] **Step 1: Create `docs/reference/DEPLOYMENT.md`**

Write exactly this content:

````markdown
## The rest of it is in `amplify-hybrid-deploy/`

**Split 2026-08-26 (D95)** — moved **verbatim** so no file exceeds 200 lines. Nothing was summarised.

| File | Holds |
|---|---|
| [`amplify-hybrid-deploy/01-deployment-setup-as-written.md`](amplify-hybrid-deploy/01-deployment-setup-as-written.md) | Deployment — AWS Amplify Hosting via GitHub Actions · 1. One-time AWS console setup |
| [`amplify-hybrid-deploy/02-deployment-runbook-as-written.md`](amplify-hybrid-deploy/02-deployment-runbook-as-written.md) | 2. GitHub repository configuration · 3. Deploying · 4. Rollback · 5. Failure playbook · 6. Cost |
| [`amplify-hybrid-deploy/03-d15-as-written.md`](amplify-hybrid-deploy/03-d15-as-written.md) | D15 — Deploy: Amplify Hosting manual-deploy app driven by GitHub Actions (2026-07-29) |
| [`amplify-hybrid-deploy/04-deploy-script-and-tests.md`](amplify-hybrid-deploy/04-deploy-script-and-tests.md) | 0. Live app · Test 1 — missing required env must fail loudly · Test 2 — missing artifact must fail before any AWS call · Deploy a built artifact to an AWS Amplify Hosting manual-deploy branch. · Amplify never builds this app; see docs/reference/DEPLOYMENT.md. · Usage: AMPLIFY_APP_ID=d... AMPLIFY_BRANCH=dev ./scripts/deploy-amplify.sh [dist.zip] |
| [`amplify-hybrid-deploy/05-scripts-readme-and-workflow.md`](amplify-hybrid-deploy/05-scripts-readme-and-workflow.md) | scripts/ — operational shell scripts · Files · Rules for this folder · Always reflect the newest push: supersede an in-flight deploy rather than racing it. |
| [`amplify-hybrid-deploy/06-verification-commands.md`](amplify-hybrid-deploy/06-verification-commands.md) | 1. Root loads · 2. Deep link loads the app rather than 404 — proves the SPA 200 rewrite · 3. Cache headers |

## Definition of done

Every item from spec §8:

1. Workflow run on `dev` green; badge renders green (Task 5 Step 2).
2. Gate steps precede `configure-aws-credentials` (Task 4 Step 3).
3. Root URL loads the dashboard (Task 4 Step 7, Task 5 Step 4).
4. Deep link loads the app, not a 404 (Task 4 Step 7).
5. `index.html` is `no-cache`; hashed assets are `immutable` (Task 4 Step 7).
6. Sidebar version badge reads `v1.1.0` (Task 5 Step 4).
7. Fresh-profile seed load matches `navigation-map.md` (Task 5 Step 4).
8. `pnpm lint` and `pnpm typecheck` pass (every task's penultimate step).

Not in scope, per spec §10: PR previews, branch deploys, custom domain, IaC for the Amplify app, Amplify Gen 2 backend, any change under `src/`.
