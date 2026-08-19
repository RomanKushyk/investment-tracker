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
| O21 | Does the funds' `nav` history ever reach the app, and as what? | — | **closed — D74** archived as published, never shown; the read-time `sell` conversion is rejected permanently |
| O22 | May a settings toggle make G5 opt-out — the app writing daily quotes with no Save press? | — | **open, 2026-08-18 — EVIDENCE GATHERED 2026-08-19**, see below. Buys one press a day; the machine's input was wrong for 5 of 23 instruments on the last measured day |
| O23 | Should annualization use each asset's OWN holding period instead of one portfolio-wide span? | — | **open, 2026-08-18 — EVIDENCE COMPUTED 2026-08-19**, see below. One row moves; it flips to beating a fixed coupon by 19,3 pp |
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

## O22 — May a settings toggle make G5 opt-out?

**Opened 2026-08-18, groomed out of the owner's idea list** (`PLAN-NOW.md`
§ Section H). The draft line reads: *"toggle in settings to auto save daily
quotes, G5 (suggest-only) if disabled"* — so the switch ON means the app writes
a snapshot with no Save press, and OFF means today's behaviour.

**Why this is a question and not a task.** G5 is stated in
`NEXT-PHASE-PLAN.md` as *"automation is suggest-only by construction. Binding and
non-negotiable: fetched and accrued values reach a draft or a prefilled form, and
the user's Save/Confirm is the sole write path. This survives the cloud move
unchanged and applies to anything the server suggests too."* A toggle does not
bend that rule, it replaces it with *"binding unless the owner opts out"* — and
the two are different contracts, one of which cannot be relied on by anything
downstream. It is also load-bearing in more places than the quotes screen: D20's
provenance map, D21's suggestion switches, D22's reminders and D24's cross-tab
locking all assume a single human write path.

**The shape is already conceded and is not what is in dispute.** The idea list
specifies the switch as opt-in with OFF meaning today's behaviour, which is the
careful version. What is undecided is whether the ruling may be narrowed at all.

**What an answer has to say, whichever way it goes:**
- If **no**: say so once, in a decision, so the line stops returning. The nearest
  thing that does not touch G5 is a one-press confirm — fewer keystrokes, same
  sole write path — and that is a design question, not a contract one.
- If **yes**: name what the switch may write (the quote snapshot only? coupons
  too?), what it may never write, whether a server-side suggestion is covered,
  and how the user sees that a machine wrote a row — provenance already exists
  for exactly this (D20), so an auto-written row must carry it.

---

## O22 — the evidence, gathered 2026-08-19

I had said this one was "a contract question, not a numbers question, so there
is nothing to compute". That was wrong twice over: the blast radius is countable
and the cost is measured. Both are below.

### 1. How load-bearing G5 is — counted, not asserted

**23 citations across 18 files**, including one in `infra/` — the backend cites
it too. The entry above asserted four dependents from memory; the audit found
the assertion understated.

They are not decorative. The structural ones:

| Site | What it says |
|---|---|
| `state/draft.ts:14` | the origins map exists to make *"never overwrite a user value"* **decidable after a reload** |
| `core/types.ts:62` | *"a draft with no origin is the user's own value — the fact G5 protects"* |
| `screens/daily-quotes/fetch-quotes.ts:5` | *"G5 IS THE WHOLE POINT of this module"* |
| `screens/DailyQuotes.tsx:93` | *"Save snapshot below stays the sole write path"* |
| `screens/daily-quotes/useQuoteFetch.ts:6` | *"nothing here touches the repository"* |
| `core/accrual.ts:268` | the coupon pointer *"is still rolled only by the user's Confirm press"* |

### 2. What the toggle buys — ONE press per day

The daily ritual in the live dataset with linked assets is two presses: **Fetch
quotes**, then **Save snapshot**. The fetch is manual-only by a separate policy
(D19), so an auto-save removes exactly **one of the two**.

