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
# Deployment — AWS Amplify Hosting via GitHub Actions

Kubushka is a static SPA deployed to **AWS Amplify Hosting** as a **manual-deploy app**
(created with "Deploy without Git"). GitHub Actions is the entire pipeline: it runs the
quality gate, builds `dist/`, and pushes the artifact to Amplify. Amplify never builds.

Rationale and the rejected alternatives: `docs/decisions/README.md` D15.
Design spec: `docs/superpowers/specs/2026-07-29-amplify-hybrid-deploy-design.md`.

Region: `eu-central-1`. App name: `kubushka`. Branch label: `dev`.

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

App settings → **Rewrites and redirects** → add rule:

| Source | Target | Type |
|--------|--------|------|
| `/<*>` | `/index.html` | 200 (Rewrite) |

Without this, every non-root route (`/overview`, `/payouts`, …) returns 404 on refresh or
direct link, because those paths exist only in the client-side router.

### 1.3 Cache headers

App settings → **Custom headers**:

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
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:RomanKushyk/investment-tracker:ref:refs/heads/dev"
        }
      }
    }
  ]
}
```

The `sub` condition pins the role to branch `dev` of this one repo — a fork, a pull
request, or another branch cannot assume it. `workflow_dispatch` runs on `dev` produce the
same `sub` and are covered.

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
      "Resource": "arn:aws:amplify:eu-central-1:<account-id>:apps/<appId>/branches/dev"
    },
    {
      "Sid": "AmplifyJobStatus",
      "Effect": "Allow",
      "Action": "amplify:GetJob",
      "Resource": "arn:aws:amplify:eu-central-1:<account-id>:apps/<appId>/branches/dev/jobs/*"
    }
  ]
}
```

`amplify:UpdateApp` is deliberately absent: rewrites and headers stay console-managed, so a
compromised workflow cannot reconfigure hosting. If a run fails with
`UnauthorizedException`, widen the **resource** to `apps/<appId>/*` first — widen the action
list only if that is not enough — and record what was needed in §5.

## 2. GitHub repository configuration

Settings → Secrets and variables → **Actions**.

| Kind | Name | Value |
|------|------|-------|
| Variable | `AMPLIFY_APP_ID` | the `d…` app ID |
| Variable | `AWS_REGION` | `eu-central-1` |
| Secret | `AWS_ROLE_ARN` | `arn:aws:iam::<account-id>:role/kubushka-github-deploy` |

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
| Run fails at `configure-aws-credentials` with `Not authorized to perform sts:AssumeRoleWithWebIdentity` | Trust policy `sub` does not match, or `permissions: id-token: write` missing | Confirm the `sub` is `repo:RomanKushyk/investment-tracker:ref:refs/heads/dev` and the workflow declares `id-token: write` |
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
````

- [ ] **Step 2: Verify the doc renders and has no broken internal links**

Run:
```bash
ls -l docs/reference/DEPLOYMENT.md
grep -c '```' docs/reference/DEPLOYMENT.md
ls docs/superpowers/specs/2026-07-29-amplify-hybrid-deploy-design.md docs/decisions/README.md
```
Expected: file exists; the fence count is **even** (unbalanced fences break rendering); both referenced paths exist.

- [ ] **Step 3: Append D15 to `docs/decisions/README.md`**

Append at the very bottom (the file is append-only), matching the existing `## Dn — Title (date)` heading style:

