# The Amplify hybrid-deploy plan — the long sections

The document itself is [`../2026-07-29-amplify-hybrid-deploy.md`](../2026-07-29-amplify-hybrid-deploy.md) and it stays the entry point. These sections moved
**verbatim** on 2026-08-26 (D95) so no file exceeds 200 lines; nothing was summarised.

**CLOSED — executed 2026-07-29, do not run it.** Roughly 300 of these lines are the text that was written INTO `../../../reference/DEPLOYMENT.md` and D15. Those are maintained and bind; this is the draft they came from. When they disagree, the maintained document is right.

| File | Holds |
|---|---|
| [`01-deployment-setup-as-written.md`](01-deployment-setup-as-written.md) | Deployment — AWS Amplify Hosting via GitHub Actions · 1. One-time AWS console setup |
| [`02-deployment-runbook-as-written.md`](02-deployment-runbook-as-written.md) | 2. GitHub repository configuration · 3. Deploying · 4. Rollback · 5. Failure playbook · 6. Cost |
| [`03-d15-as-written.md`](03-d15-as-written.md) | D15 — Deploy: Amplify Hosting manual-deploy app driven by GitHub Actions (2026-07-29) |
| [`04-deploy-script-and-tests.md`](04-deploy-script-and-tests.md) | 0. Live app · Test 1 — missing required env must fail loudly · Test 2 — missing artifact must fail before any AWS call · Deploy a built artifact to an AWS Amplify Hosting manual-deploy branch. · Amplify never builds this app; see docs/reference/DEPLOYMENT.md. · Usage: AMPLIFY_APP_ID=d... AMPLIFY_BRANCH=dev ./scripts/deploy-amplify.sh [dist.zip] |
| [`05-scripts-readme-and-workflow.md`](05-scripts-readme-and-workflow.md) | scripts/ — operational shell scripts · Files · Rules for this folder · Always reflect the newest push: supersede an in-flight deploy rather than racing it. |
| [`06-verification-commands.md`](06-verification-commands.md) | 1. Root loads · 2. Deep link loads the app rather than 404 — proves the SPA 200 rewrite · 3. Cache headers |
