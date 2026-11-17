import type { ColorKey } from '@quirenote/core/types';

const TINT: Record<ColorKey, string> = {
  reit: 'bg-reit-tint text-reit-tint-text',
  energy: 'bg-energy-tint text-energy-tint-text',
  ovdp8976: 'bg-ovdp8976-tint text-ovdp8976-tint-text',
  ovdp6475: 'bg-ovdp6475-tint text-ovdp6475-tint-text',
};

// `size` is a variant, not a free number, for the same reason `Card.radius` is: each size
// belongs to a call site, and nothing else needs one.
const SIZE = {
  34: 'size-[34px] text-small',
  44: 'size-[44px] text-body',
  48: 'size-[48px] text-body',
};

export function AssetAvatar({
  code,
  colorKey,
  size = 34,
}: {
  code: string;
  colorKey: ColorKey;
  size?: 34 | 44 | 48;
}) {
  return (
    <div
      className={`grid flex-none place-items-center rounded-full font-bold ${SIZE[size]} ${TINT[colorKey]}`}
    >
      {code}
    </div>
  );
}
