import type { CSSProperties, ReactNode } from 'react';

type Tone = 'dark' | 'tint' | 'default';

const TONE_BG: Record<Tone, string> = {
  dark: 'bg-ink text-white',
  tint: 'bg-pos-tint text-ink',
  default: 'bg-card text-ink shadow-[0_1px_3px_rgba(38,38,42,.06)]',
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
    <div className={`rounded-3xl px-[22px] py-5 transition ${TONE_BG[tone]} ${className}`} style={style}>
      <div className={`text-[10px] tracking-[.12em] uppercase ${TONE_LABEL[tone]}`}>{label}</div>
      <div className={`font-display font-semibold ${VALUE_SIZE[valueSize]} ${valueClassName}`}>
        {value}
      </div>
      {sub != null && <div className={`mt-0.5 text-xs ${subClassName}`}>{sub}</div>}
    </div>
  );
}
