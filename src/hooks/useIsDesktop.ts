import { useSyncExternalStore } from 'react';

// THE ONE BREAKPOINT (phase 6, G-1). The app has exactly two shells and this is
// the switch between them: below it the sidebar is an off-canvas drawer and a
// header bar carries the capital; at it and above, today's layout in flow.
//
// 768 IS TAILWIND'S `md`, AND THE TWO MUST STAY EQUAL — every `max-md:` and
// `md:` in the app is the CSS half of this same decision, and the JS half is
// here because a drawer needs a focus trap and a focus trap needs to know which
// shell is mounted. Written as a literal rather than read back from
// `--breakpoint-md`: a whole shell that depends on a custom property having been
// emitted fails silently, and invisibly, if it has not.
//
// Why 768 and not the 640 the old rail switched at: the chrome costs 244 px of
// sidebar plus 72 px of `main` padding, so content only reaches 360 px at a
// 676 px viewport. At `sm` the shell technically holds but leaves 324 px; at
// `md` it leaves 452 px. 768 is also iPad portrait, which then lands on the
// desktop shell exactly.
const DESKTOP = '(min-width: 768px)';

// ONE MediaQueryList for the whole app, created lazily on first read. It used
// to be constructed inside `getSnapshot`, which `useSyncExternalStore` calls on
// every render of every consumer — `Layout`, three charts through
// `useTooltipTrigger`, `DailyQuotes` and every mounted `DatePicker` — so typing
// in a quote field allocated a handful of them per keystroke, each one an object
// the engine has to register and track, for a value that only changes on resize.
let mql: MediaQueryList | undefined;
const query = () => (mql ??= window.matchMedia(DESKTOP));

function subscribe(onChange: () => void) {
  const m = query();
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
}

/**
 * The same subscription, for a caller that needs to ACT on a crossing rather
 * than render from it — `Layout` closes the drawer and spends its history entry
 * there. Exported so the breakpoint stays written once: a second
 * `matchMedia('(min-width: 768px)')` somewhere else is how two shells become
 * three.
 */
export const subscribeToBreakpoint = subscribe;

// Hoisted so its identity is stable across renders, which is the other half of
// what `useSyncExternalStore` wants from a snapshot.
function snapshot(): boolean {
  return query().matches;
}

/**
 * `true` at and above the breakpoint. `useSyncExternalStore` rather than
 * `useState` + `useEffect`: the effect form renders once with a guessed value
 * and corrects it afterwards, which for a whole shell means mounting the wrong
 * one and swapping it on the first frame — a visible flash of the desktop rail
 * on every phone load. This reads the real value during the first render.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    snapshot,
    // No DOM (a test renderer, a future prerender): the desktop shell is the
    // reference layout, so it is the honest default rather than a guess.
    () => true,
  );
}
