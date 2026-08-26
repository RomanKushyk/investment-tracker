# Plan A — Startable now

> **For agentic workers:** every task here is unblocked *today* — no evidence, no decision and no other phase gates it. Pick the first non-done task in section order, branch as named, tick the checkbox, keep the Status table current, gates green per merge (`pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`; `infra/` tasks additionally deploy through `.github/workflows/deploy-backend.yml`).
>
> **Companion plans:** `PLAN-WAITING.md` (dated, gated on evidence or elapsed time) · `PLAN-OPEN.md` (questions with no answer yet). Parent: `NEXT-PHASE-PLAN.md`. Decisions: `../decisions/README.md`.

Written 2026-08-11. Section order is deadline pressure first, then irreversibility, then value per hour, then size. **Split 2026-08-26 (D95):** this file is the index — live task bodies are in the range files below, and everything closed moved verbatim to [`../archive/plan-a/`](../archive/plan-a/README.md).

## Status — what is live

Three tasks. Section order still decides which comes first, and it is the order
of the rows here.

| # | Phase | Branch | Size | Status |
|---|-------|--------|------|--------|
| **Section B** | **Backend — cheaper before the archive grows** | | | |
| A50 | **Audit the two live queries that still shadow an ORDER BY column** | `infra/alias-order-by-audit` | S | **open** — D91's defect is deployed, not historical. `observeNbu` (`capture.ts:713`) runs on every successful capture with `to_char(as_of,…) AS as_of … ORDER BY as_of` and selects `payload_gzip`: measured **0.356 DPU** inside its 7-day `BETWEEN`, **64.979 DPU** with the range opened, which is what a manual `{observe:{}}` does. The diagnose helper at `capture.ts:1009` repeats the shape on `price_observation`. Fix is to name the column (`ORDER BY price_capture.as_of`) and re-plan; **and do not drop `price_capture_as_of`**, which D48 calls dead weight and is the only thing bounding `observeNbu` |
| **Section C** | **App — pure, independent** | | | |
| A11 | SES production access — lead-time insurance | `infra/ses-identity` | S | **denied; audited 2026-08-14, resubmission gated on W7** |
| **Section M** | **Input grammar — from O26, closed by D87 (2026-08-25)** | | | |
| A46 | The number grammar follows the language, and every field groups as it types (D87) | `feat/number-grammar` | M | **startable** — closes O26 by the owner's ruling 2026-08-25. `GROUPED_INTEGER` becomes **English-only** (not deleted), one shared `NumberField` groups live in both languages, and an unsaved draft is re-formatted on a language switch because `useDraft` stores strings |

## Where the detail is

| File | Holds |
|---|---|
| [`A01-A20.md`](A01-A20.md) | A11 |
| [`A41-A60.md`](A41-A60.md) | Section M's preamble, A46 |

**A50 has no body and does not need one** — its Status row above is the whole
specification, measured figures included. When it grows one it goes in
`A41-A60.md`.

## Where the closed work is

[`../archive/plan-a/README.md`](../archive/plan-a/README.md) — the ledger of all
51 closed tasks, and 15 files holding their bodies. **It is a record, not a task
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
