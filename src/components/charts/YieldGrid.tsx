import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { useT } from '../../i18n/useT';
import { Bar, Block } from '../loading/Placeholder';

// Two columns while the card is ≥ 600 px inside (`open-values-charts-type.md` § Signed): the grid
// measures its own box, the card's content, as the tooltip reads its plot's width.
const TWO_COLUMNS = 600;

/** A panel's title row and plot, as wave 25's render draws them. */
export const PANEL_TITLE = 22;
export const PANEL_PLOT = 170;
/** #338's message holds two rows of panels and their gap at every width, as wave 25's render
 *  draws it. */
export const TWO_PANEL_ROWS = 2 * (PANEL_TITLE + PANEL_PLOT) + 24;

const columnsOf = (width: number) => (width >= TWO_COLUMNS ? 2 : 1);

/** /yield's small-multiple grid, shared by the panels and their placeholder. No recharts here, so
 *  the placeholder stays light. */
export function YieldGrid({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // The count, not the width: a resize that keeps it re-renders no chart.
  const [columns, setColumns] = useState<1 | 2>(1);
  useLayoutEffect(() => {
    // Read before the first paint; the observer's first report comes after it.
    setColumns(columnsOf(ref.current!.clientWidth));
    const observer = new ResizeObserver(([entry]) =>
      setColumns(columnsOf(entry.contentRect.width)),
    );
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      data-yield-grid
      data-columns={columns}
      className="grid gap-x-8 gap-y-6"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

/** The toggle as a block, sized by its own words set unseen as `SegmentedControl`'s `md` sets them,
 *  so it fits either language. */
export function ToggleBlock() {
  const t = useT().analytics.yield;
  return (
    <div className="mb-3 flex justify-end">
      <div className="relative">
        <Block kind="toggle" className="absolute inset-0 rounded-[12px]" />
        <div aria-hidden="true" className="invisible grid grid-cols-2 gap-1 p-[5px]">
          {/* «Окремо» opens selected, in bold; the other segment is semibold. */}
          <span className="h-7 px-3 text-small font-bold whitespace-nowrap">{t.viewSeparate}</span>
          <span className="h-7 px-3 text-small font-semibold whitespace-nowrap">
            {t.viewCombined}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The card held before its curve answers (wave 23 L2): the toggle as a block over one title bar
 *  and one chart block at r6 per panel. */
export function YieldGridBlocks({ panels }: { panels: number }) {
  return (
    <>
      <ToggleBlock />
      <YieldGrid>
        {Array.from({ length: panels }, (_, i) => (
          <div key={i}>
            <div className="flex items-center" style={{ height: PANEL_TITLE }}>
              <Bar w="40%" />
            </div>
            {/* Literal, for Tailwind's scan: PANEL_PLOT's 170. */}
            <Block kind="chart" className="h-[170px] rounded-[6px]" />
          </div>
        ))}
      </YieldGrid>
    </>
  );
}
