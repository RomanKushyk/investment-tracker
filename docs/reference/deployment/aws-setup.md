# Deployment — one-time AWS console setup (§1.1–1.4)

> Moved **verbatim** from [`../DEPLOYMENT.md`](../DEPLOYMENT.md) on 2026-08-26 (D95). The Amplify app, the SPA rewrite, cache headers and the GitHub OIDC provider. All done; kept because a rebuild needs every step.

## 1. One-time AWS console setup

Done by hand, deliberately not automated — the CI role has no permission to change hosting
configuration.

### 1.1 Create the app

1. Amplify console → **Create new app** → **Deploy without Git** → Next.
2. App name `quirenote`, branch name `dev`.
3. Method **Drag and drop**, and upload any placeholder zip (a zip containing a one-line
   `index.html` is fine). The first workflow run replaces it.
4. Note the **App ID** (`d…`) from the app's URL or settings, and the resulting site URL
   `https://dev.<appId>.amplifyapp.com`.

### 1.2 SPA rewrite — mandatory

Left nav → **Hosting** → **Rewrites and redirects**. Use the **JSON editor** and paste
exactly this — the source is a regular expression and a typo in it silently breaks the site:

```json
[
  {
    "source": "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>",
    "status": "200",
    "target": "/index.html",
    "condition": null
  }
]
```

Without a rewrite, every non-root route (`/overview`, `/payouts`, …) returns 404 on refresh or
direct link, because those paths exist only in the client-side router.

**Do not use the naive `/<*>` → `/index.html` 200 rule.** It matches *every* path, including
`/assets/index-abc123.js`, so the browser requests the app bundle and receives `index.html`
with `Content-Type: text/html`. The result is a blank page and one console error —
`Failed to load module script: Expected a JavaScript-or-Wasm module script but the server
responded with a MIME type of "text/html"` — while `curl` still reports `200` on every URL.
The regex above is AWS's documented SPA pattern: it rewrites extensionless paths only, and
excludes the extensions this app actually ships (`js`, `css`, `woff`, `woff2`).

### 1.3 Cache headers

Left nav → **Hosting** → **Custom headers and cache**:

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

**IAM is a separate AWS service, not part of Amplify** — nothing in the Amplify app's left
nav leads to it. Reach it from the console search bar (`Alt+S` → `IAM`) or directly at
`https://console.aws.amazon.com/iam/home#/identity_providers`. IAM is global: the region
selector does not apply.

IAM → Identity providers → **Add provider** → OpenID Connect:

- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

Skip if the account already has this provider.

