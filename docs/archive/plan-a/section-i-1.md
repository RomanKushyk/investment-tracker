# Section I — the 2026-08-18 brainstorm (1 of 2)

> Closed Plan A work, moved **verbatim** from `../../plans/PLAN-NOW.md` on 2026-08-26. Holds A24, A25, A26. Index: [`README.md`](README.md). **Not a task list — nothing here is executed.**

# Section I — From the 2026-08-18 brainstorm

The owner asked how `/overview`, `/yield` and `/seasonality` could be improved
and what they might make editable. **The answer to the second half turned out to
be "nothing":** every candidate for editing was declined in favour of deriving,
so the A22 brief's rule — a page is editable where it shows STORED data — holds
for all three, now as a tested conclusion rather than an assumption.

Eight items came out of it, sequenced by dependency rather than taste, and the
owner approved the sequence:

**A24 (done) → A26's brief (period selection, and the content it adds) →
A25 → the readability work, last.**

**Why readability is last and that is not procrastination.** Period selection
adds a control to `/yield`, sparkline-style comparison to `/overview` and a
second axis to `/seasonality`. Designing the hierarchy of `/yield`'s eight
columns and then adding a ninth element is drawing the same screen twice.

## A24 — The portfolio start derives from the data — **DONE 2026-08-18** — `feat/derive-portfolio-start`

**What was wrong.** `core/derive.ts` carried
`export const PORTFOLIO_START = '2026-02-03'` — a literal that every annualized
figure divides by. True of the demo seed, false of every other dataset, and
therefore wrong on `/yield`'s whole annualized column, `/overview`'s
"+3,08 % since 03.02" and `/attributes`' days-held for anyone whose portfolio
did not start on that Tuesday. `src/README.md` already said no portfolio figure
may be hard-coded; **a date that divides all the other figures is one.**

- [x] `portfolioStart(assets, snapshots, transactions)` — the **earliest of
      three signals**, not any single one. The value answers "on what day is
      there evidence this portfolio existed", and a transaction, a snapshot or
      an asset's `firstPurchase` each carry that evidence independently.
- [x] **The direction is the argument.** A start that lands too LATE divides a
      long return by a short span and prints a rate nobody earned; too early
      only understates. The case that decides it: an asset carrying
      `firstPurchase: '2020-01-01'` added without back-filling the ledger —
      believing the transactions alone turns six years into six months.
- [x] `undefined` on an empty dataset; both consumers keep the existing
      zero-basis branch, and the two copy sites drop rather than render a date
      nothing supports.
- [x] `xirrIsExtrapolated` takes all three tables now, matching
      `yieldTableRows` — asking it for snapshots alone would answer a different
      question than the header asks.

**Verified.** 651 tests (+7), lint and typecheck green. Browser, demo dataset:
`/yield` reproduces every pinned figure (REIT +4,41 % / +9,3 % / −4,7 в.п.;
…6475 +5,20 % / +10,9 %), the footnote still reads 03.02.2026, `/overview` still
reads "+3,08 % від 03.02", `/attributes` unchanged. Browser, **empty live
dataset**: no footnote, no sub-line, and no `NaN`/`Infinity`/"від —" anywhere —
which is a visible improvement on the empty state, not merely a non-regression.

**Two things worth recording.**

**The seed made the choice of rule risk-free, and that is checkable rather than
lucky.** Its earliest transaction, earliest snapshot and earliest
`firstPurchase` are all `2026-02-03`, so no D5-pinned figure could move under
any of the three candidate rules. `lib/seed.test.ts` now asserts exactly that,
in two tests.

**The seed assertion could not live in `core/derive.test.ts`, and the linter was
right to say so.** `src/core` may not import `src/lib` (G1). The claim is about
the SEED's rows, not about core, so it belongs in `lib/seed.test.ts` — and core's
own tests keep inline fixtures. The old
`expect(PORTFOLIO_START).toBe('2026-02-03')` was a literal asserting a literal;
what replaces it asserts a derivation, in the file allowed to see both halves.

**Out of scope, filed as `PLAN-OPEN.md` O23 and since CLOSED by D85,
which keeps one shared span:** both consumers still apply ONE
span to every asset, so a bond bought in June is annualized over the portfolio's
174 days rather than its own 55. Pinned by D5#5 as a deliberate v1
simplification; changing it moves pinned figures and needs a decision.

## A25 — Portfolio-level XIRR — **DONE 2026-08-18** — `feat/portfolio-xirr`

`core/xirr.ts` already solved the money-weighted rate per asset; there was no
portfolio-level one anywhere — `/overview`'s "Total return (net)" is a different
measure (unannualized, and against net deposits).

- [x] `portfolioXirr(txs, terminalValue, terminalDate)` in `core/derive.ts`.
      `xirr.ts` stays generic math with no domain types; the domain-shaped
      companion belongs beside `netDeposits`, which already draws the same line.
- [x] Pure logic, unit-tested against the seed's real flows.

**THE BOUNDARY IS EXTERNAL CAPITAL, and that is the whole design.** `deposit`
and `withdrawal` are the only rows that cross the portfolio's edge — the line
`netDeposits` already draws, citing doc §5.1. Buys, sells, reinvests, payouts
and taxes move money WITHIN it, between the cash pot and the assets or between
assets, and whatever they did is already inside `terminalValue`. Feeding them in
as flows would count them twice.

