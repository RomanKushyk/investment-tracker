# Amplify deploy design — workflow, badge, docs, verification, risks

> Moved **verbatim** from [`../2026-07-29-amplify-hybrid-deploy-design.md`](../2026-07-29-amplify-hybrid-deploy-design.md) on 2026-08-26 (D95). Historical: this is the design that became D15. The live runbook is `../../../reference/DEPLOYMENT.md`.

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
