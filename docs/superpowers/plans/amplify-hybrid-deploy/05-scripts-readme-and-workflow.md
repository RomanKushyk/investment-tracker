# Amplify plan — the scripts/ README and the workflow, as written

> Moved **verbatim** from [`../2026-07-29-amplify-hybrid-deploy.md`](../2026-07-29-amplify-hybrid-deploy.md) on 2026-08-26 (D95). **This plan is CLOSED — executed 2026-07-29, do not run it.** Much of it is the text that was written INTO `docs/reference/DEPLOYMENT.md` and D15; those are maintained, this is the record of what was drafted. A fence the split had cut was closed on 2026-08-27: the closer at line 25 was removed, the trailing `bash` block was closed, and a pointer follows it. Nothing else was touched.

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

---

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
```

The commands that use it are [`06-verification-commands.md`](06-verification-commands.md).
