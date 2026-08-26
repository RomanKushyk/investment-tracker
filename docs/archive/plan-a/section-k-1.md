# Section K — screen density (1 of 3)

> Closed Plan A work, moved **verbatim** from `../../plans/PLAN-NOW.md` on 2026-08-26. Holds A34, A35. Index: [`README.md`](README.md). **Not a task list — nothing here is executed.**

# Section K — Screen density

The owner reported `/` and `/transactions` looking poor and empty (2026-08-20).
Measuring the two found **two different problems**, and reviewing the brief that
described them found a third that outranks both.

---

## A34 — Design brief: screen density — **DONE 2026-08-20** — `docs/design-brief-screen-density`

`docs/design-briefs/screen-density-quotes-and-transactions.md`.
The first brief here written from a COMPLAINT rather than a feature, which set
its method: every number measured on the running app. **It was then rewritten
the same day, because its own `/code-review` returned fifteen findings and all
fifteen held.**

**The finding that outranks the rest.**
`design/extensions/where-things-live.dc.html` has drawn `/transactions` as two
columns since 2026-08-19 — `flex:0 1 360px` for the form, `flex:1 1 560px` for
the ledger, lines 1203–1226. **A32 shipped neither**; it stacked both cards in
one `max-w-[560px]` column, which is exactly the 50 % of empty screen the owner
reported. The screen was never missing a design. The first draft of the brief
then specified the two columns REVERSED against that merged reference, which
wins visual disputes by the pinned rule.

Nothing caught it for a day — not the implementation, not the fifteen-finding
review of A32 + A33, and not the A32 commit message, which quoted
`padding:16px 28px` out of the very lines carrying `flex:0 1 360px` two rows
above. **The reference was read for the geometry inside the ledger and never for
the layout around it.**

**What the measurement found on `/`.** `main` is `px-9`, so its content box is
**1124**, not the 1196 border box. The ritual column is capped at 884 and the
quote row's content box is 844, carrying a **440 px void — 52 % of the row**
— between where the subline ends (x 176) and where the input starts (x 616).
On a coupon day the same row is 700 wide and the void is 296: **the screen has
two row widths depending on the calendar.**

**What it killed.** A per-asset sparkline, withdrawn before any code on 572
quotes: seven-day spread 0,13–0,40 % with **zero down-days on all four assets**,
and Energy's largest single-day move across 173 days is **0,059 %**. Accrual
curves, not prices.

**And the method's own limit, worth more than either.**
`querySelectorAll('*')` returns ancestors before descendants, so two of the
draft's figures were measurements of a WRAPPER: the yield teaser was reported at
1124 when the card is 884, and page width was taken from element boxes when
block elements span full width regardless of their ink. A measurement is only as
good as the element it lands on.

- [x] Written, every figure measured at 1440 × 900 and 360 × 740, in Ukrainian.
- [x] Reviewed under D76, fifteen findings, all accepted; brief rewritten.
- [x] Owner decision recorded: `/transactions` keeps its route.
- [x] **Design session** — ran 2026-08-24, `/` only →
      `design/extensions/screen-density.dc.html`. All three questions answered
      and two of the brief's own prescriptions overturned; see below.

**What the design session produced, 2026-08-24.**
`design/extensions/screen-density.dc.html`. Every layout in it was **built in
the live DOM and measured** before it was drawn — the method the previous
sheet's merge box asked for, applied from the start rather than after four
review rounds.

**The three answers.** The composition is capped at **944 = 560 + 24 + 360** and
**centred**, because that is the one width at which both column caps land
exactly with zero slack in the row, and because the two rejected spendings
measure badly: a 540 rail puts **417,5 px** between a label and its figure — the
440 px void rebuilt one column to the right — and a left-aligned composition
leaves the header overhanging its own content by 180. `ReminderStrip` **stays**,
at the composition's width, because it is shared with `/overview` and the
wrapper belongs to `/` rather than to the component. The pending-change block is
**taken**, naming the change and never the total (G-8).

