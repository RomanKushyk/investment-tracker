# docs/ — the index

Root `README.md` is the product spec. Everything the spec does not carry lives
here, in four folders that answer four different questions.

| Folder | Answers | Read it when |
|---|---|---|
| [`plans/`](plans/) | **What to do next** | Starting a session |
| [`decisions/`](decisions/README.md) | **Why it is like this** | Something looks wrong and you want to know if it is deliberate |
| [`reference/`](reference/) | **How a specific thing works** | You are about to touch deploys, versions, or a formula |
| [`superpowers/specs/`](superpowers/specs/) | **Where it is going** | Working on `infra/` or the migration |
| [`design-briefs/`](design-briefs/README.md) | **What is specified but not drawn** | Before starting UI work (G7) |
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
| [`plans/USER-FEATURES-DRAFT.md`](plans/USER-FEATURES-DRAFT.md) | The owner's raw idea list, in the owner's words | **Never implement from this file either**, and **keep it plain** — bare bullets, no ceremony, so it stays fast to add a line to. It fills up, gets groomed into Plan A or B, then gets wiped and fills again |
| [`plans/FOLLOW-UPS.md`](plans/FOLLOW-UPS.md) | Cosmetic backlog consciously shipped as-is | Items 1–8 cleared 2026-07-28; **9–11 open**. Add deferred-cosmetic findings here rather than reopening a closed plan |

## Why things are the way they are

[`decisions/README.md`](decisions/README.md) indexes **every decision** one line each,
across four range files (`D01-D20`, `D21-D40`, `D41-D50` — which actually runs
to D60 — and `D61-D80`). Append-only, and a wrong decision is superseded rather
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
| [`reference/INZHUR-FUND-HISTORY.md`](reference/INZHUR-FUND-HISTORY.md) | The provider's published fund price files: what they cover, the proof that they are `nav` and not `sell`, and the provider's public read surface | Read before planning or writing the import (W15). The files are `.xlsx` in `~/.quirenote` and never committed; **D83 supersedes D72 — they may now be fetched, but the link is re-read, never polled**. **The offer-page payload is devalue-encoded — its quote numbers are table indices, not prices** |
| [`reference/MARKET-DATA-SOURCES.md`](reference/MARKET-DATA-SOURCES.md) | The external source map: which Ukrainian market data is machine-readable, from which network, and on what licence | Read before adding any external data source. SMIDA's feed is the live one (D82) but **polling it is unresolved — O25**; stockmarket.gov.ua answers `200` with data stopping 2019–2021 and is unreachable from a non-Ukrainian network |

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
  Phases 2–4 are archived because they shipped; the phase-5 brief lives there
  until its extension merges and the phase ships, then it moves to the archive.
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
