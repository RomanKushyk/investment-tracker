# Amplify plan — D15 as first written

> Moved **verbatim** from [`../2026-07-29-amplify-hybrid-deploy.md`](../2026-07-29-amplify-hybrid-deploy.md) on 2026-08-26 (D95). **This plan is CLOSED — executed 2026-07-29, do not run it.** Much of it is the text that was written INTO `docs/reference/DEPLOYMENT.md` and D15; those are maintained, this is the record of what was drafted. A fence the split had cut was closed on 2026-08-27: the closer at line 33 and the opener at the end were removed, and Step 5's instruction gained a pointer. Nothing else was touched.

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

---

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

Insert immediately after the intro paragraphs, before `## 1`. The section as written opens [`04-deploy-script-and-tests.md`](04-deploy-script-and-tests.md) and ends with its `- IAM role:` bullet; the `Replace <appId>` line after it is an instruction about the section, not part of it.
