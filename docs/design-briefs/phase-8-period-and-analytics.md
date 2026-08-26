# Phase 8 brief — the period, and the three screens that need it

**Written 2026-08-19.** Input to a separate Claude design session, which produces
`design/extensions/period-and-analytics.dc.html`. Until that extension merges,
**no Phase 8 UI task may start** — G7. Pure-logic tasks are never design-blocked.

Template and pipeline: `../archive/design-briefs/README.md`. Every surface
section below carries all seven required parts.

Source: the 2026-08-18 brainstorm on `/overview`, `/yield` and `/seasonality`,
groomed as **A26** (`../archive/plan-a/section-i-1.md`, Section I — it left `PLAN-NOW.md` in D95).

Shape is governed by **D56** throughout; the two shells and the 768 breakpoint by
**D66**; scrolling by **D65**. This brief adds no exception to any of them.

---

## Owner decisions, taken 2026-08-18

1. **The sequence is A24 → this brief → A25 → readability last**, and readability
   is last on purpose rather than by neglect: a period control, a second
   seasonality axis and a portfolio XIRR all add content to these three screens.
   Designing the hierarchy of `/yield`'s eight columns and then adding a ninth
   element is drawing the same screen twice.
2. **Nothing on these three screens becomes editable.** Every candidate for
   editing was declined in favour of deriving — which is why A24 derived the
   portfolio start rather than making it a setting. The A22 brief's rule (a page
   is editable where it shows STORED data) therefore holds for all three, now as
   a tested conclusion rather than an assumption.

---

## What the code is today — read 2026-08-19, not assumed

| Fact | Where | Why it matters here |
|---|---|---|
| **NOTHING in `core/derive.ts` is date-bounded.** Every function takes the whole array and answers since-inception | `src/core/derive.ts` | A period is **not a control over existing functions.** `latestQuotes` merges ALL snapshots, `investedByAsset` sums ALL transactions, `netDeposits` sums ALL. This phase needs a windowing layer that does not exist. |
| The ONLY time-walking code in the app | `screens/yield/yield.ts` `cumulativeYieldSeries` | It filters `t.date <= s.date` inline, per point, inside one screen's glue. That is the pattern to lift into `core/`, not to copy a second time. |
| Seasonality buckets by `dayOfMonth(t.date)` | `screens/seasonality/seasonality.ts:18` | A month-of-year axis is the same shape with the month instead of the day. Mechanically trivial; how the two axes coexist is the design question. |
| Expected coupons come from `couponProjection`, **one projected coupon per asset** | `seasonality.ts` `expectedByDayOfMonth` | On a day axis one projection is one bar. On a MONTH axis one projection still lands in exactly one bucket, which will read as "this fund pays only in June". S4 must say what expected means per month. |
| `/yield`'s table is 8 columns; below `md` it is 8 `Fact` rows per card | `screens/Yield.tsx:76-83, 123-147` | Nothing marks any of them as more important. XIRR weighs the same as Invested. |
| `/overview` is 5 KPIs + 4 cards, all "now" | `screens/Overview.tsx` | No figure on it has a time dimension except the derived start date in one sub-line. |
| `portfolioXirr` exists, is tested, and is displayed nowhere | `core/derive.ts` (A25) | Where it goes is this brief's question, stated in as many words in A25's own comment. |

**Measured**, Chromium, demo dataset, 2026-08-19: at 1440 the viewport gives
`main` **1196 px**; `/allocation`'s grid is `340px 1fr` collapsing below `lg`;
the `ScreenHeader` `<h2>` renders at **39 px**.

**The seed spans 2026-02-03 → 2026-07-27** — under six months. Every period
option longer than that is degenerate on it, which is exactly why G-3 exists.

---

## AMENDMENT, 2026-08-20 — what Phase 7 changed under this brief

Written the day before Phase 7 shipped. **A29–A35 have since landed and v1.7.0
is in production**, so five statements above are stale in ways that would
mislead a drawing. Amended in place per the folder rule, because the extension
has not merged.

**1. `ScreenHeader`'s action slot is REAL, not proposed.** S1 calls it "the slot
the A22 brief adds"; A29 shipped it, and `/allocation` and `/portfolio` carry
edit controls in it today. This *strengthens* S1's first candidate in a way the
brief could not argue: **on all three Phase 8 screens the slot is EMPTY**,
because the A22 rule gives a page that displays only DERIVED data no edit
control at all — and `/overview`, `/yield` and `/seasonality` are exactly that.
A period control there collides with nothing and inherits a row whose geometry
is already drawn and shipped.

**2. `main` is 1196 as a BORDER box; its content box is 1124.** `main` carries
`px-9` (36 a side, `src/app/Layout.tsx`). The 1196 above is correct and was
still misread twice during A34/A35 — every column sum must use **1124**. Two
figures in this project were wrong for exactly this reason in the last day.

