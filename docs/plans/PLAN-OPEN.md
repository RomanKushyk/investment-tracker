# Plan C — Open questions

> **For agentic workers:** **do not implement an item from this file.** If a task you are doing depends on one, stop and surface the question — an assumption silently baked into code is how an open question becomes a wrong decision nobody remembers making.
>
> **Companion plans:** `PLAN-NOW.md` (startable today) · `PLAN-WAITING.md` (dated). Parent: `NEXT-PHASE-PLAN.md`. Answers land in `DECISIONS.md` and the item leaves this file.

Written 2026-08-11. **Resolved the same day, 18 of 19 items** — D30–D35 closed the original Rounds 1, 2 and 4; D36–D39 then reworked the auth answers as the design sharpened. What remains: Round 3, which was never a gap (three derivations deferred at zero migration cost), the archive row's non-key columns, and one new item that costs money and is therefore the owner's.

## Status

| # | Question | Round | Outcome |
|---|----------|-------|---------|
| O1 | Auth model: which Cognito shape | 1 | **closed — D32/D36/D39** Essentials, managed login, HTTP API JWT authorizer, refresh token in years, **passkey-first** onboarding |
| O2 | `basis` vocabulary from row one | 1 | **closed — D30** `buy \| sell \| nav \| fair`; currency is not a basis |
| O3 | `instrument_ref` allocation scheme | 1 | **closed — D30** `isin` for bonds, `slug` for funds; the feed's `id` rejected |
| O4 | Account bootstrap and registration policy | 1 | **closed — D38/D39** an application creates a DB row, not a Cognito user; super-admin approves; toggle opens it fully |
| O5 | Archive row schema, Inzhur half | 2 | **key closed — D30**; the non-key columns stay gated on `PLAN-WAITING.md` W3 |
| O6 | Fund valuation basis | 2 | **closed — D31** `sell`; `nav` is 0 for two of four funds |
| O21 | Does the funds' `nav` history ever reach the APP, and as what? | — | **open, 2026-08-18.** Storing it is settled (W15); showing it is not |
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
| O17 | SES sender identity — domain or address | 1 | **closed — D40** `quirenote.com`, acquired 2026-08-11; A11 unblocked |
| O18 | Is the app renamed from Kubushka to match the domain? | 4 | **closed — D41** user-facing renamed to Quirenote; every addressed identifier left alone |
| O20 | Separate dev and production databases — worth it, and when? | — | **closed — D63** the split happens at W7 and covers USER data only; one archive and one capture serve every environment |

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
| D36 — one account per email | `usernameAttributes` pinned before `CreateUserPool`; linking trigger with the `email_verified` condition | `PLAN-WAITING.md` W7 |
| D37 — no MAU metric exists | Three instruments instead of one: Free Tier alerts, a usage budget, and `EstimatedNumberOfUsers` on the 01:00 capture | `PLAN-WAITING.md` W7 |
| D38 — approval gate | `app_user` status checked by the API on every request, because token-time checks cannot revoke | `PLAN-WAITING.md` W7 |
| D39 — applications never reach Cognito | The application endpoint, its four free defences, and passkey-first onboarding | `PLAN-WAITING.md` W7 |
| D39 — SES replaces the default mail | Production access requested early so it is off the migration's critical path | `PLAN-NOW.md` A11 |
| D40 — `quirenote.com` acquired | A11 unblocked; DKIM/SPF/DMARC records specified, DNS kept off Route 53 | `PLAN-NOW.md` A11 |
| D41 — product renamed, machines not | Shipped in the same commit; no follow-up work | — |

---

## How an item leaves this file

1. The answer is written in `DECISIONS.md` with its reasoning — **not** just the conclusion. A decision whose reasoning is lost gets re-litigated.
2. The Status table is updated to point at the decision; the detail section is deleted.
3. If it produced work, that work is filed into `PLAN-NOW.md` or `PLAN-WAITING.md` and recorded in the table above.

## What must never happen

An item from this file being resolved implicitly, by a commit that assumes an answer without naming it. If you find yourself needing one of these to proceed, that is the signal to stop and ask — not the signal to pick the obvious option quietly.

## O20 — Should dev and production have separate databases, and when? — researched 2026-08-14

**Asked by the owner** after the frontend prod/dev split (D59): if git has two
environments, should the data be two stores as well?

### What is already separate, at no cost

**The app's database is per-ORIGIN, and dev and production are different
origins.** Data lives in IndexedDB (`quirenote` for demo, `quirenote-live` for
live), and the browser scopes those stores to `https://quirenote.com` and
`https://dev.quirenote.com` independently. Nothing written on dev can reach
production, today, by construction — and more thoroughly than a server split
would give, since each browser profile is its own store too. `src/` makes no call
to any server we own.

