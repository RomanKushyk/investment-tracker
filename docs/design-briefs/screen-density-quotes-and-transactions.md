# Brief — screen density: `/` and `/transactions`

**Written 2026-08-20. Rewritten the same day** after its own `/code-review`
returned fifteen findings, all of which held. The first draft is not preserved:
it specified a surface that was already drawn, and every number in its
`/transactions` half argued from that mistake. What replaced it is below, and
**the review's central finding became this brief's most valuable content** —
see "The section that does not exist".

Input to a separate Claude design session, which produces
`design/extensions/screen-density.dc.html`. Until that extension merges, **no UI
task from S1 may start** — G7. Pure-logic tasks are never design-blocked, and
neither is A35 (see below).

Template and pipeline: `../archive/design-briefs/README.md`. The one surface
section below carries all seven required parts.

Source: the owner's report that `/` and `/transactions` look poor and empty,
raised 2026-08-20. This is the first brief in the project written from a
COMPLAINT rather than a feature, and that origin set its method: **every figure
below was measured on the running app at 1440 × 900 and 360 × 740, in the demo
dataset, in dark, in Ukrainian** (the longer pair, D54/D58).

The rewrite also taught the method its own limit, which is recorded as F-3.

Shape is governed by **D56** throughout (`README.md` §4). This brief adds no
exception to it and introduces no new radius.

---

## Owner decisions, taken 2026-08-20

1. **`/transactions` keeps its route.** Reverting A32 and folding the panel back
   into `/` was put and declined.
2. **`/transactions` becomes two columns.** *(Already satisfied by a merged
   reference — see below. The decision stands; it simply needs no design work.)*
3. **`/`'s right rail becomes permanent**, and the ritual column narrows to fit
   it.
4. A per-asset sparkline was proposed by the assistant, chosen by the owner, and
   **withdrawn on evidence** before any code — see F-2.

---

## The section that does not exist — `/transactions` is already drawn

**There is no S1 in this brief, and that absence is its most important
statement.**

`design/extensions/where-things-live.dc.html`, merged 2026-08-19, already draws
`/transactions` as two columns. Read at lines 1203–1226:

```
row     display:flex; flex-wrap:wrap; gap:24px; align-items:flex-start
form    flex:0 1 360px; min-width:0
ledger  flex:1 1 560px; min-width:0
```

**The form is the NARROW column and does not grow; the ledger is the WIDE one
and does.** A32 shipped neither — it stacked both cards in a single
`max-w-[560px]` column, which is what produces the 50 % of empty screen the
owner reported. The screen is not missing a design. **It is missing its
implementation.**

The first draft of this brief then specified the two columns *reversed* — form
560, ledger 360 — against a merged reference that wins visual disputes by the
pinned rule in `../archive/design-briefs/README.md`. Had the design session run
on it, it would have drawn a contradiction of a document it was told to match.

Three consequences, and the third is the uncomfortable one:

1. **A35 is not design-blocked.** It is startable today, and its task is to
   implement `where-things-live.dc.html` § S4 as drawn.
2. **The design session's scope is `/` only.**
3. **Nothing caught this for a day.** Not A32's own implementation, not the
   fifteen-finding review of A32 + A33, and not the A32 commit message, which
   quoted `padding:16px 28px` out of the very lines that carry `flex:0 1 360px`
   two rows above. The reference was read for the geometry INSIDE the ledger and
   never for the layout AROUND it. **Reading a reference for the part you are
   changing is not reading it.**

---

## What the code is today — measured 2026-08-20

`main` is `min-w-0 flex-1 px-9 pt-8 pb-12` (`src/app/Layout.tsx:176`). At 1440
with the 244 rail, its **border box is 1196 and its content box is 1124**. Every
figure below is in the content box, because that is where the columns live.

`/` renders `@container flex flex-wrap items-start gap-6` with the ritual column
at `min-w-0 flex-[1_1_560px]` — plus `max-w-[884px]` **only when no coupon is
due** — and an aside at `min-w-0 flex flex-[1_1_300px] flex-col gap-3.5
@min-[884px]:max-w-[360px]`, rendered only when `due.length > 0`.

Measured at 1440 × 900 on a no-coupon day:

| | |
|---|---|
| `main` content box | **1124** |
| ritual column (capped) | **884** |
| unused to its right | **240 px — 21 %** |
| quote row **card** | **884**; its content box **844** |
| row anatomy, content box | avatar **48** · gap 16 · name block **536** · gap 16 · input **160** · gap 16 · delta chip **52** |
| subline text ends at | x = **176** (112 into the name block) |
| input starts at | x = **616** |
| **void between them** | **440 px — 52 % of the row's content box** |

