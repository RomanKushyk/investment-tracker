import { useT } from '../i18n/useT';
import { useSettings, type Language } from '../state/settings';
import { SegmentedControl } from './ui/SegmentedControl';

const LANGUAGE_ORDER: Language[] = ['uk', 'en'];

/**
 * THE ONE CONTROL THAT CHANGES THE LANGUAGE, and `language-holders.test.ts` says where it may
 * render. `stretch` fills the row below `sm` on `/settings`; the signed-out bar keeps its width.
 */
export function LanguageControl({ stretch = false }: { stretch?: boolean }) {
  const { language, setLanguage } = useSettings();
  const t = useT();
  return (
    <SegmentedControl
      aria-label={t.settings.language.ariaLabel}
      value={language}
      onChange={(value) => setLanguage(value)}
      options={LANGUAGE_ORDER.map((value) => ({ value, label: t.settings.language[value] }))}
      className={stretch ? 'max-sm:w-full' : ''}
    />
  );
}
