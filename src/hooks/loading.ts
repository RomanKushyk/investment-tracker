import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// THE FIRST-PAINT LOADING STATE (design/extensions/first-paint.dc.html, brief #406). A read that
// answers soon shows nothing, since a placeholder flashed for that long reads as the app being slower
// than it is (Primer's loading patterns), and one that does not shows its boxes after 300 ms. Once
// shown they stay for a time of their own, so their fade-in always completes, as React holds a
// Suspense fallback before it reveals content.
export const PLACEHOLDER_AFTER_MS = 300;
export const PLACEHOLDER_HOLD_MS = 300;

/** Whether the placeholders show for a read that is `pending`: not before it has been out for
 *  `PLACEHOLDER_AFTER_MS`, and, once shown, not for less than `PLACEHOLDER_HOLD_MS`. */
export function usePlaceholder(pending: boolean): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    if (pending) {
      if (shown) return;
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setShown(true);
      }, PLACEHOLDER_AFTER_MS);
      return () => clearTimeout(timer);
    }
    if (!shown) return;
    const wait = Math.max(0, shownAt.current + PLACEHOLDER_HOLD_MS - Date.now());
    const timer = setTimeout(() => setShown(false), wait);
    return () => clearTimeout(timer);
  }, [pending, shown]);
  return shown;
}

// The status line outside the busy screen speaks while any placeholder waits: a count, since the
// view and a wide read can each hold one.
let waiting = 0;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Registers a placeholder as waiting for as long as `active`. */
export function useAnnounce(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    waiting += 1;
    notify();
    return () => {
      waiting -= 1;
      notify();
    };
  }, [active]);
}

/** Whether the placeholders show for a read that is `pending`, and the status line says so. */
export function useHold(pending: boolean): boolean {
  const shown = usePlaceholder(pending);
  useAnnounce(shown && pending);
  return shown;
}

/** Whether any placeholder is waiting on its read. */
export function useLoadingAnnounced(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => waiting > 0,
    () => false,
  );
}
