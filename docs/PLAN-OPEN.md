# Plan C — Open questions

> **For agentic workers:** **do not implement an item from this file.** If a task you are doing depends on one, stop and surface the question — an assumption silently baked into code is how an open question becomes a wrong decision nobody remembers making.
>
> **Companion plans:** `PLAN-NOW.md` (startable today) · `PLAN-WAITING.md` (dated). Parent: `NEXT-PHASE-PLAN.md`. Answers land in `DECISIONS.md` and the item leaves this file.

Written 2026-08-11. **Resolved the same day, 13 of 16 items** — Rounds 1, 2 and 4 are closed, in D30–D35. What remains is Round 3, which was never a gap: three derivations that are deliberately deferred at zero migration cost, plus the one genuinely evidence-gated item.

## Status

| # | Question | Round | Outcome |
|---|----------|-------|---------|
| O1 | Auth model: which Cognito shape | 1 | **closed — D32** Essentials tier, managed login, email + password, HTTP API JWT authorizer, refresh token in years |
| O2 | `basis` vocabulary from row one | 1 | **closed — D30** `buy \| sell \| nav \| fair`; currency is not a basis |
| O3 | `instrument_ref` allocation scheme | 1 | **closed — D30** `isin` for bonds, `slug` for funds; the feed's `id` rejected |
| O4 | Account bootstrap and registration policy | 1 | **closed — D32** open registration (owner ruling); $0 to 10,000 MAU |
| O5 | Archive row schema, Inzhur half | 2 | **key closed — D30**; the non-key columns stay gated on `PLAN-WAITING.md` W3 |
| O6 | Fund valuation basis | 2 | **closed — D31** `sell`; `nav` is 0 for two of four funds |
| O7 | Fund T-1 dedup rule | 2 | **closed — D31, rejected permanently.** The FX channel is proven non-informative |
| O8 | The 6 short-dated bonds outside the DCF model | 2 | **closed — D31** they are 7 matured bonds; `status` is the discriminator, no threshold |
| O9 | `provenance` enum and its assignment rule | 3 | **open by design** — see below |
| O10 | Volatility / max-drawdown / best-worst-day rules | 3 | **open by design** — see below |
| O11 | UI treatment of carried and computed days | 3 | **open by design** — see below |
| O12 | Past-date prefill vs the suggest-only rule | 4 | **closed — D33** dissolved: value is derived, history moves to a `user_price` overlay |
| O13 | The seed's fate and its ~97 coupled test blocks | 4 | **closed — D34** rewritten to reconcile, checkpoints preserved |
| O14 | Which parse controls are stored settings vs code | 4 | **closed — D35** toggles are settings, mappings are code |
| O15 | The cash-reconciliation warning after stored cash | 4 | **closed — D35** retires; supersedes D13's cash half |
| O16 | CSV export after the repository becomes HTTP | 4 | **closed — D35** a scope note, not a decision |

---

# Still open

## O5 (part) — the archive row's non-key columns — gated on W3

**The key is settled** (D30) and that was the irreversible half: `basis` in the natural key, `observed_at` separate from `as_of`, `source` + `parser_version`, `returnRates.{buy,sell}`, `status`, `as_of = capture_date − 1`, corrections in a separate append-only overlay, `observation_kind` never stored.

What is still open is which **non-key** columns the Inzhur observation row carries, and that is the one place where three more weeks of captures genuinely change the answer — weekend and holiday behaviour, yield stability, fund NAV cadence, and the shape of an outage. Adding a non-key column later is an `ALTER TABLE`, so nothing here is irreversible and nothing is lost by waiting.

**Gate:** `PLAN-WAITING.md` W3, from 2026-09-01.

## O9 / O10 / O11 — three derivations, deferred on purpose

Not gaps. Each is a **read-time rule**, so each can be revised at any time for zero migration cost, and the framework around all three is already pinned (D35):

- **O9 `provenance`** — `published | carried | computed | frozen` are derived at read time, never stored. For funds they are strictly inferences; for bonds the inference rests on a model that may be revised. Storing a judgment in an immutable column is the specific error the archive design exists to avoid.
- **O10 volatility, max drawdown, best/worst day** — none of these metrics exists yet, and the rules are undecided because nothing needs them. Decide them when a screen does.
- **O11 the UI treatment of carried and computed days** — the *rule* is pinned and is not open: **levels carry forward, changes never do**; a zero delta and an unknown delta must never render the same. What that looks like belongs in a design brief when a screen needs it (G7).

**These stay here until a feature needs them.** Resolving them now would be inventing requirements.

---

# What the resolutions added to the other plans

Every closed item that produced work has been filed. Listed here so the trail from question to task is not lost.

| Decision | Work it created | Where |
|---|---|---|
| D30 — instrument ref, basis, FX on the capture | The NBU observation schema now has its key pinned before the DDL is written | `PLAN-NOW.md` A4 |
| D30 — FX belongs on `price_capture` | Capture must record the payload's implied FX rate — one number per run, and it is not currently stored | `PLAN-NOW.md` A2 |
| D31 — the DCF dates a stale price | The DCF ships as a staleness diagnostic, not only a revision check | `PLAN-NOW.md` A6 |
| D31 — `status` identifies matured instruments | The DCF must skip `completed` instruments rather than flag them as model failures | `PLAN-NOW.md` A6 |
| D32 — open registration, Essentials, managed login | Auth scope is now specified rather than named | `PLAN-WAITING.md` W7 |
| D33 — `user_price` overlay | The migration must carry the 174 snapshots across, not discard them | `PLAN-WAITING.md` W7 |
| D34 — seed rewritten to reconcile | Withdrawal and `tax` rows with `settles_payout_id` added to the seed | `PLAN-WAITING.md` W7 |
| D35 — parse-control boundary | The super-admin surface knows which controls are settings | `PLAN-WAITING.md` W8 |

---

## How an item leaves this file

1. The answer is written in `DECISIONS.md` with its reasoning — **not** just the conclusion. A decision whose reasoning is lost gets re-litigated.
2. The Status table is updated to point at the decision; the detail section is deleted.
3. If it produced work, that work is filed into `PLAN-NOW.md` or `PLAN-WAITING.md` and recorded in the table above.

## What must never happen

An item from this file being resolved implicitly, by a commit that assumes an answer without naming it. If you find yourself needing one of these to proceed, that is the signal to stop and ask — not the signal to pick the obvious option quietly.
