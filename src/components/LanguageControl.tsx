import { useT } from '../i18n/useT';
import { useSettings, type Language } from '../state/settings';
import { TAP_44 } from './ui/tap-target';

const LANGUAGE_ORDER: Language[] = ['uk', 'en'];

/**
 * THE ONE CONTROL THAT CHANGES THE LANGUAGE, and `language-holders.test.ts` says where it may
 * render. `stretch` fills the row below `sm` on `/settings`; the signed-out bar keeps its width.
 */
export function LanguageControl({ stretch = false }: { stretch?: boolean }) {
  const { language, setLanguage } = useSettings();
  const t = useT();
  return (
    <div
      role="radiogroup"
      aria-label={t.settings.language.ariaLabel}
      data-filled-track
      className={`relative grid grid-cols-2 gap-1 rounded-[12px] border border-ink bg-ink p-1 ${stretch ? 'max-sm:w-full' : ''}`}
    >
      <div
        aria-hidden
        data-owns-motion
        className="absolute top-1 bottom-1 left-1 w-[calc((100%-12px)/2)] rounded-[7px] bg-card transition-transform duration-300 ease-soft"
        style={{
          transform: `translateX(calc(${LANGUAGE_ORDER.indexOf(language)} * (100% + 4px)))`,
        }}
      />
      {LANGUAGE_ORDER.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={language === value}
          onClick={() => setLanguage(value)}
          className={`relative z-10 cursor-pointer rounded-[7px] px-3 py-1.5 text-xs font-bold transition active:scale-[.97] ${TAP_44} ${language === value ? 'text-ink' : 'text-page hover:opacity-85'}`}
        >
          {t.settings.language[value]}
        </button>
      ))}
    </div>
  );
}
