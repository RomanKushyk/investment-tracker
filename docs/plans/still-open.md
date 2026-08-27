# Plan C — the questions still open

> Bodies of the open questions. Status table and rules: [`PLAN-OPEN.md`](PLAN-OPEN.md). **Never implement from this file** — an answer becomes a decision entry first, then a task in Plan A or Plan B.

Moved verbatim from `PLAN-OPEN.md` on 2026-08-26 as `O05-O29.md`; renamed by section, 2026-08-27 (D98).

# Still open

## O27 — How is one ОВДП told apart from another? — open, 2026-08-24

Raised by the owner while grooming `USER-FEATURES-DRAFT.md`: «Код» could take up
to 4 (or 6) characters, digits as well as letters — **or** an ОВДП could be
marked some other way: by colour, by shape (a square), and by printing only the
last 4 digits of its ISIN. The owner then **parked all of it on this question**,
because widening a field is pointless until it is settled what the field has to
distinguish.

**What is true today, measured 2026-08-24 and CORRECTED 2026-08-25 by this
file's own review — the first draft overstated the constraint.**

- `code` is **editable**. `deriveCode` (`name.trim().slice(0, 2).toUpperCase()`)
  runs only while the field is untouched (`AssetForm.tsx`), so two bonds can be
  given two different codes today. The seed proves the field is hand-set and
  proves the real defect at the same time: both bonds are named
  `OVDP UA400023xxxx` — Latin, so derivation would yield `OV` — and both are
  stored as **`code: 'GB'`**, the same two characters twice.
- So the ceiling is what binds, not the derivation: **1–2 LETTERS**,
  `/^\p{L}{1,2}$/u`, no digits. Two bonds cannot be told apart by anything
  shorter than their names unless a human types two distinct pairs of letters
  and remembers which is which.