So the question is only about the **backend**: one Aurora DSQL cluster, written by
one nightly Lambda, read by nothing in the app.

### What a second cluster would cost in money — almost nothing

| Line | Figure | Source |
|---|---|---|
| DSQL DPU | **$9.50 / M DPU** (eu-north-1) | rate card in the cost spec |
| DSQL storage | **$0.36 / GB-month** | same |
| Free allowance | **100,000 DPU + 1 GB, always, recurring monthly** | same |
| Current projection | **~325 DPU/month** at year 1 — 0.3% of the allowance | cost spec |
| Current storage | **34.6 MiB / 6,630 rows** — 3.4% of the 1 GB | durability measurement |
| DSQL billed this month | **$0.00, usage quantity 0** | Cost Explorer, 2026-08-14 |

AWS free tiers are account-level, so a second cluster shares that allowance rather
than earning its own — and even doubled, the workload is under 1% of it. The one
line that does appear is CloudWatch: **7 alarms today against 10 free**, so a
duplicated stack lands at 14 and the four over cost **$0.10 each — $0.40/month**.

**Money is not the reason to hesitate.** The costs that matter are not on the bill.

### What it would cost that is not money

1. **A second nightly capture doubles the requests to Inzhur and NBU**, who
   publish this data for free, for an archive nobody reads. Avoidable — a dev
   stack can deploy its schedule `DISABLED` and be invoked by hand — but it has
   to be a deliberate part of the design, not an afterthought.
2. **A dev archive is worthless by construction.** The production archive's value
   IS its history: the backend exists because Inzhur publishes none, so a day not
   captured is lost permanently (D27). A dev cluster starts empty and stays thin,
   which means it can rehearse **schema and migrations** and nothing else. That is
   a real use — it is just much narrower than "a place where dev data lives".
3. **The operational surface doubles**: 20 stack resources become 40, 7 alarms 14,
   two backup selections, a second GitHub environment, a widened or second IAM
   role, and every future infra change either applied twice or parameterised
   first. Today's frontend split is the honest reference for the shape of that
   work — six moving parts across AWS, GitHub and the workflow.
4. **It buys nothing the app can use yet.** Nothing in `src/` reads the backend.
   Until W7 the split would protect a production store from a dev application
   that does not exist.

### Recommendation — do it AT W7, not before

W7 is the migration that first makes the app talk to a server. That is the moment
the split stops being hygiene and becomes necessary: from then on, a dev build
writing into the production archive is a live hazard rather than a theoretical
one. Doing it then also means the migration is *designed* for two environments
instead of retrofitted onto one, and the dev cluster gets created with a purpose
already attached.

Doing it now would mean maintaining two of everything for a backend with one job
and no consumers, and the protection it adds today is protection the browser
already provides for free.

**If the owner prefers to move earlier**, the cheap first step is not a second
cluster — it is making the stack take the environment as a parameter, so that
standing one up later is a deploy rather than a fork. That is a small change and
it is the part that would otherwise be done twice.

## O21 — Does the funds' `nav` history ever reach the app, and as what?

**Opened 2026-08-18, once the provider's files turned out to be a different
basis than the app computes in.** Storing them is decided — `nav`, unconverted,
`PLAN-WAITING.md` W15. What is NOT decided is whether any of it is ever shown,
and that question has teeth because the app has exactly one notion of value.

**The constraint, so nobody re-litigates it:** the app values holdings at `sell`,
because that is the amount actually realisable. The owner declined a nav/sell
toggle on 2026-08-18 and the reasons are recorded — `nav` reads 0 for
`ocean-plaza` and `zhytniy` (D31), and a toggle would change what every derived
figure MEANS rather than how it looks, unlike currency, language and theme.

**So the readings are:**

1. **Never shown.** The archive holds it for completeness and future analysis; no
   screen reads it. Cheapest, and loses the only long fund history there is —
   Energy back to 2024-11-14.
2. **Shown as its own series, labelled `nav`**, never mixed into portfolio value.
   Honest, and needs a design brief (G7): a second price line is a new visual
   claim and the app has never drawn one.
3. **Converted to `sell` at read time** with the 0.9 % spread stated as an
   assumption. Gives historical portfolio value — but the spread is
   **undocumented** (the services agreement pins no NAV formula; the 0.5 % in it
   is a referral early-sale fee) and verifiable only for 2026-04-23 → 07-06.
   Every figure before April would carry an unverified 0.9 %.

**Whichever is chosen, it must not be chosen quietly inside W15.** W15 writes
rows; this decides what they are allowed to become. The evidence for all three is
in [`../reference/INZHUR-FUND-HISTORY.md`](../reference/INZHUR-FUND-HISTORY.md).
