import { useFx } from '../hooks/useFxRate';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
import { useSettings, type Language } from '../state/settings';

/** NBU's open-data page in the UI's language: the one its terms of use ask a hyperlink to. */
const OPEN_DATA: Record<Language, string> = {
  uk: 'https://bank.gov.ua/ua/open-data',
  en: 'https://bank.gov.ua/en/open-data',
};

/**
 * The line that says which rate a converted figure used: NBU's, for a day, with «НБУ» linking NBU's
 * open data as its terms of use ask (*External sources*). The day always shows: `/view` serves a
 * rate from an earlier day under its own date, so the date is true either way and the line needs
 * no second state. With none served it says so (rate-attribution.dc.html).
 *
 * The link is inline in a sentence, which WCAG 2.5.5 and 2.5.8 both exempt from a target size, as
 * `ReminderStrip` explains, so it takes no tap-target class. It opens in the same tab, with no icon.
 */
export function RateLine() {
  const fx = useFx();
  const f = useFormat();
  const p = useT().analytics.prose;
  const language = useSettings((s) => s.language);
  return (
    <div className="text-muted">
      <a
        href={OPEN_DATA[language]}
        aria-label={p.nbuLabel}
        // `ink`, not the in-text opacity: `muted` at .85 on the capital card's `sb-bg` falls under
        // 4.5 : 1 in light, and a 12 px line needs it.
        className="underline underline-offset-2 transition-colors duration-200 hover:text-ink"
      >
        {p.nbu}
      </a>
      {fx === null ? p.rateNone : p.rateLine(f.units(fx.rate), f.date(fx.date))}
    </div>
  );
}
