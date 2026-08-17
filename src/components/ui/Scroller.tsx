// The app's one scroll surface (Phase 6 / design/extensions/mobile.dc.html S5).
//
// WHY IT EXISTS. Every box whose size is constrained while its children are not
// was scrolling with the platform's own bar: a square-cornered track running the
// full height of a rounded panel, drawn over the content, taking layout width on
// some platforms and none on others. Inside a `rounded-3xl` dialog that is a
// straight edge cutting the corner it sits in.
//
// THE CONSTRUCTION, 12 px across — 2 + 2 + 4 + 2 + 2:
//
//     2 px  rail stroke      border-2 border-panel-border
//     2 px  gap              the rail's padding
//     4 px  thumb            bg-faint, bg-muted while dragging
//     2 px  gap
//     2 px  rail stroke
//
// in a RESERVED GUTTER of `2m + 12` = 28 — the rail, with the SAME margin on
// every side of it, so the distance to the parent's edge and the distance to the
// text are one number. The bar pushes the content over instead of floating above it,
// which is the whole difference from the platform's: no row is ever read through
// a track, and there is no moment where a value is hidden by furniture or
// crowded against it.
//
// THE RAIL IS DRAWN, and that is the point: a thumb alone says where you are but
// not that the region scrolls at all. The rail is the affordance, the thumb is
// the state. It is present whenever the content overflows — a rail that appeared
// only mid-scroll would announce the affordance at the moment it stops being
// needed.
//
// RADII ARE CONCENTRIC, NOT PROPORTIONAL — thumb 1, rail 5. D56's other half
// applies here: `outer = inner + gap`, and the gap from the thumb to the rail's
// outer face is the 2px padding plus the 2px stroke, so 1 + 4 = 5. The
// proportional half of D56 cannot be used — it reads `round(min(w, h) × 0.26)`
// off two DESIGNED dimensions, and a rail's length is its panel's height while a
// thumb's is the viewport-to-content ratio. Neither is chosen and both change
// without anyone deciding, so there is no short side to key on. Same objection
// the mobile header and action bars raise, with the opposite answer: those bars
// end at the viewport and have nothing to round, while these ends are free.
//
// COLOUR, measured on `card` rather than picked: rail `panel-border` 1.37:1,
// thumb `faint` 2.12:1 at rest and `muted` 3.46:1 while dragging (dark: 1.36,
// 3.29, 6.04 — stronger, so nothing branches on theme). The resting thumb is
// deliberately below the 3:1 WCAG 1.4.11 asks of a non-text indicator: 1.4.11
// covers information REQUIRED to identify a component or its state, and a scroll
// region is identified by its content — position is carried by the content moving
// too, and the rail already marks where the control is. The passing value arrives
// when the thumb is actually being used.
import { ScrollArea } from 'radix-ui';
import type { CSSProperties, ReactNode } from 'react';

// ONE MARGIN, 8, EQUAL ON ALL FOUR SIDES — and the gutter is `2m + 12` around
// it, so 28, everywhere. The rail is a box in a strip, and a box with more air
// on one side than the other reads as misplaced rather than inset: the distance
// to the parent's edge and the distance to the text are the same number. There
// is nothing called a "content gap" — the air before the text IS the margin.
//
// TWO EARLIER RULES ARE GONE, and the reason is worth keeping. Against a rounded
// parent the inset was first `R − r` (19 in a dialog), the gap at which the
// rail's r5 shares the corner's centre exactly, then `R − 2r` (14), a relaxed
// version of the same idea. Both were drawn and both were dropped: a bar pushed
// 14–19px off its own edge reads as floating in the gutter rather than belonging
// to it, and the concentricity it buys is invisible on a shape as thin as a rail
// — nothing in the panel is near enough to compare arcs with. The exchange is
// real estate: at 24 a dialog spent 40px a side on gutters, and now spends 28.
//
// The arc still gets a guard, it just no longer sets the number. The floor is
// where the rail's corner lands on the 45° point of the parent's arc — solve
// `d = R − sqrt(R² − (R − d)²)` and it falls out as `R(1 − 1/√2)`: 7.03 at a 24,
// 4.69 at a 16, both under 8, which is why one flat margin is safe on every
// surface in the app today. `Math.max` keeps it safe on a surface rounder than
// any drawn yet — past R 27 the floor overtakes 8 and takes over.
const RAIL_MARGIN = 8;
const RAIL_WIDTH = 12;
// A scrollport clips ink overflow, and a focus ring is ink overflow: `:focus-visible`
// is a 2px outline at 2px offset, so a `w-full` control flush with the viewport's
// box — every sidebar nav pill, every dialog input — loses the ring on both sides.
// The old aside gave 16px of clearance because IT was the scroll box and had p-4;
// the viewport has none. So 4px of the gutter is handed to the viewport as padding
// and taken off the root's share: the content still sits `2m + 12` from the parent,
// and the ring has room inside the clip.
const RING = 4;

