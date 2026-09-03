# Plan C — the questions still open

> Bodies of the open questions. Status table and rules: [`PLAN-OPEN.md`](PLAN-OPEN.md). **Never implement from this file** — an answer becomes a decision entry first, then a task in Plan A or Plan B.

Moved verbatim from `PLAN-OPEN.md` on 2026-08-26 as `O05-O29.md`; renamed by section, 2026-08-27 (D98).

# Still open

## O29 — installability without a service worker — open, 2026-08-25

D92 removed the PWA shell (vite-plugin-pwa and its service worker) from W7.
What it did NOT decide is whether the app wants to be installable at all: a
bare web-app manifest gives install / add-to-home-screen in today's Chrome
(the service-worker requirement was dropped) and in Safari (which never had
one), at the cost of a JSON file and icons. Nothing blocks it and nothing
dates it — filed so the option survives somewhere other than D92's closing
paragraph.

## O5 (part) — the archive row's non-key columns — **W3 read; a decision, not a wait**

**The key is settled** (D30) and that was the irreversible half: `basis` in the natural key, `observed_at` separate from `as_of`, `source` + `parser_version`, `returnRates.{buy,sell}`, `status`, `as_of = capture_date − 1`, corrections in a separate append-only overlay, `observation_kind` never stored.

What is still open is which **non-key** columns the Inzhur observation row carries. Three more weeks of captures were expected to change the answer on four counts — weekend and holiday behaviour, yield stability, fund NAV cadence, and the shape of an outage — and **that wait is over: the window was read on 2026-08-31, THREE of the four answered and the fourth declared unanswerable.** and the working is in [`../../infra/docs/w3-window.md`](../../infra/docs/w3-window.md): weekends split by instrument class, the holiday question is moot under martial law ([`../decisions/D111.md`](../decisions/D111.md)), `returnRates.buy` is the moving half and one bond's two-sided quote collapsed permanently, and the outage shape is the one thing a healthy window could not show. **What remains is a decision, not a wait** — write-every-day against write-on-change for the Inzhur observer. Adding a non-key column later is an `ALTER TABLE`, so nothing here is irreversible — which is why waiting was free while it lasted, and why nothing now argues for waiting further. **Narrowed 2026-08-28 (D100), and it matters for what this question may answer:** on DSQL a plain nullable column can be added; a `CHECK` on it can be added later as `NOT VALID`, enforcing every later write and never validating the rows already there; and a `DEFAULT` can be set later, applying to rows inserted after it. What CANNOT be added afterwards is `NOT NULL` or a change of type. So waiting stays free, unless the answer wants one of those two, which are create-time choices. (D100's first draft also listed `DEFAULT` — one spelling probed; corrected the same day.)

**Gate:** ~~`PLAN-WAITING.md` W3, from 2026-09-02~~ — **W3 read 2026-08-31; this is no longer gated on elapsed time.** **Who rules it: W4**, which left the dated table on 2026-09-02 and is now `PLAN-NOW.md`'s **Section Q**, that file's first row — its status cell makes this question its first act. This part of O5 is therefore no longer *open by design* — the FACTS moved when the window was read on 2026-08-31, the CLASSIFICATION moved on 2026-09-02, and the Status table's disposition sentence carries both dates, why they are kept apart ([`../decisions/D130.md`](../decisions/D130.md) deferred this act and would be false at its own date if it were backdated), and why it needed no decision.

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
| D101 — W7 ships no foreign keys | **No task**, and the row is here only so the trail does not stop: the ruling is an absence, and what it produced is a widened question rather than work. The measurements behind it are written up in `infra/docs/dsql-alter-limits.md` | — (the question moved to `PLAN-OPEN.md` O33) |
| D102 — the decision index sheds its rules | `docs/decisions/RULES.md` created; the length cap counts authored lines; D99's two-command rule reverted in all three instruction sites | — (shipped in the ruling itself) |
| D134 — «Код» widens to 4, derived from the ISIN | **No plan row, deliberately** (D105): issue [#12](https://github.com/RomanKushyk/investment-tracker/issues/12) takes the default path — its own branch, `Closes #12`. Issue [#13](https://github.com/RomanKushyk/investment-tracker/issues/13) is un-parked rather than answered, and left unscheduled | — (the body moved to [`../archive/plan-c/O27.md`](../archive/plan-c/O27.md)) |
| D135 — the observe window bounds the statement | **A55**, and a new Section R to hold it — `windowEnd = min(to, from + CAP)` at CAP 1 000 days, `complete`/`nextFrom` re-derived from both bounds, the identical change in `observeInzhur` | `PLAN-NOW.md` A55 ([`section-r.md`](section-r.md)) |
| D136 — the derivation moves to the server | **No task here, and the absence is deliberate**: the work is W7's own, which lives in `PLAN-WAITING.md`. What the ruling produced is a superseded pinned row, three of A53 §1's rows re-pointed, A5/G5 retired, and an amendment `CLAUDE.md`'s eight-shared-files rule owes | [`../superpowers/specs/2026-09-03-w7-read-surface-design.md`](../superpowers/specs/2026-09-03-w7-read-surface-design.md) |

