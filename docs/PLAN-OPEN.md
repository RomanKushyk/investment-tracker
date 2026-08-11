# Plan C — Open questions

> **For agentic workers:** nothing here has an answer yet. **Do not implement an item from this file.** If a task you are doing depends on one, stop and surface the question — an assumption silently baked into code is how an open question becomes a wrong decision nobody remembers making.
>
> **Companion plans:** `PLAN-NOW.md` (startable today) · `PLAN-WAITING.md` (dated). Parent: `NEXT-PHASE-PLAN.md`. Answers land in `DECISIONS.md` and the item moves out of this file.

Written 2026-08-11. Rounds are ordered by **cost of getting it wrong**, not by difficulty. Round 1 items are irreversible on Aurora DSQL — its primary keys are immutable, so a wrong key is a DROP/CREATE, not a migration.

## Status

| # | Question | Round | Blocks | Reversible? |
|---|----------|-------|--------|-------------|
| O1 | Auth model: which Cognito shape | 1 | W7 migration | costly |
| O2 | `basis` vocabulary from row one | 1 | archive DDL | **no** |
| O3 | `instrument_ref` allocation scheme | 1 | archive DDL | **no** |
| O4 | Account bootstrap and registration policy | 1 | W7 migration | costly |
| O5 | Archive row schema, Inzhur half | 2 | W4 | **no** |
| O6 | Fund valuation basis | 2 | — (hedged by O2) | yes |
| O7 | Fund T-1 dedup rule | 2 | — | yes |
| O8 | The 6 short-dated bonds outside the DCF model | 2 | `feat/bond-dcf` polish | yes |
| O9 | `provenance` enum and its assignment rule | 3 | — | yes, zero migration |
| O10 | Volatility / max-drawdown / best-worst-day rules | 3 | — | yes, zero migration |
| O11 | UI treatment of carried and computed days | 3 | — | yes |
| O12 | **Past-date prefill vs the suggest-only rule** | 4 | the archive's whole user value | product |
| O13 | The seed's fate and ~97 coupled test blocks | 4 | W7 test repair | product |
| O14 | Which parse controls are stored settings vs code | 4 | W8 | yes |
| O15 | The cash-reconciliation warning after stored cash is removed | 4 | W7 | yes |
| O16 | CSV export after the repository becomes HTTP | 4 | — | yes |

---

# Round 1 — Irreversible; answer before the first DDL

`PLAN-WAITING.md` W7 must not start before this round is closed.

## O1 — Auth model: which Cognito shape

**The question.** The stack decision names "Cognito" and stops there. Unspecified: user pool with hosted UI versus a custom form; email/password versus a social provider; token lifetime; whether the API Gateway authorizer is a JWT authorizer or a Lambda authorizer.

**Why it is open.** The stack spec settled *which vendor*, on cost and single-vendor coherence. It never settled the shape, and the shape is what the client code is written against.

**What constrains the answer:**
- "Same everywhere" is a binding requirement. **Clerk was rejected specifically because its free plan pins a 7-day session lifetime** — so whatever is chosen must not reintroduce that failure.
- Offline is expressly not required ("its okay to lose offline everywhere"), so token refresh may assume connectivity.
- Prices are public and must **never share a response, an auth policy, or a cache policy** with user data. `GET /v1/prices/{YYYY}.ndjson` is **public, no authorizer, ever** — the authorizer decision applies to the user API alone.

**What would answer it:** an owner decision on sign-in method, plus one measurement of the refresh-token maximum on the free tier.

## O2 — `basis` vocabulary from row one

**The question.** `basis` is in the natural key precisely so `nav` and `bid` for one instrument-day can coexist. Which values exist is undecided: `sell` / `buy` / `nav` / `fair` (NBU) / something else.

**Why it cannot wait.** It is **in the key**, and DSQL keys are immutable. A value discovered later cannot be added to the vocabulary of rows already written; it can only be added as a new value going forward, leaving the archive split.

**What would answer it:** enumerate every price-shaped field both sources actually serve — Inzhur `prices.{buyUAH, sellUAH, navUAH, …}` and NBU fair value — and name each one now, including values not yet consumed. Cheap to over-provision, unrecoverable to under-provision.

## O3 — `instrument_ref` allocation scheme

