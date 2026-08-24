import type { CSSProperties, ReactNode } from 'react';

type Tone = 'dark' | 'tint' | 'default';

// `dark` is an INVERTED PLANE, not a filled control, and the distinction is
// what makes it survive a theme flip (appearance-language.dc.html FINDING 3).
// It must stay dark in BOTH themes — its label is `sidebar-muted` and callers
// put `pos-on-dark` on the sub-line, a token the Phase 5 sheet deliberately
// leaves unchanged "because it was always for a dark plane". So the fill is
// `sidebar`, not `ink`: in light the two are both #26262a, making this a
// pixel-for-pixel no-op, and in dark `sidebar` goes to #0f0f11 while `ink`
// would invert to #eceae7 and render white-on-white.
// `text-white` STAYS white here for the same reason — 19.15:1 on #0f0f11.
// Contrast the filled-emphasis case (primary Button, Switch, DatePicker
// selected day), where `bg-ink` is right in both themes and it is the paired
// `text-white` that has to become `text-page`.
const TONE_BG: Record<Tone, string> = {
  dark: 'bg-sidebar text-white',
  tint: 'bg-pos-tint text-ink',
  default: 'bg-card text-ink shadow-(--shadow-card)',
};

const TONE_LABEL: Record<Tone, string> = {
  dark: 'text-sidebar-muted',
  tint: 'text-pos-tint-text',
  default: 'text-muted',
};

// KPI value font-size varies by card: 26px (Overview's main 4), 22px (Income
// received), 19px (Portfolio's Best performer/Laggard/Income engine).
type ValueSize = 'lg' | 'md' | 'sm';

const VALUE_SIZE: Record<ValueSize, string> = {
  lg: 'text-[26px]',
  md: 'text-[22px]',
  sm: 'text-[19px]',
};

// KPI/stat card shared by Overview's KPI grid + Income received, and
// Portfolio's Best performer / Laggard / Income engine cards. `tone`/`valueSize`
// are explicit variants (not className overrides) per the established
// Card.radius / Button.weight pattern — avoids same-property class collisions.
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
