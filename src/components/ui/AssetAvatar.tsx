import type { ColorKey } from '../../core/types';

// Tint bg/text per asset colorKey (README §4 asset series colors).
const TINT: Record<ColorKey, string> = {
  reit: 'bg-reit-tint text-reit-tint-text',
  energy: 'bg-energy-tint text-energy-tint-text',
  ovdp8976: 'bg-ovdp8976-tint text-ovdp8976-tint-text',
  ovdp6475: 'bg-ovdp6475-tint text-ovdp6475-tint-text',
};

// `size` is a variant, not a free number, for the same reason `Card.radius` is:
// two call sites need two sizes and nothing needs a third. 48 is the quote-row
// value — it makes the circle 63% of that row's height, inside the 60-70% the
// block rule asks for (48 / (48 + 28px of padding) = 0.632).
const SIZE = {
  34: 'size-[34px] text-xs',
  48: 'size-[48px] text-sm',
};

export function AssetAvatar({
  code,
  colorKey,
  size = 34,
}: {
  code: string;
  colorKey: ColorKey;
  size?: 34 | 48;
}) {
  return (
    <div
      className={`grid flex-none place-items-center rounded-full font-bold ${SIZE[size]} ${TINT[colorKey]}`}
    >
      {code}
    </div>
  );
}
