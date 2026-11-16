import type { CSSProperties, ReactNode } from 'react';

// One glass, no tones, tokens only (`sidebar-plane.test.ts` holds this file to that by name).
// Padding 23 / 21: the glass's 1px edge is drawn inset over it; the content sits 22 / 20 inside.

type ValueSize = 'lg' | 'md' | 'sm';

const VALUE_SIZE: Record<ValueSize, string> = {
  lg: 'text-title',
  md: 'text-kpi',
  sm: 'text-kpi',
};

// `valueSize` is an explicit variant, not a className override, so a caller
// cannot end up with two same-property utilities fighting over generated-CSS
// order.
export function KpiCard({
  label,
  value,
  valueSize = 'lg',
  valueClassName = '',
  sub,
  subClassName = 'text-muted',
  className = '',
  style,
  timing,
}: {
  label: string;
  value: ReactNode;
  valueSize?: ValueSize;
  valueClassName?: string;
  sub?: ReactNode;
  subClassName?: string;
  className?: string;
  style?: CSSProperties;
  /** The name the paint of this value is reported under (`PerformanceElementTiming.identifier`).
   *  The browser stamps the paint of the element itself, which a mark set from an effect cannot. */
  timing?: string;
}) {
  return (
    <div
      className={`rounded-3xl glass px-[23px] py-[21px] text-ink transition ${className}`}
      style={style}
    >
      <div className="text-label-figure text-muted">{label}</div>
      <div
        className={`font-display ${VALUE_SIZE[valueSize]} ${valueClassName}`}
        {...(timing === undefined ? {} : { elementtiming: timing })}
      >
        {value}
      </div>
      {sub != null && <div className={`mt-0.5 text-small ${subClassName}`}>{sub}</div>}
    </div>
  );
}
