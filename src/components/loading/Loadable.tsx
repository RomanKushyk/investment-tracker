import { useState, type ReactNode } from 'react';

import { useHold } from '../../hooks/loading';
import { useViewGate } from '../../hooks/queries';

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
  const shown = useHold(gate === 'pending');
  const [waited] = useState(gate === 'pending');

  if (gate === 'signedOut') return null;
  if (shown) return placeholder;
  if (gate === 'pending') return null;
  return waited ? (
    <div className="animate-in duration-300 fade-in slide-in-from-bottom-2">{children}</div>
  ) : (
    children
  );
}
