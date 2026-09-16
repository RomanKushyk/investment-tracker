/**
 * A 44 × 44 pressable region below the breakpoint WITHOUT moving the drawn box, since
 * growing the controls would rewrite five radii keyed to the short side. USE IT ONLY ON
 * A CONTROL THAT HAS A DRAWN BOX, or whose small box is itself a drawn value; an inline
 * link in a sentence gets NEITHER helper, because the overlay resolves against its
 * first line box. THE CALLER OWES THE GAP: `gap >= (44 − w)/2` against a plain
 * neighbour, `gap >= 44 − w` when that neighbour carries an overlay too — and a caller
 * that can make neither uses a real 44 box, or the overlays hand each other taps.
 */
export const TAP_44 =
  'relative max-md:after:absolute max-md:after:top-1/2 max-md:after:left-1/2 ' +
  'max-md:after:size-11 max-md:after:min-h-full max-md:after:min-w-full ' +
  'max-md:after:-translate-x-1/2 max-md:after:-translate-y-1/2 max-md:after:content-[""]';

/** The other half: a REAL box reserved for a control that draws none, so growing it
 *  moves no pixel and pushes its neighbours apart instead of overlapping them. */
export const TAP_44_BOX = 'max-md:grid max-md:size-11 max-md:place-items-center';

/** The rail item's own drawn box, so the burger tiles with the ten below it. */
export const TAP_RAIL =
  'relative after:absolute after:top-1/2 after:left-1/2 after:h-9 after:w-10 ' +
  'after:-translate-x-1/2 after:-translate-y-1/2 after:content-[""]';
