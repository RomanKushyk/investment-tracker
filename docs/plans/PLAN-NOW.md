# Plan A — Startable now

> **For agentic workers:** every task here is unblocked *today* — no evidence, no decision and no other phase gates it. Pick the first non-done task in section order, branch as named, tick the checkbox, keep the Status table current, gates green per merge (`pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`; `infra/` tasks additionally deploy through `.github/workflows/deploy-backend.yml`).
>
> **Companion plans:** `PLAN-WAITING.md` (dated, gated on evidence or elapsed time) · `PLAN-OPEN.md` (questions with no answer yet). Parent: `NEXT-PHASE-PLAN.md`. Decisions: `../decisions/README.md`.

Written 2026-08-11. Section order is deadline pressure first, then irreversibility, then value per hour, then size. **Split 2026-08-26 (D95):** this file is the index — live task bodies are in the range files below, and everything closed moved verbatim to [`../archive/plan-a/`](../archive/plan-a/README.md).

## Status — what is live

Seven rows, **six startable** — A52 is a withdrawn row kept for its reason,
the way A11 is kept for its denial. Section order still decides which comes
first, and it is the order of the rows here.

| # | Phase | Branch | Size | Status |
|---|-------|--------|------|--------|
| **Section B** | **Backend — cheaper before the archive grows** | | | |
| A50 | **Audit the two live queries that still shadow an ORDER BY column** | `infra/alias-order-by-audit` | S | **code landed 2026-08-26; the re-plan is OUTSTANDING and A50 does not close until it is done.** Both queries now name the table — `NEWEST_CAPTURE_PER_DATE` (`capture.ts:723`), one string shared by `observeNbu` and by `diagnose`, and the `price_observation` sample (`capture.ts:1097`); `DISTINCT ON` and `ORDER BY` had to move together, because Postgres requires the former to match the leading latter. `price_capture_as_of` **kept**, per D91. Regression guard: `infra/src/order-by-alias.test.ts`, now actually run in CI (`deploy-backend.yml` ran no infra test before, and `deploy-frontend.yml` skips `infra/**`). **What the review corrected in the framing:** qualifying the column does NOT close the **64.979 DPU** open-range exposure — that comes from `from` defaulting to `NBU_ARCHIVE_START` with no SQL `LIMIT` (`ObserveRequest.limit` is applied in JS after the fetch), and D91 said so: *only the window stands between it and the same scan*. D91’s 6.8× win was on the streak query, which has `LIMIT 60` to make effective. **Two things left:** (1) read `plans.observeNbu` / `plans.observeNbuOpenRange` from `{diagnose:true}` after deploy and record the post-fix plan and DPU — the new order is mixed-direction (`as_of` ASC, `requested_at` DESC) and neither index serves it directly, so whether the plan improved at all is unmeasured; (2) decide with that plan in hand whether `{observe:{}}` gets a bound in the STATEMENT or refuses an unbounded `from` — the candidate durable fix |
| **Section C** | **App — pure, independent** | | | |
| A11 | SES production access — lead-time insurance | `infra/ses-identity` | S | **denied; audited 2026-08-14, resubmission gated on W7** |
| **Section P** | **W7 preparation — startable ahead of the gate** (research 2026-08-25; D92, O28/O29 — D93/D94 are the width-cap rulings and belong to no phase here). Letter P because A–O are all spent, N included: `../archive/plan-a/README.md` holds a different Section N. Placed above Section M by this file's first rule, deadline pressure — W7's gate opens 2026-09-02 and A46 is undated | | | |
| A51 | User-schema DDL draft, green on local Postgres | `infra/user-schema-ddl-draft` | M | **startable** — Round 1 closed (D30/D32); draft DDL + the old→new `Transaction` mapping; nothing applies it before W7 |
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
| [`A51-A60.md`](A51-A60.md) | Section P's preamble, A51–A54 |

The range table runs in ID order; **section order is the Status table's**, which
puts Section P (A51–A54) above Section M (A46).

**A50 has no body and does not need one** — its Status row above is the whole
specification, measured figures included. When it grows one it goes in
`A41-A50.md`.

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
