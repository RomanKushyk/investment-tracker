import type { ColorKey } from '../../core/types';

const BG: Record<ColorKey, string> = {
  reit: 'bg-reit',
  energy: 'bg-energy',
  ovdp8976: 'bg-ovdp8976',
  ovdp6475: 'bg-ovdp6475',
};

export function ColorDot({ colorKey }: { colorKey: ColorKey }) {
  return <span className={`size-2.5 flex-none rounded-full ${BG[colorKey]}`} />;
}
