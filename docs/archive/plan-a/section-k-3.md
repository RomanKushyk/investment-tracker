# Section L under the Section K header — Phase 8 implementation (3 of 3)

> Closed Plan A work, moved **verbatim** from `../../plans/PLAN-NOW.md` on 2026-08-26. Holds A38, A39. Index: [`README.md`](README.md). **Not a task list — nothing here is executed.**

## A38 — The period control — **DONE 2026-08-21** — `feat/period-control`

The control, its state and the line that names the window. **Nothing on any
screen reads the window yet** — that is A39, and the split is A29 -> A30's
shape: land the affordance, then let a screen consume it.

**The axis toggle moved to A39.** D-11 settled that it is ephemeral, but a
toggle with nothing to toggle is worse than no toggle: the month axis is S4 and
belongs to the task that draws it.

**Where it lives is D-1's argument, and the second shell decides it.** Below
`md` the sidebar is a Radix `Dialog` behind a scrim, so a control that reframes
what you are looking at sits on top of what you are looking at. The currency
toggle survives that only because the drawer carries its own readout ten pixels
below; a period has none, because the figures it moves are three routes away.

**F-1 IS NOW VISIBLE IN THE PRODUCT, not explained in a document.** The option
hint is the resolved start date, derived through `f.dateShort(window.from)`, so
the list reads: `Від початку · 03.02` · `1 місяць · 27.06` · `3 місяці · 27.04`
· `6 місяців · 03.02` · `12 місяців · 03.02` · `Від початку року · 03.02`.
**Four rows carry the same date** — six labels, three behaviours, seen rather
than argued, and it stays true as the history grows with no rule to update.

**Two divergences from the drawing, both taken under its own MERGE STATUS box.**
The cluster is a fixed 222 at every width, not `w-full` at 360: item 2 records
that a percentage width cannot work inside `ScreenHeader`'s shrink-to-fit
`ml-auto flex` wrapper. And the clamp's measured cost is **+33 px**, not the
drawn +30 — item 1 predicted exactly that, because `text-[11px]` renders 16,5
under preflight. **The browser agreed with the errata against the drawing**,
which is the first evidence that closing the sheet under D77 was right.

- [x] `period: PeriodOption` through all four touchpoints in one commit —
      `PersistedSettings`, `PERSISTED_DEFAULTS` (`'all'`), `migrateSettings`
      and `partialize`.
- [x] **A whitelist in `migrateSettings`, unlike `collapsedNavGroups`** — an
      unknown group key collapses a group that does not exist; an unknown
      period reaches `resolveWindow` and falls through its switch.
- [x] `PERIOD_OPTIONS` exported from `core/period.ts` so the control and the
      migration read one list.
- [x] `latestSnapshotDate` added to `core/derive.ts` — the name was already in
      that file's prose (`portfolioXirr`'s doc) before the function existed,
      and three screens were about to derive the window's right end three ways.
- [x] Verified in the browser: aria «Період»; popover 222 = the trigger, all six
      rows on one line (F-15's failure mode absent); the window line
      `03.02.2026 – 27.07.2026` in `muted`, clamped it re-colours to
      `warn-tint-text` and gains the brief's sentence; the period survives
      navigation across all three screens and a reload; `/portfolio` has no
      control; 360 gives 222 flush right, 16 px trigger text, overflow 0.
- [x] `pnpm lint && pnpm typecheck && pnpm test` — 690, +3.
- [x] `/code-review` (D76) — 15 findings, 14 taken, 1 declined in writing.
      Ticked after it closed, not inside the commit under review.

---

## A39 — `/yield` under a window — **DONE 2026-08-21** — `feat/analytics-period`

**A39 was three screens, a chart axis and an unanswered question.** Split, and
the reason is this week's own evidence: every branch that arrived with a large
surface came back with 12–15 review findings. A40 and A41 carry the rest.

**THE PROPERTY THE WHOLE DESIGN HANGS ON: every column reduces exactly.** The
full history is not a special case in the code — it is the widest value of one
parameter, so `yieldTableRows` DELEGATES to `yieldTableRowsIn`, the way
`latestQuotes` delegates to `quotesAsOf` (A27). Two implementations would be two
chances to disagree about D5-pinned figures.

That works because of one choice: **the opening position is valued the day
BEFORE the window opens.** `transactionsIn` includes both ends, so a purchase
dated on `from` is one of the window's own flows and valuing on `from` would
count it twice. The day before the portfolio's first transaction has no
snapshots, so the full-history opening value is 0 and every term collapses.
`dayBefore` is the one piece of date arithmetic this needed beyond `addMonths`.

**693 tests passed with no change to any of them** the moment the windowed
builder replaced the old one — which is the reduction proved on every pinned
figure at once, including …6475's +99,4 % XIRR that D18 had to defend.

**F-2 IS NOW PRODUCED BY THE APP**, measured in the browser rather than argued:

| window | Δ | `Річна` | XIRR | проти оч. |
|---|---|---|---|---|
| Від початку · 174 d | +5,20 % | +10,9 % | +99,4 % | −4,3 в.п. |
| 3 місяці · 91 d | +5,20 % | **+20,8 %** | +99,4 % | **+5,6** |
| 1 місяць · 30 d | +2,76 % | **+33,6 %** | **+39,3 %** | **+18,4** |

Δ barely moves, `Річна` triples, and `проти очікуваної` flips sign — on a
fixed-coupon bond, against its own contract. Rows 1 and 2 carry byte-identical
flows (the bond was bought 02.06, after both windows open), so the only thing
that changed is the divisor.

**Two divergences from the sheet's own table, both smaller than a rounding and
both explained.** Its 1-місяць opening value is 4 256,13 against this
implementation's 4 256,49, because the sheet valued on `from` and this values
the day before it — the choice that makes the reduction exact. Everything
downstream shifts by the same hair: 2,76 against 2,77, 33,6 against 33,7.

- [x] `yieldTableRowsIn` and `cumulativeYieldSeriesIn`, with the unwindowed
      forms delegating.
- [x] **The curve is rebased, not merely clipped.** Restricting the x-range
      while every y stayed measured from inception would put a table answering
      "since 27.04" beside a curve answering "since 03.02" — the incoherence
      A38's review caught one level up. Verified: `Від початку` spans
      08.02 → 27.07, `1 місяць` spans 29.06 → 27.07.
- [x] **Disposals count.** `close + soldInside` against the windowed basis,
      because without it a sale inside the window reads as a loss (F-7). Zero on
      the seed, which is why the sheet's formula could omit it for three review
      rounds — so it is pinned by a test with a synthetic sell.
- [x] The footnote follows the window: under `3 місяці` it names 27.04, not the
      portfolio's 03.02.
- [x] The control is passed only when a window exists, so `ScreenHeader` keeps
      its fragment branch on an empty dataset (A38 review).
- [x] `pnpm lint && pnpm typecheck && pnpm test` — 696, +3.
- [x] `/code-review` (D76) — 15 findings, 13 taken, 2 declined in writing.
      **Two were regressions on the DEFAULT screen** that the suite did not
      catch: flows clipped at the window's top dropped any transaction entered
      since the last snapshot (65 800 here against `/portfolio`'s 115 800), and
      no snapshots reported `Вкладено 0,00` where the old code showed the real
      figure. Both now pinned. The window plumbing became `usePeriodWindow`,
      which returns the window AND the control from one `resolveWindow` — so
      A40 and A41 cannot make them disagree.

---

