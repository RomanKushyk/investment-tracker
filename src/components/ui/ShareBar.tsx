import type { ColorKey } from '../../core/types';

const BG: Record<ColorKey, string> = {
  reit: 'bg-reit',
  energy: 'bg-energy',
  ovdp8976: 'bg-ovdp8976',
  ovdp6475: 'bg-ovdp6475',
};

// 12px stacked allocation bar (design line 183-185). Segment widths transition
// smoothly (D7) whenever the underlying shares recompute.
export function ShareBar({ segments }: { segments: { colorKey: ColorKey; pct: number }[] }) {
  return (
    <div className="flex h-3 overflow-hidden rounded-full">
      {segments.map((s) => (
        <div
          key={s.colorKey}
          className={`h-full transition-[width] duration-500 ease-soft ${BG[s.colorKey]}`}
          style={{ width: `${s.pct}%` }}
        />
      ))}
    </div>
  );
}
