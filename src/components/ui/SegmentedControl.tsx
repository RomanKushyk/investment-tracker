import { RadioGroup } from 'radix-ui';
import type { ReactNode } from 'react';

import { TAP_44 } from './tap-target';

/** The one segmented control (controls.md § Signed, D2), a radiogroup on equal grid columns. The
 *  knob is one element sliding under the segments: Radix's `Indicator` mounts per item. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className = '',
  ...named
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode }[];
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
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
      className={`relative grid gap-1 rounded-[12px] glass-well p-[5px] ${className}`}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
    >
      {/* Placed by the well's `p-[5px]` and `gap-1`. `data-owns-motion` keeps the theme cross-fade
          from replacing this transition during the very flip that moves it. */}
      <div
        aria-hidden
        data-owns-motion
        className="absolute top-[5px] bottom-[5px] left-[5px] rounded-[7px] glass-knob-tint transition-transform duration-300 ease-soft"
        style={{
          width: `calc((100% - 10px - ${(n - 1) * 4}px) / ${n})`,
          transform: `translateX(calc(${index} * (100% + 4px)))`,
        }}
      />
      {options.map((o) => (
        <RadioGroup.Item
          key={o.value}
          value={o.value}
          // Radix moves its tab stop only on focus; a value written elsewhere would leave it behind.
          tabIndex={o.value === value ? 0 : -1}
          className={`z-10 h-7 cursor-pointer rounded-[7px] px-3 text-small transition-control active:scale-[.97] ${TAP_44} ${
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
