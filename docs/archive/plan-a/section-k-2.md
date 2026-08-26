# Section K — screen density (2 of 3)

> Closed Plan A work, moved **verbatim** from `../../plans/PLAN-NOW.md` on 2026-08-26. Holds A44. Index: [`README.md`](README.md). **Not a task list — nothing here is executed.**

## A44 — `/` narrows to 560 and gains a permanent rail — `feat/quotes-density`

**Unblocked 2026-08-24** by `design/extensions/screen-density.dc.html`, which is
the contract for every figure below. The brief
(`docs/design-briefs/screen-density-quotes-and-transactions.md`) still wins copy
and behaviour disputes — **except the two items the sheet amends with a
measurement, ACC marks both.**

**THE FENCE BELOW IS SUPERSEDED BY D88 AND KEPT AS THE RECORD OF WHAT WAS BUILT
FIRST.** It is what the sheet drew and what the first commit shipped, measured to
the pixel; the owner then replaced the composition with `/payouts`' grid. Do not
implement from it — `transactions-layout.test.ts` now asserts that `@container`
and `@min-[Npx]` appear nowhere on these screens, so an implementer following
these four lines writes code the suite rejects.

```
SUPERSEDED (D88) — the sheet's composition, shipped 2026-08-25 and replaced the same day
composition   mx-auto, max-w-[944px]            <- strip + header + both columns
row           @container flex flex-wrap items-start gap-6
ritual        min-w-0 flex-[1_1_560px] @min-[884px]:max-w-[560px]
rail          min-w-0 flex flex-[1_1_300px] flex-col gap-3.5 @min-[884px]:max-w-[360px]
```

```
IN THE CODE TODAY — `/payouts`' own expression, on `/` and on `/transactions`
row     grid grid-cols-[1.6fr_1fr] items-start gap-3.5 max-lg:grid-cols-1
left    min-w-0            <- the day's inputs, the rows, the action row
right   min-w-0            <- pending change, yield, last saved (no control)
caps    stacked column only — the ledger's 884 came off (D93), the form's 560 is max-lg: scoped (D94); beside each other the tracks are the bound
```

- [x] The composition box wraps `ReminderStrip`, the title block and the row.
      **The strip's component is untouched** — `/overview` renders identically.
- [x] The **whole title block** moves OUT of the ritual column to the
      composition's width and renders on **one line** at 944 in both languages:
      the row (title · progress pill · fetch button · date), the subtitle, **and
      `ParseSkips`** — which is silent until a fetch happens and is the fetch
      button's own report (A7). Left behind, it puts a warning about a fetch
      under a 560 column while its button sits at 944.
- [x] `max-w-[884px]` is gone and **no CONDITIONAL patch replaces it** — the
      aside becomes an unconditional rail. The 560 cap the sheet asks for is not
      that replacement: it is permanent and container-scoped, and the brief's
      "no replacement cap" reads as a contradiction of it unless both are stated
      together (sheet ACC).
- [~] **Both caps are container-scoped** (`@min-[884px]:`) — F-6. **Done, then
      UNDONE by D88**: the container query went with the flex row, and the grid
      collapses on `lg` instead. The finding it protected did not go away —
      unbounded columns leave holes — but its enforcement moved twice: after D88
      the caps lived on the two cards, and **D93/D94 (2026-08-25) finished the
      move** — the ledger's 884 came off entirely and the form's 560 became
      `max-lg:` scoped, so beside each other the TRACKS are the bound the
      finding asked for and the 560 survives only in the stacked column.
- [x] `min-w-0` on both columns (brief G-7).
- [x] The yield card is recomposed as two `max-content` columns, label 16 px
      from its figure, and **the 360 rendering is repaired with it** (D-5) —
      246,5 px over eleven lines today.
- [x] The pending-change block, in its three states, naming the CHANGE only.
      **Its baseline is `yesterdayQuote(snapshots, assetId, selectedDate)`, the
      same one the row's «учора» subline reads — NOT `latestQuotes`**, which is
      unbounded and would measure against a later snapshot than the sublines
      beside it whenever the date picker is off today. The baseline is per
      asset, so the sub-line names the count and never a single date. Pin both
      with a test.
- [x] **Three** strings enter `src/i18n/messages.ts` in both languages, marked
      as the design session's draft copy (brief G-2) — label, empty line, count
      line. The count is NOT the existing `filled(n, m)`: a row can be filled
      and change nothing.
- [x] **`dailyQuotes.yieldSinceStart` loses its trailing colon** in both
      languages. It was an inline prefix; as a card heading `Дохідність від
      початку:` is wrong, and shipping the drawing without this change ships the
      colon.
- [x] Above the wrap point neither the yield card nor the last-saved line sits
      in the ritual column; below it, both return to today's positions and the
      action row is never left holding only its `mt-[18px]` (brief F-4).
- [x] The void measures **under 140 px on every row** and under 120 on a row
      without the `ПРОПОЗИЦІЯ` chip (115,8 plain · 130,2 / 136,8 on the two bond
      rows, which carry a fifth flex child — sheet F-7). Today it is 439,8.
- [x] Horizontal overflow 0 at 360 and 1440; no `max-sm:` override appears
      (D66).
- [x] **`navigation-map.md`'s `/` route updated** — its rows still describe the
      conditional aside, `max-w-[884px]`, the inline yield-teaser string and
      "Last saved" in the action row, all of which this task invalidates.
      CLAUDE.md requires the map to move with the screen, and this plan already
      records one task that forgot it.
- [x] **The two stale 72 px copies corrected** — `DailyQuotes.tsx`'s comment and
      `navigation-map.md` both say the coupon-day reflow is 812 → 1196, which is
      `main`'s BORDER box. The content box is 1124, so it is 884 → 740 = **144**
      (brief F-1, sheet S1-C). Both are deleted with the cap they describe.
- [x] `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` — green,
      **780 tests**. `/code-review` (D76) runs before the merge; this box is
      ticked when it closes, not when it starts.

**MEASURED IN THE BROWSER, 2026-08-25**, and every figure the sheet predicted
came out at the predicted value:

| | drawn | measured |
|---|---|---|
| composition at 1440 | 90 · 944 · 90 | **944**, margins **90** — then D88 replaced it with `/payouts`' grid at main's width |
| ritual · gap · rail | 560 · 24 · 360 | **560 · 24 · 360** |
| void, plain row | 115,8 | **115,8** at 560 — **238,9** after D88 widened the track, priced in that decision |
| void, the two bond rows | 130,2 / 136,8 | **130,2 / 136,8** (was 439,8) |
| a 773,7 container (1100 vp) | no hole | row wraps, both columns full width, hole **0** |
| yield card at 360 | repaired | **182,3** tall, heading unbroken (was 246,5 over eleven lines) |
| horizontal overflow | 0 | **0** at 360 and at 1440 |

The rail's order is the drawing's: coupon card (only when one is due) →
pending-change → yield → «Збережено». The «Збережено» line exists twice in the
DOM and each copy is `hidden` where it does not belong — CSS cannot move a node
between two flex parents, and F-4 needs it inside the action row below the wrap
point where the sticky bar has taken the buttons.

---

