# docs/ — the index

Root `README.md` is the product spec. Everything the spec does not carry lives
here, in the folders below — one per question, and `spec/` for the half of the
product spec that did not fit in the root README.

**And nowhere else: the GitHub wiki is deliberately OFF**
([D104](decisions/D104.md), 2026-08-28, never initialised, so nothing was lost).
**Two mechanisms hold this documentation honest and a wiki has neither:**
`pnpm test` reads this tree — claim ratchet, line cap, decisions index, fact
fences — and **D76 reviews documentation before it lands**. A wiki keeps
per-page revision history, so *a* diff exists, but nothing can test it and
nothing reviews it. **D104 carries the CI measurement** behind that sentence
(which workflow fires on what, and why the suite is the author's to run before a
change lands) — it is a dated entry, so it can hold a figure; this index cannot,
and a copy here would go quietly false the next time a workflow is edited. Turn
the wiki back on only by superseding those two reasons, not by finding it
convenient.

Two things a wiki also lacks are **deliberately not claimed**, because neither
tells it apart from this tree: pull requests (D73 requires none here either) and
`format:check` (`.prettierignore` excludes `*.md`). D104 records both.

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
| [`plans/PLAN-NOW.md`](plans/PLAN-NOW.md) | **Plan A — startable today.** Nothing gates these. Index + live Status table; bodies in `plans/section-c.md`, `plans/section-m.md`, `plans/section-p.md` — **and `plans/phase-w-i-ii-iii.md`, a Plan B file, which holds W4's body after its row crossed into Plan A on 2026-09-02 (D130)** | Pick the first non-done task in section order. Gates green per merge |
| [`plans/PLAN-WAITING.md`](plans/PLAN-WAITING.md) | **Plan B — dated.** Gated on elapsed time or an external event. Index + the dated table; bodies in `plans/phase-w-i-ii-iii.md`, `plans/phase-w-iv-v.md` | **Read its table before any session touching `infra/` or the migration.** Move an item to Plan A the day its gate opens |
| [`plans/PLAN-OPEN.md`](plans/PLAN-OPEN.md) | **Plan C — open questions**, with the trail from each answer to the task it created. Index + Status table; bodies in `plans/still-open.md` | **Never implement from this file.** Answer → decision entry → file the work into Plan A or B |
| [GitHub Issues](https://github.com/RomanKushyk/investment-tracker/issues) | **The inbox — the owner's raw ideas and bug reports, in his words.** Labelled `enhancement` and `bug`. Not a file since 2026-08-28 (D103) | **The rules live in [`plans/README.md`](plans/README.md) and are not restated here** — diagnosis before work, `bug` vs `enhancement`, and D105's routing (branch → work → `Closes #N`, nothing added to `plans/`). One line that must travel with the link: **a pasted sample is bytes — quote it, never re-key it** |
| [`plans/FOLLOW-UPS.md`](plans/FOLLOW-UPS.md) | Cosmetic backlog consciously shipped as-is | Every row states its own status — **read them, no count here**; the previous count in this cell was false for weeks. Add deferred-cosmetic findings here rather than reopening a closed plan |

## Why things are the way they are

[`decisions/README.md`](decisions/README.md) indexes **every decision** one line each
and links each to its own file — `D5` is `decisions/D5.md` (D96). **Since D102 it is
ONLY that index**; the log's own rules are [`decisions/RULES.md`](decisions/RULES.md).
Append-only, and a wrong decision is superseded rather
than rewritten — `D43` keeps its original diagnosis directly under its
replacement, because being wrong about which explanation held is the reusable
part.

Cited from code by bare number (`D5`, `D30`), so numbers never change.

## Reference

| File | What it is | The rule |
|---|---|---|
| [`reference/DEPLOYMENT.md`](reference/DEPLOYMENT.md) | Frontend deploy runbook: deploying, verifying, rollback, failure playbook, cost. **One-time setup — domain, Amplify app, IAM role, GitHub config — is [`reference/deployment/`](reference/deployment/README.md)** | Hosting config is console-managed by design — CI has no `UpdateApp`. **The backend is a separate stack**; see [`../infra/README.md`](../infra/README.md) |
| [`../.github/WORKFLOWS.md`](../.github/WORKFLOWS.md) | What the two workflows fire on, what `paths-ignore` really skips, and the standing prohibition on `dependabot.yml` | **Named `WORKFLOWS.md`, not `README.md`** — GitHub would render a `.github/README.md` as the repo landing page instead of the product spec |
| [`reference/DEPENDABOT.md`](reference/DEPENDABOT.md) | Security-advisory runbook: the alert query, and the checkout→fetch→rebase→install→gates→review→squash sequence for a Dependabot PR | **The ALERT is the unit, not the PR** — draining the PR list is not draining the advisories. Some steps fail SILENTLY if skipped; the file marks which and why (D104 §2) |
| [`reference/W7-API-CONTRACT.md`](reference/W7-API-CONTRACT.md) | **W7's API on paper, before it is built (A53).** All 17 `repo` methods mapped onto `GET /state` / `POST /mutations`, the four `meta` keys sorted (three stay per-device, `seeded` dies with D2), and the endpoint inventory — including the W8 admin surface, which had a screen and no API. | **Nothing here is built.** It marks O28 and O33 rather than deciding them (O31 closed as D133 the same day): an API document that quietly picked a cascade would be the implicit resolution Plan C forbids |
| [`reference/FORMULA-AUDIT.md`](reference/FORMULA-AUDIT.md) | Per challenge → app formula → validation figures → verdict, plus the pinned fintech rulings | Consult before touching any `core/derive.ts` / `core/xirr.ts` formula |
| [`reference/WEALTH-MANAGEMENT-ARCHITECTURE.md`](reference/WEALTH-MANAGEMENT-ARCHITECTURE.md) | The spreadsheet-era business-logic spec this app was migrated from | Source of truth for the formula audit. Every deviation from it is pinned there, with D13 |
| [`reference/VERSIONING.md`](reference/VERSIONING.md) | App version, the sidebar badge, **and the whole release procedure** — bump, annotate, promote, push the tag, publish the GitHub Release | `package.json` is the single source; the badge derives from it at build time. Tag `vX.Y.Z` must agree, and **the tag's annotation IS the release note** — subject becomes the title, body becomes the notes, and a body-less tag ships an empty release |
| [`reference/INZHUR-FUND-HISTORY.md`](reference/INZHUR-FUND-HISTORY.md) | The provider's published fund price files: what they cover, and the proof that they are `nav` and not `sell` | Read before planning or writing the import (W15). The files are `.xlsx` in `~/.quirenote` and never committed; **D83 supersedes D72 — they may now be fetched, but the link is re-read, never polled**. **The offer-page payload is devalue-encoded — its quote numbers are table indices, not prices** |
| [`reference/INZHUR-PUBLIC-SURFACE.md`](reference/INZHUR-PUBLIC-SURFACE.md) | What the provider serves publicly, measured 2026-08-24: the offer-page payload, the free cross-checks, `robots.txt` | **The payload is devalue-encoded — its quote numbers are table indices, not prices.** D83 supersedes D72: the files may be fetched, but the link is re-read, never polled |
| [`reference/MARKET-DATA-SOURCES.md`](reference/MARKET-DATA-SOURCES.md) | The external source map: the summary, the closed list and **the rules it leaves us with**. Per-source detail is [`reference/market-data/`](reference/market-data/README.md) | Read before adding any external data source. SMIDA's feed is the live one (D82) but **we do NOT fetch it — D86 closed O25 categorically**; stockmarket.gov.ua answers `200` with data stopping 2019–2021 and is unreachable from a non-Ukrainian network |
| [`reference/OVDP-COUPON-STRUCTURE.md`](reference/OVDP-COUPON-STRUCTURE.md) | The bond coupon, measured across all 32 live bonds 2026-08-31: the schedule's one shape, the ₴1000 nominal, and the exact rate derivation `perUnitCoupon ÷ 5` | Read before touching any coupon figure. **`returnRates` is the YTM, NOT the coupon rate** — the gap reaches 4.3 pp and changes sign, so the two can never be folded together |
| [`reference/w7-migration-translations.md`](reference/w7-migration-translations.md) | The seven translations W7's migration must apply to the app's stored data — ids, `assetId`, quantities, cash, timestamps — carried out of the retired hand-written schema draft's header | Read before writing the W7 data migration; `infra/schema/user.ts` is the schema itself, this is what existing data must become to fit it |

## Where it is going

[`superpowers/specs/`](superpowers/specs/) holds the design specs. **Two are
live and load-bearing; the third is a GATE and binds nothing yet:**

- [`2026-08-04-cloud-stack-and-cost.md`](superpowers/specs/2026-08-04-cloud-stack-and-cost.md)
  — why this stack, what it costs, and the gates on each phase.
- [`2026-08-04-data-model.md`](superpowers/specs/2026-08-04-data-model.md)
  — what is stored and why, including the columns that cannot be added later.
- [`2026-09-03-w7-read-surface-design.md`](superpowers/specs/2026-09-03-w7-read-surface-design.md)
  — **W7's read surface, and it is NOT yet decided.** The owner's direction of
  2026-09-03 sends the derivation to the server; this spec is what `PLAN-OPEN.md`
  **O28** must be answered against, and the cloud-stack spec's
  `Derivation \| 100% client-side` row stays binding until that entry exists.

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
- **Every top-level folder documents its local rules** — `design/`, `docs/`,
  `src/`, `infra/`, `scripts/`, `public/` as `README.md`. Read it before working
  there; create one for any new folder. **The one exception is `.github/`, which
  uses [`WORKFLOWS.md`](../.github/WORKFLOWS.md)**: GitHub renders a
  `.github/README.md` as the repository landing page IN PLACE OF the root product
  spec. `src/github-landing-page.test.ts` fails the suite if one appears under any
  spelling, but a test catches it after the commit, not before — which is why the
  exception is stated here, in the file a session opens when it does not know
  which file it needs.
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
documentation file exceeded 200 lines once this split was done** — the
guarantee is now enforced as a ratchet, not a hard wall (`../decisions/D98.md`).

The three plans and `archive/BUILD-PLAN.md` became indexes; their bodies moved
**verbatim** into range files named for the IDs they hold — **renamed by
section the next day, D98; `plans/README.md` names the current six** — and
everything closed moved to `archive/plan-a/`, `archive/plan-b/`,
`archive/plan-c/` and `archive/build-plan/`, each behind its own `README.md`.
IDs did not change — `A20`, `W7`, `O26`, `D95` all still resolve.
`plans/README.md` is new and carries the folder's local rules.

**The cap holds everywhere, measured 2026-08-26: zero Markdown files in this
repository exceed 200 lines.** What each class cost:

| Where | Shape it took |
|---|---|
| `plans/` | Three indexes over range files, renamed by section the next day (D98); <!--f:plan.closedTasks-->54<!--/f--> closed tasks to `archive/plan-a/` |
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
