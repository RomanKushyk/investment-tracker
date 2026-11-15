import type { ColorKey } from '@quirenote/core/types';

// The radius is proportional and NOT a capsule, taken off the RENDERED height: the label
// role's line plus this padding is the tag the tables spec signs. *Shape system*
const TINT: Record<ColorKey, string> = {
  reit: 'bg-reit-tint text-reit-tint-text',
  energy: 'bg-energy-tint text-energy-tint-text',
  ovdp8976: 'bg-ovdp8976-tint text-ovdp8976-tint-text',
  ovdp6475: 'bg-ovdp6475-tint text-ovdp6475-tint-text',
};

export function Tag({ colorKey, children }: { colorKey: ColorKey; children: string }) {
  return (
    <span
      className={`inline-block rounded-[6px] px-2.5 py-1 font-sans text-label font-semibold whitespace-nowrap ${TINT[colorKey]}`}
    >
      {children}
    </span>
  );
}