The 440 px is the complaint. The name block is the `flex-1` that stretches, so
the eye travels 440 px from "Inzhur REIT" to the field where its price is typed
— the slowest possible arrangement for the one ritual the screen exists to
serve.

**On a coupon day the same row is narrower and the void is smaller.** The aside
takes 360, so the ritual column is 1124 − 24 − 360 = 740, the card content box
is 700, and the void is 700 − 176 − (16 + 160 + 16 + 52) = **280** *(derived,
not measured — the seed's next coupon is 25.08.2026)*. The screen therefore has
two different row widths depending on the calendar, which is the second thing
worth fixing and the reason `max-w-[884px]` exists at all.

---

## Findings

### F-1 — `max-w-[884px]` is a patch, and the change that deletes it is the right one

It was added by A32 *because* the aside became conditional: without it the rows
would jump 812 → 1124 the day a coupon is recorded. A permanent rail removes the
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

## S1 — `/`: a narrow ritual and a permanent rail

### 1. Purpose, parent, references

Remove the 440 px void inside every quote row by narrowing the column that
causes it, give the freed width to a rail that is always there, and delete the
conditional cap that exists only because the rail was not.

- Parent: `src/screens/DailyQuotes.tsx` (the `@container` row and the aside).
  `src/screens/daily-quotes/QuoteRow.tsx` is **not** to be redesigned.
- `design/Investment Tracker.dc.html` — `/`'s header row and asset-row anatomy
  are drawn at lines 55–146 (the `showEntry` block; see the line map in
  `design/README.md`).
- `design/extensions/daily-quotes-live.dc.html` § S5 — the coupon-due card that
  already occupies this column.
- `design/extensions/where-things-live.dc.html` § S4 — the two-column idiom to
  match, including its `min-width:0` on both columns.
- `design/extensions/mobile.dc.html` / `scroll-surface.dc.html` — D66 and D65.

### 2. Content inventory — exact copy, EN + UK

**None required.** Both elements the rail receives keep their strings:

| Element | Where it is today | Measured | Where it goes |
|---|---|---|---|
| Coupon-due card (S5) | the aside, only on a coupon day | 300–360 | the rail, unchanged |
| Yield teaser | a `Card` at the foot of the ritual column | **884** | the rail |
| `Збережено 25.07, 21:14` | `ml-auto` in the action row | **158** | the rail |

**Optional, and the session decides whether to take it:** a block naming what
the pending save will change (G-8 permits the change; it forbids the total).

| Key | EN | UK |
|---|---|---|
| `dailyQuotes.pendingChange.label` | `This snapshot changes` | `Цей зріз змінює` |
| `dailyQuotes.pendingChange.none` | `Nothing entered yet` | `Ще нічого не введено` |

Both are drafts and are marked as such in `messages.ts`, per G-2.

### 3. State matrix

| State | Treatment |
|---|---|
| **default** | Ritual column at its 560 measure; rail present, holding the teaser and the last-saved line. |
| **hover** | n/a for the layout itself. The rehoused elements keep their own: the teaser's "Yield chart →" is a ghost control at opacity 85 %, 150 ms; the last-saved line is text and has no hover. |
| **focus** | The app's existing focus ring, unchanged and never restyled per surface. The rail introduces no new focusable element unless the optional block is taken, and that block is text. **Tab order must follow the visual order** — rows, then actions, then rail. |
| **disabled** | n/a — the rail holds no control. The one disabled surface on this screen is the demo-gated fetch button, which stays in the header (D19). |
| **loading** | Rail renders after the queries, exactly as the aside does today. It must not render an empty box while they are pending. |
| **error** | n/a — the rail reads stored data. A failed save is reported by toast and keeps every entered value; unchanged. |
| **empty** | Live dataset, no assets → no rows, and the rail renders only what applies. An empty rail is not drawn. |
| **stale** | n/a — nothing in the rail reads the feed. |
| **demo-disabled** | n/a — the rail reads stored data only. |
| **coupon due** | The coupon card joins the rail **above** the rest. **The ritual column's width does not change** — today it does, by 144 px. |
| **below the wrap point** | One column. **The teaser and the last-saved line return to their present positions** (F-4), so 360 is untouched. |
| **0 of N filled** | Optional block, if taken, reads its empty string. |
| **partially filled** | No partial state exists: an unfilled asset keeps its last known value through `coalesce` (D33), so a total is always complete. |
| **invalid input** | Treated as unfilled; the row's existing validation is unchanged. |

### 4. Motion (D7)

| Trigger | Property | Duration / easing | Reduced-motion |
|---|---|---|---|
| Rail mounts on load | opacity + translateY | 300 ms, `cubic-bezier(0.22,1,0.36,1)`, staggered per card as the aside does today | no transform, no fade — final state immediately |
| Coupon card appears in the rail | opacity + translateY | 300 ms, same curve | as above |
| Container query crosses the wrap point | — | **none, deliberately** — animating a breakpoint smears while a window is dragged | n/a |
| Optional pending-change figure updates | the number itself, `useTweenedNumber` | ~300 ms, same curve, like every other headline figure | **the tween is disabled, the update is not** |
| Teaser's "Yield chart →" hover | opacity | 150 ms | none |
| Any pressable in the rail | `scale(.97)` | 220 ms | no scale |

### 5. Tokens

`card` for the rail's cards, `panel`/`panel-border` where the teaser already
uses them, `muted` for the last-saved line, `pos`/`neg` for a change figure if
the optional block is taken. No new token. If the session believes it needs one,
it says so loudly as a finding rather than adding it quietly.

### 6. Layout

- The row stays `@container flex flex-wrap items-start gap-6`.
- Ritual column: `min-w-0 flex-[1_1_560px] max-w-[560px]`. **The conditional
  `max-w-[884px]` is removed entirely** (F-1).
- Rail: `min-w-0 flex flex-[1_1_300px] flex-col gap-3.5`, rendered
  unconditionally. Its `@min-[884px]:max-w-[360px]` cap is subject to G-3, and
  if the basis changes the container query moves with it (G-4).
- **`min-w-0` on both columns, and `flex flex-col gap-3.5` on the rail** — G-7.
- **`QuoteRow` is not redesigned, and the arithmetic says it need not be.**
  Measured at an 884 card / 844 content box: avatar 48 + gap 16 + name block 536
  + gap 16 + input 160 + gap 16 + delta 52 = 844, and the subline ends 112 into
  the name block, leaving the 440. At a **560 card**, `px-5` leaves 520 of
  content and the fixed parts take 48 + 160 + 52 + 48 = 308, so the name block
  gets **212** against its `min-w-[110px]`. It fits without touching the
  component, and the two-line wrap below `md` is untouched.

### 7. Acceptance

- [ ] No quote row card is wider than 560 at any viewport.
- [ ] At 1440 the gap between a row's subline and its input is **under 60 px**.
      Today it is **440**.
- [ ] The row width is **identical on a coupon day and a no-coupon day**. Today
      they differ by 144 px (884 against 740).
- [ ] `max-w-[884px]` no longer appears in `src/screens/DailyQuotes.tsx`, and no
      replacement cap takes its place.
- [ ] Both columns carry `min-w-0` (G-7).
- [ ] Above the wrap point, neither the yield teaser nor the last-saved line
      renders inside the ritual column.
- [ ] **At 360 the screen is pixel-identical to today** — including the action
      row, which must not be left holding only its `mt-[18px]` (F-4).
- [ ] Horizontal overflow is 0 px at 360 and at 1440.
- [ ] `/`'s rail shows no portfolio TOTAL; if it names the pending save it names
      the change (G-8).
- [ ] With `prefers-reduced-motion`, nothing tweens and everything still
      updates.
- [ ] No D5-pinned demo figure changes.

---

## Questions this brief hands to the session

1. **How the leftover width is spent** (G-3) — 240 at a 300 rail, 180 at 360.
   Wider rail, symmetric outer margin, or wider gap. A drawing answers it.
2. **Does `ReminderStrip` move into the rail?** It is a full-width banner above
   the header and it is **shared with `/overview`**. Moving it on `/` alone
   makes two screens disagree; moving it on both is larger than this brief. The
   brief takes no position, and "it stays" is a complete answer.
3. **Is the optional pending-change block taken?** § 2 carries its copy. If not,
   the rail holds two rehoused elements plus the coupon card, which is a
   complete answer on its own.

---

## What this brief does not touch

- The route table. `/transactions` stays; A32 is not reverted.
- **`/transactions`' layout** — already drawn and merged; A35 implements it.
- `QuoteRow`'s internals, the write paths, the ledger's row anatomy.
- The mobile shell (D66). `/` is unchanged below the wrap point.
- D56. No new radius, no exception.
