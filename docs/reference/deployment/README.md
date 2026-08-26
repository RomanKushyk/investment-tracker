# deployment/ — the one-time setup

The runbook you open during a deploy is [`../DEPLOYMENT.md`](../DEPLOYMENT.md).
These four files are the parts that were done once, in 2026-08, and are kept
because a rebuild needs every step. Moved **verbatim** on 2026-08-26 (D95).

| File | Was | Read it when |
|---|---|---|
| [`custom-domain.md`](custom-domain.md) | §0a | DNS, the certificate or the prod/dev host split is in question |
| [`aws-setup.md`](aws-setup.md) | §1.1–1.4 | Rebuilding the Amplify app, the SPA rewrite, cache headers or the OIDC provider |
| [`iam-role.md`](iam-role.md) | §1.5, §1.5a | The deploy role's trust policy or permissions are the suspect |
| [`github-config.md`](github-config.md) | §2 | A secret or variable the workflow reads is missing |

**Hosting config is console-managed on purpose** — CI has no `UpdateApp` (D15).
That is why the SPA rewrite and the cache headers are documented here rather
than expressed in `.github/workflows/deploy-frontend.yml`.
