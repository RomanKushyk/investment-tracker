// How far the virtual keyboard reaches up from the bottom of the LAYOUT viewport.
//
// WHY THE MODULE EXISTS: `fixed; bottom: 0` pins to the layout viewport, and the two
// platforms disagree about what the keyboard does to it — Android shrinks it so a fixed
// bar rides up by itself, iOS leaves it alone and draws the keyboard OVER the page. The
// formula below reads 0 on Android because the layout viewport already moved, which is
// why one serves both. THIS MODULE IS THE SINGLE WRITER of `--keyboard-inset`.
//
// `!vv` and NOT `vv === null`: the property is typed `VisualViewport | null` so the
// strict compare typechecks, but an engine without the API has none at all and
// `undefined` walks past it and throws — at boot, taking the whole app down.
function subscribe(onChange: () => void) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  // `scroll` too: on iOS the page scrolls WITHIN the visual viewport while the
  // keyboard is up, moving `offsetTop` without changing `height`.
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
  // Rounded, or a value jittering by a hundredth of a pixel repaints every frame.
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

/** Publishes the number as `--keyboard-inset` on the root and keeps it live, from
 *  `main.tsx`. A CUSTOM PROPERTY RATHER THAN A HOOK, because three surfaces read it and
 *  one CANNOT subscribe: sonner's offset is a static string handed to a `<Toaster>`
 *  above the router. A hook would also listen on every dialog in the tree, open or
 *  closed, since a closed one stays mounted for its exit animation. */
export function publishKeyboardInset(): void {
  const write = () => {
    document.documentElement.style.setProperty('--keyboard-inset', `${snapshot()}px`);
  };
  write();
  subscribe(write);
}
