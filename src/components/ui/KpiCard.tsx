import type { CSSProperties, ReactNode } from 'react';

type Tone = 'wall' | 'tint' | 'default';

// `wall` IS THE SIDEBAR'S PLANE, BORROWED — one headline card per screen reads
// as the rail does, which is why it was ever a separate tone. It was called
// `dark` while that plane was dark in both themes; #92 gave the wall to the
// theme, so the name was the only part of it still claiming otherwise.
// It is NOT a filled control, and the distinction survives a theme flip
// (appearance-language.dc.html FINDING 3): the fill is `sb-bg` and the text
// `ink`, both of which invert together. `text-white` is gone with the premise
// that kept it — a literal cannot follow a plane that moves.
// Its label is `sb-item` rather than `sb-label`, which is the rail's caption
// rank and ships under 1.4.3 by ruling; a KPI label is 10px and takes the rank
// that clears it.
// Contrast the filled-emphasis case (primary Button, Switch, DatePicker
// selected day), where `bg-ink` is right in both themes and it is the paired
// `text-white` that has to become `text-page`.
// The border is not decoration: `sb-bg` is 1.08 : 1 against `page` in light and
// 1.03 in dark, so the fill step alone draws no box at all — where the retired
// `dark` tone was a near-black slab at 16.24 and needed none. `field-border` is
// the rank the rail's own edge takes against this same plane (3.35 light, 4.20
// dark), so the card and the wall it borrows from are bounded the same way.
// EVERY TONE CARRIES A BORDER SO THE BOX IS ONE BOX. Only `wall` draws one, but
// `box-sizing: border-box` takes the 1px out of the CONTENT box, so a bordered
// card's label and value would sit a pixel down and right of the unbordered
// cards beside it in the same `auto-fit` row. The transparent border is a 1px
// geometric spacer and draws nothing — the same move `index.css` records for the
// filled tracks' `border border-ink`.
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
