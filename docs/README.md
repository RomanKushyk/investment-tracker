# docs/ — the index

Root `README.md` is the product spec. Everything the spec does not carry lives
here, in the folders below — one per question, and `spec/` for the half of the
product spec that did not fit in the root README.

| Folder | Answers | Read it when |
|---|---|---|
| [`plans/`](plans/README.md) | **What to do next** | Starting a session |
| [`decisions/`](decisions/README.md) | **Why it is like this** | Something looks wrong and you want to know if it is deliberate |
| [`reference/`](reference/) | **How a specific thing works** | You are about to touch deploys, versions, or a formula |
| [`superpowers/specs/`](superpowers/specs/) | **Where it is going** | Working on `infra/` or the migration |
| [`design-briefs/`](design-briefs/README.md) | **What is specified but not drawn** | Before starting UI work (G7) |
| [`spec/`](spec/README.md) | **What a screen must contain** | §6 of the root spec, moved out on 2026-08-26. Still §6, still binding |
| [`archive/`](archive/README.md) | **How it got here** | Historical. Never a task list |

---

## Start here

**Pick the first non-done task in section order from
[`plans/PLAN-NOW.md`](plans/PLAN-NOW.md).** That is the whole workflow. The
other plans exist to keep things *out* of that one.

| File | What it is | The rule |
|---|---|---|
| [`plans/NEXT-PHASE-PLAN.md`](plans/NEXT-PHASE-PLAN.md) | The plan of record: shipped work, retired items with reasons, governing decisions G1–G8 | Keep the Status table current; a contract change needs a decision entry |
| [`plans/PLAN-NOW.md`](plans/PLAN-NOW.md) | **Plan A — startable today.** Nothing gates these. Index + live Status table; bodies in `plans/A01-A20.md`, `plans/A41-A60.md` | Pick the first non-done task in section order. Gates green per merge |
| [`plans/PLAN-WAITING.md`](plans/PLAN-WAITING.md) | **Plan B — dated.** Gated on elapsed time or an external event. Index + the dated table; bodies in `plans/W02-W08.md`, `plans/W09-W17.md` | **Read its table before any session touching `infra/` or the migration.** Move an item to Plan A the day its gate opens |
| [`plans/PLAN-OPEN.md`](plans/PLAN-OPEN.md) | **Plan C — open questions**, with the trail from each answer to the task it created. Index + Status table; bodies in `plans/O05-O29.md` | **Never implement from this file.** Answer → decision entry → file the work into Plan A or B |
| [`plans/USER-BUGS-DRAFT.md`](plans/USER-BUGS-DRAFT.md) | The owner's raw **bug** list, in the owner's words — the pair to `plans/USER-FEATURES-DRAFT.md` | **Never fix from this file**, and **keep it plain** — bare bullets, no ceremony, same as its pair. A line is a symptom, not a diagnosis: reproduce, write the failing test, then fix. **A pasted sample is bytes — copy it, never re-key it.** A missing capability is an idea, not a bug; a cosmetic shipped on purpose goes to [`plans/FOLLOW-UPS.md`](plans/FOLLOW-UPS.md) |
| [`plans/USER-FEATURES-DRAFT.md`](plans/USER-FEATURES-DRAFT.md) | The owner's raw idea list, in the owner's words | **Never implement from this file either**, and **keep it plain** — bare bullets, no ceremony, so it stays fast to add a line to. It fills up, gets groomed into Plan A or B, then gets wiped and fills again |
| [`plans/FOLLOW-UPS.md`](plans/FOLLOW-UPS.md) | Cosmetic backlog consciously shipped as-is | Items 1–8 cleared 2026-07-28; **9–11 open**. Add deferred-cosmetic findings here rather than reopening a closed plan |

## Why things are the way they are

[`decisions/README.md`](decisions/README.md) indexes **every decision** one line each,
and links each to its own file — `D5` is `decisions/D5.md` (D96). Append-only, and a wrong decision is superseded rather
than rewritten — `D43` keeps its original diagnosis directly under its
replacement, because being wrong about which explanation held is the reusable
part.

Cited from code by bare number (`D5`, `D30`), so numbers never change.

## Reference

