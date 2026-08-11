# docs/ — Project documentation

Working documentation for multi-session, agent-driven development. Root `README.md` stays the spec of record; these docs carry everything the spec doesn't.

## Files & rules

| File | What it is | Rules |
|------|-----------|-------|
| `BUILD-PLAN.md` | The **v1 record** (Tasks 1–7, done): pinned contracts, seed spec, test fixtures, session workflow. | Historical reference — v1 pinned contracts stay binding until a NEXT-PHASE-PLAN phase supersedes them (with a DECISIONS entry). Do not reopen tasks here. |
| `NEXT-PHASE-PLAN.md` | **The plan of record and index** (rewritten 2026-08-11 for the cloud direction): shipped record, retired items with reasons, governing decisions G1–G8 with their current standing. Execution is split into the three plans below. | Keep the Status table current; contract changes require a DECISIONS entry. |
| `PLAN-NOW.md` | **Plan A — startable today.** Nothing gates these: coupon-date fix, the backend's do-before-data phases, the pure app work, and the theme + Ukrainian sweep. Full phase ceremony (goal, rationale, tasks, contracts, verify, risks). | Pick the first non-done task in section order. Gates green per merge. |
| `PLAN-WAITING.md` | **Plan B — dated.** Everything gated on elapsed time or an external event, with earliest dates, which are hard, and what missing one costs. | **Read the dated table at the start of any session touching `infra/` or the migration.** Move an item to PLAN-NOW the day its gate opens. |
| `PLAN-OPEN.md` | **Plan C — open questions.** 13 of 16 resolved 2026-08-11 in D30–D35; what remains is three read-time derivations deferred at zero cost plus the archive row's non-key columns. Carries the trail from each decision to the task it created. | **Never implement from this file.** Answer → DECISIONS entry → update the Status table → file the work into PLAN-NOW or PLAN-WAITING. |
| `NEXT-PHASE-DRAFT.md` | The user's raw wishlist that NEXT-PHASE-PLAN implements. | Input document — don't edit except when grooming leftovers into a fresh draft at P7 closeout. |
| `WEALTH-MANAGEMENT-ARCHITECTRUE.md` | User's spreadsheet-era business-logic spec (formulas + resolved edge cases). | Source of truth for the P1 formula audit (`FORMULA-AUDIT.md` records the reconciliation). |
| `FORMULA-AUDIT.md` | The P1 formula-audit record: per doc-challenge → app formula → validation figures → verdict, plus the pinned fintech rulings and the dual-metric-family map. | Every deviation from `WEALTH-MANAGEMENT-ARCHITECTRUE.md` is pinned here (with D13); consult before touching any `core/derive.ts` / `core/xirr.ts` formula. |
| `DECISIONS.md` | Decision log D1…Dn (stack, persistence, git conventions, testing scope, reference-data reconciliation). | **Append-only** — add new entries at the bottom, supersede rather than rewrite. Read D5 before touching seed data or derivations. |
| `FOLLOW-UPS.md` | Post-plan backlog: cosmetic/degenerate-data items consciously shipped as-is on 2026-07-28. | Tick or strike items as a sweep clears them; add new deferred-cosmetic findings here rather than reopening `BUILD-PLAN.md`. |
| `VERSIONING.md` | App version & sidebar badge: single source of truth (`package.json`), SemVer bump rules, tag convention. | Bump `package.json` only — the badge derives from it at build time; keep tag `vX.Y.Z` and `package.json` in agreement. |
| `DEPLOYMENT.md` | Deploy runbook for the **frontend**: Amplify Hosting manual-deploy app + GitHub Actions pipeline, IAM/OIDC setup, rollback, failure playbook. | Hosting config (rewrite, cache headers) is console-managed by design — CI has no `UpdateApp`; keep §5 current when a failure mode is hit. The **backend** is a separate stack with its own workflow and its own IAM role — see `infra/README.md`, not this file. |

## Conventions for this folder

- New long-lived documentation goes here; one file per concern, linked from `CLAUDE.md` if sessions must always see it.
- Per-folder rules live in that folder's own `README.md` (`design/`, `src/` once created…) — not here.
- The agentic manual-testing map is the root `navigation-map.md` — update it (route status + checkpoints) whenever a task changes screens or flows.
- `superpowers/specs/` and `superpowers/plans/` hold dated design specs and implementation plans from brainstorming/planning sessions. They are point-in-time records — once a plan is executed, the durable documentation is the concern file here (e.g. `DEPLOYMENT.md`) plus the `DECISIONS.md` entry.

## The backend (since 2026-08-11)

There are now **two** deployables, and most tasks concern only one of them:

| | Frontend | Backend |
|---|---|---|
| Lives in | `src/` | `infra/` |
| Deploys to | Amplify Hosting | Aurora DSQL + Lambda, `eu-north-1` |
| Workflow | `.github/workflows/deploy.yml` | `.github/workflows/deploy-backend.yml` |
| IAM role | `kubushka-github-deploy` | `kubushka-backend-deploy` (separate, by design) |
| Docs | `DEPLOYMENT.md` | `infra/README.md` |

**The app does not read the backend yet.** Portfolio data is still IndexedDB
(D2); the backend only archives prices, because the provider publishes no
history and a missed day is unrecoverable (D26).

Two dated specs describe where this is going and why — read them before
proposing anything about persistence, sources or the data model:
`superpowers/specs/2026-08-04-cloud-stack-and-cost.md` (stack, costs, rejected
options) and `-data-model.md` (schema, sources, super-admin surface). Field
notes from the first live deploy — eight failures, none of them in the docs read
beforehand — are in `infra/README.md`.
