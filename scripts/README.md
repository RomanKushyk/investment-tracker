# scripts/ — operational scripts

Scripts run by CI, by hand for recovery, or by a developer as repo tooling (`pnpm facts`).
Not part of the app build; nothing here is imported by `src/` — `facts.ts` below imports FROM
it, never the other way.

## Files

| File | What it is | Rules |
|------|-----------|-------|
| `deploy-amplify.sh` | Pushes a built artifact to the Amplify Hosting manual-deploy branch: `create-deployment` → upload zip → `start-deployment` → poll `get-job` until `SUCCEED`. | Exits non-zero unless the job reaches `SUCCEED` — the deploy badge depends on that. Keep it runnable by hand for rollback. Requires `AMPLIFY_APP_ID` and `AMPLIFY_BRANCH`; takes the zip path as `$1` (default `dist.zip`). |
| `facts.ts` | The `pnpm facts` CLI, run through `tsx` (not a shell script): rewrites every Markdown fence in the repo to its fact's current value. | Imports `FACTS`, `rewriteFile` and `markdownFiles`/`REPO` from `../src/facts/` — see `src/facts/README.md`. Validates every file before writing any, so a single damaged file aborts with the repo untouched. |

## Rules for this folder

- `set -euo pipefail` in every shell script; fail loudly with a message on stderr and a
  non-zero exit rather than continuing in a half-state.
- A shell script's required inputs are env vars validated up front with `: "${VAR:?message}"`.
- Keep the exec bit set in git on every `.sh` file (`git update-index --chmod=+x`) — Windows
  checkouts do not carry it and the Linux runner needs it. `.gitattributes` pins `*.sh` to LF
  so the shebang survives a CRLF working copy.
- No AWS credentials or account IDs in this folder; CI supplies them via OIDC.
- Operational context belongs in `docs/reference/DEPLOYMENT.md`, not in comments here.
