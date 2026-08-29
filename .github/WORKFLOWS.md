# .github/ — CI and repository automation

> **This file is `WORKFLOWS.md` and not `README.md` on purpose.** GitHub renders
> the repository landing page from `.github/README.md` before the root one, so a
> README here would silently replace the product spec as this public repo's
> front page. The folder-README rule in `CLAUDE.md` is satisfied by this file
> under a name GitHub does not claim.

Two workflows, and one file that is deliberately absent.

**The workflows are two files in `workflows/`, and they are the source — this
page deliberately does not transcribe their triggers or path filters.** A copy
here would go quietly false the next time one is edited, and nothing checks
prose (`docs/README.md` states that rule; the `app.version` fence in
`docs/plans/NEXT-PHASE-PLAN.md` exists because a hand-copied figure survived six
releases). Read `deploy-frontend.yml` and `deploy-backend.yml`; what follows is
only what the files themselves do not say.

- **`paths-ignore` skips a run only when EVERY changed file matches it.** A
  documentation change that also rewrites root-level `claim-baseline.json` —
  most do — therefore still runs the frontend workflow. This is the single most
  misread thing about the setup.
- **Neither workflow runs on a pull request**, so the suite never runs on
  the branch a change is reviewed on. It runs after the squash-merge and gates
  the *deploy*, not the landing. Before a change lands, the gates are the
  author's to run and D76's review is what stands between an edit and `dev`.
- **The frontend typecheck has no step of its own** — it happens inside
  `pnpm build` (`tsc --noEmit && vite build`), so simplifying that script would
  silently end it.
- **The backend one is explicit, and it had to be added.** Root `tsconfig.json`
  includes only `src`, `vite.config.ts` and `scripts`, so `pnpm typecheck` never
  read `infra/` and `infra/tsconfig.json` was run by nothing — measured: a
  deliberate type error in `infra/src` passed the local gates, and esbuild strips
  types on the way out. `deploy-backend.yml` now runs `pnpm exec tsc --noEmit -p infra`
  **and `pnpm lint`** before any credential exists (issue #30) — the lint half
  had the identical hole: `eslint .` covers `infra/`, but only the frontend
  workflow ran it and its `paths-ignore` contains `infra/**`.
- **`pnpm exec`, never bare `npx`, for anything in `infra/`.** That folder
  declares neither `typescript` nor `@types/node`; both resolve from the root
  pnpm tree, so `npx` run outside it fetches an unrelated TypeScript and then
  fails on missing node types.
- **There are THREE dependency ecosystems here**, and the pinned actions are one
  of them: `actions/checkout`, `actions/setup-node`,
  `aws-actions/configure-aws-credentials`, `aws-actions/setup-sam`. Dependabot
  can raise an advisory on any of them, with **no manifest and no lockfile** to
  fix it in — the `@vN` pin IS the version, so the fix is a hand edit here.
- **`infra/` is a SECOND dependency tree, and it is npm, not pnpm.**
  `infra/package.json` + `infra/package-lock.json`, installed by `npm ci` in the
  backend workflow. Anything reasoning about "the dependencies" has to say which
  manifest it means.

## Do not add `dependabot.yml` (nor `dependabot.yaml`)

**Dependabot is on for SECURITY only** — alerts plus automated security fixes,
enabled as repository *settings*. `dependabot.yml` is what turns on routine
version-bump PRs, and every merge here costs a `/code-review` (D76), so version
churn would tax the gate that protects the app while buying no security.

The ruling is [`../docs/decisions/D104.md`](../docs/decisions/D104.md) §2 and the
runbook for handling an advisory is
[`../docs/reference/DEPENDABOT.md`](../docs/reference/DEPENDABOT.md). **This note
exists because the prohibition lived only in files nobody opens while working in
this folder** — the natural place to create `dependabot.yml` is right here.
Enabling version updates means superseding D104 first, on purpose — **and `src/dependabot-config.test.ts` will turn the suite red the moment the file appears**, so this is a gate now, not only a paragraph.

## Local rules

- **Deploy config is console-managed** where the workflow cannot reach it —
  hosting rewrites and cache headers are set in the Amplify console and CI has no
  `UpdateApp` permission (D15). See
  [`../docs/reference/DEPLOYMENT.md`](../docs/reference/DEPLOYMENT.md).
- **Pin actions by major and bump deliberately.** Every action here was moved off
  the deprecated Node 20 runtimes in one pass; the trap that pass stepped over is
  recorded in `docs/plans/FOLLOW-UPS.md` item 12.
- **A workflow file is code.** It goes through a branch, the gates and
  `/code-review` like anything else (D73, D76).