**3. The sidebar S1's second candidate would sit in has changed.** Since A33 the
three nav groups collapse and persist; the currency toggle lives in band 3 of a
three-band grid whose middle band is the only part that scrolls (D65). A control
placed "near the currency toggle" joins a pinned cluster, not a free column.

**4. There are eleven routes, not ten.** `/transactions` (A32) and `/settings`.
None is a Phase 8 screen, but the nav the sidebar candidate would join is a
different shape.

**5. D77 now governs how faithfully the extension must be followed.** A merged
reference wins the RESULT; the code owns the MECHANISM. Draw the geometry, and
where a static sheet cannot express a case — intermediate widths, viewport
height, a second language — say so in the header instead of drawing one width
and leaving the rest to be guessed.

**6. `core/derive.ts` IS DATE-BOUNDED, and the row above saying it is not was
the stalest line in the brief.** A27 landed 2026-08-19 — the day the brief was
written — and added `src/core/period.ts` (`PeriodOption`, `PeriodWindow`,
`resolveWindow`) plus `transactionsIn(txs, w: PeriodWindow)` at `derive.ts:125`,
`quotesAsOf`, `cashAsOf` and `headlineTotalAsOf`, with `latestQuotes`,
`latestCash` and `headlineTotal` delegating to them. `derive.ts` imports
`PeriodWindow` on line 4. **The windowing layer this brief calls missing already
ships**, and the session must build on it rather than propose it.

This item is here twice over, because the first version of this amendment
CLOSED by re-asserting the false claim — "everything else was re-checked and
stands: `core/derive.ts` is still not date-bounded" — in a note whose entire
purpose is to kill staleness. Caught by review, not by writing. Re-checking a
list is not the same as checking it.

What genuinely was re-checked and does stand: `portfolioXirr` is computed,
tested and displayed nowhere; `/yield` is still 8 columns; and the seed still
spans 2026-02-03 → 2026-07-27.

---

## The spine: a period means three different things

This is the finding the whole brief rests on. **A window does not mean the same
operation to every figure**, and a control that pretends it does will silently
mislead. Three kinds:

| Kind | What a period does to it | Examples |
|---|---|---|
| **FLOW** — accumulates over time | **Sum over the window.** | income received, payouts, deposits, taxes, seasonality's bars |
| **STOCK** — a level at an instant | **Value at the window's END.** "Free cash in the last 12 months" is not a question. | total capital, free cash, share %, position value |
| **RETURN** — relates two instants | **Needs BOTH ends.** The opening value becomes a synthetic inflow. | Δ total, annualized, total return, XIRR |

**Every figure this phase touches must be classified in the extension**, and the
classification must be visible to the reader — not as a label on each number,
but through the design making it obvious which card answers "over this period"
and which answers "as of the end of it". A KPI grid mixing all three with one
period control above it, unmarked, is the failure mode.

**The RETURN row is where the real work is.** `annualizedPct(value, invested,
daysHeld)` divides by a span; under a window `daysHeld` becomes the window
length, which is straightforward. `portfolioXirr` under a window is NOT: it needs
the portfolio's value at the window's open as a synthetic outflow, and that value
has to come from the snapshot on (or before) that date. That is computable — the
data is there — but it is a different formula from the one A25 shipped, and the
brief must not pretend otherwise.

---

## The long sections are in `phase-8/`

**Split 2026-08-26 (D95)** — moved **verbatim** so no file exceeds 200 lines. No `S` number changed and nothing was summarised.

| File | Holds |
|---|---|
| [`phase-8/constraints.md`](phase-8/constraints.md) | Global constraints |
| [`phase-8/s1-s2.md`](phase-8/s1-s2.md) | S1 — The period control · S2 — /yield under a period |
| [`phase-8/s3-s4.md`](phase-8/s3-s4.md) | S3 — /overview gains a time dimension · S4 — /seasonality gains a month-of-year axis |
| [`phase-8/s5-s6.md`](phase-8/s5-s6.md) | S5 — Where the portfolio XIRR goes · S6 — Readability of the three screens |

## What this brief does not decide

- **Where the period control lives** (S1 § 1) — two candidates with real
  trade-offs, put to the session rather than guessed.
- **Whether `/overview` gets sparklines** (S3 § 6) — a new mark type on a surface
  that has none; the session accepts or rejects it.
- **Which seasonality axis opens by default** (S4 § 4).
- **Which of the three homes the portfolio XIRR takes** (S5).
- **Custom date ranges.** Deliberately out of scope: the fixed options above
  cover the questions a one-user portfolio asks, and a range picker is a surface
  of its own. If it is wanted later it supersedes S1, it does not extend it.
