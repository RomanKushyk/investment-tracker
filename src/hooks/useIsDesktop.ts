import { useSyncExternalStore } from 'react';

// THE ONE BREAKPOINT. 768 IS TAILWIND'S `md`, AND THE TWO HALVES MUST STAY EQUAL: every
// `max-md:` and `md:` in the app is the CSS half of this one decision, and the JS half
// is here because a drawer needs a focus trap and a focus trap has to know which shell
// is mounted. A LITERAL rather than `--breakpoint-md`, because a whole shell that
// depends on a custom property having been emitted fails silently if it has not.
// *Two shells, one breakpoint*
const DESKTOP = '(min-width: 768px)';

// ONE MediaQueryList for the whole app, lazily: built inside `getSnapshot` it is
// rebuilt on every render of every consumer, for a value that changes on resize.
let mql: MediaQueryList | undefined;
const query = () => (mql ??= window.matchMedia(DESKTOP));

function subscribe(onChange: () => void) {
  const m = query();
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
}

/** The same subscription, for a caller that needs to ACT on a crossing rather than
 *  render from it. Exported so the breakpoint stays written once: a second
 *  `matchMedia` elsewhere is how two shells become three. */
export const subscribeToBreakpoint = subscribe;

// Hoisted so its identity is stable, the other half of what the store wants.
function snapshot(): boolean {
  return query().matches;
}

/** `true` at and above the breakpoint. `useSyncExternalStore` and not `useState` with
 *  `useEffect`: the effect form renders once with a guess and corrects it after, which
 *  for a whole shell is a visible flash of the desktop rail on every phone load. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    snapshot,
    // No DOM: the desktop shell is the reference layout, so it is the honest default.
    () => true,
  );
}
