# .github/

Three workflows — `workflows/deploy-frontend.yml`, `workflows/deploy-backend.yml` and the manual `workflows/migrate.yml` — are themselves the source for what they fire on; read them for the literal triggers. What follows is what they do not say for themselves.

- **`paths-ignore` (frontend) and `paths` (backend) skip a run only when EVERY changed file matches the filter** — a commit touching both a skipped and a live path still runs.
- Frontend fires on push to `dev`/`main`, ignoring `**/*.md`, `docs/**`, `infra/**` and `deploy-backend.yml`: a backend-only or docs-only commit does not rebuild the SPA.
- Backend fires on push to `dev` **and `main`**, matching `infra/**`, the shared `src/core/{inzhur,nbu}/**`, `dates.ts`, `types.ts`, `package.json`, `pnpm-lock.yaml` and `.github/**` — the last so a `.github/README.md` commit, which frontend's `**/*.md` ignore skips, still runs a workflow and its gates.
- **The two branches deploy different things.** It is three stacks: the user stack for the ref's environment deploys from either branch, the archive stack from `dev` alone — one archive and one capture serve every environment. So `main` is the only way to reach the prod user stack, and `dev` is the only way to reach the archive; a `workflow_dispatch` on `main` cannot repair the archive. The user stack is deployed FIRST, because the archive deploy is what removes the old migration function.
- Because `main` moves by fast-forward, a release's push range is every commit since the last one, so the prod user stack deploys whenever any of them touched `paths` — and is otherwise left alone, which is correct and worth recognising rather than debugging.
- `migrate.yml` is `workflow_dispatch` only and never runs from a deploy. It takes a `mode` and a `target`, neither with a default, and resolves the runner out of `quirenote-backend-user-<target>`. The `prod` environment's deployment branch policy is what refuses a prod migration dispatched from anywhere but `main`, before any credential exists.
- No workflow here runs on a pull request; the suite runs after the squash-merge and gates the deploy, not the review.
- The two are separate workflows so a broken SPA build never blocks the price capture, and `deploy-backend.yml` runs the whole test suite before any AWS credential exists.
- Frontend's typecheck is inside `pnpm build`, not its own step. Backend runs `pnpm exec tsc --noEmit -p infra` and `pnpm lint` explicitly, because root `tsconfig.json` never includes `infra/` and frontend's `paths-ignore` excludes `infra/**` from ever being linted there.
- Use `pnpm exec`, never bare `npx`, for anything in `infra/` — it declares no TypeScript of its own and resolves it from the root pnpm tree.
- Three dependency ecosystems: root (pnpm), `infra/` (npm), and the pinned Actions (`actions/checkout`, `actions/setup-node`, `aws-actions/configure-aws-credentials`, `aws-actions/setup-sam`) — the last has no manifest or lockfile, so an advisory against one is a hand edit here. See `docs/reference/DEPENDABOT.md`.

## No dependabot.yml

Never add `.github/dependabot.yml` (nor `.yaml`). GitHub's UI commits this file the moment someone switches version updates on, and `src/dependabot-config.test.ts` fails the suite if it appears. Security alerts and fixes are already on as a repo setting; this file would also turn on routine version-bump PRs, and every merge here costs a review, so version churn would tax the gate for no security gain.

## No README here

GitHub renders `.github/README.md` as the repository landing page in place of the root one, so this folder documents itself as `WORKFLOWS.md` instead. `src/github-landing-page.test.ts` guards against one appearing.
