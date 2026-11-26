// The scroll bar's geometry (*Scrolling* in docs/DECISIONS.md), apart from `Scroller.tsx` so a band
// drawn outside a Scroller can line up with its content. Nothing else derives these figures.

// One margin all round, so the edge and the text are one distance; a floating bar takes less.
const RAIL_MARGIN = 8;
export const OVERLAY_MARGIN = 2;
// The bar is the thumb's width and the rail half of it, centred even on half pixels; the rail's
// radius is fixed rather than derived (*Scrolling*).
export const THUMB_WIDTH = 6;
export const RAIL_WIDTH = THUMB_WIDTH / 2;
export const RAIL_RADIUS = 1;
// A scrollport clips a focus ring, so the viewport pads by this and the gutter gives it back.
export const RING = 4;

/** The bar's margin from an edge of radius `radius`, measured at the Scroller's own box. */
export const railInset = (radius?: number) =>
  radius === undefined
    ? RAIL_MARGIN
    : Math.max(RAIL_MARGIN, Math.ceil(radius * (1 - Math.SQRT1_2)));

/** The root's gutter for a bar `inset` from the edge: the margin, the bar, the margin, less the
 *  ring allowance the viewport pads back. */
export const gutterOf = (inset: number) => 2 * inset + THUMB_WIDTH - RING;

/** How far a reserving Scroller's content stands from its box's inline edge. A band drawn outside
 *  the Scroller pads by this to line up with it. */
export const contentInset = (radius?: number) => gutterOf(railInset(radius)) + RING;

/** The ledger's Scroller on /transactions, whose skeleton lines its rows up with it. */
export const LEDGER_RADIUS = 20;

/** The dialog bands' inset: the body Scroller's content inset at the panel's radius. A top
 *  panel's bands take it too, though its own bar floats, so its steps line up with the header. */
export const DIALOG_RADIUS = 24;
const dialogInset = contentInset(DIALOG_RADIUS);
export const DIALOG_GUTTER = { paddingLeft: dialogInset, paddingRight: dialogInset };
