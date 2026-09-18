import type { CSSProperties, ReactNode } from 'react';

type Tone = 'wall' | 'tint' | 'default';

// `wall` IS THE SIDEBAR'S PLANE, BORROWED, so one headline card per screen reads
// as the rail does. It is NOT a filled control: fill `sb-bg` and text `ink`
// invert together, where an `ink`-filled control pairs `bg-ink` with `text-page`.
// Its label takes `sb-item`, not the rail's own caption rank, which ships under
// 1.4.3 by ruling and a 10 px KPI label cannot borrow.
//
// EVERY COLOUR HERE IS A TOKEN, because a literal luminance cannot follow a
// plane that moves — which is what retired `text-white`, and what
// `sidebar-plane.test.ts` holds this file to by name.
//
// THE BORDER IS NOT DECORATION: `sb-bg` barely steps off `page` in either theme,
// so the fill alone draws no box, and `field-border` is the rank the rail's own
// edge takes against this same plane.
//
// EVERY TONE CARRIES ONE SO THE BOX IS ONE BOX. Only `wall` draws it, but
// `box-sizing: border-box` takes the 1px out of the CONTENT box, so a bordered
// card's label and value would sit a pixel down and right of the unbordered
// cards beside it in the same `auto-fit` row. The transparent border is a
// geometric spacer that draws nothing.
const TONE_BG: Record<Tone, string> = {
  wall: 'bg-sb-bg text-ink border border-field-border',
  tint: 'bg-pos-tint text-ink border border-transparent',
  default: 'bg-card text-ink border border-transparent shadow-(--shadow-card)',
};

const TONE_LABEL: Record<Tone, string> = {
  wall: 'text-sb-item',
  tint: 'text-pos-tint-text',
  default: 'text-muted',
};

type ValueSize = 'lg' | 'md' | 'sm';

const VALUE_SIZE: Record<ValueSize, string> = {
  lg: 'text-[26px]',
  md: 'text-[22px]',
  sm: 'text-[19px]',
};

// `tone` and `valueSize` are explicit variants, not className overrides, so a
// caller cannot end up with two same-property utilities fighting over
// generated-CSS order.
export function KpiCard({
  label,
  value,
  valueSize = 'lg',
  valueClassName = '',
  sub,
  subClassName = 'text-muted',
  tone = 'default',
  className = '',
  style,
}: {
  label: string;
  value: ReactNode;
  valueSize?: ValueSize;
  valueClassName?: string;
  sub?: ReactNode;
  subClassName?: string;
  tone?: Tone;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`rounded-3xl px-[22px] py-5 transition ${TONE_BG[tone]} ${className}`}
      style={style}
    >
      <div className={`text-[10px] tracking-[.12em] uppercase ${TONE_LABEL[tone]}`}>{label}</div>
      <div className={`font-display font-semibold ${VALUE_SIZE[valueSize]} ${valueClassName}`}>
        {value}
      </div>
      {sub != null && <div className={`mt-0.5 text-xs ${subClassName}`}>{sub}</div>}
    </div>
  );
}
