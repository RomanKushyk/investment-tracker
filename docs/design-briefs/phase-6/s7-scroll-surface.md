# Phase 6 — S7, the scroll surface (supersedes S5 scrollbar)

> Moved **verbatim** from [`../phase-6-mobile.md`](../phase-6-mobile.md) on 2026-08-26 (D95). The brief keeps its title, its owner decisions and its acceptance; only the long sections moved. **Read the brief first, and [`constraints.md`](constraints.md) with it** — the global constraints this section is written under are in that file, not in the brief.

## S7 · The scroll surface — supersedes S5's scrollbar (added 2026-08-17)

`design/extensions/mobile.dc.html` is merged, so per D14 it keeps saying what it
said and this section supersedes the part of it that is now wrong. The new
reference is **`design/extensions/scroll-surface.dc.html`**; the decision of
record is **D65**. S5's other three overlays — date picker, select, toast — are
untouched and the merged file remains their authority.

**What S5 got wrong, and it is one sentence:** it specified a bar that *overlays*
("takes no layout width — content does not reflow when it appears"). An overlay
bar puts a track across the last row of a table and across a value in a form. The
reflow it avoids is a one-time settle nobody sees; the obstruction it creates is
permanent and everybody sees it.

**What the surface is now.**

- **The bar reserves, it does not overlay.** A gutter of `2m + 12` = **28** is
  given up by the content, and it is the padding of the box *around* the
  scroller, never the scroller's own — padding inside a scroll box holds only at
  the ends of the scroll range, and at every other position the content slides
  straight under the bar.
- **One margin, 8, equal on all four sides.** The distance to the parent's edge
  and the distance to the text are one number. S5's `R − 2r` inset (14 in a
  dialog) and the `R − r` concentric inset before it (19) are both withdrawn:
  concentricity is invisible on a shape this thin, and a bar pushed that far off
  its own edge reads as floating in the gutter rather than belonging to it. The
  arc keeps a guard, not a rule — `R(1 − 1/√2)` is 7.03 at a 24 and 4.69 at a 16,
  both under 8.
- **A dialog is three bands and only the middle one scrolls.** Title and buttons
  are fixed. At 360 this matters more than anywhere: the form is longest exactly
  where the viewport is shortest, and a Save button that scrolls away is one the
  reader has to go looking for.
- **Both axes, always, where the content is not the caller's to predict.** The
  axis a scroller does not manage is `overflow: hidden`, so a field wider than
  its panel is not merely unreachable — it is gone, with no bar to say so.

**Acceptance (S7)** — replaces the S5 scrollbar bullets only:

- [x] No platform scrollbar anywhere except `Select` (Radix owns that viewport)
      and the page itself; both dressed from the same tokens.
- [x] Content sits 28 from the panel edge on both inline sides, at *every* scroll
      position, and the three dialog bands line up down that same edge.
- [x] A dialog's title and buttons do not move while its body scrolls.
- [x] A `w-full` control inside a scrollport keeps its full focus ring.
- [x] A dialog body of non-interactive text is scrollable by keyboard alone.
- [x] The thumb reaches `muted` while hovered or dragged (the 3:1 value 1.4.11
      wants of the state that identifies the control in use).
