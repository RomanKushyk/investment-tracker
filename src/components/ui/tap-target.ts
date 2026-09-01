/**
 * G-2 — a 44 × 44 pressable region below the breakpoint, WITHOUT moving the
 * drawn box.
 *
 * This is the class that protects D56. Growing controls to 44 px instead would
 * move every radius, because `r = round(min(w, h) × 0.26)` is keyed to the short
 * side: a nav pill goes 36 → 44 and its 9 becomes 11, `Button` md goes 40 → 44
 * and its 10 becomes 11, the currency track goes 13 → 17. Five radii and one
 * concentric chain, rewritten as a side effect of an accessibility fix. So the
 * hit area grows and the drawing does not.
 *
 * HOW IT WORKS. An absolutely positioned `::after` centred on the control, 44 ×
 * 44, transparent, and never smaller than the control itself (`min-w-full` /
 * `min-h-full`) so a wide button keeps its whole width pressable rather than
 * being narrowed to a 44 px stripe. A click on a pseudo-element targets its
 * originating element, so no handler changes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * USE IT ONLY ON A CONTROL THAT HAS A DRAWN BOX — a fill, a border, or both.
 *
 * That is the whole rule, and it is not a style preference: it is what decides
 * whether the overlay is the right tool at all.
 *
 * · A control WITH a drawn box (a nav pill, a segment, a `Button`, a Select
 *   trigger) cannot simply be given padding — the padding would grow the fill
 *   and move the radius. The overlay is the only way, and its cost is the
 *   spacing rule below.
 * · A control WITHOUT one — an icon button, a ghost text button — has nothing to
 *   redraw. Give it a REAL 44 px box (`max-md:size-11`, or a min-height) and let
 *   layout account for it. Nothing moves visually, because nothing was drawn,
 *   and the neighbours are pushed apart instead of being overlapped.
 * · An inline link inside a sentence gets NEITHER. An absolutely positioned
 *   pseudo-element resolves against the first line box of an inline element, so
 *   on a wrapped link the overlay lands somewhere nobody predicted; and WCAG
 *   2.5.8 exempts a target that is "inline in a sentence" for exactly this
 *   reason — the line height is the author's, not the control's.
 *
 * THE SPACING RULE, and the defect it exists to stop. A centred 44 px overlay on
 * a small control reaches `(44 − w) / 2` past each of its own edges. Measured on
 * the daily-quotes offer row: a 19 px dismiss ✕ with an 8 px gap put its overlay
 * 4.5 px ON TOP of the accept button beside it — and being later in DOM order at
 * the same z-index, it won. A tap on the last 4.5 px of "Use 68 702,10" DISCARDED
 * the fetched quote. Overlapping hit areas are worse than small ones: they hand
 * the tap to the wrong control, and the wrong control is often the destructive
 * one. So a caller must guarantee the gap, and WHICH gap depends on whether the
 * neighbour has an overlay of its own — the file stated only one of the two for a
 * long time, with a worked example from the other:
 *
 *   neighbour has NO overlay   `gap >= (44 − w) / 2`   one reach to clear
 *   neighbour ALSO has one     `gap >= 44 − w`         two reaches, i.e. w + gap >= 44
 *
 * The sidebar nav is the worked example and it is the SECOND case: 36 drawn + 8
 * gap = 44, so two overlays tile the column edge to edge with no overlap and no
 * dead strip. Read against the first formula that gap looks twice as generous as
 * it needs to be, which is how the two got asserted fifteen lines apart as if
 * they were one rule. A caller that cannot make either number uses a real box.
 *
 * WCAG 2.5.8 (AA) asks 24 × 24, and the 36 px controls this helper is for pass
 * it on their own. 44 is the platform guidance, and it is satisfiable without
 * redrawing anything.
 *
 * ONE CONTROL DOES NOT PASS, and it is named here because this file is where
 * someone auditing the rule will look: `PriceModeSegment`'s segments render
 * 15 × 16 on a 19 px pitch (D114, owner's ruling — the Settings switch's
 * footprint). `TAP_44` cannot rescue it, and that is this helper's own
 * arithmetic rather than an exemption — the two-overlay case above, since both
 * segments would carry one: `w + gap >= 44` needs a 29 px gap at w = 15, and the
 * pitch is 19. The overlays would hand each other taps, which is measurably
 * worse than a small target.
 */
export const TAP_44 =
  'relative max-md:after:absolute max-md:after:top-1/2 max-md:after:left-1/2 ' +
  'max-md:after:size-11 max-md:after:min-h-full max-md:after:min-w-full ' +
  'max-md:after:-translate-x-1/2 max-md:after:-translate-y-1/2 max-md:after:content-[""]';

/**
 * The other half of the rule above: a 44 × 44 REAL box for a control that draws
 * no fill and no border, so growing it moves no pixel and pushes its neighbours
 * apart instead of overlapping them. `grid place-items-center` keeps the glyph
 * where it was.
 */
export const TAP_44_BOX = 'max-md:grid max-md:size-11 max-md:place-items-center';