**It is the exact mirror of the per-asset XIRR** in `screens/yield/yield.ts`,
which takes the buys, sells and payouts and SKIPS deposits and withdrawals —
because at an asset's boundary those are the internal ones. Neither is more
correct; they answer about different boundaries, and the two comments now say so
to each other.

**Verified — and the pinned figure is not left hanging on its own.** The seed
gives **+8.93 %**, and the test proves it means something rather than just
reproducing itself: `globalRoi` is **+4.08 %** over a **174**-day span, which
stretched linearly reads **+8.56 %**. The XIRR must come out ABOVE that (it
compounds where the stretch is linear, and it weights the February money — which
had the whole span — over the June deposit that had eight weeks) and within a
percentage point of it (same measurement, different weighting). A portfolio XIRR
that ever fell BELOW the linear stretch on a purely-growing seed would mean the
flows are being signed or dated wrong, and that is what the assertion catches.
A third test drops the seed's 15 internal rows and asserts the rate is
byte-identical — the boundary claim, on real data rather than in a fixture.

**Not browser-verified, because there is nothing to see:** the figure is
computed and tested but rendered nowhere. Where it belongs on screen is a design
question and stays with A26's brief (G7). Tested, not dead — `core/derive.ts`
says so at the function.

**659 tests (+8)**, lint and typecheck green.

## A26 — Design brief: period selection and the three screens — `docs/design-brief-phase-8`

**Phase 8, deliberately not folded into the Phase 7 brief** — that one is written
and not yet drawn, and handing a design session two unrelated jobs in one file
is how both get done badly.

- [ ] **Period selection is a cross-cutting concept, not a filter on one
      screen.** Where the selected window lives, whether it persists, and what
      each chart and table does with it. Today everything is "since start":
      `/yield`'s annualized column and its four-line chart are both locked to
      one window, with no YTD, no 12m, no custom range.
- [ ] **`/overview` has no time dimension at all** — five KPIs and four cards,
      all "now". "Versus last period" is the same concept applied to KPIs, so it
      belongs in this brief rather than a separate one.
- [x] **`/seasonality` knows only day-of-month** (31 buckets). A month-of-year
      axis is the more useful cut for a portfolio holding semiannual bonds, and
      the data is already there. Independent of the period window — it is a
      grouping axis, not a filter — but it lands on the same screen.
      **Done — A41 the axis, A42 the window (both 2026-08-24). The independence
      claim is true OF THE AXIS and was misread as covering the screen:** a
      grouping axis is indeed not a filter, but the merged sheet windows the
      bars it groups (`period-and-analytics.dc.html:1477`, FLOW). A41 built the
      axis; A42 wired the window and ruled on the insight cards (D81).
- [x] **Readability, last:** brief § S6, written now so the session sees the
      whole shape but drawn after S1–S5 settle. Each of the three carries the
      constraint that stops it being solved destructively — no `/yield` column
      may be deleted without a decision (they were each added deliberately in
      P2), the five-KPI grid's proportions are D5-pinned, and `/seasonality`'s
      words stay in the dictionary with token-based assembly (D8/Contract 0).

**What writing it turned up, and the first item reframes the whole phase.**

**NOTHING in `core/derive.ts` is date-bounded.** Every function takes the whole
array and answers since-inception: `latestQuotes` merges ALL snapshots,
`investedByAsset` and `netDeposits` sum ALL transactions. So a period is **not a
control over existing functions** — it is a windowing layer that does not exist.
The only time-walking code in the app is `cumulativeYieldSeries`, which filters
`t.date <= s.date` inline inside one screen's glue; that is the pattern to lift
into `core/`, not to copy a second time. **That half is pure logic and is not
design-blocked** — it can be built before the extension merges.

**A period means three different things, and this is the spine of the brief.** A
FLOW (income, payouts, deposits) sums over the window; a STOCK (total capital,
free cash, share) is a level at the window's END and does not change with its
length; a RETURN (Δ, annualized, XIRR) needs BOTH ends, with the opening value as
a synthetic flow. A KPI grid mixing all three under one unmarked period control
is the failure mode, and `/overview` is exactly such a grid. It also means
**`portfolioXirr` under a window is a different formula from the one A25
shipped** — the brief says so rather than letting it be discovered.

**`/seasonality`'s expected series breaks on a month axis, and it would have been
inherited silently.** `expectedByDayOfMonth` takes ONE projected coupon per asset
from `couponProjection`. On a day axis that is one bar; on a MONTH axis a
semiannual bond shows a single expected bar and nothing in its other coupon
month, reading as "this bond pays once a year". Either the projection is extended
across the schedule or the series is absent on that axis — pinned as a state, not
left as a bug.

**The case for the month axis is in the seed, and it is verified arithmetic, not
an argument.** February's income is **1 763,70** against March's **595,80** —
three times — because a bond coupon landed there. The day axis puts that coupon's
1 183,50 in bucket 25 and the fund's 580,20 in bucket 10, where they read as two
ordinary days. **The bond coupons are exactly what a seasonality screen exists to
reveal, and exactly what the current axis hides.** All six monthly and three
daily figures in the brief were recomputed from `lib/seed.ts` before it shipped.

**Four things are deliberately left to the design session** rather than guessed:
where the period control lives (header slot or sidebar, both with precedent and
both with a real cost), whether `/overview` gets sparklines, which seasonality
axis opens by default, and which of three homes the portfolio XIRR takes. Custom
date ranges are ruled OUT of scope — a range picker is a surface of its own and
would supersede S1 rather than extend it.