```markdown

## D15 — Deploy: Amplify Hosting manual-deploy app driven by GitHub Actions (2026-07-29)

`infra/amplify-hybrid-deploy` puts the app online. Runbook: `docs/reference/DEPLOYMENT.md`; design
spec: `docs/superpowers/specs/2026-07-29-amplify-hybrid-deploy-design.md`.

- **Amplify Hosting only, no Amplify backend.** The app is a pure client-side SPA over
  Dexie/IndexedDB (D2) with no server, so hosting is the whole deployment surface.
- **Hybrid chosen over git-connected Amplify:** Amplify Hosting has **no build-status
  badge** (that is a CodeBuild feature), so a git-connected app cannot show deployment
  status in the README. A GitHub Actions workflow badge *is* real deployment status when the
  workflow performs the deploy and polls `GetJob` until `SUCCEED`. Console drag-and-drop was
  rejected as unautomatable for an actively developed project.
- **One-way door, accepted.** `CreateDeployment`/`StartDeployment` apply only to apps *not*
  connected to a Git repository, and there is no supported conversion between the two
  models — switching later means a new `appId` and a new URL.
- **Cost was not the deciding factor.** Amplify's free tier is 12-month-only; building in
  Actions (unlimited-free on public repos) removes the only non-trivial post-free-tier line
  item, but the delta is under $1/mo. The badge decided it.
- **Secondary benefit:** pnpm is absent from the Amplify build container, so a git-connected
  build would need its own install step. Building in Actions reuses the exact local
  toolchain (Node 26 + pnpm 11.10.0 via `corepack`).
- **Security posture:** GitHub OIDC into a role whose trust `sub` is pinned to
  `refs/heads/dev`; no long-lived AWS keys. The role deliberately lacks `amplify:UpdateApp`,
  so the SPA 200 rewrite and cache headers stay console-managed and CI cannot change
  hosting configuration.
- **Public URL is not a data exposure:** every figure is derived in-browser from IndexedDB
  and nothing is transmitted (there is no backend to transmit to). A visitor gets the demo
  seed; the P2 `kubushka-live` dataset never leaves the owner's browser.
```

- [ ] **Step 4: Add the `docs/README.md` row and conventions line**

In the **Files & rules** table, insert a row after the `VERSIONING.md` row:

```markdown
| `DEPLOYMENT.md` | Deploy runbook: Amplify Hosting manual-deploy app + GitHub Actions pipeline, IAM/OIDC setup, rollback, failure playbook. | Hosting config (rewrite, cache headers) is console-managed by design — CI has no `UpdateApp`; keep §5 current when a failure mode is hit. |
```

In the **Conventions for this folder** list, add:

```markdown
- `superpowers/specs/` and `superpowers/plans/` hold dated design specs and implementation plans from brainstorming/planning sessions. They are point-in-time records — once a plan is executed, the durable documentation is the concern file here (e.g. `DEPLOYMENT.md`) plus the `DECISIONS.md` entry.
```

- [ ] **Step 5: Add the `CLAUDE.md` pointer**

In the **Working agreements** bullet list, after the `navigation-map.md` bullet, add:

```markdown
- **Deployment is `docs/reference/DEPLOYMENT.md`** — Amplify Hosting manual-deploy app fed by `.github/workflows/deploy.yml`; hosting config (SPA 200 rewrite, cache headers) is console-managed and CI has no permission to change it (see DECISIONS D15).
```

- [ ] **Step 6: Verify nothing in the toolchain broke**

Run:
```bash
pnpm lint && pnpm typecheck
```
Expected: both pass. (Docs-only change — this is a regression check, not a test of the docs.)

- [ ] **Step 7: Commit**

```bash
git add docs/reference/DEPLOYMENT.md docs/decisions/README.md docs/README.md CLAUDE.md
git commit -m "docs: add Amplify deploy runbook and D15

- docs/reference/DEPLOYMENT.md: one-time console/IAM procedure, both IAM policy documents,
  GitHub config, rollback, failure playbook, cost notes
- DECISIONS D15: hybrid over git-connected, the one-way door, security posture
- register DEPLOYMENT.md in docs/README.md and CLAUDE.md working agreements"
```

---

### Task 2: HUMAN GATE — AWS console and GitHub configuration

**This task cannot be done by an agent.** It requires an authenticated AWS console session and admin on the GitHub repo. An agent reaching this task must stop and hand back to the user with the checklist below.

**Files:**
- Modify: `docs/reference/DEPLOYMENT.md` (append the "Live app" section)

**Interfaces:**
- Consumes: `docs/reference/DEPLOYMENT.md` §1–§2 from Task 1.
- Produces: repo variables `AMPLIFY_APP_ID`, `AWS_REGION`; repo secret `AWS_ROLE_ARN`; the live URL `https://dev.<appId>.amplifyapp.com`, recorded in `docs/reference/DEPLOYMENT.md` §0 and consumed by Task 4's verification and Task 5's README link.

- [ ] **Step 1: Execute `docs/reference/DEPLOYMENT.md` §1** — create the app, add the 200 rewrite, add the cache headers, add the OIDC provider, create the role with both policies.

- [ ] **Step 2: Execute `docs/reference/DEPLOYMENT.md` §2** — set the two variables and one secret in the GitHub web UI. Do **not** try `gh secret set`; the local `gh` is a read-only account on this repo.

- [ ] **Step 3: Verify the placeholder site is live**

