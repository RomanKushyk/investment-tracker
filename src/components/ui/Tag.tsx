import type { ColorKey } from '../../core/types';

// Yield-type tag (design `.tag` spots — the class's own CSS is missing per
// design/README.md's styling caveat, so this recreates the shape from
// README §4). Radius is the D56 proportional value, NOT a capsule: the tag
// renders 22.5px tall and round(22.5 × 0.26) = 6. Measured rather than derived
// from the classes — `text-[11px]` sets a font size and no line height, so the
// markup alone cannot say how tall this is.
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
