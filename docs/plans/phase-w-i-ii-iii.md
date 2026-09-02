# Plan B — Phases W-I to W-III

> Bodies of the waiting items in these phases. Dated table and rules: [`PLAN-WAITING.md`](PLAN-WAITING.md). **W3 and W4 closed and left together on 2026-09-03** — [`../archive/plan-b/W03-W04.md`](../archive/plan-b/W03-W04.md). W1 closed and is in [`../archive/plan-b/`](../archive/plan-b/README.md).

Moved verbatim from `PLAN-WAITING.md` on 2026-08-26 as `W02-W08.md`; renamed by section, 2026-08-27 (D98). **W2 is done and W6 is not** — they were written as one section and stay one, because splitting a measurement from its follow-up would lose what W6 is measuring against.

# Phase W-I — Self-accruing observations (no action until the date)

These need nobody to do anything. They are listed so the *check* is not forgotten.

## W2 / W6 — DPU measured over a week, then a month — W2 **DONE 2026-08-17**, W6 **2026-09-10**

**Gate:** elapsed time only. The cost spec calls this out — the formula is documented (`ReadDPU = max(BytesRead, 2048) × 0.00000183105`) and reproduces a published bill to three significant figures, but **background/system DPU (auto-ANALYZE, index maintenance) is genuinely unmodellable** and only measurement settles it.

- [x] 2026-08-17 — recorded in `infra/README.md` § "W2 — a week of real DPU": **~1,620 DPU/month** extrapolated, **5× the ~325 projection** and 1.6% of the free allowance, so nothing decided by its *size* changes. Two corrections fell out, both now carried by **D90**: D64's guard costs ~73 DPU/month, not ~6 (it reads 117 KiB, not the 2 KiB minimum assumed), and a full capture reads 34.2 MiB against 34.9 MiB of total cluster storage — **answered 2026-08-25 by `EXPLAIN`, not by W6 (D91)**: it was `unchangedStreak` on `nbu_fv` — a Full Scan at 64.989 DPU, dropping to 9.508 when the ORDER BY names the column instead of the query's own `to_char` alias. A20 removed the call on 2026-08-18.
- [ ] 2026-09-10 — record the month figure, and expect **~173 DPU/month**, not W2's ~1,620: the scan that dominated W2 was the streak query, removed by A20 on 2026-08-18 (**D91**, re-measured 2026-08-25). Also re-read **`BytesRead` against `ClusterStorageSize`** — the ratio that exposed the scan; and remember `EXPLAIN (ANALYZE, VERBOSE)` prints `Statement DPU Estimate` per statement (D91). A2's before/after is NOT waiting on this — A2 closed 2026-08-11 and D48 published the measured pair.

**No design decision differs across the $0–$2/month spread this could move.** Measure it to know it, not to decide anything.

---

# Phase W-II — The unrepeatable observation

## W5 — cum/ex boundary on UA4000238976 — **2026-09-24, hard**

**The only genuinely unrepeatable item in this plan.** The spec calls it "one free observation already scheduled": ≈1081.82 cum versus ≈1003.42 ex, a step of ≈78.40 — exactly the coupon. It settles the cum/ex convention by observation instead of inference.

**The date arithmetic matters, get it right — and it was REWRITTEN on 2026-08-18 (D71).**
The bullets here used to read *"the price published on day D is captured by the 01:00
run on D+1 and stored with `as_of = D`"*. That is the premise `asOfFor` was built on,
and D71 retired it for Inzhur: the endpoint is live, and the price current at 01:00
Kyiv on day X is the price struck for X. The old chain reached the right pair of dates
through a rule that is now false, which is the most dangerous kind of correct.

- The coupon pays **2026-09-23**.
- An Inzhur row carries the RUN's Kyiv date (`inzhurAsOf`, D71), so the row written at
  01:00 on day X is labelled `as_of = X`. Nothing is subtracted. NBU still subtracts a
  day and is still right to — do not "align" them.