Run, substituting the real app ID:
```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://dev.<appId>.amplifyapp.com/
```
Expected: `200`.

- [ ] **Step 4: Verify the GitHub config is visible to Actions**

In the GitHub UI, Settings → Secrets and variables → Actions shows `AMPLIFY_APP_ID` and `AWS_REGION` under **Variables** and `AWS_ROLE_ARN` under **Secrets**. A variable created in the wrong tab is the most common cause of an empty `--app-id` in Task 4.

- [ ] **Step 5: Record the concrete values in `docs/reference/DEPLOYMENT.md`**

Insert immediately after the intro paragraphs, before `## 1`:

```markdown
## 0. Live app

- URL: `https://dev.<appId>.amplifyapp.com`
- App ID: `<appId>` (public — it is part of the URL)
- Region: `eu-central-1`
- IAM role: `kubushka-github-deploy` (ARN held in the `AWS_ROLE_ARN` repo secret; the
  account ID stays out of this file deliberately)
```

Replace `<appId>` with the real ID in both lines. Leave the account ID out.

- [ ] **Step 6: Commit**

```bash
git add docs/reference/DEPLOYMENT.md
git commit -m "docs: record the live Amplify app id and URL"
```

---

### Task 3: Deploy script

The create → upload → start → poll sequence, in one file so it reads as a unit and can be run by hand for recovery. Its error paths are testable locally without AWS — those are the tests.

**Files:**
- Create: `scripts/deploy-amplify.sh`
- Create: `scripts/README.md`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `scripts/deploy-amplify.sh [zip-path]`, default zip path `dist.zip`. Required env: `AMPLIFY_APP_ID`, `AMPLIFY_BRANCH`. Optional env: `POLL_TIMEOUT_SECONDS` (default `600`), `POLL_INTERVAL_SECONDS` (default `5`). Exit `0` only on job status `SUCCEED`. Task 4's workflow calls it exactly as `./scripts/deploy-amplify.sh dist.zip`.

- [ ] **Step 1: Write the failing tests**

These are the two error paths reachable without AWS credentials. Run them now, before the file exists:

```bash
# Test 1 — missing required env must fail loudly
env -u AMPLIFY_APP_ID -u AMPLIFY_BRANCH bash scripts/deploy-amplify.sh; echo "exit=$?"

# Test 2 — missing artifact must fail before any AWS call
AMPLIFY_APP_ID=dtest AMPLIFY_BRANCH=dev bash scripts/deploy-amplify.sh /nonexistent.zip; echo "exit=$?"
```

Expected now: both print `No such file or directory` and `exit=127`.
Expected after Step 3: Test 1 prints a message containing `AMPLIFY_APP_ID` and `exit=1`; Test 2 prints a message containing `artifact not found` and `exit=1`.

- [ ] **Step 2: Run the tests to confirm they fail**

Run both commands from Step 1.
Expected: `exit=127` for both — the script does not exist yet.

- [ ] **Step 3: Write `scripts/deploy-amplify.sh`**

```bash
#!/usr/bin/env bash
# Deploy a built artifact to an AWS Amplify Hosting manual-deploy branch.
# Amplify never builds this app; see docs/reference/DEPLOYMENT.md.
#
# Usage: AMPLIFY_APP_ID=d... AMPLIFY_BRANCH=dev ./scripts/deploy-amplify.sh [dist.zip]
set -euo pipefail

: "${AMPLIFY_APP_ID:?AMPLIFY_APP_ID is required}"
: "${AMPLIFY_BRANCH:?AMPLIFY_BRANCH is required}"

ZIP="${1:-dist.zip}"
POLL_TIMEOUT_SECONDS="${POLL_TIMEOUT_SECONDS:-600}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-5}"

if [[ ! -f "$ZIP" ]]; then
  echo "artifact not found: $ZIP" >&2
  exit 1
fi

# The zip must hold the CONTENTS of the build output, not the output folder itself —
# otherwise Amplify serves "Access Denied" because the site root is never initialized.
echo "Creating deployment for $AMPLIFY_APP_ID/$AMPLIFY_BRANCH"
read -r JOB_ID UPLOAD_URL < <(
  aws amplify create-deployment \
    --app-id "$AMPLIFY_APP_ID" \
    --branch-name "$AMPLIFY_BRANCH" \
    --query '[jobId, zipUploadUrl]' \
    --output text
)
echo "Job $JOB_ID created; uploading $ZIP"

