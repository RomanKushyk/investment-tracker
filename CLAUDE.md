# Quirenote — Investment Portfolio Tracker

Read README.md first — it is the full implementation spec (design tokens, screens, data model, behavior checklist).

## Key facts
- Design reference: `design/Investment Tracker.dc.html`. All styles are INLINE in its markup — read it for any exact color/size/spacing. Ignore `design/support.js` and `_ds/` references (prototype runtime only).
- Stack: React 19 + Vite + TypeScript + Tailwind 4 (see package.json). pnpm.
- Fonts: **IBM Plex Sans** (headings/buttons/KPI numbers) + **JetBrains Mono** (body) — via @fontsource. They replaced Space Grotesk + Spline Sans Mono on 2026-08-12 because **neither of those carries a single Cyrillic letter** and Ukrainian is now the default language (D54). The design reference still shows the old pair; that divergence is deliberate. JetBrains Mono keeps the same 0.6em advance, so no width in the reference moves.
- All portfolio figures must be DERIVED from stored data (snapshots, transactions, assets) — never hard-coded. Seed with the mock data from README §7 so first run matches the reference.
- Persistence **today**: **Dexie.js on IndexedDB** (db `quirenote`) behind `src/lib/repository.ts` — D2. The app is still entirely local; nothing in `src/` talks to a server.
- **Backend alerting has NO SNS topic, and that is deliberate** — the alarms in `infra/template.yaml` carry no `AlarmActions`. CloudWatch publishes alarm state changes to EventBridge for every alarm regardless, and delivery is EventBridge → AWS User Notifications → the Console Mobile App. Email was abandoned after three subscriptions died within seconds of confirmation (D44, D45, D47). Do not "fix" this by adding a topic back.
- **There is now a backend, and the app does not use it yet** — `infra/` runs a daily job that archives asset prices into Aurora DSQL (see `infra/README.md`). It exists because the provider publishes no price history, so a day not captured is lost permanently; it buys that one thing and nothing else. The planned move of the app itself onto it is in `docs/superpowers/specs/2026-08-04-cloud-stack-and-cost.md` and `-data-model.md`. Do not assume either state — check which layer a task is about.
- **Shape is a system, not a taste (D56)** — nothing in the app is a capsule. A standalone control takes `round(min(w,h) × 0.26)`; a box nested against a parent's corner takes `outer = inner + gap`; a segmented control is both (segment proportional, track concentric). Surfaces keep the reference's 16/20/24. Only the logo circle, asset avatars, colour dots and the decorative blob stay round. Measure the RENDERED height — `text-[11px]` sets no line height. Full rule in README §4.
- **The logo is mark 04** — four bars, height is value and opacity is age. It lives in **three** places that must change together — `src/app/Sidebar.tsx` (`Mark`), `public/favicon.svg`, and `public/apple-touch-icon.png`. The first two are pinned against each other by `src/app/mark.test.ts`; the PNG has no automatic guard (a raster cannot be diffed against an SVG in vitest) and is regenerated with `node scripts/build-touch-icon.mjs`. Bar centres are EVEN — a bar spans `[x-2, x+2]`, which only halves to whole device pixels at 16px when `x` is even. The sidebar circle no longer carries ₴/$.
- Currency toggle (₴/$, rate 44.83) converts display of headline KPIs + sidebar only; tables stay in ₴.
- Number format: tables use `68 702,10` (space thousands, comma decimals); prose/KPIs use `₴68,629.36`; dates `dd.MM.yyyy`.

## Working agreements
- Follow README §10 build order; keep the behavior checklist (§9) green.
- **`docs/README.md` is the index of all documentation** — four folders, one per question: `plans/` what to do next, `decisions/` why it is like this, `reference/` how a specific thing works, `archive/` how it got here (never a task list). Go there when you do not know which file you need.
- **docs/plans/NEXT-PHASE-PLAN.md is the plan of record** (v1 is done — docs/archive/BUILD-PLAN.md is its record; v1 pinned contracts stay binding until a phase supersedes them). Execution is split into three sibling plans: **docs/plans/PLAN-NOW.md** (startable today — pick the first non-done task in section order), **docs/plans/PLAN-WAITING.md** (dated; read its table before any `infra/` or migration session), **docs/plans/PLAN-OPEN.md** (unanswered questions — never implement from it; needing an answer means ask). Keep checkboxes + Status tables updated.
- **Decisions: docs/decisions/README.md** — indexes D1–D50 one line each across three range files. Append-only; append to the highest-numbered file. Cited from code by bare number (`D5`, `D30`), so numbers never change. Supersede a wrong decision, never rewrite it.
- **Every top-level folder has a README.md with its local rules** (design/, docs/, src/, infra/) — read it before working there, create one for any new folder, keep them current.
- **navigation-map.md (root) is the agentic manual-testing map** — per-route expected seed values and checkpoints. Use it to verify; update route Status + checkpoints whenever screens or flows change.
- **Deployment is `docs/reference/DEPLOYMENT.md`** — Amplify Hosting manual-deploy app fed by `.github/workflows/deploy-frontend.yml`; hosting config (SPA 200 rewrite, cache headers) is console-managed and CI has no permission to change it (see DECISIONS D15).
- Tailwind theme tokens for the palette (README §4) — no ad-hoc hex in components.
- **Fluid, soft motion on every interaction** (user requirement) — follow "Motion & interaction standards" in docs/archive/BUILD-PLAN.md; nothing pops or snaps instantly; respect prefers-reduced-motion.
- `pnpm lint` and `pnpm typecheck` must pass before considering a task done (plus `pnpm test` once vitest lands in Task 2).

## Git conventions (this repo)
- Personal pet project — **no Jira, never ask for a ticket key**.
- Base branch: `dev`. Feature branches `<type>/<kebab-title>` (e.g. `feat/daily-quotes`), plain conventional commits, squash-merge back to `dev`.
- Remote: `origin` → `git@github-personal:RomanKushyk/investment-tracker.git` (personal GitHub account). Push `dev` after merging.
- Author identity is repo-local and personal: `RomanKushyk <romankushyk0@gmail.com>` — never commit here with the work identity.
