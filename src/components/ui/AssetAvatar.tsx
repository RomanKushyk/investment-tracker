import type { ColorKey } from '../../core/types';

// Tint bg/text per asset colorKey (README §4 asset series colors).
const TINT: Record<ColorKey, string> = {
  reit: 'bg-reit-tint text-reit-tint-text',
  energy: 'bg-energy-tint text-energy-tint-text',
  ovdp8976: 'bg-ovdp8976-tint text-ovdp8976-tint-text',
  ovdp6475: 'bg-ovdp6475-tint text-ovdp6475-tint-text',
};

export function AssetAvatar({ code, colorKey }: { code: string; colorKey: ColorKey }) {
  return (
    <div
      className={`grid size-[34px] flex-none place-items-center rounded-full text-xs font-bold ${TINT[colorKey]}`}
    >
      {code}
    </div>
  );
}
