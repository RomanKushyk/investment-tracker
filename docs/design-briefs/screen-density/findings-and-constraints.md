# Screen density — findings and global constraints

> Moved **verbatim** from [`../screen-density-quotes-and-transactions.md`](../screen-density-quotes-and-transactions.md) on 2026-08-26 (D95). The brief keeps its title, its owner decisions and its acceptance; only the long sections moved. **Read the brief first** — a surface section is written under constraints stated there.

## Findings

### F-1 — `max-w-[884px]` is a patch, and the change that deletes it is the right one

It was added by A32 *because* the aside became conditional: without it the rows
would jump 740 → 1124 the day a coupon is recorded — **740, not the 812 a
first draft wrote: that figure is `1196 − 24 − 360`, the BORDER box, carried
over from the extension's own arithmetic into a paragraph that had already moved
to the content box.** A permanent rail removes the
condition, so the patch goes with it. **A change that deletes a branch is more
likely to be right than one that adds a rule**, and this is the brief's own test
of S1.

### F-2 — the sparkline, killed on data, recorded so it is not re-proposed

572 quotes read out of the demo database:

| Asset | quotes | 7 days | 30 days | whole history | down-days |
|---|---|---|---|---|---|
| Inzhur Energy | 173 | +0,20 % | +0,41 % | +1,48 % | **0 in 173 days** |
| OVDP …8976 | 171 | +0,13 % | +0,65 % | +2,96 % | 12 in 171 |
| Inzhur REIT | 174 | +0,40 % | +1,83 % | +6,30 % | **0 in 174 days** |
| OVDP …6475 | 54 | +0,24 % | +2,77 % | +10,96 % | 4 in 54 |

Energy's largest **single-day** move across its entire history is **0,059 %**.
These are accrual curves, not market prices. A sparkline would draw the same
rising diagonal in every row on every day, and an autoscaled one would render a
0,13 % week as a mountain — decoration that also exaggerates.

### F-3 — what the void cannot be filled with, and how the measurement misled twice

A quote row already carries yesterday's value, the provenance chip, the accrual
ghost, the delta chip and the A6/D52 model note. **There is nothing further to
say about ONE ASSET at quote time**, so the void cannot honestly be filled at the
row's level. It is removed, and the width goes to the day and the portfolio.

Two of the first draft's numbers were wrong in the same way and the way is worth
recording: `document.querySelectorAll('*')` returns **ancestors before
descendants**, so a "find the element containing this text" probe matches a
wrapper first. It reported the yield teaser at 1124 (`main`'s content box) when
the card is **884**, and it reported page content width from element boxes when
block elements span the full width regardless of their ink. **A measurement is
only as good as the element it lands on** — resolve to the painted box and check
what you actually selected.

### F-4 — the elements the rail would take are not spare

The yield teaser is a `Card` **inside the ritual column** (884 on a no-coupon
day, ~700 with the aside), not a full-width strip. The last-saved line is a
`span` with `ml-auto` in the action row, 158 px wide, and
`src/screens/DailyQuotes.tsx` carries a load-bearing comment about it:

> "Last saved" stays in flow in both arrangements: it is a fact about the data,
> not a control, and a fact does not need to follow the thumb.

Below `md` with `stickyActions` on, that span is the **only** child of the
action row. Moving it empties a flex row that still has `mt-[18px]`. **S1 must
therefore state what happens to both elements below the wrap point, and the
answer that preserves today's 360 rendering is that they stay where they are.**

---

## Global constraints

### G-1 — Nothing here is new information

S1 narrows a column and rehouses two elements that are on the screen already. No
new derivation, no new query, no new store field. The one thing the session MAY
add is named in S1 § 7 and is explicitly optional.

### G-2 — No new copy unless the optional block is taken

`/transactions` has just been through A32's F6, where a heading was **deleted**
rather than replaced because the screen's own title already said what the list
was. The same restraint holds. Any string the session mints enters
`src/i18n/messages.ts` in both languages (Contract 0, D58) and is marked as the
session's draft, not as owner-approved copy.

### G-3 — 560 is the measure; 180 is the budget

The hard number is **560**: the ritual column must not exceed it, because at 884
the void is 440 and 52 % of the row.

The rail's minimum is **300**, the coupon card's existing `flex-[1_1_300px]`
basis — the one surface already drawn for that column
(`design/extensions/daily-quotes-live.dc.html` § S5).

At 1440 the content box is **1124**. Two columns at 560 + 24 + 300 need 884, so
the leftover is **240**; at a 360 rail it is **180**. **How that is spent is the
session's decision and it is a real one** — a wider rail, a symmetric outer
margin, or a wider gap. Arithmetic cannot answer it; a drawing can.

### G-4 — the wrap point is a consequence of the bases, not a free choice

`flex-wrap` wraps on the **bases**, so with the ritual at `1 1 560px` and the
rail at `1 1 300px` the row wraps at 884 — which is exactly the number `/`'s
container query already uses. **If the session changes the rail's basis, the
container query must move with it**, and the first draft's claim of a single
944 shared with `/transactions` was wrong on both halves: it ignored the bases,
and `/transactions` is not this brief's to set.

Below the wrap point the arrangement is exactly today's stacked column.
**Nothing about the mobile shell changes** (D66) and no `max-sm:` override may
appear.

### G-5 — Motion (D7)

The reflow at a container query is not a transition — animating a breakpoint
smears while a window is dragged. Anything the session adds respects
`prefers-reduced-motion`; the per-surface table is S1 § 4.

### G-6 — Tokens

`card`, `panel`, `muted`, `faint`, `hairline`, `pos`/`neg` — all existing. No new
colour. The rail is not a new surface: it is the `Card` stack the aside uses.

### G-7 — `min-w-0` is not optional and must appear in every spec

Every column on both screens carries it today, and the merged reference carries
`min-width:0` on all four of its columns. A truncating child in a flex item
without it forces horizontal overflow. `TransactionPanel.tsx` documents what the
omission costs — the ledger ran 51 px wide at 360, silently, because a Radix
`display:table` wrapper sized shrink-to-fit. CLAUDE.md: *"A scrolling band needs
`min-h-0` AND `min-w-0`."*

### G-8 — Two truths about one number are forbidden — but only where it is one number

The sidebar renders `ЗАГАЛЬНИЙ КАПІТАЛ 149 016 ₴`. **A live portfolio total in
`/`'s rail would be the same quantity in two places with two different values**
— the saved one and the draft one — which is the trap A32's own commit named.

This does **not** mean the figure may appear only once in the app. It already
appears on `/overview` as a KPI and in `/portfolio`'s Total row, both legitimate
and both showing the same saved value. The rule is about **one screen showing
two different values of one quantity**, not about uniqueness. If the rail is to
speak about the pending save it must speak about the **change**, which the
sidebar does not show.

### G-9 — G5 still holds: this writes nothing

No new write path. Save remains the sole writer of a snapshot; anything in the
rail is a preview.

---