// `m-(--rail-inset)` is one uniform margin doing three jobs, because Radix pins
// each rail by its own edges: the margin on the pinned edge (`right` for a
// vertical rail, `bottom` for a horizontal one) moves it in, the two along the
// axis shorten it, and the fourth is inert against a fixed width.
const RAIL =
  'm-(--rail-inset) flex touch-none select-none border-panel-border p-[2px] ' +
  'data-[orientation=vertical]:w-(--rail-w) data-[orientation=vertical]:border-2 data-[orientation=vertical]:rounded-[5px] ' +
  'data-[orientation=horizontal]:h-(--rail-w) data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:border-2 data-[orientation=horizontal]:rounded-[5px]';

// A bg-faint bound to the visible data-state USED TO BE HERE and it cancelled the
// hover: both selectors are (0,2,0), Tailwind emits the data-variant after the
// hover-variant, and Radix marks the thumb visible the whole
// time a rail is up. So the thumb sat at `faint` while being dragged, i.e. the
// 3:1 value the colour note below rests on was never reached. It was redundant
// as well as harmful — the base class already paints `faint`.
//
// The transition lives here rather than on the rail: the thumb is the only part
// with a colour to change, and CLAUDE.md's motion rule ("nothing pops or snaps")
// applies to the one element that actually moves between two values.
const THUMB =
  'bg-faint hover:bg-muted active:bg-muted relative flex-1 rounded-[1px] transition-colors duration-200';

export interface ScrollerProps {
  children: ReactNode;
  /**
   * Which axis may overflow. `both` draws either rail as its axis needs it —
   * `type="auto"` mounts each one only on real overflow, so this costs nothing
   * until it is needed. PREFER IT WHENEVER THE CONTENT IS NOT YOURS TO
   * PREDICT: the axis you leave out is not merely unscrollable, it is
   * `overflow: hidden`, and whatever crosses it is gone with no bar to say so.
   */
  orientation?: 'vertical' | 'horizontal' | 'both';
  /**
   * Classes for the VIEWPORT, and THE HEIGHT LIMIT BELONGS HERE — `max-h-…`,
   * `h-…`, padding, all of it. Putting the limit on the root instead looks
   * identical and silently does not scroll: the viewport is `h-full`, a
   * percentage height against a root that has only a max-height resolves to
   * auto, so the viewport grows to its content and the root just clips it.
   */
  className?: string;
  /**
   * Radius of the rounded edge this rail runs into, MEASURED AT THE SCROLLER'S
   * OWN BOX — a surface of radius R seen from inside p px of padding presents
   * `R − p`.
   *
   * BE HONEST ABOUT WHAT IT DOES TODAY: the inset is `max(8, ceil(R(1 − 1/√2)))`
   * and that is 8 for every R up to 27, so at the app's 24 and 16 this prop moves
   * the rail by nothing at all — it is a guard for a rounder surface than any yet
   * drawn. Its LIVE effect is the one below, and that is the reason to pass it.
   *
   * PASSING IT ALSO OPENS THE INLINE GUTTER ITSELF — `2 × inset + 12` on both
   * sides, fixed, outside the scroll box. So DO NOT ADD INLINE PADDING OF YOUR
   * OWN for it: yours would live inside the scroll box, where it holds only
   * until something scrolls across it. Bands outside the Scroller (a dialog's
   * header and footer) still pad themselves, to the same number, so their text
   * lines up with the body's.
   */
  radius?: number;
}

