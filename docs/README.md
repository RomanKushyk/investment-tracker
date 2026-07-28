# docs/ — Project documentation

Working documentation for multi-session, agent-driven development. Root `README.md` stays the spec of record; these docs carry everything the spec doesn't.

## Files & rules

| File | What it is | Rules |
|------|-----------|-------|
| `BUILD-PLAN.md` | **The living plan**: 7 tasks (README §10 order), pinned contracts, seed spec, test fixtures, Status table, session workflow. | Tick step checkboxes as you complete them; keep the Status table current; the **Pinned contracts section is binding** — changing a contract requires updating every task that consumes it plus a DECISIONS entry. |
| `DECISIONS.md` | Decision log D1…Dn (stack, persistence, git conventions, testing scope, reference-data reconciliation). | **Append-only** — add new entries at the bottom, supersede rather than rewrite. Read D5 before touching seed data or derivations. |
| `FOLLOW-UPS.md` | Post-plan backlog: cosmetic/degenerate-data items consciously shipped as-is on 2026-07-28. | Tick or strike items as a sweep clears them; add new deferred-cosmetic findings here rather than reopening `BUILD-PLAN.md`. |

## Conventions for this folder

- New long-lived documentation goes here; one file per concern, linked from `CLAUDE.md` if sessions must always see it.
- Per-folder rules live in that folder's own `README.md` (`design/`, `src/` once created…) — not here.
- The agentic manual-testing map is the root `navigation-map.md` — update it (route status + checkpoints) whenever a task changes screens or flows.
