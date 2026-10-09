import { useEffect, useState } from 'react';

import { useToday } from './useToday';

/** The chip's fade, and the timer that unmounts it: never `transitionend`, which a throttled tab
 *  never fires (*Interaction rules*). */
export const CHIP_EXIT_MS = 220;

/** Date ranges, not rows, because the clock moves every row at once: after `day` is ahead below
 *  `xl`, `(fadeFrom, day]` still fading, `(holdFrom, day]` held open under a pointer. */
export interface Mark {
  day: string;
  fadeFrom?: string;
  holdFrom?: string;
}

export type ChipState = 'in' | 'out' | undefined;

/** The mark after the clock and the pointer have moved. Pure, and the SAME object when nothing
 *  moved, since the hook settles it during render. */
export function settle(m: Mark, today: string, over: boolean): Mark {
  // Forward: the earliest open range is kept, so a line that already folded never reopens.
  if (today > m.day) {
    return {
      day: today,
      fadeFrom: m.fadeFrom ?? m.day,
      ...(over ? { holdFrom: m.holdFrom ?? m.day } : {}),
    };
  }
  // Back: the line opens only while no pointer is over the list, and chip and weight go with it.
  if (today < m.day && !over) return { day: today };
  if (!over && m.holdFrom !== undefined) {
    return { day: m.day, ...(m.fadeFrom === undefined ? {} : { fadeFrom: m.fadeFrom }) };
  }
  return m;
}

/** The fade timer's end: the chip unmounts, a held line stays held. */
export function dropFade(m: Mark): Mark {
  return { day: m.day, ...(m.holdFrom === undefined ? {} : { holdFrom: m.holdFrom }) };
}

/** One row's mark: `wide`, line 1's chip from `xl`, follows `today`, since nothing there moves
 *  vertically; `narrow` and its line's fold `open` follow the held `day`. */
export function rowAhead(
  date: string,
  m: Mark,
  today: string,
): { wide: ChipState; narrow: ChipState; open: boolean } {
  const chip = (ahead: boolean): ChipState =>
    ahead ? 'in' : m.fadeFrom !== undefined && date > m.fadeFrom ? 'out' : undefined;
  return {
    wide: chip(date > today),
    narrow: chip(date > m.day),
    open: date > m.day || (m.holdFrom !== undefined && date > m.holdFrom),
  };
}

/** The ledger's rows-ahead mark: today's date as state, and whether a pointer is over the list. */
export function useRowsAhead() {
  const today = useToday();
  const [over, setOver] = useState(false);
  const [mark, setMark] = useState<Mark>(() => ({ day: today }));
  const next = settle(mark, today, over);
  // Settled during render, so the amount regains its bold in the render the clock causes.
  if (next !== mark) setMark(next);

  useEffect(() => {
    if (mark.fadeFrom === undefined) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const id = window.setTimeout(() => setMark(dropFade), reduce ? 0 : CHIP_EXIT_MS);
    return () => window.clearTimeout(id);
  }, [mark.fadeFrom, mark.day]);

  return {
    today,
    mark: next,
    // A touch has no hover, so its line folds at once.
    enter: (e: { pointerType: string }) => {
      if (!over && e.pointerType !== 'touch') setOver(true);
    },
    leave: () => setOver(false),
  };
}
