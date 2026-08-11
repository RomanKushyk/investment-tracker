# Kubushka — Investment Portfolio Tracker

Read README.md first — it is the full implementation spec (design tokens, screens, data model, behavior checklist).

## Key facts
- Design reference: `design/Investment Tracker.dc.html`. All styles are INLINE in its markup — read it for any exact color/size/spacing. Ignore `design/support.js` and `_ds/` references (prototype runtime only).
- Stack: React 19 + Vite + TypeScript + Tailwind 4 (see package.json). pnpm.
- Fonts: Space Grotesk (headings/buttons/KPI numbers) + Spline Sans Mono (body) — via @fontsource packages already in deps.
- All portfolio figures must be DERIVED from stored data (snapshots, transactions, assets) — never hard-coded. Seed with the mock data from README §7 so first run matches the reference.
- Persistence **today**: **Dexie.js on IndexedDB** (db `kubushka`) behind `src/lib/repository.ts` — D2. The app is still entirely local; nothing in `src/` talks to a server.
- **There is now a backend, and the app does not use it yet** — `infra/` runs a daily job that archives asset prices into Aurora DSQL (see `infra/README.md`). It exists because the provider publishes no price history, so a day not captured is lost permanently; it buys that one thing and nothing else. The planned move of the app itself onto it is in `docs/superpowers/specs/2026-08-04-cloud-stack-and-cost.md` and `-data-model.md`. Do not assume either state — check which layer a task is about.
- Currency toggle (₴/$, rate 44.83) converts display of headline KPIs + sidebar only; tables stay in ₴.
- Number format: tables use `68 702,10` (space thousands, comma decimals); prose/KPIs use `₴68,629.36`; dates `dd.MM.yyyy`.

## Working agreements
- Follow README §10 build order; keep the behavior checklist (§9) green.
- **docs/NEXT-PHASE-PLAN.md is the plan of record and index** (v1 is done — docs/BUILD-PLAN.md is its record; v1 pinned contracts stay binding until a phase supersedes them). Execution is split into three sibling plans: **docs/PLAN-NOW.md** (startable today — pick the first non-done task in section order), **docs/PLAN-WAITING.md** (dated; read its table before any `infra/` or migration session), **docs/PLAN-OPEN.md** (unanswered questions — never implement from it; needing an answer means ask). Keep checkboxes + Status tables updated. Decisions log: docs/DECISIONS.md.
- **Every top-level folder has a README.md with its local rules** (design/, docs/, src/ once created) — read it before working there, create one for any new folder, keep them current.
- **navigation-map.md (root) is the agentic manual-testing map** — per-route expected seed values and checkpoints. Use it to verify; update route Status + checkpoints whenever screens or flows change.
- **Deployment is `docs/DEPLOYMENT.md`** — Amplify Hosting manual-deploy app fed by `.github/workflows/deploy.yml`; hosting config (SPA 200 rewrite, cache headers) is console-managed and CI has no permission to change it (see DECISIONS D15).
- Tailwind theme tokens for the palette (README §4) — no ad-hoc hex in components.
- **Fluid, soft motion on every interaction** (user requirement) — follow "Motion & interaction standards" in docs/BUILD-PLAN.md; nothing pops or snaps instantly; respect prefers-reduced-motion.
- `pnpm lint` and `pnpm typecheck` must pass before considering a task done (plus `pnpm test` once vitest lands in Task 2).

## Git conventions (this repo)
- Personal pet project — **no Jira, never ask for a ticket key**.
- Base branch: `dev`. Feature branches `<type>/<kebab-title>` (e.g. `feat/daily-quotes`), plain conventional commits, squash-merge back to `dev`.
- Remote: `origin` → `git@github-personal:RomanKushyk/investment-tracker.git` (personal GitHub account). Push `dev` after merging.
- Author identity is repo-local and personal: `RomanKushyk <romankushyk0@gmail.com>` — never commit here with the work identity.
