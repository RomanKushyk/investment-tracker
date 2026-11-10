import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { getRelativeCoordinate, useActiveTooltipDataPoints, usePlotArea } from 'recharts';
import type { MouseHandlerDataParam, PlotArea } from 'recharts';

import { useIsDesktop } from './useIsDesktop';

type Probe = (plot: PlotArea | undefined, pinned: readonly unknown[] | undefined) => void;

export interface TooltipPin {
  trigger: 'hover' | 'click';
  /** The `<Tooltip>`'s `active`: `false` while a pin is released, else recharts decides. */
  active: false | undefined;
  /** For the active dots, which read recharts' own click state and outlive `active={false}`. */
  released: boolean;
  /** The chart's `onClick`. */
  onClick: (data: MouseHandlerDataParam, event: MouseEvent<SVGGraphicsElement>) => void;
  /** Handed to `<TapPinPlot>` inside the chart. */
  probe: Probe;
}

// Tap to pin below `md` (`docs/superpowers/specs/2026-11-05-layout-refresh/charts.md`
// § Перенесено): recharts re-pins on every click and cannot clear its click state, so the release
// is held here.
export function useTooltipTrigger(data: readonly unknown[]): TooltipPin {
  const desktop = useIsDesktop();
  const [releasedPin, setReleased] = useState(false);
  const chart = useRef<{ plot?: PlotArea; pinned?: readonly unknown[] }>({});
  const probe = useCallback<Probe>((plot, pinned) => {
    chart.current = { plot, pinned };
  }, []);
  // Until a click lands on the plot, what recharts shows is its keyboard walk, never a pin.
  const clicked = useRef(false);

  const onClick = useCallback(
    ({ activeIndex }: MouseHandlerDataParam, event: MouseEvent<SVGGraphicsElement>) => {
      // Off the plot recharts keeps its click state and reports the old index: its own range test.
      const { plot, pinned } = chart.current;
      const { relativeX: x, relativeY: y } = getRelativeCoordinate(event);
      if (!plot || x < plot.x || x > plot.x + plot.width || y < plot.y || y > plot.y + plot.height)
        return;
      const wasPinned = clicked.current;
      clicked.current = true;
      if (desktop || activeIndex == null) return;
      // recharts has moved its pin already, but the chart has not re-rendered: `pinned` is the
      // point before this tap, clamped and recorded at any width by recharts itself.
      const same = wasPinned && (pinned?.includes(data[Number(activeIndex)]) ?? false);
      setReleased((r) => !r && same);
    },
    [desktop, data],
  );

  // recharts' Escape hides its box alone; the cursor and the dot follow the release.
  const released = !desktop && releasedPin;
  useEffect(() => {
    if (desktop || releasedPin) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && clicked.current && chart.current.pinned?.length) setReleased(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [desktop, releasedPin]);

  return {
    trigger: desktop ? 'hover' : 'click',
    active: released ? false : undefined,
    released,
    onClick,
    probe,
  };
}

/** Rendered inside the chart, where recharts' own hooks can read its plot and its pin. */
export function TapPinPlot({ probe }: { probe: Probe }): null {
  const plot = usePlotArea();
  const pinned = useActiveTooltipDataPoints();
  useEffect(() => probe(plot, pinned), [probe, plot, pinned]);
  return null;
}
