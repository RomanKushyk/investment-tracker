# Plan A — Startable now

> **For agentic workers:** every task here is unblocked *today* — no evidence, no decision and no other phase gates it, **with one declared exception: W4, whose two rulings are its own first step and not a wait on anyone else (see Section Q, and D130)**. Pick the first non-done task in section order, branch as named, tick the checkbox, keep the Status table current, gates green per merge (`pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`; `infra/` tasks additionally deploy through `.github/workflows/deploy-backend.yml`).
>
> **Companion plans:** `PLAN-WAITING.md` (dated, gated on evidence or elapsed time) · `PLAN-OPEN.md` (questions with no answer yet). Parent: `NEXT-PHASE-PLAN.md`. Decisions: `../decisions/README.md`.

Written 2026-08-11. Section order is deadline pressure first, then irreversibility, then value per hour, then size. **Split 2026-08-26 (D95), files renamed by section 2026-08-27 (D98):** this file is the index — live task bodies are in the section files below, and everything closed moved verbatim to [`../archive/plan-a/`](../archive/plan-a/README.md). **One exception, and it is not optional: `W4` closes to [`../archive/plan-b/`](../archive/plan-b/README.md), never to `plan-a/` — see the closing rule below, and D130 for why.**

## Status — what is live

Five rows, **two startable** — A54 and A46. **W4 is DONE and awaiting its archive move**, not startable and not in progress; the count and its row must agree, and two earlier versions of this line did not. **A53 closed 2026-09-02** and left for the archive with its ledger row, which is how a task closes here. Section order still decides
which comes first and it is the order of the rows here. W4 still heads the
table under Section Q, but it is **finished** rather than the first task: pick
the first row that is neither done nor denied, which is **A54**. A11 and A52
keep their places for their reasons rather than their work — A11 is denied,
A52 is withdrawn — and W4 keeps its place only until its archive move.

| # | Phase | Branch | Size | Status |
|---|-------|--------|------|--------|
| **Section Q** | **The archive schema — W7's own gate** (moved here from `PLAN-WAITING.md` on 2026-09-02, the first item ever to cross between plans; the rule that move created is **D130**). Placed FIRST by this file's own order — deadline pressure, then irreversibility: W4 gates W7 and W15, and a DSQL natural key cannot be migrated, only dropped and recreated. **Its gate was met 2026-08-31**, not today — W3 was read that day and A4 closed 2026-08-11 (D50); the date it used to carry was never its own, and `PLAN-WAITING.md`'s kept W4 row is the canonical account of that. **One caveat against this file's header, which promises no task here is gated on a decision:** W4 owes two, and they are its OWN first step rather than someone else's — it is where they get ruled, not a task waiting on a ruling made elsewhere. Letter Q because A–P are spent | | | |
| W4 | Inzhur observation schema | `infra/inzhur-observation-schema` | M | **ALL THREE BOXES DONE 2026-09-02 — merged and verified live.** Both rulings taken (D132), `observeInzhur` and `bond_terms` shipped, and the backfill's no-op proved on the cluster: `seen 70, written 70, termsWritten 30`, then the identical call `seen 70, written 0, termsWritten 0`. **It has not yet CLOSED**, because closing is a move and this row belongs in `../archive/plan-b/` with its body (D130) — that is the next task, and it is mechanical. **Consequence: W7's gate is now MET** |
| **Section C** | **App — pure, independent** | | | |
| A11 | SES production access — lead-time insurance | `infra/ses-identity` | S | **denied; audited 2026-08-14, resubmission gated on W7** |
| **Section P** | **W7 preparation — startable ahead of the gate** (research 2026-08-25; D92, O28/O29 — D93/D94 are the width-cap rulings and belong to no phase here). Letter P because A–O are all spent, N included: `../archive/plan-a/README.md` holds a different Section N. Placed above Section M by this file's first rule, deadline pressure — W7's DATE arrived 2026-09-02 while its gate is still W4, which is Section Q above, and A46 is undated | | | |
| A52 | ~~The seed reconciles under the ledger model (D34)~~ | — | — | **not startable — withdrawn to W7 by the review of 2026-08-26.** Three quantities are pinned at once and there is no free variable left: `navigation-map.md` checkpoint 7 fixes the row COUNT at `4/174/18` (so do D10 and D24), and the same checkpoint plus D5 fix **`Deposited 143 176 ₴`**, which D5 derives from the `deposit` rows themselves. So no added row can be net-zero while `derive.ts` still subtracts `withdrawal` and nets `tax` — D34's invariant is a property of the post-migration model. Back to W7's scope, which already lists it; the ruling it needs first is `PLAN-OPEN.md` **O31** |
| A54 | Cognito rehearsal on a throwaway pool | `infra/cognito-pool-rehearsal` | S | **startable, scope corrected** — **`usernameAttributes` is the only immutable parameter** (D36); Essentials tier and token validity are mutable, and token validity is D32's, not D36's. The pool proves what a pool can prove: a duplicate-email sign-up is **refused**, which D36 asserts from AWS's table and nothing here has tested. **The MAU question is not measurable on a free-tier pool — it moved to `PLAN-OPEN.md` O30.** Pool deleted the same day |
| **Section M** | **Input grammar — from O26, closed by D87 (2026-08-25)** | | | |
| A46 | The number grammar follows the language, and every field groups as it types (D87) | `feat/number-grammar` | M | **startable** — closes O26 by the owner's ruling 2026-08-25. `GROUPED_INTEGER` becomes **English-only** (not deleted), one shared `NumberField` groups live in both languages, and an unsaved draft is re-formatted on a language switch because `useDraft` stores strings |

