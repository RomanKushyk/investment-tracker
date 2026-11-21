import { useLayoutEffect, useRef, useState } from 'react';

import { SERIES } from '@quirenote/core/colors';
import type { Asset } from '@quirenote/core/types';
import { MONO_ADVANCE } from './anatomy';

export interface BarPart {
  asset: Asset;
  /** Its share of the total, 0-100: the part's width. */
  share: number;
  /** The share as the legend prints it. */
  label: string;
}

// `charts.md` § Signed › Forms, A3: 28 px tall, 2 px gaps, 4 px corners, 11/700 labels.
const GAP = 2;
const CORNER = 4;
const LABEL_SIZE = 11;

/** Whether `label` fits inside a part `width` px wide, clear of its rounded corners. */
const fits = (label: string, width: number) =>
  label.length * LABEL_SIZE * MONO_ADVANCE + 2 * CORNER <= width;

// The update motion (`charts.md` § Signed › Anatomy, Motion). One figure for the growth and for
// the wait of a label that starts to fit, so the label can never outrun its part.
const GROW_MS = 400;
const GROW = 'transition-[flex-grow] ease-soft';
const GROWING = { transitionDuration: `${GROW_MS}ms`, flexBasis: 0 };

/**
 * The tall segmented bar: one part per asset, in the legend's order, each as wide as its share of
 * the total, so free cash leaves its own share at the end unpainted. A share is printed inside only
 * where it fits; a sliver carries none. Hidden from assistive technology, since the legend beside
 * it says the same in text.
 */
export function AllocationBar({ parts }: { parts: BarPart[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);

  const held = parts.reduce((sum, p) => sum + p.share, 0);
  const room = (width * held) / Math.max(100, held) - GAP * (parts.length - 1);
  return (
    <div
      ref={ref}
      data-allocation-bar
      aria-hidden="true"
      className="flex h-7 w-full animate-bar-reveal"
    >
      <div
        data-allocation-parts
        className={`flex min-w-0 gap-[2px] ${GROW}`}
        style={{ ...GROWING, flexGrow: held }}
      >
        {parts.map(({ asset, share, label }) => (
          <div
            key={asset.id}
            data-allocation-part={asset.id}
            className={`flex min-w-0 items-center justify-center overflow-hidden rounded-[4px] font-mono text-label font-bold whitespace-nowrap ${GROW}`}
            style={{
              ...GROWING,
              flexGrow: share,
              background: SERIES[asset.colorKey].main,
              color: SERIES[asset.colorKey].label,
            }}
          >
            {/* Fitted against the part's final width, so it waits out the growth to that width.
                Keyed by its length, the one thing the fit reads: a label that grows waits again. */}
            {fits(label, (room * share) / held) ? (
              <span
                key={label.length}
                className="animate-label-in motion-reduce:animate-none"
                style={{ animationDelay: `${GROW_MS}ms` }}
              >
                {label}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div
        data-allocation-rest
        className={GROW}
        style={{ ...GROWING, flexGrow: Math.max(0, 100 - held) }}
      />
    </div>
  );
}
