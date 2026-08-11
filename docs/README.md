# docs/ — the index

Root `README.md` is the product spec. Everything the spec does not carry lives
here, in four folders that answer four different questions.

| Folder | Answers | Read it when |
|---|---|---|
| [`plans/`](plans/) | **What to do next** | Starting a session |
| [`decisions/`](decisions/README.md) | **Why it is like this** | Something looks wrong and you want to know if it is deliberate |
| [`reference/`](reference/) | **How a specific thing works** | You are about to touch deploys, versions, or a formula |
| [`superpowers/specs/`](superpowers/specs/) | **Where it is going** | Working on `infra/` or the migration |
| [`archive/`](archive/README.md) | **How it got here** | Historical. Never a task list |

---

## Start here

**Pick the first non-done task in section order from
[`plans/PLAN-NOW.md`](plans/PLAN-NOW.md).** That is the whole workflow. The
other plans exist to keep things *out* of that one.

| File | What it is | The rule |
|---|---|---|
| [`plans/NEXT-PHASE-PLAN.md`](plans/NEXT-PHASE-PLAN.md) | The plan of record: shipped work, retired items with reasons, governing decisions G1–G8 | Keep the Status table current; a contract change needs a decision entry |
| [`plans/PLAN-NOW.md`](plans/PLAN-NOW.md) | **Plan A — startable today.** Nothing gates these | Pick the first non-done task in section order. Gates green per merge |
| [`plans/PLAN-WAITING.md`](plans/PLAN-WAITING.md) | **Plan B — dated.** Gated on elapsed time or an external event | **Read its table before any session touching `infra/` or the migration.** Move an item to Plan A the day its gate opens |
| [`plans/PLAN-OPEN.md`](plans/PLAN-OPEN.md) | **Plan C — open questions**, with the trail from each answer to the task it created | **Never implement from this file.** Answer → decision entry → file the work into Plan A or B |
| [`plans/FOLLOW-UPS.md`](plans/FOLLOW-UPS.md) | Cosmetic backlog consciously shipped as-is | Items 1–8 cleared 2026-07-28; **9–11 open**. Add deferred-cosmetic findings here rather than reopening a closed plan |

## Why things are the way they are

[`decisions/README.md`](decisions/README.md) indexes **D1–D50** one line each,
across three range files. Append-only, and a wrong decision is superseded rather
than rewritten — `D43` keeps its original diagnosis directly under its
replacement, because being wrong about which explanation held is the reusable
part.

Cited from code by bare number (`D5`, `D30`), so numbers never change.

## Reference

| File | What it is | The rule |
|---|---|---|
| [`reference/DEPLOYMENT.md`](reference/DEPLOYMENT.md) | Frontend deploy runbook: Amplify Hosting + GitHub Actions, IAM/OIDC, rollback, failure playbook | Hosting config is console-managed by design — CI has no `UpdateApp`. **The backend is a separate stack**; see [`../infra/README.md`](../infra/README.md) |
| [`reference/FORMULA-AUDIT.md`](reference/FORMULA-AUDIT.md) | Per challenge → app formula → validation figures → verdict, plus the pinned fintech rulings | Consult before touching any `core/derive.ts` / `core/xirr.ts` formula |
| [`reference/WEALTH-MANAGEMENT-ARCHITECTURE.md`](reference/WEALTH-MANAGEMENT-ARCHITECTURE.md) | The spreadsheet-era business-logic spec this app was migrated from | Source of truth for the formula audit. Every deviation from it is pinned there, with D13 |
| [`reference/VERSIONING.md`](reference/VERSIONING.md) | App version and the sidebar badge | `package.json` is the single source; the badge derives from it at build time. Tag `vX.Y.Z` must agree |

## Where it is going

[`superpowers/specs/`](superpowers/specs/) holds the design specs. Two are live
and load-bearing:

- [`2026-08-04-cloud-stack-and-cost.md`](superpowers/specs/2026-08-04-cloud-stack-and-cost.md)
  — why this stack, what it costs, and the gates on each phase.
- [`2026-08-04-data-model.md`](superpowers/specs/2026-08-04-data-model.md)
  — what is stored and why, including the columns that cannot be added later.

**This folder stays where it is on purpose**: it is written to by tooling, so
moving it would split new specs from old ones. It is surfaced here instead.

## Conventions

- One file per concern. New long-lived documentation goes in the folder that
  matches the question it answers — and gets a row in this index.
- **A new design brief goes in `docs/design-briefs/`, not in the archive.**
  Phases 2–4 are archived because they shipped; A8's phase-5 brief is future
  work and belongs beside the plans until it does. Create the folder and its
  `README.md` when writing the first one.
- If a session must always see a document, link it from `CLAUDE.md` as well.
  That file is the only one loaded unconditionally, so it stays a pointer list
  rather than a copy.
- **Every top-level folder has its own `README.md`** with its local rules —
  `design/`, `docs/`, `src/`, `infra/`. Read it before working there; create one
  for any new folder.
- Dates in documentation are absolute (`2026-08-11`), never relative. A doc that
  says "last week" is unreadable three sessions later.

## Layout changed 2026-08-12

`docs/` was flat: live plans, closed records and reference sat side by side, and
the decision log had reached 2,219 lines in one file. Everything moved into the
folders above, `DECISIONS.md` split into three ranges behind an index, and every
`docs/…` path across the repository — roughly 180 of them, most in code comments
— was rewritten to match. `git mv` throughout, so file history is intact.
