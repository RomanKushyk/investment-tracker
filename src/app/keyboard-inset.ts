import { useSyncExternalStore } from 'react';

// How far the virtual keyboard reaches up from the bottom of the LAYOUT viewport.
//
// WHY THE MODULE EXISTS: `fixed; bottom: 0` pins to the layout viewport, and the keyboard
// does not resize it — iOS draws the keyboard OVER the page, and so does Chrome on Android
// under the default `interactive-widget=resizes-visual` — so a bar meant to stay in reach
// has to be lifted by this number. Where an engine does shrink the layout viewport the
// formula reads 0, so one serves both. THIS MODULE IS THE SINGLE WRITER of `--keyboard-inset`.
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

/** How far the visual viewport must lose to count as a keyboard, Ionic's own threshold: less is a
 *  toolbar. Its height alone, never its scroll, and only at full width, which a pinch is not. */
const KEYBOARD_PX = 150;
const NOT_TEXT = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

// A field in a modal is the modal's: its own sheet rides the keyboard, and the page behind is hidden.
function takesText(el: Element | null): boolean {
  if (!(el instanceof HTMLElement) || el.closest('[role="dialog"], [role="alertdialog"]')) {
    return false;
  }
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !NOT_TEXT.has(el.type);
}

function keyboardOpen(): boolean {
  const vv = window.visualViewport;
  if (!vv || !takesText(document.activeElement)) return false;
  return vv.width >= window.innerWidth - 1 && window.innerHeight - vv.height > KEYBOARD_PX;
}

// Focus moving between two fields fires `focusout` before `focusin`, with `<body>` focused
// between them: told a task later, the move reads as one open keyboard, not a close and a reopen.
function subscribeKeyboard(onChange: () => void) {
  const off = subscribe(onChange);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 0);
  };
  document.addEventListener('focusin', onChange);
  document.addEventListener('focusout', later);
  return () => {
    off();
    clearTimeout(timer);
    document.removeEventListener('focusin', onChange);
    document.removeEventListener('focusout', later);
  };
}

/** Whether the on-screen keyboard is up, for a surface that changes with it rather than moving by
 *  `--keyboard-inset`. A focused field alone is also a hardware keyboard, which covers nothing. */
export function useKeyboardOpen(): boolean {
  return useSyncExternalStore(subscribeKeyboard, keyboardOpen, () => false);
}
