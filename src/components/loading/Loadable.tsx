import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { PLACEHOLDER_AFTER_MS, PLACEHOLDER_HOLD_MS, useAnnounce } from '../../hooks/loading';
import { useViewGate, useViewPending } from '../../hooks/queries';

// The view's placeholder clocks live in the shell, above the screen `Layout` remounts on a route
// change. The delay is the read's: due once the view has been out for its time, whatever screen is
// mounted. The hold is the drawn placeholder's: from a screen's first draw, so it never holds back
// an answer for a placeholder nobody saw, and never cuts one short.
type Held = { due: boolean; drawn: boolean; draw: () => void };
const ViewHeld = createContext<Held>({ due: false, drawn: false, draw: () => {} });

/** Holds the view's placeholder clocks for the screens below it. */
export function ViewClock({ children }: { children: ReactNode }) {
  const pending = useViewPending();
  const [due, setDue] = useState(false);
  if (due && !pending) setDue(false);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setDue(true), PLACEHOLDER_AFTER_MS);
    return () => clearTimeout(timer);
  }, [pending]);
  const [drawnAt, setDrawnAt] = useState<number>();
  // A read that starts again is a new one, as after an account change: the last one's hold is not its.
  const [was, setWas] = useState(pending);
  if (was !== pending) {
    setWas(pending);
    if (pending) setDrawnAt(undefined);
  }
  useEffect(() => {
    if (pending || drawnAt === undefined) return;
    const wait = Math.max(0, drawnAt + PLACEHOLDER_HOLD_MS - Date.now());
    const timer = setTimeout(() => setDrawnAt(undefined), wait);
    return () => clearTimeout(timer);
  }, [pending, drawnAt]);
  const draw = useCallback(() => setDrawnAt((at) => at ?? Date.now()), []);
  return (
    <ViewHeld value={{ due: due && pending, drawn: drawnAt !== undefined, draw }}>
      {children}
    </ViewHeld>
  );
}

/** A screen behind the view. Until the read answers the shell shows alone, then, if the answer is
 *  slow, the screen's placeholder (*Not found and failures*); a caller nobody has signed in sees
 *  neither the portfolio nor a placeholder for it. The real screen arrives with the animation a
 *  route change gives it when it replaced a placeholder, since a swap in place remounts nothing. */
export function Loadable({
  placeholder,
  children,
}: {
  placeholder: ReactNode;
  children: ReactNode;
}) {
  const gate = useViewGate();
  const held = useContext(ViewHeld);
  const shown = (held.due && gate === 'pending') || held.drawn;
  const { draw } = held;
  useEffect(() => {
    if (shown) draw();
  }, [shown, draw]);
  useAnnounce(shown && gate === 'pending');
  const [waited] = useState(gate === 'pending' || shown);

  if (gate === 'signedOut') return null;
  if (shown) return placeholder;
  if (gate === 'pending') return null;
  return waited ? (
    <div className="animate-in duration-300 fade-in slide-in-from-bottom-2">{children}</div>
  ) : (
    children
  );
}
