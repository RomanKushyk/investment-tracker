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
// This module OWNS `--keyboard-inset` the way `theme.ts` owns `data-theme`:
// one writer, on the root, kept live. Nothing else may compute it — three
// surfaces read it now (the `/` action bar, the Dialog panel, the toast
// offset), and a second copy of this arithmetic is a second answer.
//
// `!vv` and NOT `vv === null`. `lib.dom` types the property as
// `VisualViewport | null`, so the strict compare typechecks — but an engine that
// does not implement the API has no property at all, and the runtime value is
// `undefined`, which walks straight past `=== null` and throws on the next line.
// That runs at boot, before the first paint, so it would take down the whole app
// rather than one route.
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

/**
 * Publishes the same number as `--keyboard-inset` on the root, and keeps it
 * live. Called once, from `main.tsx`.
 *
 * A CSS CUSTOM PROPERTY RATHER THAN A HOOK, because three surfaces need this
 * value and only one of them is in a position to subscribe. `Dialog` renders
 * from two Radix roots and is kept MOUNTED while closed so its exit animation
 * can run (see Dialog.tsx), so a hook there would put a visual-viewport
 * listener on every dialog in the tree, open or not — Settings alone has
 * several — and re-render each of them on every scroll frame of an iOS page
 * that is merely being scrolled with the keyboard up. sonner's `mobileOffset`
 * cannot subscribe at all: it is one static string handed to a `<Toaster>` that
 * lives above the router.
 *
 * Writing a custom property re-renders NOTHING. The browser recomputes the
 * `calc()`s that read it and repaints, which is the whole of the work — where
 * the React route would have re-run every component between the root and the
 * bar to arrive at the same pixel.
 */
export function publishKeyboardInset(): void {
  const write = () => {
    document.documentElement.style.setProperty('--keyboard-inset', `${snapshot()}px`);
  };
  write();
  subscribe(write);
}
