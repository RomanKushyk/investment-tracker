import { useSyncExternalStore } from 'react';

// How far the virtual keyboard reaches up from the bottom of the LAYOUT
// viewport, in CSS pixels. Zero when no keyboard is up.
//
// WHY THIS IS NEEDED AT ALL. `position: fixed; bottom: 0` pins to the layout
// viewport, and the two platforms disagree about what the keyboard does to it:
// Android Chrome shrinks the layout viewport, so a fixed bar rides up by itself,
// while iOS Safari leaves it alone and simply draws the keyboard over the bottom
// of the page. On iOS the bar is then UNDER the keyboard — which is precisely
// the state S4 exists to fix (B4: the keyboard covers the quote input and
// `Save snapshot` together).
//
// The visual viewport is the part actually on screen, so
// `innerHeight − (height + offsetTop)` is the strip the keyboard has taken. It
// reads 0 on Android because there the layout viewport already moved, which is
// why one formula serves both.
// `!vv` and NOT `vv === null`. `lib.dom` types the property as
// `VisualViewport | null`, so the strict compare typechecks — but an engine that
// does not implement the API has no property at all, and the runtime value is
// `undefined`, which walks straight past `=== null` and throws on the next line.
// Inside `useSyncExternalStore`'s subscribe that takes down the whole route.
function subscribe(onChange: () => void) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  // `scroll` as well as `resize`: on iOS the page can be scrolled WITHIN the
  // visual viewport while the keyboard is up, which moves `offsetTop` without
  // changing `height`.
  vv.addEventListener('resize', onChange);
  vv.addEventListener('scroll', onChange);
  return () => {
    vv.removeEventListener('resize', onChange);
    vv.removeEventListener('scroll', onChange);
  };
}

function snapshot(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  // Rounded, because `useSyncExternalStore` re-renders on any change and a
  // fractional value that jitters by a hundredth of a pixel would re-render on
  // every scroll frame for no visible difference.
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}