To remove both, the toggle would have to auto-FETCH as well — which the idea
list does not ask for and which D19 forbids on its own grounds. So the honest
accounting is: **one press, once a day.**

### 3. What it costs — measured on the most recent real day

The 01:00 capture on **2026-08-19** reported, from the DCF inversion A6 runs
nightly:

```
quoteVerdicts   consistent 18 · stale 3 · revised 2 · insensitive 0
quoteMaxStaleDays  6
```

**Three of twenty-three instruments' published prices did not correspond to that
day** — the oldest by six days. Two more did not fit the published yield at all.

Under G5 the user sees that on the row before deciding: `ModelNote`
(`QuoteRow.tsx:147`) prints *"Provider price is N days old — it still prices to
dd.MM."* for a stale one, and a `warn` line for a price no yield in the window
explains. **Under auto-save those five rows are written as that day's snapshot
with nobody looking**, and the note that would have said so is rendered to an
empty room.

This is the whole argument in one number: **the machine's input was measurably
wrong for 5 of 23 instruments on the most recent day measured.** Not
hypothetically — that is what the capture recorded.

### 4. What collapses structurally, as opposed to merely bending

The provenance model. `QuoteOrigin` exists so that *"a draft with NO origin is
the user's own"* is decidable after a reload. If the app writes on its own, every
stored snapshot is machine-origin and the distinction has nothing left to
distinguish. **That is not a rule bending under a toggle — it is a type that
stops meaning anything**, and the `origins` map in `state/draft.ts` becomes dead
weight the next reader will delete.

### 5. The cheap alternative that touches nothing

**A one-press confirm.** The user still presses, but once for the whole day
rather than per row. The S3 "Use fetched?" offer already batches at row level;
batching it at day level is a design question for a brief, not a contract
change. It removes most of the friction the idea list is aiming at and leaves
G5 exactly as it is.

### 6. What this evidence does NOT settle

- **Whether G5 should bend for the BACKEND.** It already does not need to: the
  nightly capture writes to the ARCHIVE, never to user data, and D63 draws that
  line. Nothing here touches it.
- **Whether the friction is felt.** The count above is presses, not annoyance.
  One press a day is small on paper; only the owner knows whether it is small in
  practice, and that is the half of this decision no audit can supply.

## O23 — Should annualization use each asset's own holding period?

**Opened 2026-08-18, found while deriving the portfolio start (A24).** Two
callers — `screens/yield/yield.ts` and `screens/Attributes.tsx` — compute **one**
`daysHeld` for the whole portfolio and apply it to **every** asset:

```ts
const daysHeld = now && start ? daysBetween(start, now) : 0;
```

So `UA4000236475`, bought **2026-06-02**, is annualized over the portfolio's
**174** days rather than its own **53**. Its `+5.20 %` total becomes `+10.9 %`
annualized; on its own basis it would be roughly `+38 %`.

**This is not a bug that slipped in — it is pinned.** `core/derive.ts` carried
the comment *"a single date for ALL assets (design §6.5 footnote), NOT each
asset's own firstPurchase"* from v1, `D5#5` pins the basis, and
`derive.test.ts` asserts `+10.9 %` with the words *"NOT per-asset basis"*. It was
a deliberate simplification with a reference behind it.

**Why it is a question rather than a task.** Changing it moves D5-pinned demo
figures on `/yield` and `/attributes`, which the standing invariants forbid
without a decision. And the right answer is not obvious: a per-asset basis is
more honest per row but makes the column non-comparable between rows, which is
what a reader of a table does first. **XIRR already gives the per-asset,
money-weighted answer** (added in P2), so the question is partly whether the
simple annualized column should duplicate it or stay the naive comparable one.

**What an answer must state:** which basis each of the two screens uses, whether
D5#5 is superseded or kept, and what happens to the seed figures the tests pin.

---

## O23 — the evidence, computed 2026-08-19

