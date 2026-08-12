import type { ColorKey } from '../../core/types';

// Yield-type pill (design `.tag` spots — the class's own CSS is missing per
// design/README.md's styling caveat, so this recreates the pill shape from
// README §4: radius 999px, small caps-free label).
const TINT: Record<ColorKey, string> = {
  reit: 'bg-reit-tint text-reit-tint-text',
  energy: 'bg-energy-tint text-energy-tint-text',
  ovdp8976: 'bg-ovdp8976-tint text-ovdp8976-tint-text',
  ovdp6475: 'bg-ovdp6475-tint text-ovdp6475-tint-text',
};

export function Tag({ colorKey, children }: { colorKey: ColorKey; children: string }) {
  return (
    <span
      className={`inline-block rounded-[6px] px-2.5 py-[3px] text-[11px] font-semibold whitespace-nowrap ${TINT[colorKey]}`}
    >
      {children}
    </span>
  );
}
