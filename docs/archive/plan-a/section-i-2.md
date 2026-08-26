# Section I — the 2026-08-18 brainstorm (2 of 2)

> Closed Plan A work, moved **verbatim** from `../../plans/PLAN-NOW.md` on 2026-08-26. Holds A27, A28. Index: [`README.md`](README.md). **Not a task list — nothing here is executed.**

## A27 — The windowing layer in `core/` — **DONE 2026-08-19** — `feat/period-window`

**The half of Phase 8 that G-5 marks as pure logic**, built before the design
session so the extension lands on a mechanism that already exists and is tested.
No screen reads any of it yet.

- [x] `core/period.ts` — `PeriodOption` (`all` · `1m` · `3m` · `6m` · `12m` ·
      `ytd`) and `resolveWindow(option, start, to) → {from, to, clamped}`.
- [x] `quotesAsOf` / `cashAsOf` / `headlineTotalAsOf` in `core/derive.ts`, with
      the unbounded `latestQuotes` / `latestCash` / `headlineTotal` **delegating
      to them**. One merge, two names — growing a second bounded copy beside
      the first would have been a second answer.
- [x] `transactionsIn(txs, window)`, inclusive at both ends.

**Three decisions worth reading twice.**

**Counted back from the LATEST SNAPSHOT, never from today.** Today is not a
portfolio fact: it moves while the data does not, so "3 months" measured to today
would quietly lengthen every night on a portfolio nobody updated, and would
disagree with the span every other figure on these screens is already measured
to. This is A24's argument applied to the other end of the window.

**`clamped` means "you asked for more than exists", not "from equals start".**
That is why it is decided by comparing the REQUEST against the start rather than
the result — and why `all` is never clamped even though it always begins at the
start. Flagging `all` would put a warning on the default state, which is the
state that reproduces every pinned figure.

**`transactionsIn` is a one-line filter with a whole function around it, on
purpose.** G-5's reason stated plainly: three screens each writing their own
boundary test is three chances to disagree about whether the opening day counts.

**Verified.** 674 tests (+15) in 43 files (+1); lint and typecheck green. The
whole pre-existing suite passes UNCHANGED, which is what proves the delegation is
behaviour-identical rather than merely plausible. Browser, demo dataset: every
`/overview` figure byte-identical — `149 016,36 ₴`, `+4 452,61 ₴ / +3,08 % від
03.02`, `+5 839,99 ₴ / +4,08 %`, `143 176 ₴`, sidebar `149 016 ₴` — with no
`NaN`, `Infinity` or `undefined` anywhere.

**Deliberately NOT built:** windowed returns. `annualizedPct` under a window is
straightforward, but `portfolioXirr` needs the opening value as a synthetic flow
and is a different formula from the one A25 shipped (brief § spine). Building it
now would be guessing at a shape the design session may not ask for.

## A28 — "Next payouts" offers a dividend date in the past — `fix/payout-projection-roll`

**Found by the 2026-08-19 walk of `navigation-map.md`**, on a card whose title is
the claim it breaks.

`nextPayoutRows` projects a dividend as **the latest `dividend_accrual` date plus
one payout-schedule period** and stops there — it never rolls the result forward
to the next occurrence at or after today. The seed's last REIT accrual is
**10.07.2026**, so the card offered **10.08** on a day the app itself printed as
**19.08**: nine days in the past, under the heading "Next payouts".

**THE SENTENCE THAT STOOD HERE — "coupons are unaffected" — WAS WRONG, and the
code said so within the hour.** It claimed a bond reads a grid walk. It does
not: `couponProjection` reads `asset.nextCoupon || asset.maturity` **verbatim**,
and `nextCoupon` only ever moves through the S5 confirm (G5). So an unrecorded
coupon leaves the pointer frozen in the past exactly as the dividend was. The
seed merely hid it, because its stored 25.08.2026 still happened to be in the
future on the day the defect was found. The D23 grid walk is real but lives in
`nextUnsettledCoupon`, which the reminder strip and the S5 card use — **not this
card**. Fixing one half and shipping the other was the first draft of this fix.

- [x] Roll BOTH branches forward by whole periods until the date is on or after
      the reference. Whole periods, never "the next month": landing between the
      asset's own dates would invent an occurrence that never happens.
- [x] The coupon half steps with `rollNextCoupon` — the same stepper the S5
      confirm writes with — so this card can never show a date the roll would
      not produce. It also stops at maturity, so a matured bond drops off the
      card rather than projecting forever.
- [x] **The reference date is TODAY, and the box that stood here said
      `latestSnapshotDate`.** That was the wrong instinct carried over from A24
      and A27: those measure a VALUE, whose as-of is the data's. This card
      answers "what comes next", which is a question about the calendar — a
      payout dated before today is not next, however fresh the snapshots are.
      It is still the caller's to supply (`Overview.tsx`, `Payouts.tsx` pass
      `todayIso()`); a pure function reading the clock cannot be tested.
- [x] Amount unchanged — **D5#7 pins the estimate and says nothing about the
      date**, which is why the date was fixable without a decision entry.

**A missed occurrence is not hidden by this.** Surfacing it is the reminder
strip's and the S5 card's job, and both read the grid rather than this
projection. This card answers "what comes next"; "what did you forget" is a
different question with its own surface.

**Verified.** 679 tests (+5), lint and typecheck green. Browser, demo dataset,
2026-08-19: `/overview` and `/payouts` both now read **Дивіденд REIT ~700 ₴ ·
10.09** where they read 10.08 an hour earlier, the two coupons are untouched at
25.08 and 03.12, and the soonest-first sort is now genuinely soonest-first — the
…8976 coupon leads, where the past-dated dividend used to.

**Not a live-data-only defect, and not only a seed-ageing artifact.** On a
ledger kept current the projection is in the future and nothing shows; the card
goes wrong exactly when the user stops recording — which is when a reminder is
worth most. The frozen demo seed simply makes it visible every day.

---