Every figure below was computed from `lib/seed.ts` through the app's own
`annualizedPct` and `xirr`, not estimated. Terminal date `2026-07-27` (the last
snapshot); global basis **174 days**.

| Asset | first purchase | own days | Δ total | **global ann.** | **own ann.** | XIRR | expected |
|---|---|---|---|---|---|---|---|
| Inzhur REIT | 2026-02-03 | 174 | +4,41 % | **+9,3 %** | **+9,3 %** | +23,0 % | 14,0 % |
| Inzhur Energy | 2026-02-03 | 174 | +1,48 % | **+3,1 %** | **+3,1 %** | +3,1 % | 10,0 % |
| OVDP …8976 | 2026-02-05 | 172 | +2,96 % | **+6,2 %** | **+6,3 %** | +25,8 % | 16,4 % |
| OVDP …6475 | 2026-06-02 | **55** | +5,20 % | **+10,9 %** | **+34,5 %** | +99,4 % | 15,2 % |

### 1. The question is about ONE row, not four

Two of the four do not move at all — REIT and Energy were bought on the
portfolio's first day, so their own basis IS the global one. …8976 moves by
**0,1 pp**. **The entire decision rests on …6475**, and it rests on it only
because that position is eight weeks old.

### 2. The per-asset figure was already computed at v1, and already rejected

`navigation-map.md` has carried the words *"…6475 annualized **+10,9 %** (global
03.02 basis — D5#5; **NOT +34,5 %**)"* since v1, and `core/derive.test.ts`
asserts the same with the comment *"NOT per-asset basis"*. **+34,5 % is exactly
what the computation above produces.** So the alternative was not overlooked —
it was calculated, named, and declined, and this entry is a re-examination
rather than a discovery.

### 3. The decisive number is not the annualized column — it is "vs expected"

That column is what the screen actually asks the reader to judge, and it is
`annualized − expectedPct`:

| Asset | vs expected, **global** | vs expected, **own** |
|---|---|---|
| REIT | −4,7 pp | −4,7 pp |
| Energy | −6,9 pp | −6,9 pp |
| …8976 | −10,2 pp | −10,1 pp |
| **…6475** | **−4,3 pp** | **+19,3 pp** |

**Under a per-asset basis, …6475 reads as beating its own expected yield by 19,3
percentage points — on a bond whose coupon is contractually fixed at 15,2 %.** A
fixed-coupon instrument cannot outperform its own contract by 19 pp. The figure
is not a measurement of the bond; it is 55 days of accrual multiplied by 6,6.

### 4. The app already has the per-asset answer, and it already disclaims itself

`XIRR` is money-weighted and uses each asset's own flows and dates — it IS the
per-asset column. It reads **+99,4 %** for …6475, and its header carries the
`(ann.)` clarity mark **precisely because a short history annualizes badly**
(`xirrIsExtrapolated`, S9b). So the screen already offers a per-asset rate that
labels itself an extrapolation. Making the simple annualized column agree with
it would leave the table with two extrapolations and no comparable figure.

### 5. What the distortion does over time

It shrinks. …6475's own basis reaches 174 days in November 2026 and a full year
in June 2027, at which point the two bases converge for it. **The distortion is
therefore worst exactly when a position is new — which is when it is looked at
most.**

### 6. What this evidence does NOT settle

- Whether the column should be **labelled** more explicitly. It currently reads
  `Річна` / `Annualized` with the basis only in the footnote; "annualized over
  the portfolio's life, not this asset's" is a copy question this evidence does
  not answer.
- `/attributes`' `ФАКТИЧНА (РІЧНА)` per-asset fact card, which uses the same
  global span and where the "comparable between rows" argument is weaker —
  a fact card is read one asset at a time.

**A correction to this entry's own earlier wording.** It said …6475 "would be
roughly +38 % on its own basis" over "53 days". Both were wrong: the terminal
date is the last snapshot (2026-07-27), giving **55 days** and **+34,5 %** —
the figure the map had named all along.