- What separates them on screen is the tint, and the tint is handed out by
  ARRIVAL ORDER: `COLOR_KEYS[existingAssetCount % COLOR_KEYS.length]` in
  `core/asset-builder.ts` and `AssetForm.tsx`, plus a THIRD site that cycles on
  a different count — `TransactionPanel.tsx`'s quick-create avatar preview uses
  `assets.length`. It repeats from the 5th asset (`ShareBar`'s comment says so)
  and encodes nothing about the bond. **The `% 4` form quoted in the first draft
  of this section is a COMMENT in `core/colors.ts`, not the code.**
- The last four ISIN digits are already this project's informal name for a bond:
  two of the four palette keys are `ovdp8976` and `ovdp6475`, and O23's evidence
  table above calls them «OVDP …8976» and «OVDP …6475».

**Why an agent must not settle it.** Two of the four candidates cost a decision
rather than an edit, and a third costs a data-sourcing choice nobody has made:

1. **A longer code.** At 4 characters this is free: the avatar is a 34 px circle
   at 12 px, and the mono advance is 0,6em ≈ 7,2 px, so four characters measure
   28,8 and fit. At **6** they measure 43,2 and do not, and widening the circle
   into a pill is the one shape D56 forbids outright. **The first draft priced
   this candidate off the 6 case alone and called it a decision; the 4 case is
   not one.**
2. **A square for bonds.** D56 names asset avatars among the four things that
   stay round, so this is a supersede in writing, not a class change.
3. **A pickable colour** — the draft's own «a colour selector would not be
   excessive». The palette is four keys wired to their own Tailwind tint tokens
   (README §4) and named after assets rather than colours. Renaming them follows
   through the avatar, `Tag`, `ShareBar`, `ColorDot`, three charts, the three
   cycling sites above — **and the STORED half the first draft missed**:
   `colorKey` is a hard `z.enum` in `core/backup/json.ts`, it is a CSV column,
   and every Dexie row already holds one of the four literals. Renaming without
   an alias makes every backup taken before the change fail to import.
4. **The last 4 ISIN digits** — no shape, no palette, and the avatar holds four
   characters as shown above. But **there is no ISIN to read on most assets**:
   `Asset.inzhur` is optional (`core/types.ts`), so a bond added without the
   link carries its ISIN only inside the free-text `name`, and `deriveCode`
   slices the name, never `ref`. This candidate therefore also decides either
   parsing an ISIN out of prose or making the Inzhur link mandatory for bonds —
   plus edits to the three places that pin "2 letters" in writing
   (`core/types.ts`, README §7's asset shape and README §5's avatar line).

**When it is answered** the two parked draft lines leave
`USER-FEATURES-DRAFT.md` for `PLAN-NOW.md`.

## O28 — the server-side derivation boundary — open, 2026-08-25

Raised by the owner while preparing W7, in the same conversation that produced
D92. Two premises moved: **cross-browser now outranks offline** (D92), which
removes the offline-PWA argument for keeping every derivation on the client;
and the capture Lambda already imports `src/core/` modules, so "two derivation
codebases" was never the strong objection — the same tested code can run on
either side.

**What it questions:** the cloud-stack spec's pinned row — `Derivation | 100%
client-side. src/core/ untouched. Server ships raw rows, never aggregates` —
now carries an in-place annotation pointing here. The row is NOT superseded:
it stays binding until a decision at W7 design re-affirms or replaces it.

**The direction the owner stated (not yet a ruling):** the backend should
compute what it reasonably can so the client receives ready data, balanced
against cost — and the balance axis is WHEN it computes, not how much:

- archive-only derivations, identical for all users → server, once per
  capture (already the case: `ytm`, `clean_rate`, return rates in
  `price_observation`);
- user-data derivations independent of view parameters → MAY materialize
  server-side on mutation, versioned, ETag-cacheable;
- view-parameter-dependent derivation (period, currency toggle, date ranges)
  → stays client-side (combinatorics, and the fluid-motion requirement);
- per-request aggregation → admin reads only (W8).

**Why an agent must not settle it:** it rewrites a pinned spec contract and
shapes the W7 API surface (`GET /state` vs materialized reads). Decide at W7
design, with a decision number.

## O29 — installability without a service worker — open, 2026-08-25

D92 removed the PWA shell (vite-plugin-pwa and its service worker) from W7.
What it did NOT decide is whether the app wants to be installable at all: a
bare web-app manifest gives install / add-to-home-screen in today's Chrome
(the service-worker requirement was dropped) and in Safari (which never had
one), at the cost of a JSON file and icons. Nothing blocks it and nothing
dates it — filed so the option survives somewhere other than D92's closing
paragraph.

## O5 (part) — the archive row's non-key columns — gated on W3

**The key is settled** (D30) and that was the irreversible half: `basis` in the natural key, `observed_at` separate from `as_of`, `source` + `parser_version`, `returnRates.{buy,sell}`, `status`, `as_of = capture_date − 1`, corrections in a separate append-only overlay, `observation_kind` never stored.

What is still open is which **non-key** columns the Inzhur observation row carries, and that is the one place where three more weeks of captures genuinely change the answer — weekend and holiday behaviour, yield stability, fund NAV cadence, and the shape of an outage. Adding a non-key column later is an `ALTER TABLE`, so nothing here is irreversible and nothing is lost by waiting.

**Gate:** `PLAN-WAITING.md` W3, from 2026-09-02.

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
| D33 — `user_price` overlay | The migration must carry the <!--f:seed.snapshots-->174<!--/f--> snapshots across, not discard them | `PLAN-WAITING.md` W7 |
| D34 — seed rewritten to reconcile | Withdrawal and `tax` rows with `settles_payout_id` added to the seed | `PLAN-WAITING.md` W7 |
| D35 — parse-control boundary | The super-admin surface knows which controls are settings | `PLAN-WAITING.md` W8 |
| D36 — one account per email | `usernameAttributes` pinned before `CreateUserPool`; linking trigger with the `email_verified` condition | `PLAN-WAITING.md` W7 |
| D37 — no MAU metric exists | Three instruments instead of one: Free Tier alerts, a usage budget, and `EstimatedNumberOfUsers` on the 01:00 capture | `PLAN-WAITING.md` W7 |
| D38 — approval gate | `app_user` status checked by the API on every request, because token-time checks cannot revoke | `PLAN-WAITING.md` W7 |
| D39 — applications never reach Cognito | The application endpoint, its four free defences, and passkey-first onboarding | `PLAN-WAITING.md` W7 |
| D39 — SES replaces the default mail | Production access requested early so it is off the migration's critical path | `PLAN-NOW.md` A11 |
| D40 — `quirenote.com` acquired | A11 unblocked; DKIM/SPF/DMARC records specified, DNS kept off Route 53 | `PLAN-NOW.md` A11 |
| D41 — product renamed, machines not | Shipped in the same commit; no follow-up work | — |

