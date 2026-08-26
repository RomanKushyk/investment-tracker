# Amplify plan — the deployment doc as first written, §2 to §6

> Moved **verbatim** from [`../2026-07-29-amplify-hybrid-deploy.md`](../2026-07-29-amplify-hybrid-deploy.md) on 2026-08-26 (D95). **This plan is CLOSED — executed 2026-07-29, do not run it.** Much of it is the text that was written INTO `docs/reference/DEPLOYMENT.md` and D15; those are maintained, this is the record of what was drafted.

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