curl --fail --silent --show-error --upload-file "$ZIP" "$UPLOAD_URL"

aws amplify start-deployment \
  --app-id "$AMPLIFY_APP_ID" \
  --branch-name "$AMPLIFY_BRANCH" \
  --job-id "$JOB_ID" >/dev/null
echo "Job $JOB_ID started; waiting for it to finish"

# A green badge must mean "live", not "upload accepted" — so wait for the terminal status.
deadline=$(( SECONDS + POLL_TIMEOUT_SECONDS ))
while (( SECONDS < deadline )); do
  status=$(
    aws amplify get-job \
      --app-id "$AMPLIFY_APP_ID" \
      --branch-name "$AMPLIFY_BRANCH" \
      --job-id "$JOB_ID" \
      --query 'job.summary.status' \
      --output text
  )
  case "$status" in
    SUCCEED)
      echo "Deployment $JOB_ID succeeded"
      exit 0
      ;;
    FAILED | CANCELLED | CANCELLING)
      echo "Deployment $JOB_ID ended with status $status" >&2
      exit 1
      ;;
    *)
      echo "  status=$status"
      sleep "$POLL_INTERVAL_SECONDS"
      ;;
  esac
done

echo "Timed out after ${POLL_TIMEOUT_SECONDS}s waiting for job $JOB_ID" >&2
exit 1
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run both commands from Step 1.
Expected: Test 1 → stderr contains `AMPLIFY_APP_ID is required`, `exit=1`. Test 2 → stderr contains `artifact not found: /nonexistent.zip`, `exit=1`.

Also check syntax (no `shellcheck` on this machine):
```bash
bash -n scripts/deploy-amplify.sh; echo "syntax=$?"
```
Expected: `syntax=0`.

- [ ] **Step 5: Mark the script executable in git**

Windows checkouts do not carry the exec bit, so set it in the index explicitly or the runner cannot execute it:

```bash
git update-index --add --chmod=+x scripts/deploy-amplify.sh
git ls-files -s scripts/deploy-amplify.sh
```
Expected: mode `100755`.

- [ ] **Step 6: Create `scripts/README.md`**

```markdown
# scripts/ — operational shell scripts

Scripts run by CI and by hand for recovery. Not part of the app build; nothing here is
imported by `src/`.

## Files

| File | What it is | Rules |
|------|-----------|-------|
| `deploy-amplify.sh` | Pushes a built artifact to the Amplify Hosting manual-deploy branch: `create-deployment` → upload zip → `start-deployment` → poll `get-job` until `SUCCEED`. | Exits non-zero unless the job reaches `SUCCEED` — the deploy badge depends on that. Keep it runnable by hand for rollback. Requires `AMPLIFY_APP_ID` and `AMPLIFY_BRANCH`; takes the zip path as `$1` (default `dist.zip`). |

## Rules for this folder

- `set -euo pipefail` in every script; fail loudly with a message on stderr and a non-zero
  exit rather than continuing in a half-state.
- Required inputs are env vars validated up front with `: "${VAR:?message}"`.
- Keep the exec bit set in git (`git update-index --chmod=+x`) — Windows checkouts do not
  carry it and the Linux runner needs it.
- No AWS credentials or account IDs in this folder; CI supplies them via OIDC.
- Operational context belongs in `docs/reference/DEPLOYMENT.md`, not in comments here.
```

- [ ] **Step 7: Verify the repo still lints and typechecks**

```bash
pnpm lint && pnpm typecheck
```
Expected: both pass. (`eslint .` should ignore `.sh`; if it errors on `scripts/`, that is a real finding — report it rather than silencing the rule.)

- [ ] **Step 8: Commit**

```bash
git add scripts/deploy-amplify.sh scripts/README.md
git commit -m "feat: add Amplify manual-deploy script

- create-deployment -> upload zip -> start-deployment -> poll get-job until SUCCEED
- non-zero exit on any other terminal status or on timeout, so a green CI run
  means the artifact is actually live
- validates required env up front; runnable by hand for rollback"
```

---

### Task 4: Workflow and first live deploy

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `scripts/deploy-amplify.sh` (Task 3); repo variables `AMPLIFY_APP_ID`, `AWS_REGION` and secret `AWS_ROLE_ARN` (Task 2).
- Produces: a workflow named **`Deploy`** in file `deploy.yml` — Task 5's badge URL depends on both the file name and that the workflow exists at `.github/workflows/deploy.yml`.

