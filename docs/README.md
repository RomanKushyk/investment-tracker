# docs/ — Project documentation

Working documentation for multi-session, agent-driven development. Root `README.md` stays the spec of record; these docs carry everything the spec doesn't.

## Files & rules

| File | What it is | Rules |
|------|-----------|-------|
| `BUILD-PLAN.md` | The **v1 record** (Tasks 1–7, done): pinned contracts, seed spec, test fixtures, session workflow. | Historical reference — v1 pinned contracts stay binding until a NEXT-PHASE-PLAN phase supersedes them (with a DECISIONS entry). Do not reopen tasks here. |
| `NEXT-PHASE-PLAN.md` | **The living plan** (post-v1.0.0): 8 phases covering `NEXT-PHASE-DRAFT.md`, governing decisions G1–G8, formula reconciliation, per-phase tasks/verification. | Tick checkboxes as you complete them; keep the Status table current; contract changes require a DECISIONS entry. |
| `NEXT-PHASE-DRAFT.md` | The user's raw wishlist that NEXT-PHASE-PLAN implements. | Input document — don't edit except when grooming leftovers into a fresh draft at P7 closeout. |
| `WEALTH-MANAGEMENT-ARCHITECTRUE.md` | User's spreadsheet-era business-logic spec (formulas + resolved edge cases). | Source of truth for the P1 formula audit (`FORMULA-AUDIT.md` records the reconciliation). |
| `FORMULA-AUDIT.md` | The P1 formula-audit record: per doc-challenge → app formula → validation figures → verdict, plus the pinned fintech rulings and the dual-metric-family map. | Every deviation from `WEALTH-MANAGEMENT-ARCHITECTRUE.md` is pinned here (with D13); consult before touching any `core/derive.ts` / `core/xirr.ts` formula. |
| `DECISIONS.md` | Decision log D1…Dn (stack, persistence, git conventions, testing scope, reference-data reconciliation). | **Append-only** — add new entries at the bottom, supersede rather than rewrite. Read D5 before touching seed data or derivations. |
| `FOLLOW-UPS.md` | Post-plan backlog: cosmetic/degenerate-data items consciously shipped as-is on 2026-07-28. | Tick or strike items as a sweep clears them; add new deferred-cosmetic findings here rather than reopening `BUILD-PLAN.md`. |
| `VERSIONING.md` | App version & sidebar badge: single source of truth (`package.json`), SemVer bump rules, tag convention. | Bump `package.json` only — the badge derives from it at build time; keep tag `vX.Y.Z` and `package.json` in agreement. |
| `DEPLOYMENT.md` | Deploy runbook: Amplify Hosting manual-deploy app + GitHub Actions pipeline, IAM/OIDC setup, rollback, failure playbook. | Hosting config (rewrite, cache headers) is console-managed by design — CI has no `UpdateApp`; keep §5 current when a failure mode is hit. |

## Conventions for this folder

- New long-lived documentation goes here; one file per concern, linked from `CLAUDE.md` if sessions must always see it.
- Per-folder rules live in that folder's own `README.md` (`design/`, `src/` once created…) — not here.
- The agentic manual-testing map is the root `navigation-map.md` — update it (route status + checkpoints) whenever a task changes screens or flows.
- `superpowers/specs/` and `superpowers/plans/` hold dated design specs and implementation plans from brainstorming/planning sessions. They are point-in-time records — once a plan is executed, the durable documentation is the concern file here (e.g. `DEPLOYMENT.md`) plus the `DECISIONS.md` entry.