export function Scroller({
  children,
  orientation = 'vertical',
  className = '',
  radius,
}: ScrollerProps) {
  const inset =
    radius === undefined
      ? RAIL_MARGIN
      : Math.max(RAIL_MARGIN, Math.ceil(radius * (1 - Math.SQRT1_2)));
  // The gutter rides on a custom property because the number is computed per
  // caller while the `:has()` test that applies it can only live in a class: an
  // inline style cannot ask whether a rail exists, and a class cannot know this
  // rail's radius.
  const rootStyle = {
    '--rail-inset': `${inset}px`,
    '--rail-w': `${RAIL_WIDTH}px`,
    '--rail-gutter': `${2 * inset + RAIL_WIDTH - RING}px`,
  } as CSSProperties;
  return (
    <ScrollArea.Root
      type="auto"
      style={rootStyle}
      // `auto` and not `always`: the rail appears only when the content actually
      // overflows, so a list that fits draws no furniture at all.
      //
      // THE RAIL PUSHES THE CONTENT OVER rather than lying on top of it: the
      // root reserves what the rail wants — its margin, the 12 of rail, and the
      // same margin again, so 28 for a free-standing one — and nothing is read
      // through a bar, nothing
      // is read pressed against one either. A horizontal rail would otherwise
      // sit exactly where a table's last row is.
      // Reserved only while the rail exists, and the child combinator matters:
      // a Scroller nested inside another (a table inside a dialog) must not
      // make the outer one budge. A caller that passed a `radius` has already
      // sized that side itself, so this reserve stands down rather than adding
      // a second gutter on top of the one the inset was measured into.
      //
      // `h-full` so the height chain closes when the CALLER is the one holding
      // the limit (the sidebar is `h-screen` and the Scroller has to reach its
      // floor for the bottom cluster's `mt-auto` to have one). Against a parent
      // of automatic height it resolves to auto and changes nothing, which is
      // the max-h-on-the-viewport case.
      className={
        'relative h-full overflow-hidden has-[>[data-orientation=horizontal]]:pb-(--rail-gutter) ' +
        // THE GUTTER IS THE ROOT'S PADDING, NEVER THE VIEWPORT'S. Padding on
        // the viewport lives INSIDE the scroll box, so it only guarantees a gap
        // at the END of the scroll range: at every other position the content
        // slides straight under a rail that floats above it. Padding here takes
        // the strip out of the scroll box altogether, and the rail stands
        // beside the content instead of over it — on either axis.
        //
        // A `radius` caller takes the gutter on BOTH inline sides and keeps it
        // whether or not a rail is up. Both, because the side without a rail
        // still has to hold the text off the panel edge, and a caller cannot do
        // it with its own padding: that padding would sit inside the scroll box
        // and slide away the moment the content scrolled across it, leaving the
        // text flush against the edge. Always, because gating it would make the
        // panel jump between symmetric and lopsided as content grew past the
        // fold. Everyone else reserves only while the rail is up, so a list that
        // fits keeps its full width.
        (radius === undefined
          ? 'has-[>[data-orientation=vertical]]:pr-(--rail-gutter)'
          : 'px-(--rail-gutter)')
      }
    >
      {/* The viewport is the scroller — and it is what the reserved strip is
          taken from, so the rail lands beside the content, never over it. */}
      {/* `tabIndex` because a scroll region with no focusable children is
          otherwise unreachable by keyboard: the panel used to be the scroll box
          and answered PageDown, and moving the scrolling here took that away
          (WCAG 2.1.1). `px-1` is the ring allowance — see RING. */}
      <ScrollArea.Viewport tabIndex={0} className={`h-full w-full px-1 ${className}`}>
        {children}
      </ScrollArea.Viewport>
      {orientation !== 'horizontal' && (
        <ScrollArea.Scrollbar orientation="vertical" className={RAIL}>
          <ScrollArea.Thumb className={THUMB} />
        </ScrollArea.Scrollbar>
      )}
      {orientation !== 'vertical' && (
        <ScrollArea.Scrollbar orientation="horizontal" className={RAIL}>
          <ScrollArea.Thumb className={THUMB} />
        </ScrollArea.Scrollbar>
      )}
      {orientation === 'both' && <ScrollArea.Corner />}
    </ScrollArea.Root>
  );
}