| File | What it is | The rule |
|---|---|---|
| [`reference/DEPLOYMENT.md`](reference/DEPLOYMENT.md) | Frontend deploy runbook: deploying, verifying, rollback, failure playbook, cost. **One-time setup — domain, Amplify app, IAM role, GitHub config — is [`reference/deployment/`](reference/deployment/README.md)** | Hosting config is console-managed by design — CI has no `UpdateApp`. **The backend is a separate stack**; see [`../infra/README.md`](../infra/README.md) |
| [`reference/FORMULA-AUDIT.md`](reference/FORMULA-AUDIT.md) | Per challenge → app formula → validation figures → verdict, plus the pinned fintech rulings | Consult before touching any `core/derive.ts` / `core/xirr.ts` formula |
| [`reference/WEALTH-MANAGEMENT-ARCHITECTURE.md`](reference/WEALTH-MANAGEMENT-ARCHITECTURE.md) | The spreadsheet-era business-logic spec this app was migrated from | Source of truth for the formula audit. Every deviation from it is pinned there, with D13 |
| [`reference/VERSIONING.md`](reference/VERSIONING.md) | App version and the sidebar badge | `package.json` is the single source; the badge derives from it at build time. Tag `vX.Y.Z` must agree |
| [`reference/INZHUR-FUND-HISTORY.md`](reference/INZHUR-FUND-HISTORY.md) | The provider's published fund price files: what they cover, and the proof that they are `nav` and not `sell` | Read before planning or writing the import (W15). The files are `.xlsx` in `~/.quirenote` and never committed; **D83 supersedes D72 — they may now be fetched, but the link is re-read, never polled**. **The offer-page payload is devalue-encoded — its quote numbers are table indices, not prices** |
| [`reference/INZHUR-PUBLIC-SURFACE.md`](reference/INZHUR-PUBLIC-SURFACE.md) | What the provider serves publicly, measured 2026-08-24: the offer-page payload, the free cross-checks, `robots.txt` | **The payload is devalue-encoded — its quote numbers are table indices, not prices.** D83 supersedes D72: the files may be fetched, but the link is re-read, never polled |
| [`reference/MARKET-DATA-SOURCES.md`](reference/MARKET-DATA-SOURCES.md) | The external source map: the summary, the closed list and **the rules it leaves us with**. Per-source detail is [`reference/market-data/`](reference/market-data/README.md) | Read before adding any external data source. SMIDA's feed is the live one (D82) but **we do NOT fetch it — D86 closed O25 categorically**; stockmarket.gov.ua answers `200` with data stopping 2019–2021 and is unreachable from a non-Ukrainian network |

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

## Layout changed again 2026-08-26 — the 200-line cap (D95)

`PLAN-NOW.md` had reached 2,211 lines and carried 51 closed tasks beside three
live ones, which is the same failure the decision log hit in August: the file a
session must read first became the file it cannot afford to read. **No
documentation file now exceeds 200 lines.**

The three plans and `archive/BUILD-PLAN.md` became indexes; their bodies moved
**verbatim** into range files named for the IDs they hold, and everything closed
moved to `archive/plan-a/`, `archive/plan-b/`, `archive/plan-c/` and
`archive/build-plan/`, each behind its own `README.md`. IDs did not change —
`A20`, `W7`, `O26`, `D95` all still resolve. `plans/README.md` is new and
carries the folder's local rules.

**The cap holds everywhere, measured 2026-08-26: zero Markdown files in this
repository exceed 200 lines.** What each class cost:

| Where | Shape it took |
|---|---|
| `plans/` | Three indexes over ID-range files; 51 closed tasks to `archive/plan-a/` |
| `archive/` | `BUILD-PLAN.md` and the three phase briefs became indexes over folders |
| `reference/` | `DEPLOYMENT.md` over `deployment/`, `MARKET-DATA-SOURCES.md` over `market-data/`, and `INZHUR-FUND-HISTORY.md` split into the two documents it always was |
| `design-briefs/` | Every brief an index over `phase-N/` · `asset-create/` · `screen-density/` |
| `superpowers/` | Each spec and the executed plan an index over a folder; no tooling path moved |
| `decisions/` | **One file per decision (D96)** — `D5` is `D5.md`. The range files could not hold a cap and an append rule at once |
| root | `README.md` §6 to `docs/spec/screens.md` · `navigation-map.md` over `docs/navigation-map/` · `infra/README.md` over `infra/docs/` |

**Distillation was tried where the owner asked for it and mostly refused
itself.** `MARKET-DATA-SOURCES.md` and `navigation-map.md` are measurements and
checkpoints almost line for line: cutting them is discarding, not distilling.
The one file that shrank without loss was `INZHUR-FUND-HISTORY.md`, and only
because it was two documents under one filename. **Prefer a boundary the
document already has.**
