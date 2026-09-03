# .github/

Two workflows, `workflows/deploy-frontend.yml` and `workflows/deploy-backend.yml`, are the source for what they fire on — read them for the literal triggers. What follows is what they do not say for themselves.

- **`paths-ignore` (frontend) and `paths` (backend) skip a run only when EVERY changed file matches the filter** — a commit touching both a skipped and a live path still runs.
- Frontend fires on push to `dev`/`main`, ignoring `**/*.md`, `docs/**`, `infra/**` and `deploy-backend.yml`: a backend-only or docs-only commit does not rebuild the SPA.
- Backend fires on push to `dev` only, matching `infra/**`, the shared `src/core/{inzhur,nbu}/**`, `dates.ts`, `types.ts`, `package.json`, `pnpm-lock.yaml` and `.github/**` — the last so a `.github/README.md` commit, which frontend's `**/*.md` ignore skips, still runs a workflow and its gates.
- Neither workflow runs on a pull request; the suite runs after the squash-merge and gates the deploy, not the review.
- The two are separate workflows so a broken SPA build never blocks the price capture, and `deploy-backend.yml` runs the whole test suite before any AWS credential exists.
- Frontend's typecheck is inside `pnpm build`, not its own step. Backend runs `pnpm exec tsc --noEmit -p infra` and `pnpm lint` explicitly, because root `tsconfig.json` never includes `infra/` and frontend's `paths-ignore` excludes `infra/**` from ever being linted there.
- Use `pnpm exec`, never bare `npx`, for anything in `infra/` — it declares no TypeScript of its own and resolves it from the root pnpm tree.
- Three dependency ecosystems: root (pnpm), `infra/` (npm), and the pinned Actions (`actions/checkout`, `actions/setup-node`, `aws-actions/configure-aws-credentials`, `aws-actions/setup-sam`) — the last has no manifest or lockfile, so an advisory against one is a hand edit here. See `docs/reference/DEPENDABOT.md`.

## No dependabot.yml

Never add `.github/dependabot.yml` (nor `.yaml`). GitHub's UI commits this file the moment someone switches version updates on, and `src/dependabot-config.test.ts` fails the suite if it appears. Security alerts and fixes are already on as a repo setting; this file would also turn on routine version-bump PRs, and every merge here costs a review, so version churn would tax the gate for no security gain.

## No README here

GitHub renders `.github/README.md` as the repository landing page in place of the root one, so this folder documents itself as `WORKFLOWS.md` instead. `src/github-landing-page.test.ts` guards against one appearing.
