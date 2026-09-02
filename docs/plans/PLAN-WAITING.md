# Plan B — Waiting, with dates

> **For agentic workers:** nothing here is startable on demand — each item waits on elapsed time, an external event, or another phase. **Check the dated table first every session.** An item whose date has passed moves to `PLAN-NOW.md` or is executed here directly; an item whose date is near needs preparation, not waiting.
>
> **Companion plans:** `PLAN-NOW.md` (startable today) · `PLAN-OPEN.md` (undecided). Parent: `NEXT-PHASE-PLAN.md`.

Written 2026-08-11. Dates are Europe/Kyiv. "Earliest" is when the gate *opens*, not when work must start. "Hard" is a date that cannot be moved — miss it and the cost column says what it costs.

**Nothing automated watches these dates, and nothing should** (owner's ruling, 2026-08-28, closing the "a reminder is the candidate" line D103 left open; recorded as **D106**). The mechanism is this table's own first rule — *check it first every session* — and the project's measured session cadence carries it — **the figure is in [`../decisions/D106.md`](../decisions/D106.md), which is dated and may hold one; this live index may not.**

**Most gates here OPEN rather than expire**, so arriving late costs waiting, not the item. **The Hard? column names the four that do not: W5, W10, W11 and W12** — read that column, not this paragraph, if the two ever disagree. W5 is automated (below). The other three — W10 and W12's bond maturities and W11's AWS credits — are **all gated in 2027 or later; the table below carries the dates and this paragraph deliberately does not repeat them.** Each will be read at dozens of sessions before it arrives, which is the argument for the table over a watcher rather than against it. **W9 is deliberately `no`** although its cost line says "cached forever" — and it takes the same present/read split as W5. Nobody has to be there: the 01:00 run on 1 Jan writes 31 Dec by itself, so the date is not one a person must hit. But **sealing is a separate, deliberate act**, and W9's first unticked box is *do not seal before verifying completeness for the whole year* — the irreversibility comes from `immutable` plus a strong ETag, not from the capture. Late is fine; sealing unread is not.

**W5 no longer needs anyone PRESENT — it still needs someone to READ, and that distinction is the whole ruling.** The nightly capture measures the cum/ex boundary with nobody watching, so a missed *day* costs nothing and W5 explicitly warns against acting on the day. What is NOT automated is the verdict — **read W5's own unticked boxes in [`phase-w-i-ii-iii.md`](phase-w-i-ii-iii.md), not a count repeated here**, because they get ticked and this paragraph would not. The last of them is the load-bearing one and the easiest to skip: **write the cum/ex convention into DECISIONS**, saying explicitly whether it confirms `futureFlows`' same-day rule or overturns it. The reading feels like the work; the entry is the work. **Cost of missing: 182 days**, and the next boundary is messier (W10 pairs it with maturity). Do not read `UnexplainedQuoteAlarm` as a detector for "the convention is wrong": it fires when a quote cannot be explained by **any** yield the model can produce, so a wrong-but-fittable convention is silent. A watcher was declined because this table is read every session, **not** because W5 needs nothing.

> **Two drafts of the rule above got their own justification wrong** — "every date left is inside four weeks" (the table runs to 2028-09-27) and a miscount of W5's remaining boxes. Both were caught in review before anything merged, and **[`../decisions/D106.md`](../decisions/D106.md) records them** — the dated entry is where a correction belongs, and repeating it here would be a second copy to keep in step. Read it before rewriting this section.

## The dated table

| # | Item | Gate | Earliest | Hard? | Cost of missing |
|---|------|------|----------|-------|-----------------|
| W1 | ~~Frozen-feed detector on real data~~ | — | **done 2026-08-18** | — | reading was 1 on all five business days; see `infra/README.md` |
| W2 | ~~DPU measured over a real week~~ | — | **done 2026-08-17** | — | ~1,620 DPU/month — 5× the ~325 projection, **1.6% of DSQL's 100,000 always-free DPU tier**, so the *size* settles nothing. It corrected two figures in D64 (**D90**) and found the number worth knowing before acting: **creating a cluster cost 34,956 DPU in one day**, a third of a month's allowance. **Its headline is now obsolete — re-measured 2026-08-25 (D91), the cost is ~173 DPU/month = 0.17%** at today's archive size, because A20 retired the query that dominated it — an aliased `ORDER BY` was disabling the index (D91). Not comparable to the ~325 year-1 projection, which models a much larger archive. Full working in `infra/README.md` |
| W3 | ~~Inzhur observation window closes~~ | — | **read 2026-08-31** | — | **five of six questions answered; the outage shape stays open and a healthy 21-day window cannot close it.** 21 consecutive days per source, no gap. Fund NAV never moves into Sunday or Monday; bonds move every calendar day; `returnRates.sell` changed once in 18 transitions (and `returnRates.buy` three times); `payload_sha256` is uninformative for `inzhur` and informative for `nbu_fv` (D28 confirmed). Full working in [`../../infra/docs/w3-window.md`](../../infra/docs/w3-window.md) |
| W4 | Inzhur observation schema | W3 + `PLAN-NOW.md` A4 | **OPEN NOW** (was 2026-09-02) | no | blocks B3 migration. **Both halves of the gate are met**: A4 closed 2026-08-11 (D50) and W3 was read 2026-08-31. The 2026-09-02 in this cell was only ever W3's window-close date and W4 never had one of its own — **move it to `PLAN-NOW.md`** |
| W5 | **cum/ex boundary on UA4000238976** | the coupon itself | **2026-09-24** | **yes** | **182 days** — next chance 2027-03-24 |
| W6 | DPU over a real month — **and `BytesRead` against `ClusterStorageSize`** | 30 days of captures | **2026-09-10** | no | **low, but not none.** The scan question is answered (**D91**, not W6). What is lost by skipping W6 is the standing re-read of `BytesRead` / `ClusterStorageSize` — the ratio that exposed a scan three code reviews missed — and confirmation of ~173 DPU/month over a full month rather than seven days |
| W7 | B3 migration: auth, user schema, HTTP client | W4 + durability gate passed | **2026-09-02** | no | everything downstream — **it owns the dev/prod database split, USER data only (D63)**, and **it is the gate on resubmitting SES production access**: the request describes a sign-up-then-approve flow that will not exist until this lands (A11 audit, 2026-08-14) |
| W8 | Super-admin control surface **+ demo-data ownership** | W7 | after W7 | no | parse control stays code-only; **the demo original is the super-admin's, ordinary users get a device-scoped play copy** (owner, 2026-09-01) |
| W9 | First year sealed in the archive | the 01:00 run on 1 Jan writes 31 Dec | **2027-01-01** | no | a year cached wrong is cached forever |
| W10 | UA4000238976 matures | the bond | **2027-03-24** | **yes** | first production exercise of the `sold` term |
| W11 | AWS credits expire | — | **2027-07-29** | **yes** | $119.99 unused |
| W12 | UA4000236475 matures | the bond | **2028-09-27** | **yes** | second redemption |
| W13 | Phase 6: chart analytics | W7 — deferred by judgment, not blocked | after W7 | no | doing it twice |
| W14 | Phase 7: DB browser | W7 — by construction | after W7 | no | building it twice |
| W15 | Import the provider's fund NAV history | W4 (it lands in `price_observation`, whose Inzhur key W4 decides) | **after W4**, which is now open | no | none — read up in `docs/reference/INZHUR-FUND-HISTORY.md`, and **D83 now allows fetching the files rather than holding them by hand** |
| W16 | User profile page and its settings | W7 — there is no user to have a profile until auth lands | **after W7** | no | none — the page has nothing to show today |
| W17 | How a hand-entered value is MARKED as the user's (D75) | W7 — the mark only exists once `coalesce(user_price, archive)` does | **after W7** | no | none today — nothing is coalesced yet |

---

## Where the detail is

**Split 2026-08-26 (D95), files renamed by section 2026-08-27 (D98)** — this
file is the dated table and the rules; the item bodies are in the section
files below, and W1 closed to
[`../archive/plan-b/`](../archive/plan-b/README.md).

| File | Holds |
|---|---|
| [`phase-w-i-ii-iii.md`](phase-w-i-ii-iii.md) | Phase W-I's remainder (W2/W6), W5, W3/W4, W7, W8 |
| [`phase-w-iv-v.md`](phase-w-iv-v.md) | W9, W10/W12, W11, W13, W14, W15, W16, W17 |

Item numbers never change — they are cited from the other plans, from
`../decisions/` and from `infra/README.md` by bare number. Splitting moves
bodies verbatim; the 200-line cap is a ratchet, not a wall (D95, ratcheted by
D98).

## Standing "no" list (relevant whenever any phase here provisions something)

At a $0.02 baseline only a fixed charge moves the bill: NAT Gateway **$33.58/mo** · Aurora Serverless v2 at 0.5 ACU ~$51/mo · Amplify **WAF $15/mo** (one console toggle, the likeliest accident) · public IPv4 **$3.65/mo even idle** · Lambda provisioned concurrency ~$2.29/mo *and it voids Lambda's free tier* · customer-managed KMS key $1–3/mo · Route 53 zone $0.50/mo · Secrets Manager $0.40/mo.

## Review cadence

Re-read the dated table at the start of any session that touches `infra/` or the migration. Move an item to `PLAN-NOW.md` the day its gate opens; do not let a passed date sit here unexecuted, because a plan whose dates are stale stops being read.

