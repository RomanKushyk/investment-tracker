# Plan B — Waiting, with dates

> **For agentic workers:** nothing here is startable on demand — each item waits on elapsed time, an external event, or another phase. **Check the dated table first every session.** An item whose date has passed moves to `PLAN-NOW.md` or is executed here directly; an item whose date is near needs preparation, not waiting.
>
> **Companion plans:** `PLAN-NOW.md` (startable today) · `PLAN-OPEN.md` (undecided). Parent: `NEXT-PHASE-PLAN.md`.

Written 2026-08-11. Dates are Europe/Kyiv. "Earliest" is when the gate *opens*, not when work must start. "Hard" is a date that cannot be moved — miss it and the cost column says what it costs.

## The dated table

| # | Item | Gate | Earliest | Hard? | Cost of missing |
|---|------|------|----------|-------|-----------------|
| W1 | ~~Frozen-feed detector on real data~~ | — | **done 2026-08-18** | — | reading was 1 on all five business days; see `infra/README.md` |
| W2 | ~~DPU measured over a real week~~ | — | **done 2026-08-17** | — | ~1,620 DPU/month — 5× the ~325 projection, **1.6% of DSQL's 100,000 always-free DPU tier**, so the *size* settles nothing. It corrected two figures in D64 (**D90**) and found the number worth knowing before acting: **creating a cluster cost 34,956 DPU in one day**, a third of a month's allowance. **Its headline is now obsolete — re-measured 2026-08-25 (D91), the cost is ~173 DPU/month = 0.17%** at today's archive size, because A20 retired the query that dominated it — an aliased `ORDER BY` was disabling the index (D91). Not comparable to the ~325 year-1 projection, which models a much larger archive. Full working in `infra/README.md` |
| W3 | Inzhur observation window closes | ~3 weeks of captures from **2026-08-11** (restarted by the stack move) | **2026-09-02** | no | schema decided on thin evidence |
| W4 | Inzhur observation schema | W3 + `PLAN-NOW.md` A4 | **2026-09-02** | no | blocks B3 migration |
| W5 | **cum/ex boundary on UA4000238976** | the coupon itself | **2026-09-24** | **yes** | **182 days** — next chance 2027-03-24 |
| W6 | DPU over a real month — **and `BytesRead` against `ClusterStorageSize`** | 30 days of captures | **2026-09-10** | no | **low, but not none.** The scan question is answered (**D91**, not W6). What is lost by skipping W6 is the standing re-read of `BytesRead` / `ClusterStorageSize` — the ratio that exposed a scan three code reviews missed — and confirmation of ~173 DPU/month over a full month rather than seven days |
| W7 | B3 migration: auth, user schema, HTTP client | W4 + durability gate passed | **2026-09-02** | no | everything downstream — **it owns the dev/prod database split, USER data only (D63)**, and **it is the gate on resubmitting SES production access**: the request describes a sign-up-then-approve flow that will not exist until this lands (A11 audit, 2026-08-14) |
| W8 | Super-admin control surface | W7 | after W7 | no | parse control stays code-only |
| W9 | First year sealed in the archive | the 01:00 run on 1 Jan writes 31 Dec | **2027-01-01** | no | a year cached wrong is cached forever |
| W10 | UA4000238976 matures | the bond | **2027-03-24** | **yes** | first production exercise of the `sold` term |
| W11 | AWS credits expire | — | **2027-07-29** | **yes** | $119.99 unused |
| W12 | UA4000236475 matures | the bond | **2028-09-27** | **yes** | second redemption |
| W13 | Phase 6: chart analytics | W7 — deferred by judgment, not blocked | after W7 | no | doing it twice |
| W14 | Phase 7: DB browser | W7 — by construction | after W7 | no | building it twice |
| W15 | Import the provider's fund NAV history | W4 (it lands in `price_observation`, whose Inzhur key W4 decides) | **after 2026-09-02** | no | none — read up in `docs/reference/INZHUR-FUND-HISTORY.md`, and **D83 now allows fetching the files rather than holding them by hand** |
| W16 | User profile page and its settings | W7 — there is no user to have a profile until auth lands | **after W7** | no | none — the page has nothing to show today |
| W17 | How a hand-entered value is MARKED as the user's (D75) | W7 — the mark only exists once `coalesce(user_price, archive)` does | **after W7** | no | none today — nothing is coalesced yet |

---

## Where the detail is

**Split 2026-08-26 (D95)** — this file is the dated table and the rules; the
item bodies are in the range files below, and W1 closed to
[`../archive/plan-b/`](../archive/plan-b/README.md).

| File | Holds |
|---|---|
| [`W02-W08.md`](W02-W08.md) | Phase W-I's remainder (W2/W6), W5, W3/W4, W7, W8 |
| [`W09-W17.md`](W09-W17.md) | W9, W10/W12, W11, W13, W14, W15, W16, W17 |

Item numbers never change — they are cited from the other plans, from
`../decisions/` and from `infra/README.md` by bare number. Splitting moves
bodies verbatim; no file goes over 200 lines.

## Standing "no" list (relevant whenever any phase here provisions something)

At a $0.02 baseline only a fixed charge moves the bill: NAT Gateway **$33.58/mo** · Aurora Serverless v2 at 0.5 ACU ~$51/mo · Amplify **WAF $15/mo** (one console toggle, the likeliest accident) · public IPv4 **$3.65/mo even idle** · Lambda provisioned concurrency ~$2.29/mo *and it voids Lambda's free tier* · customer-managed KMS key $1–3/mo · Route 53 zone $0.50/mo · Secrets Manager $0.40/mo.

## Review cadence

Re-read the dated table at the start of any session that touches `infra/` or the migration. Move an item to `PLAN-NOW.md` the day its gate opens; do not let a passed date sit here unexecuted, because a plan whose dates are stale stops being read.

