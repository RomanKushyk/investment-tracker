# Plan A — Startable now

> **For agentic workers:** every task here is unblocked *today* — no evidence, no decision and no other phase gates it. Pick the first non-done task in section order, branch as named, tick the checkbox, keep the Status table current, gates green per merge (`pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`; `infra/` tasks additionally deploy through `.github/workflows/deploy-backend.yml`).
>
> **Companion plans:** `PLAN-WAITING.md` (dated, gated on evidence or elapsed time) · `PLAN-OPEN.md` (questions with no answer yet). Parent: `NEXT-PHASE-PLAN.md`. Decisions: `../decisions/README.md`.

Written 2026-08-11. Section order is deadline pressure first, then irreversibility, then value per hour, then size. **Split 2026-08-26 (D95):** this file is the index — live task bodies are in the range files below, and everything closed moved verbatim to [`../archive/plan-a/`](../archive/plan-a/README.md).

## Status — what is live

Five rows, **three startable** — A53, A54, A46. Section order still decides
which comes first and it is the order of the rows here, but **the first row is
not the first task**: A11 heads the table and is denied, and A52 is withdrawn.
Both are kept for their reasons rather than their work. **The first startable row
is A53**, under Section P.

| # | Phase | Branch | Size | Status |
|---|-------|--------|------|--------|
| **Section C** | **App — pure, independent** | | | |
| A11 | SES production access — lead-time insurance | `infra/ses-identity` | S | **denied; audited 2026-08-14, resubmission gated on W7** |
| **Section P** | **W7 preparation — startable ahead of the gate** (research 2026-08-25; D92, O28/O29 — D93/D94 are the width-cap rulings and belong to no phase here). Letter P because A–O are all spent, N included: `../archive/plan-a/README.md` holds a different Section N. Placed above Section M by this file's first rule, deadline pressure — W7's gate opens 2026-09-02 and A46 is undated | | | |
| A52 | ~~The seed reconciles under the ledger model (D34)~~ | — | — | **not startable — withdrawn to W7 by the review of 2026-08-26.** Three quantities are pinned at once and there is no free variable left: `navigation-map.md` checkpoint 7 fixes the row COUNT at `4/174/18` (so do D10 and D24), and the same checkpoint plus D5 fix **`Deposited 143 176 ₴`**, which D5 derives from the `deposit` rows themselves. So no added row can be net-zero while `derive.ts` still subtracts `withdrawal` and nets `tax` — D34's invariant is a property of the post-migration model. Back to W7's scope, which already lists it; the ruling it needs first is `PLAN-OPEN.md` **O31** |
| A53 | The W7 API contract on paper | `docs/w7-api-contract` | M | **startable** — 17 `repo` methods → `GET /state`/`POST /mutations`, the `meta`-key sort, and the endpoint inventory incl. the unplanned W8 admin surface; O28 marked, never decided |
| A54 | Cognito rehearsal on a throwaway pool | `infra/cognito-pool-rehearsal` | S | **startable, scope corrected** — **`usernameAttributes` is the only immutable parameter** (D36); Essentials tier and token validity are mutable, and token validity is D32's, not D36's. The pool proves what a pool can prove: a duplicate-email sign-up is **refused**, which D36 asserts from AWS's table and nothing here has tested. **The MAU question is not measurable on a free-tier pool — it moved to `PLAN-OPEN.md` O30.** Pool deleted the same day |
| **Section M** | **Input grammar — from O26, closed by D87 (2026-08-25)** | | | |
| A46 | The number grammar follows the language, and every field groups as it types (D87) | `feat/number-grammar` | M | **startable** — closes O26 by the owner's ruling 2026-08-25. `GROUPED_INTEGER` becomes **English-only** (not deleted), one shared `NumberField` groups live in both languages, and an unsaved draft is re-formatted on a language switch because `useDraft` stores strings |

## Where the detail is

| File | Holds |
|---|---|
| [`A01-A20.md`](A01-A20.md) | A11 |
| [`A41-A50.md`](A41-A50.md) | Section M's preamble, A46 |
| [`A51-A60.md`](A51-A60.md) | Section P's preamble, A52 (withdrawn), A53, A54 |

The range table runs in ID order; **section order is the Status table's**, which
puts Section P (A52–A54; A51 closed 2026-08-26) above Section M (A46).

## Where the closed work is

[`../archive/plan-a/README.md`](../archive/plan-a/README.md) — the ledger of all
<!--f:plan.closedTasks-->53<!--/f--> closed tasks, and 16 files holding their bodies. **It is a record, not a task
list**; work that comes out of reading it becomes a new task here.

## How this file is split

Range files, which `../decisions/` used until D96 changed it to one file per
decision. The plans keep ranges deliberately — see `README.md` in this folder.

- **No file over 200 lines.** That is the cap this split exists to hold (D95).
- **Task numbers never change.** They are cited from commit messages and from
  the other plans by bare number.
- **Splitting moves bodies verbatim.** Tidying in transit is what breaks a
  caller; the drained file keeps the pointer instead.
- **A task closes by moving to the archive**, ledger row and all — it does not
  stay here with a tick.

## Cross-phase rules

- Branches as named; plain conventional commits; **`/code-review` on the branch before every squash-merge — findings fixed, or declined in the merge commit body with the reason (D76)**; squash-merge to `dev`; no AI attribution in any git artifact.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` per merge; `pnpm build` + tag per section close.
- `infra/` phases deploy through `.github/workflows/deploy-backend.yml` only. CI drives one named stack and may not touch hosting config (D15).
- **Standing invariants:** no silent writes — fetched, derived and server-suggested values reach a draft or a prefill only (G5); empty cell ≠ 0; validate-fully-then-one-transaction; every new persisted settings field enters `partialize` in the same commit; D7 motion + reduced-motion on every new control.
- Every DDL change on DSQL: one statement per transaction, never mixed with DML, no `DESC` in index keys, retry SQLSTATE 40001, ≤3,000 mutated rows per transaction.
