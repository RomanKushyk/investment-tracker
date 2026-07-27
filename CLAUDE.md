# Kubushka — Investment Portfolio Tracker

Read README.md first — it is the full implementation spec (design tokens, screens, data model, behavior checklist).

## Key facts
- Design reference: `design/Investment Tracker.dc.html`. All styles are INLINE in its markup — read it for any exact color/size/spacing. Ignore `design/support.js` and `_ds/` references (prototype runtime only).
- Stack: React 19 + Vite + TypeScript + Tailwind 4 (see package.json). pnpm.
- Fonts: Space Grotesk (headings/buttons/KPI numbers) + Spline Sans Mono (body) — via @fontsource packages already in deps.
- All portfolio figures must be DERIVED from stored data (snapshots, transactions, assets) — never hard-coded. Seed with the mock data from README §7 so first run matches the reference.
- Local-only persistence: **Dexie.js on IndexedDB** (db `kubushka`) behind `src/lib/repository.ts` — decided 2026-07-27, see docs/DECISIONS.md D2. No server.
- Currency toggle (₴/$, rate 44.83) converts display of headline KPIs + sidebar only; tables stay in ₴.
- Number format: tables use `68 702,10` (space thousands, comma decimals); prose/KPIs use `₴68,629.36`; dates `dd.MM.yyyy`.

## Working agreements
- Follow README §10 build order; keep the behavior checklist (§9) green.
- **docs/BUILD-PLAN.md is the living plan** — pinned contracts (types, repo/hooks/store APIs, token names), task checkboxes, Status table. Pick up the first non-done task there and keep it updated. Decisions log: docs/DECISIONS.md.
- **Every top-level folder has a README.md with its local rules** (design/, docs/, src/ once created) — read it before working there, create one for any new folder, keep them current.
- **navigation-map.md (root) is the agentic manual-testing map** — per-route expected seed values and checkpoints. Use it to verify; update route Status + checkpoints whenever screens or flows change.
- Tailwind theme tokens for the palette (README §4) — no ad-hoc hex in components.
- `pnpm lint` and `pnpm typecheck` must pass before considering a task done (plus `pnpm test` once vitest lands in Task 2).

## Git conventions (this repo)
- Personal pet project — **no Jira, never ask for a ticket key**.
- Base branch: `dev`. Feature branches `<type>/<kebab-title>` (e.g. `feat/daily-quotes`), plain conventional commits, squash-merge back to `dev`.
- Remote: `origin` → `git@github-personal:RomanKushyk/investment-tracker.git` (personal GitHub account). Push `dev` after merging.
- Author identity is repo-local and personal: `RomanKushyk <romankushyk0@gmail.com>` — never commit here with the work identity.