**The question.** `instrument_ref` is **permanently allocated, never reused, never renamed**, and no foreign key protects that on DSQL. Undecided: what it *is*. Fund slug and bond ISIN work today, but they are the provider's identifiers, not ours.

**Why it matters.** If the provider renames a slug, either the ref changes (violating "never renamed") or it stops matching the feed. `listed_from` / `retired_at` exist so a missing row can be told apart from "the instrument did not exist yet" — which is what the cron-silence alarm depends on.

**What would answer it:** decide between provider-native refs with a rename-mapping table, or app-allocated refs with the provider identifier as a mapped attribute. The second is more work now and cannot be retrofitted.

## O4 — Account bootstrap and registration policy

**The question.** Accounts are independent and prices are global — settled. Unsettled: does registration exist at all, or is this a closed single-user system with accounts modelled for the future? Who is user #1 and how are they created?

**Why it is Round 1.** It decides whether a public sign-up path, email verification, rate limiting and abuse handling exist in the API surface at all. Retrofitting a public path onto a closed system is a security review, not a feature.

**Note:** `account` (provider account per user) is already modelled from day one even though Inzhur is the only provider — cheap now, expensive to retrofit. The same argument may or may not apply to registration; that is the question.

---

# Round 2 — Evidence in flight; answer when it lands

Gated on `PLAN-WAITING.md` W3 (Inzhur observation window, from 2026-09-01).

## O5 — Archive row schema, Inzhur half

**Status:** the ledger half of the data model is **settled**; the price-archive half is explicitly pending. The URL and read contract are already decided (`/v1/prices/{YYYY}.ndjson`, public, no query parameters in the default read path, NDJSON with named keys, seal on verified completeness, version by filename). What remains open is the **row**.

Already pinned regardless of evidence, and not up for re-litigation: `basis` in the key · `observed_at` separate from `as_of` · `source` + `parser_version` · `returnRates.{buy,sell}` · `status` · `as_of = capture_date − 1` · corrections in a **separate append-only overlay** (`price_correction`), never a `revision` column in the key · **`observation_kind` derived at read time, never stored**.

## O6 — Fund valuation basis

**The question.** Which published fund figure is *the* value of a fund position — `sellUAH`, `navUAH`, or something derived.

**Why it can wait:** deferred for free by keeping `basis` in the key. Both can be stored; the choice becomes a read-time decision rather than a migration. This is O2 earning its cost.

## O7 — Fund T-1 dedup rule

**Explicitly blocked, and more weeks will not automatically unblock it.** The spec's own words: the fund FX-date channel rests on **one** informative observation and conflates "the date the rate was converted with" with "the date the NAV was struck" — independent operations. **Do not ship a fund T-1 dedup rule on that evidence.**

For contrast, the bond channel *is* settled: inverting the DCF recovers the date the provider priced for at ~140:1 discrimination (a 0.42 ₴/day step against a 0.003 ₴ residual). That is an observation, not an inference. **Bonds yes, funds no.**

**What would answer it:** an observation that separates the two operations — not more of the same observation.

## O8 — The 6 short-dated bonds outside the DCF model

**The question.** Six short-dated bonds do not fit the DCF model. Neither of the user's holdings is among them.

**Deferred resolution, already chosen:** handle by **residual threshold plus alert**, not by a special case. Open is only the threshold value, which needs the residual distribution across instruments — available once the archive has observations rather than raw captures.

---

# Round 3 — Deferred by design; zero migration cost

These are **derivations**. Storing a judgment in an immutable column is the specific error the archive design exists to avoid, so each of these stays a read-time rule and can be revised at any time for free. Listed so they are not mistaken for oversights.

## O9 — `provenance` enum and its assignment rule

`published | carried | computed | frozen` are derived at read time. For funds they are strictly inferences; for bonds the inference depends on a model that may be revised.

## O10 — Volatility, max-drawdown, best/worst-day rules

None of these metrics exists yet. The rules are undecided because nothing needs them.

## O11 — UI treatment of carried and computed days

The governing rule is already pinned and is not open: **levels carry forward; changes never do** — a zero delta and an unknown delta must never render the same. What that *looks like* is open, and belongs in a design brief when a screen needs it.

---

# Round 4 — Product questions with no technical gate

