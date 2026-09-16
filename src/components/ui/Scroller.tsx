// The app's one scroll surface: a platform bar cuts a rounded panel's corner and takes
// layout width on one OS and none on another, so a screen reflows per platform. THE
// RAIL'S GEOMETRY IS DERIVED UNDER *Scrolling* in docs/DECISIONS.md — the constants
// below carry it and nothing here re-derives it. The resting thumb is deliberately
// under the 3 : 1 WCAG 1.4.11 asks of a non-text indicator, and `field-border.test.ts`
// pins it there: a scroll region is identified by its content moving.
import { ScrollArea } from 'radix-ui';
import type { CSSProperties, ReactNode } from 'react';

// One margin on all four sides, so the distance to the parent's edge and to the text
// are one number. A floating bar has nothing beside it and takes the smaller one.
const RAIL_MARGIN = 8;
const RAIL_WIDTH = 12;
const OVERLAY_MARGIN = 2;
// A scrollport clips ink overflow and a focus ring is ink overflow, so a `w-full`
// control flush with the viewport's box loses its ring. The viewport takes this as
// padding and the root gives it back out of the gutter, so the content does not move.
const RING = 4;

// One uniform margin does three jobs, because Radix pins each rail by its own edges:
// the pinned edge moves it in, the two along the axis shorten it, the fourth is inert.
const RAIL =
  'm-(--rail-inset) flex touch-none select-none border-panel-border p-[2px] ' +
  'data-[orientation=vertical]:w-(--rail-w) data-[orientation=vertical]:border-2 data-[orientation=vertical]:rounded-[5px] ' +
  'data-[orientation=horizontal]:h-(--rail-w) data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:border-2 data-[orientation=horizontal]:rounded-[5px]';

// Do not bind a fill to the visible data-state: Radix marks the thumb visible the
// whole time a rail is up, and that variant outranks `hover:` in generated-CSS
// order, so the dragged thumb never reaches the value 1.4.11 is cleared on.
const THUMB =
  'bg-faint hover:bg-muted active:bg-muted relative flex-1 rounded-[1px] transition-colors duration-200';

export interface ScrollerProps {
  children: ReactNode;
  /**
   * Which axis may overflow. PREFER `both` WHENEVER THE CONTENT IS NOT YOURS TO
   * PREDICT: the axis you leave out is not merely unscrollable, it is
   * `overflow: hidden`, and whatever crosses it is gone with no bar to say so.
   */
  orientation?: 'vertical' | 'horizontal' | 'both';
  /**
   * Classes for the VIEWPORT, and THE HEIGHT LIMIT BELONGS HERE. On the root it looks
   * identical and silently does not scroll: `h-full` resolves to auto against a root
   * that has only a max-height, so the viewport grows and the root just clips it.
   */
  className?: string;
  /**
   * Radius of the edge this rail runs into, measured at the Scroller's OWN box. It
   * moves the rail by nothing on any surface the app has drawn; what it DOES do is open
   * the inline gutter on both sides, outside the scroll box — so add no inline padding
   * of your own, which would slide away as soon as content scrolled over it.
   */
  radius?: number;
  /**
   * For a column too narrow to reserve a gutter in: the bar floats at the edge. IT IS
   * NOT A PREFERENCE — the rule it suspends, no row read through a bar, holds anywhere
   * text or a value runs to the edge. It SUPERSEDES `radius`, which only ever widens a
   * reserve there is none of.
   */
  overlay?: boolean;
}

export function Scroller({
  children,
  orientation = 'vertical',
  className = '',
  radius,
  overlay = false,
}: ScrollerProps) {
  const inset = overlay
    ? OVERLAY_MARGIN
    : radius === undefined
      ? RAIL_MARGIN
      : Math.max(RAIL_MARGIN, Math.ceil(radius * (1 - Math.SQRT1_2)));
  // A custom property because the number is per caller while the `:has()` test that
  // applies it can only live in a class.
  const rootStyle = {
    '--rail-inset': `${inset}px`,
    '--rail-w': `${RAIL_WIDTH}px`,
    '--rail-gutter': `${2 * inset + RAIL_WIDTH - RING}px`,
  } as CSSProperties;
  return (
    <ScrollArea.Root
      type="auto"
      style={rootStyle}
      // The child combinator matters: a Scroller nested in another must not budge it.
      className={
        'relative h-full overflow-hidden ' +
        // THE GUTTER IS THE ROOT'S PADDING, NEVER THE VIEWPORT'S: padding on the
        // viewport lives inside the scroll box and holds only at the ends of the range.
        // A `radius` caller takes it on both sides whether or not a rail is up, because
        // gating it flips the panel between symmetric and lopsided as content grows.
        //
        // `-mx-1` BELONGS TO THE FLAG: with no gutter to pay the viewport's `px-1` out
        // of, a narrow column would lose that width and clip its items.
        (overlay
          ? '-mx-1'
          : 'has-[>[data-orientation=horizontal]]:pb-(--rail-gutter) ' +
            (radius === undefined
              ? 'has-[>[data-orientation=vertical]]:pr-(--rail-gutter)'
              : 'px-(--rail-gutter)'))
      }
    >
      {/* `tabIndex` because a scroll region with no focusable children is otherwise
          unreachable by keyboard (WCAG 2.1.1). `px-1` is the ring allowance. */}
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
