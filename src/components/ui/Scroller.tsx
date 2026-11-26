// The app's one scroll surface: a platform bar cuts a rounded panel's corner and takes
// layout width on one OS and none on another, so a screen reflows per platform. THE
// BAR'S GEOMETRY IS DERIVED UNDER *Scrolling* in docs/DECISIONS.md — `scroller-geometry.ts`
// carries it and nothing here re-derives it. The thumb's body holds the 3 : 1 WCAG
// 1.4.11 asks against its rail and the glass, pinned by `scroller-contrast.test.ts`.
import { ScrollArea } from 'radix-ui';
import type { CSSProperties, ReactNode } from 'react';

import {
  OVERLAY_MARGIN,
  RAIL_RADIUS,
  RAIL_WIDTH,
  THUMB_WIDTH,
  gutterOf,
  railInset,
} from './scroller-geometry';

// One margin, as Radix pins a bar by its own edges; the rail is a layer, never in the flow,
// where it would push the thumb, so the hit area stays the thumb-wide box.
const RAIL =
  'm-(--rail-inset) flex touch-none select-none ' +
  'before:pointer-events-none before:absolute before:rounded-(--rail-r) before:scroll-rail forced-colors:before:bg-[GrayText] ' +
  'data-[orientation=vertical]:w-(--thumb-w) data-[orientation=vertical]:before:inset-y-0 data-[orientation=vertical]:before:left-1/2 data-[orientation=vertical]:before:w-(--rail-w) data-[orientation=vertical]:before:-translate-x-1/2 ' +
  'data-[orientation=horizontal]:h-(--thumb-w) data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:before:inset-x-0 data-[orientation=horizontal]:before:top-1/2 data-[orientation=horizontal]:before:h-(--rail-w) data-[orientation=horizontal]:before:-translate-y-1/2';

// Do not bind a fill to the visible data-state: Radix marks the thumb visible the
// whole time a rail is up, and that variant outranks `hover:` in generated-CSS
// order, so the dragged thumb never reaches its own step.
const THUMB =
  'relative flex-1 rounded-[2px] bg-accent hover:bg-accent-hover active:bg-accent-pressed scroll-thumb ' +
  'transition-control-colors duration-200 forced-colors:bg-none ' +
  'forced-colors:bg-[CanvasText] forced-colors:hover:bg-[CanvasText] forced-colors:active:bg-[CanvasText]';
// The glass knob's sheen runs across the thumb's short side.
const SHEEN = {
  vertical: 'bg-[linear-gradient(90deg,var(--color-glass-knob-sheen)_0%,transparent_40%)]',
  horizontal: 'bg-[linear-gradient(180deg,var(--color-glass-knob-sheen)_0%,transparent_40%)]',
};

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
  const inset = overlay ? OVERLAY_MARGIN : railInset(radius);
  // A custom property because the number is per caller while the `:has()` test that
  // applies it can only live in a class.
  const rootStyle = {
    '--rail-inset': `${inset}px`,
    '--thumb-w': `${THUMB_WIDTH}px`,
    '--rail-w': `${RAIL_WIDTH}px`,
    '--rail-r': `${RAIL_RADIUS}px`,
    '--rail-gutter': `${gutterOf(inset)}px`,
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
          <ScrollArea.Thumb className={`${THUMB} ${SHEEN.vertical}`} />
        </ScrollArea.Scrollbar>
      )}
      {orientation !== 'vertical' && (
        <ScrollArea.Scrollbar orientation="horizontal" className={RAIL}>
          <ScrollArea.Thumb className={`${THUMB} ${SHEEN.horizontal}`} />
        </ScrollArea.Scrollbar>
      )}
      {orientation === 'both' && <ScrollArea.Corner />}
    </ScrollArea.Root>
  );
}