Answerable today by the owner. None blocks a DDL; O12 blocks most of the archive's user-facing value.

## O12 — Past-date prefill versus the suggest-only rule

**The largest open question in the project.**

The archive will hold a price for every day since 2026-08-10 (and NBU fair value back to 2016). The portfolio has history the user entered by hand. The question: **how does a captured price become portfolio history?**

**The tension, stated exactly.** G5 is binding and survives the cloud move unchanged: *fetched, accrued and server-suggested values reach a draft or a prefilled form, and the user's Save/Confirm is the sole write path.* Applied literally to 174 days of backfill, that is 174 confirmations — which nobody will do, so the archive's history sits unused. Applied loosely, the server writes the user's portfolio history, which is exactly what G5 forbids.

**Candidate shapes, none chosen:**
1. **Never prefill the past.** The archive serves charts and checks only; portfolio history stays what the user entered. Honest, and wastes most of the archive.
2. **Bulk confirm.** One review screen showing every day the archive can fill, one press for the lot. Preserves "the user's press is the write path" while collapsing 174 presses into one — but a single press authorising 174 rows is a weaker consent than G5 assumes.
3. **Derive, never store.** Portfolio value at a past date is *computed* from `units(a, D) × price(a, D)` at read time and never written. This is what the ledger model already implies — **there is no stored daily snapshot** — which may dissolve the question entirely rather than answer it.

**Option 3 deserves the first look**, because the data model already removed `Snapshot` as a stored entity. If value is always derived, "prefilling history" may not be a thing that can happen.

## O13 — The seed's fate and its ~97 coupled test blocks

**The problem, measured.** `src/lib/seed.ts` will not reconcile under the new ledger model: its 18 transactions carry no withdrawal rows and no separate tax rows, so the account sum will not produce ₴7,75. Under the new model the sum reconciles **by construction** — no exclusion rules, no pairing heuristics — which is precisely why the old seed fails it.

Measured coupling: **97 `it()` blocks across 12 files** import the seed helpers, out of 508 in the suite. The demo/live split is removed by the same migration, so the seed survives as a **test fixture only**.

**Open:** whether the seed is rewritten to reconcile under the new model (preserving the D5-pinned figures that `navigation-map.md` checkpoints assert), or replaced by a purpose-built fixture with the pinned figures re-derived. The first keeps the checkpoints; the second is honest about the seed no longer describing a real portfolio.

## O14 — Which parse controls are stored settings, which stay code

The owner asked for parsing to be controllable via super-admin settings. The visibility half is unblocked (`PLAN-NOW.md` A7). Open is the boundary: enable/disable a source and re-run a date are clearly runtime settings; parser version, field mappings and the tolerant-parse rules are arguably code, and making them data means a bad setting can break capture without a deploy to blame.

**Constraint that is not open:** parse errors are never silent and never destructive. A payload that fails to parse is **still stored** — the raw bytes are what a later parser fix reads — and the row records why.

## O15 — The cash-reconciliation warning after stored cash is removed

D13 compromised on `Snapshot.cash` as an *observed* broker balance plus a ledger-reconciliation warning when stored and derived drift. The new model **removes stored cash entirely** — `free_cash(D)` is a plain signed sum over account rows, which the real statement was shown to reconcile against (₴8.11, verified).

**Open:** does the warning have anything left to compare, or does it retire with the stored value? If it retires, the D13 entry needs superseding rather than silently dying.

## O16 — CSV export after the repository becomes HTTP

`feat/csv-export` shipped 2026-08-11 (D29) reading through `repository.ts`. After W7 that becomes an HTTP client. **Open only in scope:** exporting a full history now means fetching it, which the read contract shapes as cached yearly NDJSON. Minor, listed so it is not discovered during the migration.

---

## How an item leaves this file

1. The answer is written in `DECISIONS.md` with its reasoning — **not** just the conclusion. A decision whose reasoning is lost gets re-litigated.
2. The item is deleted here and the Status table updated.
3. If it produced work, that work is added to `PLAN-NOW.md` or `PLAN-WAITING.md` with its branch name.

## What must never happen

An item from this file being resolved implicitly, by a commit that assumes an answer without naming it. If you find yourself needing one of these to proceed, that is the signal to stop and ask — not the signal to pick the obvious option quietly.