- [ ] **Step 1: Confirm Task 2 is done**

```bash
git log --oneline -3
```
Expected: the "record the live Amplify app id and URL" commit is present. If it is not, stop — the workflow will fail with an empty `--app-id`.

- [ ] **Step 2: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy

on:
  push:
    branches: [dev]
  workflow_dispatch:

# Always reflect the newest push: supersede an in-flight deploy rather than racing it.
concurrency:
  group: deploy-dev
  cancel-in-progress: true

permissions:
  id-token: write # required for OIDC role assumption
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 26 # must match local Node

      - name: Enable pnpm via corepack
        run: corepack enable # honors packageManager: pnpm@11.10.0

      - run: pnpm install --frozen-lockfile

      # Quality gate — everything below runs before any AWS credential exists,
      # so a failing check can never deploy.
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build # already runs tsc --noEmit

      - name: Zip the contents of dist
        run: cd dist && zip -qr ../dist.zip .

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: ${{ vars.AWS_REGION }}

      - name: Deploy to Amplify and wait for the job
        run: ./scripts/deploy-amplify.sh dist.zip
        env:
          AMPLIFY_APP_ID: ${{ vars.AMPLIFY_APP_ID }}
          AMPLIFY_BRANCH: dev
```

- [ ] **Step 3: Verify the gate ordering by reading the file**

```bash
grep -n 'pnpm lint\|pnpm test\|pnpm build\|configure-aws-credentials\|deploy-amplify' .github/workflows/deploy.yml
```
Expected: the line numbers for `pnpm lint`, `pnpm test`, and `pnpm build` are all **smaller** than the `configure-aws-credentials` line, which is smaller than the `deploy-amplify` line. This is the spec's §8.2 acceptance criterion — a failing gate cannot reach Amplify.

- [ ] **Step 4: Commit and push**

```bash
git add .github/workflows/deploy.yml
git commit -m "infra: add GitHub Actions deploy workflow for Amplify Hosting

- gate (lint, test, build) runs before any AWS credential is configured
- OIDC role assumption, no stored AWS keys
- concurrency group deploy-dev cancels superseded runs so the badge tracks HEAD
- workflow_dispatch for redeploy without a commit"
git push -u origin infra/amplify-hybrid-deploy
```

Note: the workflow triggers on `push` to `dev` only, so pushing this branch does **not** deploy. That is intentional — Step 5 triggers the first run deliberately.

- [ ] **Step 5: Trigger the first real run**

The workflow must exist on `dev` before it can run there. Merge the branch into `dev` per the repo's squash-merge convention, then push:

```bash
git checkout dev
git merge --squash infra/amplify-hybrid-deploy
git commit -m "infra: deploy to AWS Amplify Hosting from GitHub Actions

- manual-deploy Amplify app fed by .github/workflows/deploy.yml (gate -> build ->
  create-deployment -> upload -> start-deployment -> poll until SUCCEED)
