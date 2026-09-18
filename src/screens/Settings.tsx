import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { NumberField } from '../components/ui/NumberField';
import { ParseSkips } from '../components/ui/ParseSkips';
import { Reveal } from '../components/ui/Reveal';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Switch } from '../components/ui/Switch';
import { inputValue, storedNumber } from '../core/money';
import { THEME_ORDER, useSettings, type Language } from '../state/settings';
import { CsvExportRow } from './settings/CsvExportRow';
import { DangerZone } from './settings/DangerZone';
import { DatasetSwitch } from './settings/DatasetSwitch';
import { ImportRow } from './settings/ImportRow';
import { NbuRateFetch } from './settings/NbuRateFetch';
import { parseLeadDays } from './settings/settings';
import { useBackupDownload } from '../hooks/useBackupDownload';
import { useT } from '../i18n/useT';
import { TAP_44 } from '../components/ui/tap-target';

function SectionLabel({
  className = 'mb-3.5',
  children,
}: {
  className?: string;
  children: string;
}) {
  return (
    <div className={`text-[10px] tracking-[.12em] text-muted uppercase ${className}`}>
      {children}
    </div>
  );
}

function SettingRow({
  title,
  helper,
  children,
}: {
  title: string;
  helper: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      {/* min() caps the design's floor to the container width, so the card interior never overflows at 360. */}
      <div className="min-w-[min(200px,100%)] flex-[1_1_260px]">
        <div className="text-[13px] font-semibold">{title}</div>
        <div className="mt-[3px] text-xs leading-normal text-muted">{helper}</div>
      </div>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="my-4 h-px bg-hairline" />;
}

function BackupButton() {
  const t = useT();
  const backup = useBackupDownload();
  return (
    <Button
      variant="outline"
      disabled={backup.pending}
      onClick={() => {
        void backup.download();
      }}
    >
      {t.settings.backup.button}
    </Button>
  );
}

// SAME ANATOMY AS THE SIDEBAR TOGGLE, DIFFERENT FIELD. This one writes the
// PREFERENCE — what the app opens in — and the sidebar's writes the session.
// While they were one field this was a second remote for that switch rather than
// a default. It still moves the view immediately, because `setDefaultCurrency`
// carries the session with it; the sidebar toggle does not come back.
function CurrencyControl() {
  const { defaultCurrency: currency, setDefaultCurrency: setCurrency } = useSettings();
  const segment = (c: 'UAH' | 'USD', label: string) => (
    <button
      type="button"
      aria-pressed={currency === c}
      onClick={() => setCurrency(c)}
      className={`relative z-10 cursor-pointer rounded-[7px] px-[18px] py-1.5 text-xs font-bold transition active:scale-[.97] ${TAP_44} ${currency === c ? 'text-ink' : 'text-page hover:opacity-85'}`}
    >
      {label}
    </button>
  );
  /* A GRID, like the controls beside it. A flex track shrink-wraps, so a fixed
  `calc(50% − N)` chip only lands while both labels are the same width — a bet on
  the font and on nobody relabelling it, which the dataset switch lost. Two `1fr`
  columns take the widest content, so the chip fits by construction. */
  return (
    <div
      data-filled-track
      className="relative grid grid-cols-2 gap-1 rounded-[12px] border border-ink bg-ink p-1"
    >
      <div
        aria-hidden
        data-owns-motion
        className="absolute top-1 bottom-1 left-1 w-[calc(50%-6px)] rounded-[7px] bg-card transition-transform duration-300 ease-soft"
        style={{ transform: currency === 'UAH' ? 'translateX(0)' : 'translateX(calc(100% + 4px))' }}
      />
      {segment('UAH', '₴ UAH')}
      {segment('USD', '$ USD')}
    </div>
  );
}

// GRID, not flex, and that is load-bearing. `flex-1` is `flex:1 1 0%`, which only
// equalises segments that can shrink to their basis, and text cannot go below its
// min-content. `grid-cols-3` columns are equal by construction whatever the words
// are, so the labels can be translated without re-measuring. A flex track holds only
// while a pair is equal-width in EVERY dictionary — true of ₴ UAH against $ USD in the
// mono face this app sets, and not of the dataset switch's.
// The thumb's width is DERIVED from the track's padding box, not fitted.

function ThemeControl() {
  const t = useT();
  const { theme, setTheme } = useSettings();
  const index = THEME_ORDER.indexOf(theme);
  return (
    <div
      role="radiogroup"
      aria-label={t.settings.theme.ariaLabel}
      data-filled-track
      className="relative grid grid-cols-3 gap-1 rounded-[12px] border border-ink bg-ink p-1 max-sm:w-full"
    >
      {/* `data-owns-motion` keeps the theme cross-fade from replacing this transition
          during the very flip that moves it. */}
      <div
        aria-hidden
        data-owns-motion
        className="absolute top-1 bottom-1 left-1 w-[calc((100%-16px)/3)] rounded-[7px] bg-card transition-transform duration-300 ease-soft"
        style={{ transform: `translateX(calc(${index} * (100% + 4px)))` }}
      />
      {THEME_ORDER.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          onClick={() => setTheme(value)}
          className={`relative z-10 cursor-pointer rounded-[7px] px-3 py-1.5 text-xs font-bold transition active:scale-[.97] ${TAP_44} ${theme === value ? 'text-ink' : 'text-page hover:opacity-85'}`}
        >
          {t.settings.theme[value]}
        </button>
      ))}
    </div>
  );
}