**The two contradictions of this brief, and they are the reason to read the
sheet first.** Its § 7 asks for a void **under 60 px** at a card its § 6 sets to
560: measured, `void = card − 444,2`, so 560 gives **115,8** and under 60 needs
a card under **504**. The owner ruled that 560 stands and the target is
restated — 440 → 116 is a 74 % cut and what is left is one avatar wide. And its
§ 6 writes both caps unconditionally, which below the wrap point is the
"cap becomes a hole" failure `DailyQuotes.tsx` already documents for the aside:
at a 774 container it leaves **214 px** beside the rows and **414** beside the
rail. Both caps are `@min-[884px]:`.

**Three things the brief could not have known**, all of them found by rendering
rather than reasoning: narrowing the column to 560 **breaks the header row**
(871,27 px of content into 560 → 87 px over two lines, with the fetch button
beside the date) — and that row holds one line TODAY, at 884, by **12,73 px**;
the yield teaser **cannot be rehoused unchanged** (72 px / 2 lines at 884 →
246,5 / 11 at 360 → **617 px / 30 lines** at 300, because `min-w-0 flex-1` lets
the text collapse to 29 px rather than wrap a 174,61 px link); and that same
teaser is **already broken at 360 in production** — 246,5 px, eleven lines,
`Дохідніс/ть` split mid-word — which is why the sheet's D-5 amends this brief's
"pixel-identical at 360" rather than shipping around it.

**A method trap worth more than one drawing.** On Windows a driver cannot resize
a Chrome window below **500 px**, so a request for 360 silently returns 500 and
every figure taken in it is wrong by 164 px of content width. Device emulation
is the only way to the real column. Same shape as this brief's own F-3: a
measurement is only as good as the box it lands on.

---

## A35 — `/transactions` implements the two columns already drawn for it — `feat/transactions-two-column`

**Not design-blocked.** `design/extensions/where-things-live.dc.html` § S4 is the
contract and it is merged; this task builds what it draws.

```
row     display:flex; flex-wrap:wrap; gap:24px; align-items:flex-start
form    flex:0 1 360px; min-width:0     <- NARROW, does not grow
ledger  flex:1 1 560px; min-width:0     <- WIDE, grows
```

**What shipped, and where it diverges — D77.** The row is the drawing's
`flex-wrap` and the same idiom `/` uses. The form takes `flex-[1_1_360px]` with
`max-w-[560px]` / `@min-[944px]:max-w-[360px]` rather than the drawn grow-0:
the rendered width is identical beside the ledger, and a wrapped form still
fills its line up to the 560 this screen shipped with instead of stranding at
360. Gap is `gap-x-6 gap-y-3.5` — the drawn 24 between columns, today's 14 when
stacked. The ledger's height cap is the viewport's above 944 rather than the
drawn `max-height:328px`.

- [x] `src/screens/Transactions.tsx` replaces its `flex max-w-[560px] flex-col
      gap-3.5` wrapper with the row above, as `@container flex flex-wrap
      items-start gap-x-6 gap-y-3.5` on ONE element. `TransactionPanel` has
      exactly one caller, so the split is free.
- [x] **`min-w-0` on both columns** — the reference carries `min-width:0` on
      both, and `TransactionPanel.tsx` already documents what its absence cost
      the ledger (51 px clipped at 360, silently).
- [x] The ledger's `max-h-[420px]` was chosen when the card was stacked BELOW
      the form. In a column it becomes a function of the viewport, so the page
      stops scrolling and the column does (D65).
- [x] **Below the wrap point the stacking gap stays 14**, not the row's 24 —
      the reference draws `margin-bottom:12px` at 360, so this needed a decision
      recorded, not a silent change. **Recorded as D77**, with the other two
      divergences.
- [x] At 1440 the rightmost ink reaches within 40 px of `main`'s content box.
      Today it falls **590 short**.
- [x] Every seeded row visible without scrolling at 900 px of viewport where the
      column allows it. **The seed has 18 transactions** — any acceptance
      figure above that is untickable.
- [x] At 360, pixel-identical to today; horizontal overflow 0 px.
- [x] `pnpm lint && pnpm typecheck && pnpm test`, then `/code-review` (D76).
      **Ticked after the review closed, not inside the commit under review** —
      the first pass did the latter, claiming an event that had not happened.
      Two passes ran: 13 findings then 10, all taken. 687 tests.

---

