import { RadioGroup } from 'radix-ui';
import type { ReactNode } from 'react';

import { TAP_44 } from './tap-target';

/** Each size's well padding and segment gap, in px, which place the knob too. `sm` is the
 *  sidebar's 22: radii 6 / 9 make its padding 3, and its gap keeps `md`'s 4 : 5 of it. */
const SIZES = {
  md: {
    pad: 5,
    gap: 4,
    well: 'rounded-[12px]',
    knob: 'rounded-[7px]',
    segment: 'h-7 rounded-[7px] px-3 text-small',
  },
  sm: {
    pad: 3,
    gap: 2,
    // `min-w-max` keeps a `flex-1` parent from shrinking the well under its segments, while the
    // columns stay equal for the knob.
    well: 'rounded-[9px] min-w-max',
    knob: 'rounded-[6px]',
    // `44 − gap` below the breakpoint, so two neighbours' 44 overlays tile (tap-target.ts).
    segment:
      'flex h-[22px] items-center justify-center rounded-[6px] text-body max-md:min-w-[42px]',
  },
} as const;

/** The one segmented control (controls.md § Signed, D2), a radiogroup on equal grid columns. The
 *  knob is one element sliding under the segments: Radix's `Indicator` mounts per item. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className = '',
  ...named
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode }[];
  size?: keyof typeof SIZES;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  const { pad, gap, well, knob, segment } = SIZES[size];
  const n = options.length;
  const index = options.findIndex((o) => o.value === value);
  return (
    <RadioGroup.Root
      {...named}
      value={value}
      onValueChange={(v) => onChange(v as T)}
      // The root is focusable for Radix's hand-off; a press on its padding would park focus there.
      onMouseDown={(e) => {
        if (!(e.target as Element).closest('[role="radio"]')) e.preventDefault();
      }}
      className={`relative grid glass-well ${well} ${className}`}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, padding: pad, gap }}
    >
      {/* `data-owns-motion` keeps the theme cross-fade from replacing this transition during the
          very flip that moves it. */}
      <div
        aria-hidden
        data-owns-motion
        className={`absolute glass-knob-tint transition-transform duration-300 ease-soft ${knob}`}
        style={{
          top: pad,
          bottom: pad,
          left: pad,
          width: `calc((100% - ${2 * pad}px - ${(n - 1) * gap}px) / ${n})`,
          transform: `translateX(calc(${index} * (100% + ${gap}px)))`,
        }}
      />
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          // Radix moves its tab stop only on focus; a value written elsewhere would leave it behind.
          tabIndex={o.value === value ? 0 : -1}
          className={`z-10 cursor-pointer transition-control active:scale-[.97] ${segment} ${TAP_44} ${
            o.value === value
              ? 'font-bold text-segment-label'
              : 'font-semibold text-muted hover:bg-ink/5'
          }`}
        >
          {o.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
