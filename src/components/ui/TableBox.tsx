import type { ReactNode } from 'react';

import { useDocumentTop } from '../../hooks/useDocumentTop';
import { Scroller } from './Scroller';

/**
 * A table's own scroll box, on both axes, so its header can stick (*Scrolling*). It fills the
 * viewport down to 80 px from its bottom, as the ledger's does, and never falls under 200.
 */
export function TableBox({ children }: { children: ReactNode }) {
  const ref = useDocumentTop('--table-top');
  return (
    // The box reaches the card's edge over its 22 px padding, so the fixed rail gutter takes the
    // padding's place rather than adding to it; the radius is that edge's, the card's 24.
    <div ref={ref} className="-mx-[22px]">
      <Scroller
        orientation="both"
        radius={24}
        // `scroll-pt-9`: a control focused under the 36 px band scrolls clear of it.
        className="max-h-[max(200px,calc(100dvh-var(--table-top,197px)-80px))] scroll-pt-9"
      >
        {children}
      </Scroller>
    </div>
  );
}