- scripts/deploy-amplify.sh, runnable by hand for rollback
- docs/reference/DEPLOYMENT.md runbook + DECISIONS D15"
git push origin dev
```

Then watch it:
```bash
gh run watch --repo RomanKushyk/investment-tracker
```
(Reading runs works with the read-only `gh` account because the repo is public.)

- [ ] **Step 6: If the run fails, fix by cause — do not weaken the gate**

- **esbuild / `@esbuild/linux-x64` unresolved:** refresh the lockfile so the Linux optional dependency is recorded (`pnpm install --lockfile-only` locally, commit `pnpm-lock.yaml`). Never drop `--frozen-lockfile`.
- **`node-version: 26` unavailable in `setup-node`:** change to the current LTS, and record the divergence from local Node `v26.4.0` in `docs/reference/DEPLOYMENT.md` §5.
- **`Not authorized to perform sts:AssumeRoleWithWebIdentity`:** trust-policy `sub` mismatch — see `docs/reference/DEPLOYMENT.md` §5.
- **`UnauthorizedException` on an `amplify:` call:** widen the resource ARN to `apps/<appId>/*` per §1.5 and record it in §5.
- **Empty `--app-id`:** `AMPLIFY_APP_ID` was created as a Secret instead of a Variable.

Commit each fix separately with a `fix:` message and push to `dev` to re-run.

- [ ] **Step 7: Verify the deployment is genuinely live**

Substitute the real app ID:

```bash
BASE=https://dev.<appId>.amplifyapp.com

# 1. Root loads
curl -sS -o /dev/null -w 'root=%{http_code}\n' "$BASE/"

# 2. Deep link loads the app rather than 404 — proves the SPA 200 rewrite
curl -sS -o /dev/null -w 'deep=%{http_code}\n' "$BASE/overview"
curl -sS "$BASE/overview" | grep -c 'id="root"'

# 3. Cache headers
curl -sSI "$BASE/index.html" | grep -i '^cache-control'
```

Expected: `root=200`; `deep=200` and the grep count is `1` (the deep link returns the SPA shell, not a 404 page); `Cache-Control: no-cache` on `index.html`.

Then find a hashed asset and check its header:
```bash
ASSET=$(curl -sS "$BASE/" | grep -o '/assets/[^"]*\.js' | head -1)
curl -sSI "$BASE$ASSET" | grep -i '^cache-control'
```
Expected: `public, max-age=31536000, immutable`.

If the asset header is missing, the `/assets/**` custom-header pattern did not save — re-check `docs/reference/DEPLOYMENT.md` §1.3.

---

### Task 5: Badge, live URL, and the manual verification sweep

**Files:**
- Modify: `README.md` (root, under the H1)
- Modify: `navigation-map.md`

**Interfaces:**
- Consumes: the `Deploy` workflow at `.github/workflows/deploy.yml` (Task 4); the live URL from `docs/reference/DEPLOYMENT.md` §0 (Task 2).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Add the badge and live link to root `README.md`**

Insert directly after the H1 line `# Handoff: Kubushka — Investment Portfolio Tracker`, as its own paragraph before the existing "Implementation package…" line:

```markdown
[![Deploy](https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy.yml/badge.svg?branch=dev)](https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy.yml)

**Live:** https://dev.<appId>.amplifyapp.com · deploy runbook: [`docs/reference/DEPLOYMENT.md`](../../reference/DEPLOYMENT.md)
```

Replace `<appId>` with the real ID. GitHub's native workflow badge is used rather than shields.io — no third party, and it works because the repo is public.

- [ ] **Step 2: Verify the badge resolves and is green**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  'https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy.yml/badge.svg?branch=dev'
curl -sS 'https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy.yml/badge.svg?branch=dev' | grep -o 'passing\|failing\|no status'
```
Expected: `200`, and `passing`. `no status` means the workflow file name or branch in the URL does not match reality.

- [ ] **Step 3: Note the deployed target in `navigation-map.md`**

Add to the intro/preamble section, before the per-route table:

```markdown
Checkpoints can be run against the deployed site as well as `localhost` — see
`docs/reference/DEPLOYMENT.md` §0 for the URL. Run them in a **fresh browser profile** when
verifying a deploy: the seed only loads into an empty IndexedDB, so an existing profile
will show your own data instead of the pinned values.
```

- [ ] **Step 4: Run the manual verification sweep against the deployed URL**

In a **fresh browser profile** (no existing IndexedDB for the host), open the live URL and confirm the spec's §8 criteria that automation cannot check:

1. The dashboard (Daily quotes) renders as the landing view.
2. Sidebar version badge reads **`v1.1.0`** — matches `package.json`.
3. Walk the `navigation-map.md` per-route checkpoints; the seed-pinned expected values match on each of `/`, `/overview`, `/balances`, `/payouts`, `/yield`, `/attributes`, `/seasonality`, `/portfolio`, `/allocation`. This proves derivation-from-seed works off a cold IndexedDB in production.
4. Reload while on a non-root route — it must stay on that route, not 404.

Report any mismatch as a finding; do not silently adjust `navigation-map.md` expected values to match production.

- [ ] **Step 5: Verify the repo still lints and typechecks**

```bash
pnpm lint && pnpm typecheck
```
Expected: both pass.

- [ ] **Step 6: Commit and push**

```bash
git add README.md navigation-map.md
git commit -m "docs: add deploy badge and live URL

- native GitHub Actions workflow badge for deploy.yml on dev
- link the live site and the deploy runbook from the root README
- navigation-map: checkpoints can run against the deployed URL (fresh profile)"
git push origin dev
```

- [ ] **Step 7: Clean up the feature branch**

Only after the badge is confirmed green and the sweep passed:

```bash
git branch -d infra/amplify-hybrid-deploy
git push origin --delete infra/amplify-hybrid-deploy
```

---

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
