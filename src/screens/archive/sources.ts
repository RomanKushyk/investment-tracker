import type { Lang } from '@quirenote/core/money';
import { useSettings } from '../../state/settings';

const MB_OPTIONS: Intl.NumberFormatOptions = {
  style: 'unit',
  unit: 'megabyte',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
};
const MB: Record<Lang, Intl.NumberFormat> = {
  uk: new Intl.NumberFormat('uk-UA', MB_OPTIONS),
  en: new Intl.NumberFormat('en-US', MB_OPTIONS),
};

/** Bytes in «МБ» of 1024², as the import limit's «25 МБ» is (the owner's ruling). The unit holds to
 *  its figure as `makeFormat`'s do. */
export function useMegabytes(): (bytes: number) => string {
  const language = useSettings((s) => s.language);
  return (bytes) => MB[language].format(bytes / 1024 / 1024).replace(/\s/g, ' ');
}
