# Plan A — Section P

> Bodies of Section P's Plan A tasks that are **not closed**. Index and status table: [`PLAN-NOW.md`](PLAN-NOW.md). Closed Section P tasks are in [`../archive/plan-a/`](../archive/plan-a/README.md).

Created 2026-08-26 by splitting `A41-A60.md`, which Section P pushed past the 200-line cap, as `A51-A60.md`; renamed by section, 2026-08-27 (D98). Bodies moved verbatim; A46 and Section M stayed behind in [`section-m.md`](section-m.md).

# Section P — W7 preparation, startable ahead of the gate

> **A53 closed 2026-09-02** and moved verbatim to
> [`../archive/plan-a/section-p.md`](../archive/plan-a/section-p.md); its
> deliverable is [`../reference/W7-API-CONTRACT.md`](../reference/W7-API-CONTRACT.md).

The 2026-08-25 research (its record: **D92**; the questions it left:
`PLAN-OPEN.md` O28/O29 — D93/D94 are that day's width-cap rulings and belong to
no phase here) mapped what the B3 migration needs that nothing gates: the
user-schema DDL is unblocked (Round 1 closed — D30/D32), the seed rewrite waits
on no observation window, the API contract can be written on paper, and one
Cognito assumption can be tested where a mistake costs nothing. W7's own gate
(W4) is untouched — these tasks sharpen W7, they do not start it. **The
2026-09-02 this sentence used to give as W4's date was never W4's own**; W4's
row is now `PLAN-NOW.md`'s Section Q, above this one, and `PLAN-WAITING.md`'s
kept W4 row is where that date is accounted for.

**Letter P, not N.** Plan A has spent A–O; the archive's Section N is the
owner's idea list of 2026-08-24. Section letters are cited, so a letter is
never reused under a new title.

## A52 — Withdrawn from Section P: the seed rewrite cannot come before W7

**Not startable, and the reason is the deliverable.** A52 was written to pull
D34's seed rewrite in front of W7. It cannot be pulled: the constraint it would
have to satisfy has no solution while `derive.ts` still carries the exclusion
rules the ledger model removes. Measured 2026-08-26, during the review of this
section:

- `freeCashFromLedger` (`derive.ts:628`) subtracts `withdrawal`, `xirrGlobal`
  puts withdrawals into the flow set (`:558`), and `payoutsNet` (`:430`) is
  gross − `tax`. The seed has 18 rows, zero `withdrawal` and zero `tax`.
- So a new row must be net-zero under today's formulas — but **the row COUNT is
  itself a pinned checkpoint.** `navigation-map.md` checkpoint 7 pins the
  dataset as `4/174/18` and the import preview as `Added +4 / +174 / +18`; D10
  and D24 pin `4 assets / 174 snapshots / 18 transactions`. Any added row moves
  it, whatever the amount.
- And the compensating deposit that would keep free cash at 7,75 is also
  forbidden: the same checkpoint pins **`Deposited 143 176 ₴`**, and D5 derives
  that KPI from the `deposit` rows themselves (143 176,37 = own-funded buys
  143 168,62 + cash 7,75). Deposits cannot rise to offset a withdrawal.

Three pinned quantities, no free variable. D34's invariant — "every D5-pinned
figure and every `navigation-map.md` checkpoint stays valid" — is a property of
the **post-migration** model, where the sum reconciles by construction with no
exclusion rules. Before that, it is unsatisfiable.

**Where the work goes:** back to W7, whose scope already lists it
(`phase-w-i-ii-iii.md`, the Seed bullet). The seed rewrite and the `derive.ts` change
land together or neither lands.

**What W7 needs answered first — `PLAN-OPEN.md` O31.** Moving `4/174/18` means
superseding part of D10 and D24, which are decisions: this repo supersedes them
with a new entry, never edits them. Nobody has ruled on that, so it is a
question, not a task.

**Two facts the original A52 had wrong, kept here so W7 does not inherit them:**

- **The backup envelope is NOT simply additive.** `transactionRowSchema`
  (`core/backup/json.ts:65`) is `z.strictObject` and declares **no** optional
  fields, so `settles_payout_id` was never pre-declared. The comment at `:25`
  describes the mechanism — "optional fields the plan adds later are accepted
  already, so formatVersion stays 1" — and this field is not one of them. Add
  it to the schema as optional in the same commit that exports it, or a build
  predating the change rejects the row on an unknown key while
  `readEnvelopeHead` still calls formatVersion 1 supported: per-row errors
  instead of the honest unsupported-version message.
- **The CSV is export-only — there is no round trip.** `core/backup/csv.ts`
  exports three serializers and nothing parses them back (`import.ts` reads the
  JSON envelope only). The real exposure is an external spreadsheet keyed to a
  six-column header, not an internal contract.

## A54 — Cognito rehearsal on a throwaway pool — `infra/cognito-pool-rehearsal`

**Scope corrected 2026-08-26.** Only `usernameAttributes` is immutable (D36).
Essentials tier is switchable; access/ID/refresh validity is an app-client
setting that comes from D32 and that D36 never mentions. So the rehearsal is
worth one question, not four — three of them cost nothing to get wrong later.

- [ ] Create a throwaway pool as D36 pins: `usernameAttributes: ['email']`
      (never `aliasAttributes`), Essentials tier, refresh token in years,
      access/ID at 60 minutes. Record the verbatim `CreateUserPool` call in
      `docs/reference/COGNITO-POOL-PARAMS.md`, marking which parameter is
      immutable and which is merely chosen.
- [ ] **Test what D36 asserts and nothing has tried:** under
      `usernameAttributes: ['email']` a second sign-up on an existing address
      **fails** rather than succeeding quietly. This needs a user pool
      **client** as well as the pool — bullet 1 alone cannot call `SignUp`.
- [ ] **The MAU question is out, and why is the deliverable.** "Does a
      trigger-rejected sign-up cost an MAU" cannot be answered here:
      `EstimatedNumberOfUsers` counts users and a rejected sign-up creates
      none, so the reading is 0 → 0 whatever Cognito bills; `phase-w-i-ii-iii.md`
      already records total users as a strict *upper bound* on MAU, not a
      measure of it; and inside 10,000 free MAU no bill can disagree. Filed as
      `PLAN-OPEN.md` O30. Testing the trigger path at all would need a
      pre-sign-up Lambda and its `LambdaConfig`, which this task does not build.
- [ ] **A stated exception to two standing rules:** PLAN-NOW says `infra/`
      deploys through `deploy-backend.yml` only, and the global preference is
      IaC over CLI calls. A pool outside the capture stack, deleted the same
      day, is a deliberate exception. A one-off CFN/SAM stack would need no
      exception at all and makes the delete one command — but it inherits
      A51's hazard: anything under `infra/` merged to `dev` fires
      `deploy-backend.yml` against the live capture stack, so it belongs
      outside `infra/` or behind the same negated path.
- [ ] Delete the pool the same day. The reference file and its one answer are
      the deliverable, not the pool. **Its row joins `docs/README.md`'s
      Reference table in the same commit.**
