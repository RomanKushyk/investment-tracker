# v1 — §9 traceability and the session workflow

> Moved **verbatim** from `../BUILD-PLAN.md` on 2026-08-26 (D95). Index: [`../BUILD-PLAN.md`](../BUILD-PLAN.md). **v1 is closed — this is a record, not a task list**, but the behavior checklist it maps is still the one README §9 carries.

## §9 behavior checklist → task traceability

| §9 item | Owned by | Result |
|---------|----------|--------|
| Quote entry live chips/pill, save+toast+last-saved, copy yesterday | Task 3 | **pass** (2026-07-28) |
| Snapshot upsert per day | Task 2 (repo) + 3 (UI) | **pass** (2026-07-28) |
| Transaction form / new-asset sub-form / recent list | Task 4 | **pass** (2026-07-28) |
| Currency toggle persistence + scope | Task 7 (store from Task 2) | **pass** (2026-07-28) — only logo/sidebar/Overview KPIs convert; tables ₴; survives reload |
| Charts recompute from stored data | Task 6 | **pass** (2026-07-28) |
| No horizontal scroll ≥360px; sidebar internal scroll | Task 1, re-verified Task 7 | **pass** (2026-07-28) — `max-sm:` sidebar rail; all 9 routes clean at 360px & 641px |
| Focus rings, hover, aria-current | Task 1, re-verified Task 7 | **pass** (2026-07-28) |

## Session workflow (every future session)

1. Read `CLAUDE.md`, this file's Status table, `docs/decisions/README.md` (especially D5 before touching seed/derivations). README.md stays the spec of record.
2. `git checkout dev && git pull` (remote: `origin` → RomanKushyk/investment-tracker on the personal GitHub account; commits must be authored `RomanKushyk <romankushyk0@gmail.com>` — repo-local config, already set).
3. Take the first non-done task, branch as listed, execute steps top-to-bottom, ticking checkboxes in this file as you go.
4. Browser-verify against `design/Investment Tracker.dc.html` — open it directly (interactive via its bottom script), but remember the `.btn/.input/.field/.table/.tag` styling caveat in `design/README.md`. Use root `navigation-map.md` for per-route checkpoints and expected seed values. The app runs pinned to :3000; the user's dev server is usually already up — check before starting one.
5. All gates green → conventional commit, squash-merge to `dev`, update the Status table + `navigation-map.md` (route Status, any changed checkpoints) + affected folder READMEs, commit doc updates.