const LANGUAGE_ORDER: Language[] = ['uk', 'en'];

function LanguageControl() {
  const { language, setLanguage } = useSettings();
  const t = useT();
  return (
    <div
      role="radiogroup"
      aria-label={t.settings.language.ariaLabel}
      data-filled-track
      className="relative grid grid-cols-2 gap-1 rounded-[12px] border border-ink bg-ink p-1 max-sm:w-full"
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

// Stored language-free and shown by `NumberField` in the language on screen, so
// validity is language-free too: an invalid or ≤0 value never reaches the store
// and the last valid rate stays in effect.
const USD_RATE_ERROR_ID = 'usd-rate-error';

/** The rate this text holds, or nothing — a rate is a finite number above zero. */
function asRate(text: string): number | undefined {
  const held = storedNumber(text);
  return held !== undefined && held > 0 ? held : undefined;
}

function UsdRateField() {
  const t = useT();
  const { usdRate, setUsdRate } = useSettings();
  // Its own string, because a half-typed or refused value is not a rate and must
  // not reach the store.
  const [raw, setRaw] = useState(() => inputValue(usdRate));
  const [error, setError] = useState(false);
  // ONE READING AND ONE RULE, language-free: what the field STORES is canonical,
  // and reading it under the live language left a box that had gone green while
  // `usdRate` held the old number. `asRate` owns what counts as a rate and
  // `storedNumber` whether the text was readable at all — running them together is
  // what let «Enter a rate above 0.» answer a pasted «16,5».
  const valid = asRate(raw) !== undefined;
  const unreadable = raw.trim() !== '' && storedNumber(raw) === undefined;

  function handleChange(value: string) {
    setRaw(value);
    const next = asRate(value);
    if (next !== undefined) {
      setError(false);
      setUsdRate(next);
    } else {
      setError(value.trim() !== '');
    }
  }

  // Applied HERE rather than by the fetch control, so the stored number and the
  // draft string this input shows can never disagree.
  function applyFetched(rate: number) {
    setRaw(inputValue(rate));
    setError(false);
    setUsdRate(rate);
  }

  return (
    // The input goes INSIDE the fetch block: the two are one control, and only that
    // nesting keeps them on one line.
    <div className="ml-auto flex flex-col items-end gap-2">
      <NbuRateFetch onApply={applyFetched}>
        {/* The error travels WITH the input: as a sibling below the fetch block it
            rendered under the NBU status line, two rows from the field it describes. */}
        <div className="flex flex-col items-end gap-1">
          <NumberField
            id="usd-rate"
            name="usdRate"
            value={raw}
            onChange={handleChange}
            onBlur={() => setError(!valid)}
            aria-label={t.settings.rate.ariaLabel}
            aria-invalid={error}
            aria-describedby={error ? USD_RATE_ERROR_ID : undefined}
            className={`h-9 w-[110px] rounded-[9px] border bg-page px-3 text-right text-[13px] transition ${error ? 'border-neg' : 'border-field-border hover:border-ink'}`}
          />
          {error && (
            <div
              id={USD_RATE_ERROR_ID}
              className="animate-in text-right text-[11px] text-neg duration-200 fade-in slide-in-from-top-1"
            >
              {unreadable ? t.settings.rate.unreadable : t.settings.rate.invalid}
            </div>
          )}
        </div>
      </NbuRateFetch>
    </div>
  );
}

// Same arming rule as the ₴/$ rate above: an invalid entry never reaches the
// store, so the last valid lead time stays in effect.
const LEAD_DAYS_ERROR_ID = 'reminder-lead-days-error';

function LeadDaysField() {
  const t = useT();
  const { reminderLeadDays, setReminderLeadDays } = useSettings();
  const [raw, setRaw] = useState(() => inputValue(reminderLeadDays));
  const [error, setError] = useState(false);

  function handleChange(value: string) {
    setRaw(value);
    const days = parseLeadDays(value);
    if (days !== null) {
      setError(false);
      setReminderLeadDays(days);
    } else {
      setError(value.trim() !== '');
    }
  }

  return (
    <div>
      <input
        id="reminder-lead-days"
        name="reminderLeadDays"
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setError(parseLeadDays(raw) === null)}
        inputMode="decimal"
        aria-label={t.settings.reminders.leadAriaLabel}
        aria-invalid={error}
        // The message lives outside the label, so the link has to be explicit — `aria-invalid` alone gives no reason.
        aria-describedby={error ? LEAD_DAYS_ERROR_ID : undefined}
        className={`h-9 w-[72px] rounded-[9px] border bg-page px-2.5 text-right text-[13px] transition ${error ? 'border-neg' : 'border-field-border hover:border-ink'}`}
      />
      {error && (
        <div
          id={LEAD_DAYS_ERROR_ID}
          className="mt-1 animate-in text-right text-[11px] text-neg duration-200 fade-in slide-in-from-top-1"
        >
          {t.settings.reminders.leadInvalid}
        </div>
      )}
    </div>
  );
}

function RestoreDismissedButton() {
  const t = useT();
  const { dismissedReminders, restoreDismissed } = useSettings();
  const count = dismissedReminders.length;
  return (
    <Button
      variant="outline"
      disabled={count === 0}
      onClick={() => {
        restoreDismissed();
        toast.success(t.settings.reminders.restoredToast);
      }}
    >
      <span key={count} className="animate-in duration-150 fade-in">
        {count === 0 ? t.settings.reminders.restore : t.settings.reminders.restoreWithCount(count)}
      </span>
    </Button>
  );
}

// All three features are pure local derivations, so the card is identical in demo and live.
function AutomationRows() {
  const t = useT();
  const {
    autoQuoteSuggest,
    couponSuggest,
    remindersEnabled,
    setAutoQuoteSuggest,
    setCouponSuggest,
    setRemindersEnabled,
  } = useSettings();
  return (
    <>
      <SettingRow title={t.settings.quoteSuggest.title} helper={t.settings.quoteSuggest.helper}>
        <Switch
          label={t.settings.quoteSuggest.title}
          checked={autoQuoteSuggest}
          onCheckedChange={setAutoQuoteSuggest}
        />
      </SettingRow>
      <Divider />
      <SettingRow title={t.settings.couponSuggest.title} helper={t.settings.couponSuggest.helper}>
        <Switch
          label={t.settings.couponSuggest.title}
          checked={couponSuggest}
          onCheckedChange={setCouponSuggest}
        />
      </SettingRow>
      <Divider />
      <SettingRow title={t.settings.reminders.title} helper={t.settings.reminders.helper}>
        <Switch
          label={t.settings.reminders.title}
          checked={remindersEnabled}
          onCheckedChange={setRemindersEnabled}
        />
      </SettingRow>
      {/* The two sub-rows belong to the row above, and collapse with the gate. */}
      <Reveal
        show={remindersEnabled}
        distance={1}
        className="mt-3.5 flex flex-col gap-3.5 border-l border-hairline pl-3"
      >
        <SettingRow title={t.settings.reminders.leadTitle} helper={t.settings.reminders.leadHelper}>
          <LeadDaysField />
        </SettingRow>
        <SettingRow
          title={t.settings.reminders.dismissedTitle}
          helper={t.settings.reminders.dismissedHelper}
        >
          <RestoreDismissedButton />
        </SettingRow>
        <Divider />
        {/* Read-only. Tuning the parse needs the user model; seeing what it did needs
            nothing, and that is the half that was missing. */}
        <SettingRow title={t.settings.parse.title} helper={t.settings.parse.helper}>
          <ParseSkips className="ml-auto text-right" />
        </SettingRow>
      </Reveal>
    </>
  );
}

export function Settings() {
  const t = useT();
  return (
    <div>
      <ScreenHeader title={t.screen.settings.title} subtitle={t.screen.settings.subtitle} />

      <div className="flex flex-col gap-3.5">
        {/* THE PORTFOLIO CARD IS GONE: its two halves went to the screens that draw what
            they edit. Settings keeps what belongs to the BROWSER — data, automation,
            appearance — and nothing that belongs to the portfolio. */}
        <Card
          radius={24}
          className="animate-in p-[22px] delay-75 duration-300 fade-in slide-in-from-bottom-1"
        >
          <SectionLabel>{t.settings.sections.data}</SectionLabel>
          <SettingRow title={t.settings.dataset.title} helper={t.settings.dataset.helper}>
            <DatasetSwitch />
          </SettingRow>
          <Divider />
          <SettingRow title={t.settings.backup.title} helper={t.settings.backup.helper}>
            <BackupButton />
          </SettingRow>
          <Divider />
          <ImportRow />
          <Divider />
          {/* Row 4 of the pinned order: Dataset → Backup → Import → Spreadsheet export → Danger zone. */}
          <CsvExportRow />
          <Divider />
          <SettingRow title={t.settings.dangerZone.title} helper={t.settings.dangerZone.helper}>
            <DangerZone />
          </SettingRow>
        </Card>

        <Card
          radius={24}
          className="animate-in p-[22px] delay-150 duration-300 fade-in slide-in-from-bottom-1"
        >
          <SectionLabel>{t.settings.sections.automation}</SectionLabel>
          <AutomationRows />
        </Card>

        <Card
          radius={24}
          className="animate-in p-[22px] delay-200 duration-300 fade-in slide-in-from-bottom-1"
        >
          <SectionLabel>{t.settings.sections.appearance}</SectionLabel>
          {/* Theme is the FIRST row and its copy is the brief's verbatim: a brief wins
              copy disputes even after its extension has merged. */}
          <SettingRow title={t.settings.theme.title} helper={t.settings.theme.helper}>
            <ThemeControl />
          </SettingRow>
          <Divider />
          <SettingRow title={t.settings.language.title} helper={t.settings.language.helper}>
            <LanguageControl />
          </SettingRow>
          <Divider />
          <SettingRow title={t.settings.currency.title} helper={t.settings.currency.helper}>
            <CurrencyControl />
          </SettingRow>
          <Divider />
          <SettingRow title={t.settings.rate.title} helper={t.settings.rate.helper}>
            <UsdRateField />
          </SettingRow>
        </Card>
      </div>
    </div>
  );
}