- **The model already commits to an answer.** `futureFlows` filters `p.date > onIso`
  — strictly future, same-day flows excluded — so `src/core/inzhur/dcf.ts` prices
  `as_of 2026-09-23` **ex**. This item is therefore no longer an open observation: it
  CONFIRMS OR REFUTES A CONVENTION THAT IS ALREADY IN THE CODE.
- **So the pair to compare is not knowable in advance, and must not be pinned.** If the
  code's convention holds, the step falls between `as_of 09-22` (cum) and `as_of 09-23`
  (ex), and both rows are in the archive by **01:00 on 2026-09-23**. If it does not, the
  step falls between `as_of 09-23` and `as_of 09-24` instead. Read the window
  `as_of 2026-09-21 … 2026-09-25` and let the ≈ 78.40 step locate itself; a comparison
  pinned to one pair can only confirm the convention it assumed.
- **Reading on 2026-09-24 or after covers both cases**, which is why that date stands
  unchanged as the hard one.

**A6 now makes this observation automatically, which the item predates.**
Since 2026-08-18 the DCF re-derivation runs inside the nightly capture and publishes
`quoteVerdicts` / `UNEXPLAINED_QUOTE`. It walks the same schedule with the same
same-day rule, so the boundary is measured whether or not anyone is watching:

- **Quiet through the night of 09-23 → the convention in the code is right.**
- **`UNEXPLAINED_QUOTE` fires that night → the convention is wrong**, and the alarm IS
  the finding. Do not treat it as an incident and do not "fix" the check on the day —
  that would destroy the one observation, and the next chance is 182 days out.

Either way the verdict lands in the run journal, so the manual reading below is now
corroboration rather than the only record.

**Preparation — must be done before the date, not on it:**
- [x] `PLAN-NOW.md` **A1 must be merged first.** The date grid used to say 2026-09-25; a
      coupon suggested on the wrong day contaminates the very observation this exists to
      make. **Done 2026-08-11** — the schedule now walks the published grid.
- [ ] Confirm before 2026-09-22 that the scheduled capture is healthy — the silence
      alarm covers a dead job, but check rather than assume.

**On 2026-09-24 or after:**
- [ ] Read the window, not a pair, and record where the ≈ 78.40 step actually falls.
- [ ] Record the verdict in DECISIONS — cum/ex convention, stated once, in writing,
      and say explicitly whether it confirms `futureFlows`' same-day rule or overturns it.

**Cost of missing:** 182 days. The next boundary is 2027-03-24, which is also W10 (maturity) and therefore a *different*, messier observation — final coupon and principal on the same date. Missing 2026-09-24 means the clean version does not recur.

**What does not need doing:** nothing has to run on the day. The capture is automatic; only the reading is manual.

---

# Phase W-III — Evidence-gated backend

## W3 / W4 — Inzhur observation window and schema — **BOTH CLOSED**

**W3 read 2026-08-31; W4 completed and verified live 2026-09-02.** The section
moved verbatim to [`../archive/plan-b/W03-W04.md`](../archive/plan-b/W03-W04.md)
on 2026-09-03, both halves at once — the body was one section and stayed joined
because W3's answers are W4's input. What they produced is live elsewhere:
`observeInzhur` and `bond_terms` in `../../infra/src/`, the rulings in
[`../decisions/D132.md`](../decisions/D132.md), and the window's own working in
[`../../infra/docs/w3-window.md`](../../infra/docs/w3-window.md).

## W7 — B3 migration

