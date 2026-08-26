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
is 700, so the name block is 700 − 308 = 392 and ends at x = 456; the input
starts a gap later at 472, and the void is 472 − 176 = **296** *(derived, not
measured — the seed's next coupon is 25.08.2026)*. **A first draft wrote 280 by
subtracting the fixed parts from the content box, which lands on the name
block's right EDGE and drops the trailing gap; the same formula applied to the
1440 case returns 424 against the measured 440, which is how it was caught.** The screen therefore has
two different row widths depending on the calendar, which is the second thing
worth fixing and the reason `max-w-[884px]` exists at all.

---

## The long sections are in `screen-density/`

**Split 2026-08-26 (D95)** — moved **verbatim** so no file exceeds 200 lines. No `S` number changed and nothing was summarised.

| File | Holds |
|---|---|
| [`screen-density/findings-and-constraints.md`](screen-density/findings-and-constraints.md) | Findings · Global constraints |
| [`screen-density/s1.md`](screen-density/s1.md) | S1 — /: a narrow ritual and a permanent rail |

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
