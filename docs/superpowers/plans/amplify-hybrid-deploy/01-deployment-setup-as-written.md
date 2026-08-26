# Amplify plan — the deployment doc as first written, §1

> Moved **verbatim** from [`../2026-07-29-amplify-hybrid-deploy.md`](../2026-07-29-amplify-hybrid-deploy.md) on 2026-08-26 (D95). **This plan is CLOSED — executed 2026-07-29, do not run it.** Much of it is the text that was written INTO `docs/reference/DEPLOYMENT.md` and D15; those are maintained, this is the record of what was drafted.

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