**GATE MET 2026-09-02.** W4 complete **and** the A3 durability gate passed — **both halves.** (The status lives here rather than in the heading: putting it there broke this section's anchor twice, and it is the only intra-doc link in the folder.) The durability half passed 2026-08-11 (D49); W4's three boxes all closed 2026-09-02, verified against the live cluster. W7's own 2026-09-02 is the date arriving, not the gate opening — and it is deliberately no longer in this heading, so that a passed date cannot read as an open gate. A3 left `PLAN-NOW.md` with D95 and its row is in [`../archive/plan-a/README.md`](../archive/plan-a/README.md). ~10–12 days of work per the staging estimate — sized when the scope still included the PWA shell, which D92 removed, so the figure stands as an unadjusted upper bound. **Prep that nothing gates is `PLAN-NOW.md` Section P (A54 — body in `section-p.md`; A51 and A53 closed and are in `../archive/plan-a/section-p.md`)** — the DDL draft, the API contract on paper, the Cognito rehearsal — added 2026-08-26 from the research of 2026-08-25. **The seed rewrite was tried as A52 and withdrawn:** it cannot be pulled in front of this phase, because the row count `4/174/18` and `Deposited 143 176 ₴` are both pinned checkpoints, so no added row is net-zero while `derive.ts` keeps its exclusion rules. The seed rewrite and the `derive.ts` change land **together, here** — and the ruling they waited on is given: **O31 closed 2026-09-02 as D133, all three figures may move.**

**Pre-condition, CLEARED 2026-08-27 (D99).** DSQL rejects `USING btree` and
rejects a `CREATE INDEX` without `ASYNC`, so promotion rewrites every index line
**twice** — insert `ASYNC`, strip `USING btree`. Measured with it: the whole of
`003_user_schema.sql` applies to the live cluster and its `CHECK`/`UNIQUE`/`DEFAULT`
are enforced, so **the DDL is no longer this phase's first contact — the
migration RUNNER is**. DSQL also grew enforced foreign keys on 2026-08-26, which opened O34 and **closed it on 2026-08-28 (D101): W7 ships none**, and whether they are ever adopted is O33's to decide.
Rules in `infra/migrations/drafts/README.md`, working in
`infra/docs/dsql-ddl-first-contact.md`.

**W7 SEEDS FRESH DEMO DATA — it does NOT carry the local data across** (owner,
2026-09-01). There is no live user and therefore no live data, so there is
nothing on the other side worth a migration: the browser's IndexedDB holds a
demo portfolio and whatever the owner typed while building the app, and both are
cheaper to re-create than to translate. **What this removes from the phase:**
the whole class of problems in
[`../reference/w7-migration-translations.md`](../reference/w7-migration-translations.md)
that exist only because a stored row predates a rule — unrecoverable unit counts
([`../decisions/D128.md`](../decisions/D128.md)) first among them. **What it does
NOT remove:** the translations that are about SHAPE rather than history — enum
spellings, key order, nullability — which a fresh seed still has to satisfy.

**So `transaction_quantity_required_ck` needs no backfill step.** D125 justified
that CHECK by sequencing (backfill, then migrate); with nothing migrating, the
constraint is simply true of everything the seed writes. Read the DDL's own
comment beside it — it says the same thing and points here.

**READ THIS AGAINST THE D33 BULLET BELOW, which says the migration MUST carry
the snapshots into a per-user `user_price` overlay and that discarding them
"deletes five months of history no source can regenerate".** The two meet
exactly, and the seeming contradiction is worth spelling out because a session
skimming will hit one or the other:

- **The mechanism changes.** Nothing is CARRIED. `seed.ts` is the source that
  regenerates those snapshots — deterministically, which is why their count sits
  behind a fact fence — so "no source can regenerate" was true of a live user's
  hand-entered prices and never of the demo's.
- **The requirement does not.** D33's overlay is about SHAPE, and shape survives
  a reseed intact: the demo's prices still have to land as `user_price` rows, or
  `coalesce(user_price, archive)` has nothing to coalesce and every past-date
  value falls back to the archive's basis. **The seed writes them; the migration
  does not move them.** Same end state, and the D34 bullet below already assumes
  the seed is rewritten for this schema.

That is the whole of the reconciliation: history-because-a-row-is-old is gone,
history-because-a-derivation-needs-a-row stays.

**Scope is now specified, not merely named** — D32–D34 closed the questions that used to sit under each of these words:

- **Auth (D32, amended by D36 and D38):** Cognito user pool on the **Essentials** tier, **managed login**, refresh token measured in years, API Gateway **HTTP API with the native JWT authorizer** — no Lambda authorizer. Free to 10,000 MAU. `GET /v1/prices/{YYYY}.ndjson` stays public with no authorizer, ever.
- **Registration is an application, not an open door (D38):** sign-up always succeeds and produces a `pending` row; a super-admin approves, rejects or removes it; a toggle can open registration fully, with a warning. **The approval gate is access control, not cost control** — a pending user already counts as an MAU, so D37's monitor is what guards the free tier.
- **Three sign-in methods, one account per email (D36):** password + Google + passkey. Passkeys add no duplication risk — a passkey is a credential on an existing user, not an account. The duplication pair is local-vs-federated, and it needs **both** mechanisms below.
- **Free-tier watch (D37):** there is no CloudWatch MAU metric; three instruments stand in for one.

**Pool-creation checklist — the immutable parts (D36).** `usernameAttributes` cannot be changed after the pool is created; getting it wrong means recreating the pool, so this is checked before `CreateUserPool`, not after:

- [ ] `usernameAttributes: ['email']`. **Not `aliasAttributes`** — aliases let several users hold one email and resolve it as "only the last user who verified it can sign in", which silently takes sign-in away from an existing account.
- [ ] Essentials tier (passkeys are not in Lite).
- [ ] Refresh token in years; access and ID tokens left at 60 minutes.

**Approval gate (D38).** The intuitive design — a pre-authentication trigger that refuses unapproved users — is **insufficient and must not be the gate**: AWS documents that the trigger does not fire when the user has an existing session, and with a refresh token measured in years an existing session lasts approximately forever. Anything checked at token-issue time can grant but never revoke.

- [ ] **`POST /v1/applications` creates a DSQL row and NO Cognito user (D39).** This is what protects the MAU allowance — Cognito marks a user active at sign-up, so an application that reaches `SignUp` has already cost an MAU whether or not it is ever approved. The Cognito user is created by `AdminCreateUser` **on approval**, which also makes approval the verification step: the invitation reaches only the address's owner.
- [ ] Abuse defences on that endpoint, all free: **API Gateway route throttling** (what WAF is usually bought for), a **unique index on email** so a flood becomes one row, and **no email sent on submission** — mailing an address on submission would let anyone type a stranger's address and have this domain deliver to it.
- [ ] **Pre-sign-up trigger rejects federated sign-ins with no approved application** — a Google user is created on first IdP sign-in, which is the second route to `SignUp`. Auto-approve when the open-registration toggle is on.
- [ ] Verify the flagged inference with one test sign-up: a trigger-rejected sign-up should cost no MAU (no user is created), but AWS does not document it.
- [ ] `app_user(user_id, email, status, role, applied_at, decided_at, decided_by)` in DSQL. `status ∈ pending | active | rejected`, `role ∈ user | super_admin`. **This is the authoritative record**, and the API Lambda checks it on every request — it already loads the row to scope data by `user_id`, so the check is free and there is one place where "may this person act" is answered.
- [ ] **Post-confirmation trigger** creates the row `pending`, or `active` when the open-registration toggle is on.
- [ ] A `pending` caller gets a distinct response, not 401 — they are genuinely signed in and simply may not act yet. The client renders "awaiting review".
- [ ] **`cognito:groups` is not the authorization source; the `role` column is.** Group membership is stamped into a token at issue time, so removing someone from a super-admin group would not take effect until the token refreshes.
- [ ] `AdminDisableUser` on **rejected** users as defence in depth — a consequence of the status, never the record of it.
- [ ] **Bootstrap in the same migration that creates the table:** the owner is created with `AdminCreateUser` and seeded `active` + `super_admin`. Everyone starts `pending` and only a super-admin approves, so without this the system cannot be started at all.
- [ ] Super-admin screen: users table with approve / reject / delete.
- [ ] **Delete is scoped to `pending` and `rejected` users only** — they own no portfolio data, so no cascade exists and it is genuinely cleanup. **Deleting an `active` user with transactions is not implemented and not decided**: it is exactly the cascade the ledger model forbids. Rejecting or disabling achieves every operational purpose without destroying a ledger.
- [ ] Open-registration toggle: one settings row, read by the post-confirmation trigger, default **off**. Its warning states the specific consequence — anyone who signs up gets in immediately and there is no threat protection behind it (Plus has no free tier, WAF is $15/mo and on the standing "no" list).

**Onboarding is passkey-first (D39).** Approval → invitation with a temporary password → user sets their own password (`NEW_PASSWORD_REQUIRED`) → **registers a passkey immediately** → every later sign-in uses the passkey and sends no email.

- [ ] **Delete `public/robots.txt` when sign-up ships.** Production is `Disallow: /` until then (2026-08-14) — an indexed page a visitor cannot act on is worse than no page. The file explains why `noindex` must not be added alongside it. **Deleting it is not neutral:** with no file at the origin, Cloudflare synthesises its own content-signals robots.txt again, so decide then whether those AI-training reservations should be written into a shipped file instead.
- [ ] **Do not reach for SMS OTP either (D62).** Investigated 2026-08-14 as a way around the SES denial: it is not one. This account is in the SNS SMS sandbox AND capped at $1/month of text spend, so it needs TWO AWS approvals where SES needs one; a message to a Ukrainian number costs **$0.16154** against SES's $0.0001, which is six messages a month at the current cap; and a code sent on demand is a way to spend the account's money from outside it. Ukraine at least needs no sender-ID registration — checked, no `UA_*` type exists — but that is the only point in its favour.
- [ ] **Do not enable email OTP as a sign-in factor.** The password the user sets is the recovery path, so OTP is not needed, and enabling it would make email the critical path for every new session. It stays available later at zero migration cost — it is a pool setting, not a schema decision.
- [ ] **Do not set MFA to required** — OTP flows are incompatible with it, which would close that door pre-emptively. A passkey with user verification can satisfy MFA anyway (`FactorConfiguration: MULTI_FACTOR_WITH_USER_VERIFICATION`).
- [ ] Headroom to know: 20 passkeys per user, 5 linked federated identities. Email volume across an account's whole life is **two messages** — the invitation, and a reset if ever needed.

**Email delivery moves to SES (D39).**

- [ ] Configure the pool with `EmailSendingAccount: DEVELOPER`. **The default is unusable here, and volume is not the reason** — hard-bounced addresses go onto an AWS-managed suppression list that **cannot be cleared** while the pool uses the default, possibly indefinitely, and a registration system that mails strangers will collect typo'd addresses. The 50 messages/day/account cap (non-adjustable, resets 09:00 UTC) would also have been fatal had OTP been chosen.
- [ ] Confirm SES production access is granted before cutover — see `PLAN-NOW.md` A11, which raises the request early precisely so this is not discovered here.

**Account linking (D36).**

- [ ] Pre-sign-up Lambda trigger calling `AdminLinkProviderForUser`, linking the incoming federated identity to the existing local user **before** Cognito mints a duplicate profile.
- [ ] **Link only when the IdP asserts `email_verified: true`, read explicitly in the trigger.** AWS's own warning: use it only with IdPs and attributes you trust. Linking an unverified address hands the account to anyone who can claim it. Google does assert the claim — the trigger still reads it, because the day a second provider is added is the day an assumption becomes a takeover.
- [ ] Direction is fixed: **local user is the destination, federated identity is the source.** The account that owns the portfolio must not be the one that disappears when an external provider is removed.
- [ ] Ceiling to respect: five federated identities per user.

**Free-tier monitoring (D37).**

- [ ] Confirm the **root account email** is monitored — AWS Free Tier usage alerts fire at 85% of the limit automatically, and they go there (Billing → Preferences → Alert preferences). Zero code; the only work is making sure someone reads it.
- [ ] Add an **AWS Budgets usage budget at 100% of the Cognito free tier**. This is the second of the two budgets that fit in Budgets' own free allowance (60 budget-days/month); the $5 cost budget is the first. A third costs $0.02/day.
- [ ] Emit `DescribeUserPool.EstimatedNumberOfUsers` from the **01:00 capture** — no second schedule, because "exactly one automation" is a pinned ruling — as a log line, turned into a metric by a **metric filter** (free; only 10 custom metrics are). Total users is a strict upper bound on MAU, so it fires early and never late.
- [ ] Alarm at **8,000 users (80%)**, deliberately ahead of the 85% billing alert — a guard that fires with the bill is not a guard. `TreatMissingData: notBreaching`, unlike the capture-silence alarm: a missing count means the emitter stopped, which the existing liveness alarm already catches.
- [ ] Dashboard: user count beside `SignUpSuccesses`. Neither is MAU — say so on the chart. `SignUpSuccesses` is the one that shows the risk open registration actually adds, a signup spike.
- [ ] Role change to make consciously: the capture role gains `cognito-idp:DescribeUserPool` and nothing else. That reads **pool configuration, not users** — no attribute, list or user datum becomes reachable, so the boundary that makes suggest-only a permission rather than a convention holds.
- **Value derivation (D33):** there is no past-date prefill, because there is nothing to prefill — `value(a, D) = units(a, D) × coalesce(user_price(a, D), archive(a, D))`, computed at read time. **The migration must carry the existing <!--f:seed.snapshots-->174<!--/f--> snapshots into a per-user `user_price` overlay**; discarding them deletes five months of history no source can regenerate.
- **Seed (D34):** rewritten to reconcile under the ledger model — withdrawal rows and `tax` rows carrying `settles_payout_id` — **and D34's promise that every D5-pinned figure and every `navigation-map.md` checkpoint stays valid is CORRECTED by D133 (2026-09-02): the figures MAY move, and the checkpoints are re-derived from the new seed rather than defended**. **198** `it()` blocks across 12 files ride on it (measured 2026-08-26). **The figure moves, so re-measure rather than cite it:** D34 and `PLAN-OPEN.md` O13 still record 97, and 97 was already wrong when written — measured at `5f5499c`, the commit that wrote it, the 12 seed-importing files held **147** `it()` of 506 in the suite. So the 101-block gap splits almost exactly in half: **50 blocks of undercount, 51 of suite growth.** (My count method reads 506 in the suite at that commit where D34 recorded 508 — the 147 is what matters here, and the two-block difference in the total is not reconciled.) D34 is not rewritten (decisions are superseded, never edited); this is the pointer.

Remaining scope: user schema in DSQL, API Gateway + API Lambda, `repository.ts` rewritten as an HTTP client, test repair, cutover. **The PWA shell is out (D92)** — cross-browser beats offline by owner ruling, the spec had already renounced offline ("installable shell, network-required, no offline"), and a service worker bought for an offline that was given up is all cost; a bare-manifest install can return later as its own item — filed as `PLAN-OPEN.md` O29. Front-loaded accepted costs: **OCC retry handling** (`If-Match` becomes `UPDATE … WHERE version = $2` + rowcount, mutations retry on SQLSTATE 40001) and **no local emulator** (local Postgres for the inner loop with the schema kept inside the DSQL subset, real DSQL in CI).

**`PLAN-OPEN.md` Round 1 is closed** (D30, D32), so the DDL is no longer blocked on a decision. The `basis` vocabulary, the `instrument_ref` scheme and the FX placement are pinned; what remains gated is only the observation row's non-key columns, which are an `ALTER TABLE` away and therefore not a blocker for the user schema. **Narrowed 2026-08-28 (D100), and by less than that entry's first draft claimed.** Measured on the live cluster: it holds for a plain nullable column, for a `CHECK` added `ALTER TABLE … ADD CONSTRAINT … NOT VALID` (enforcing every later write, never validating the rows already there), and for a `DEFAULT` set later, which applies to rows inserted after it. It does **not** hold for `NOT NULL`, for a type change, or for anything touching the primary key. So what O5 must not assume deferrable is a non-null column or a different type — a default is fine.

**One consequence to carry into the build (D32, sharpened by D38):** threat protection lives in Cognito's **Plus** tier, which has no free tier, and WAF is $15/mo and on the standing "no" list below. The approval gate keeps unapproved sign-ups away from data, but it does **not** keep them off the MAU meter — sign-up itself marks a user active. So the sign-up endpoint is defended by Cognito's built-in request quotas and email verification alone, and D37's `SignUpSuccesses` chart is the thing that would show abuse. If it appears, the honest fallbacks are to gate sign-up in the pre-sign-up trigger (which makes applications impossible to submit) or to start paying — there is no third one.

Retires D2 (IndexedDB), D16/G4 (demo+live split) and the dataset guards. `navigation-map.md` needs a full re-baseline in the same phase; **198** `it()` blocks across 12 files depend on the seed helpers (measured 2026-08-26 — see the Seed bullet above for why D34 still reads 97).

## W8 — Super-admin control surface — **after W7**

**THE DEMO PORTFOLIO IS OWNED, AND ONLY THE SUPER-ADMIN OWNS IT** (owner,
2026-09-01). The seeded demo lives in the database as ONE original. The
super-admin edits that original — it is the reference portfolio every screenshot,
every pinned figure and every walk-through in `navigation-map.md` is measured
against, so it must not drift under anyone else's hands.

**An ordinary user may play with it, and their changes never reach it.** They get
a working copy scoped to the DEVICE — or to the session, if that turns out
simpler, and the choice is deliberately left open here because it is the whole
implementation question. What matters is the guarantee, not the storage: two
users on the demo see the same starting portfolio, neither can move the other's,
and neither can move the original.

**Why it belongs to this phase and not to `feat/dataset-split`.** Today's demo /
live switch (G4) is a choice between two LOCAL databases — there is no server, no
account and so no notion of "whose". The moment [`W7`](#w7--b3-migration)
gives every row a `user_id` and the app an authenticated identity, "the demo" has
to answer a question it has never faced: is it a row set with an owner, or a
fixture the client materialises? This ruling answers it — **owned, with
copy-on-play** — and W8 is where the control to edit the original lands, beside
the other things only the super-admin may touch.

**Three things to settle when it is built,** none of them decided here:
the scope (device vs session) and how a reset back to the original is offered ·
whether a play copy survives a sign-out on the same device · whether the copy
lives in the same store as `live` or beside it, since `exportAll` reads "the DB
bound to the active dataset" and a backup of a play copy must not claim to be
the demo.

Deferred until the app can read the archive. The data is already being recorded, so nothing is lost by waiting.

Controls, in the spec's rough priority: enable/disable a source without a deploy · re-run one date (`{asOf}`) to repair a bad capture · run a backfill range · view the last N runs with their errors · view which tracked refs were missing from a published file.

**The settings/code boundary is decided (D35):** those toggles are runtime settings; parser version, field mappings and the tolerant-parse rules stay code. The line is whether a wrong value can break capture with no deploy to blame it on — an operator toggling a source is recoverable, an operator editing a field mapping is a silent data defect.

The four states that must stay distinguishable, because conflating them is how a broken pipeline looks healthy: **captured** (`ok=true`) · **not published** (`404`, `not_published` — no alarm, it is a weekend) · **parse failure** (error set, payload still stored — alarm) · **never ran** (no row at all — the silence alarm).

