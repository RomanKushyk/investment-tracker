import type { ColorKey } from '@quirenote/core/types';

const BG: Record<ColorKey, string> = {
  reit: 'bg-reit',
  energy: 'bg-energy',
  ovdp8976: 'bg-ovdp8976',
  ovdp6475: 'bg-ovdp6475',
};

// Segment widths transition whenever the underlying shares recompute — one
// shared tween, so the bar re-proportions rather than jumping. *Interaction
// rules*
export function ShareBar({ segments }: { segments: { colorKey: ColorKey; pct: number }[] }) {
  return (
    <div className="flex h-3 overflow-hidden rounded-[3px]">
      {segments.map((s, i) => (
        <div
          // `colorKey` alone is NOT unique once a fifth asset wraps the four-hue
          // cycle; the position suffix keeps the keys unique, and segment order
          // is stable because assets render in `createdAt` order.
          key={`${i}-${s.colorKey}`}
          className={`h-full transition-[width] duration-300 ease-soft ${BG[s.colorKey]}`}
          style={{ width: `${s.pct}%` }}
        />
      ))}
    </div>
  );
}