## Where the detail is

| File | Holds |
|---|---|
| [`phase-w-i-ii-iii.md`](phase-w-i-ii-iii.md) | W4 — **a Plan B body**, and it stays there beside W3, whose answered questions are W4's input. See this folder's `README.md` |
| [`section-c.md`](section-c.md) | A11 |
| [`section-p.md`](section-p.md) | Section P's preamble, A52 (withdrawn), A54 |
| [`section-m.md`](section-m.md) | Section M's preamble, A46 |

**Renamed by section, 2026-08-27 (D98)** — the table above runs in Status-table
order (Q, C, P, M), the same order the Status table itself uses, so there is
nothing left for either table to explain about the other.

## Where the closed work is

[`../archive/plan-a/README.md`](../archive/plan-a/README.md) — the ledger of all
<!--f:plan.closedTasks-->54<!--/f--> closed tasks, and 16 files holding their bodies. **It is a record, not a task
list**; work that comes out of reading it becomes a new task here. **Not W4's destination** — see the closing rule below.

## How this file is split

Section files — the shape `../decisions/` moved to at D96; **D98 does the same
for the plans**, retiring the ID-range names (`A01-A20.md` and so on) they
started with. See `README.md` in this folder.

- **The 200-line cap is a ratchet, not a wall (D95, ratcheted by D98).** A
  file may not grow past its own committed length; a file whose growth lands
  it over 200 lines is reported with the diagnostic question, not an
  instruction to split.
- **Task numbers never change.** They are cited from commit messages and from
  the other plans by bare number.
- **Splitting moves bodies verbatim.** Tidying in transit is what breaks a
  caller; the drained file keeps the pointer instead.
- **A task closes by moving to the archive**, ledger row and all — it does not
  stay here with a tick. **To the archive of the plan it came FROM** (D130):
  Plan A's tasks to `plan-a/`, and **W4 to `plan-b/`** — because
  `plan.closedTasks` counts `plan-a`'s ledger rows by a pattern matching `W4`
  as readily as `A20`, so filing it there would move a fact fence three
  indexes cite and change what it counts. This is the one place in this file
  that carries the reason; D130 carries the working.

## Cross-phase rules

- Branches as named; plain conventional commits; **`/code-review` on the branch before every squash-merge — findings fixed, or declined in the merge commit body with the reason (D76)**; squash-merge to `dev`; no AI attribution in any git artifact.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` per merge; `pnpm build` + tag per section close.
- `infra/` phases deploy through `.github/workflows/deploy-backend.yml` only. CI drives one named stack and may not touch hosting config (D15).
- **Standing invariants:** no silent writes — fetched, derived and server-suggested values reach a draft or a prefill only (G5); empty cell ≠ 0; validate-fully-then-one-transaction; every new persisted settings field enters `partialize` in the same commit; D7 motion + reduced-motion on every new control.
- Every DDL change on DSQL: one statement per transaction, never mixed with DML, no `DESC` in index keys, retry SQLSTATE 40001, ≤3,000 mutated rows per transaction.
