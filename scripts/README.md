# scripts/ — operational scripts

Scripts run by CI, by hand for recovery, or by a developer as repo tooling (`pnpm facts`).
Not part of the app build; nothing here is imported by `src/` — `facts.ts` below imports FROM
it, never the other way.

## Files

| File | What it is | Rules |
|------|-----------|-------|
| `deploy-amplify.sh` | Pushes a built artifact to the Amplify Hosting manual-deploy branch: `create-deployment` → upload zip → `start-deployment` → poll `get-job` until `SUCCEED`. | Exits non-zero unless the job reaches `SUCCEED` — the deploy badge depends on that. Keep it runnable by hand for rollback. Requires `AMPLIFY_APP_ID` and `AMPLIFY_BRANCH`; takes the zip path as `$1` (default `dist.zip`). |
| `facts.ts` | The `pnpm facts` CLI, run through `tsx` (not a shell script): rewrites every Markdown fence in the repo to its fact's current value. | Imports `FACTS`, `rewriteFile` and `markdownFiles`/`REPO` from `../src/facts/` — see `src/facts/README.md`. Validates every file before writing any, so a single damaged file aborts with the repo untouched. |
| `decisions.ts` | The `pnpm decisions` CLI, run through `tsx`: regenerates `docs/decisions/README.md`'s three index tables from every decision file's front matter. | Imports `readDecisions`/`validateDecisions`/`DECISIONS_DIR` and `spliceGeneratedRows` from `../src/decisions/` — see `src/decisions/README.md`. Validates before writing, same as `facts.ts`. |
| `claim-baseline.ts` | The `pnpm claim-baseline` CLI, run through `tsx`: rewrites `claim-baseline.json` (repo root) to the claim lint's current, real counts. | Imports `scanRepo` from `../src/claims/repo-scan` and `BASELINE_PATH`/`countsFromClaims`/`serializeBaseline`/`loadBaseline` from `../src/claims/baseline` — see `src/claims/README.md`. `src/claims/claim-lint.test.ts` is the read-only check this pairs with. |
| `build-touch-icon.mjs` | Regenerates `public/apple-touch-icon.png` (mark 04) via headless Chrome screenshot — the one copy of the mark no test can guard, since comparing a raster to `public/favicon.svg` needs a renderer the test environment doesn't have. | Run by hand: `node scripts/build-touch-icon.mjs` (needs Chrome; `CHROME` env var overrides the default path). Geometry is duplicated from `favicon.svg` on purpose — see the file's own header comment. `public/README.md` names it in the "change mark 04 together" rule. |

## Rules for this folder

- `set -euo pipefail` in every shell script; fail loudly with a message on stderr and a
  non-zero exit rather than continuing in a half-state.
- A shell script's required inputs are env vars validated up front with `: "${VAR:?message}"`.
- Keep the exec bit set in git on every `.sh` file (`git update-index --chmod=+x`) — Windows
  checkouts do not carry it and the Linux runner needs it. `.gitattributes` pins `*.sh` to LF
  so the shebang survives a CRLF working copy.
- No AWS credentials or account IDs in this folder; CI supplies them via OIDC.
- Operational context belongs in `docs/reference/DEPLOYMENT.md`, not in comments here.
