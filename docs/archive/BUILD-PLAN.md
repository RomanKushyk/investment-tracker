# Quirenote Implementation Plan

> **For agentic workers: this plan is CLOSED — do not execute it.** v1 shipped 2026-07-28 and `../README.md`'s rule holds: nothing in `archive/` is a task list. The instruction that stood here told a reader to tick checkboxes in this file; every checkbox moved to [`build-plan/tasks-1-7.md`](build-plan/tasks-1-7.md) on 2026-08-26, already ticked, and the same stale sentence survives verbatim inside [`build-plan/traceability.md`](build-plan/traceability.md) because a record is not rewritten.

**Goal:** Recreate `design/Investment Tracker.dc.html` as a production React SPA where every figure is derived from locally stored data (Dexie/IndexedDB), seeded so first run matches the reference.

**Architecture:** A 9-route SPA (react-router) with a fixed dark sidebar shell. All portfolio data lives in IndexedDB behind `src/lib/repository.ts`, consumed via TanStack Query; pure derivation/formatting functions in `src/lib` turn raw records into every displayed number. Currency preference + draft quote entry live in persisted zustand stores.

**Tech Stack:** React 19, Vite 7, TypeScript 5 (strict), Tailwind 4 `@theme` tokens, Dexie 4, TanStack Query 5, zustand 5, react-hook-form + zod, recharts 3, Radix, CVA, sonner, react-day-picker, lucide-react. See `docs/decisions/README.md`.

## Global constraints

Copied from README / CLAUDE.md — every task implicitly includes these:

- **Source of truth:** README.md is the spec; `design/Investment Tracker.dc.html` is the visual reference. Where the reference's mock copy is internally inconsistent, `docs/decisions/README.md` D5 pins the resolution — check it before "fixing" a mismatch. Ignore `design/support.js` and `_ds/` references. `design/Tracker Options.dc.html` only disambiguates.
- **No hard-coded figures.** Every displayed number derives from stored assets/snapshots/transactions. Seed data makes first run match the reference.
- **Palette only via Tailwind `@theme` tokens** (Task 1) — no ad-hoc hex in components. Charts use `src/lib/colors.ts` (mirrors the tokens; recharts can't resolve CSS vars in SVG attributes).
- **Fonts:** Space Grotesk 600/700 for h1–h4, buttons, KPI numbers; Spline Sans Mono for body/labels/tables. h2 26px, KPI value 26px, micro-labels 10px uppercase `.12em`, body 13px, tables 12.5px.
- **Formats:** prose/KPI `₴68,629.36`, USD `$3,324.03`; tables/inputs `68 702,10` (NBSP thousands, comma decimals); dates `dd.MM.yyyy`, short `dd.MM`, payouts "10 Aug"; deltas always signed, green `#5c7355` / negative `#a8695a`, "pp" for point gaps. Exception: Allocation current-vs-target delta color encodes off-target severity, not sign (see Task 6).
- **Currency toggle** (₴/$, stored rate 44.83) converts **display only** of logo symbol, sidebar capital, Overview KPIs. Tables stay in ₴. Preference persists across reloads.
- **Layout:** no horizontal scroll ≥360px; sidebar 232px fixed, internally scrollable; grids wrap via `repeat(auto-fit,minmax(200px,1fr))`-style rules.
- **A11y:** focus-visible rings (`2px solid #26262a`, offset 2px), hover states, `aria-current` on active nav.
- **Quality gate per task:** `pnpm lint && pnpm typecheck` (plus `pnpm test` once vitest exists) green before commit; browser-verify against the design reference. The app is pinned to port 3000 (vite.config) — the dev server is usually already running; check before launching one.
- **Git:** pet project, no Jira. Branch `<type>/<kebab-title>` off `dev`, plain conventional commits, no AI attribution. Squash-merge back to `dev`, then push. Author identity: `RomanKushyk <romankushyk0@gmail.com>` (repo-local config — never the work identity).
- **Motion:** every interaction animates fluidly — see "Motion & interaction standards" below (user requirement, D7). Nothing pops or snaps instantly.
- **Docs upkeep:** every top-level folder carries a `README.md` with its local rules — create one for any new folder (Task 1 creates `src/README.md`). Root `navigation-map.md` is the agentic manual-testing map: update its route Status + checkpoints (and affected folder READMEs) whenever a task changes screens, flows or structure.

## Motion & interaction standards (user requirement — D7)

Every UX/UI move or interaction animates; the app must feel lively, tactile and **soft**. No new deps: CSS transitions + `tw-animate-css` utilities (imported in `src/index.css`) + recharts/sonner built-ins.

- **Defaults:** all `transition*` utilities inherit the soft curve `cubic-bezier(0.22,1,0.36,1)` and 220ms via the `--default-transition-*` theme tokens in `src/index.css`. Micro-feedback (hover) may drop to `duration-150`; reveals and layout shifts use `duration-300`–`400`.
- **Tactile press:** every button/pill/segment gets `transition active:scale-[.97]`.
- **Hover states:** never instant — background/opacity/color changes always transition.
- **Screen changes:** `Layout` re-mounts the outlet per route inside `animate-in fade-in slide-in-from-bottom-2 duration-300` (pattern already wired — keep it).
- **Reveals** (New-asset sub-form, cards appearing, empty states): `animate-in fade-in slide-in-from-*`/`zoom-in-*` — never instant mount; prefer symmetric exit when feasible.
- **Live state** (delta chips, "N of 4 filled" pill, filled-input borders): colors/borders transition; when a chip's *value* changes, re-trigger entry animation (`key` the element by value + `animate-in fade-in zoom-in-95`).
- **Charts (Task 6):** keep recharts `isAnimationActive` on, duration ≈900ms ease-out; data updates animate from previous state — never redraw cold.
- **Currency toggle (Task 7):** sliding thumb (transform transition); headline KPI values tween between currencies (~300ms rAF hook, e.g. `hooks/useTweenedNumber`).
- **Toasts:** sonner defaults are already soft — keep.
- **A11y:** the global `prefers-reduced-motion: reduce` kill-switch in `src/index.css` stays; never animate so click targets shift under a hovering pointer.

## Status

| # | Task | Branch | Status |
|---|------|--------|--------|
| 1 | Scaffold, theme, shell + nav | `feat/scaffold-shell` | **done** (2026-07-27) |
| 2 | Data layer + seed + tests | `feat/data-layer` | **done** (2026-07-27) |
| 3 | Daily quotes screen | `feat/daily-quotes` | **done** (2026-07-27) |
| 4 | Transaction form + new-asset sub-form | `feat/transaction-form` | **done** (2026-07-27) |
| 5 | Overview, Portfolio, Attributes | `feat/derived-views` | **done** (2026-07-27) |
| 6 | Charts: Balances, Payouts, Yield, Seasonality, Allocation | `feat/charts` | **done** (2026-07-28) |
| 7 | Currency toggle, toasts, polish, empty states | `feat/polish` | **done** (2026-07-28) — plan complete |

Plan complete. Deferred cosmetic items live in `docs/plans/FOLLOW-UPS.md` (non-blocking; one `chore/cosmetic-sweep` branch clears them).

## Design reference

How to read `design/Investment Tracker.dc.html` — file anatomy, the **line map** that task references below ("design lines X–Y") point into, and the browser-rendering caveat — lives in **`design/README.md`**. Read it once per session before any visual work.

## Where the rest of it is

**Split 2026-08-26 (D95)** — this file keeps the constraints, the motion
standards and the status; the long sections moved verbatim to
[`build-plan/`](build-plan/), so no file goes over 200 lines. Nothing was
rewritten, and **the pinned contracts still bind**.

| File | Holds | Still binding? |
|---|---|---|
| [`build-plan/file-structure.md`](build-plan/file-structure.md) | The `src/` layout v1 established | As the record — the layout is still the live one |
| [`build-plan/pinned-contracts.md`](build-plan/pinned-contracts.md) | Domain types, Dexie, repository, hooks, stores, derivations, formatting, Tailwind tokens, routes | **Yes** — until a decision in `../decisions/` supersedes them |
| [`build-plan/tasks-1-7.md`](build-plan/tasks-1-7.md) | Tasks 1–7, all shipped 2026-07-28 | No — closed |
| [`build-plan/traceability.md`](build-plan/traceability.md) | §9 behavior checklist → task map, and the v1 session workflow | The checklist is still README §9's |
