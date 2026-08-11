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
  carry it and the Linux runner needs it. `.gitattributes` pins `*.sh` to LF so the shebang
  survives a CRLF working copy.
- No AWS credentials or account IDs in this folder; CI supplies them via OIDC.
- Operational context belongs in `docs/reference/DEPLOYMENT.md`, not in comments here.
