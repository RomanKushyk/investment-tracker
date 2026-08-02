import type { ColorKey } from '../../core/types';

const BG: Record<ColorKey, string> = {
  reit: 'bg-reit',
  energy: 'bg-energy',
  ovdp8976: 'bg-ovdp8976',
  ovdp6475: 'bg-ovdp6475',
};

// 12px stacked allocation bar (design line 183-185). Segment widths transition
// smoothly (D7) whenever the underlying shares recompute — 300ms soft, the
// duration brief S4 pins for the targets preview (one shared tween; also
// inside the v1 300-400ms reveal band).
export function ShareBar({ segments }: { segments: { colorKey: ColorKey; pct: number }[] }) {
  return (
    <div className="flex h-3 overflow-hidden rounded-full">
      {segments.map((s, i) => (
        <div
          // colorKey alone is NOT unique once a 5th asset wraps the 4-hue
          // cycle (P2 asset manager makes that a first-class flow) — the
          // position suffix keeps keys unique while segment order stays
          // stable (assets render in createdAt order).
          key={`${i}-${s.colorKey}`}
          className={`h-full transition-[width] duration-300 ease-soft ${BG[s.colorKey]}`}
          style={{ width: `${s.pct}%` }}
        />
      ))}
    </div>
  );
}
