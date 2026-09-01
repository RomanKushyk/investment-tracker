import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ParseSkips } from '../components/ui/ParseSkips';
import { Reveal } from '../components/ui/Reveal';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Switch } from '../components/ui/Switch';
import { quoteInputSchema } from '../core/schemas';
import { useSettings, type Language, type Theme } from '../state/settings';
import { CsvExportRow } from './settings/CsvExportRow';
import { DangerZone } from './settings/DangerZone';
import { DatasetSwitch } from './settings/DatasetSwitch';
import { ImportRow } from './settings/ImportRow';
import { NbuRateFetch } from './settings/NbuRateFetch';
import { parseLeadDays } from './settings/settings';
import { useBackupDownload } from '../hooks/useBackupDownload';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
import { TAP_44 } from '../components/ui/tap-target';

// Section microlabel — the card-label idiom shared with Overview's cards
// (design/extensions/settings.dc.html S2, 10px uppercase tracking .12em).
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

// Label-left / control-right row (S2): title 13px semibold + 12px muted
// helper on the left, the control on the right; wraps to stacked when the
// row gets narrower than the left block's 200px floor (~480px and below).
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
      {/* min() caps the design's 200px floor to the container width, so the
          card interior never overflows at 360px (same fix as Overview's KPI
          grid track floor) */}
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

// S7 — the P1 sidebar Backup pill relocated to its designed home. Identical
// download path (repo.exportAll → buildBackup → Blob link, shared via
// useBackupDownload with the destructive dialogs' backup CTA); the outline
// variant is back on its native light palette, so the sidebar's
// ON_DARK_OUTLINE token remap is gone with the pill.
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

// FILLED segmented control (D114): track `ink`, `card` sliding chip, no thumb
// shadow — the surface step no longer needs one. It was `panel`/`card` and a
// twin of the sidebar toggle; D114 makes the RAIL the one exception, so the
// kinship now runs the other way. Sliding-thumb motion still cloned from the
// sidebar control (D7: transform 300ms soft; press scale; reduced-motion
// collapses via the global kill-switch).
//
// SAME ANATOMY AS THE SIDEBAR TOGGLE, DIFFERENT FIELD (A21). This one writes
// the PREFERENCE — what the app opens in — and the sidebar's writes the
// session. It was the same field until 2026-08-18, which made this control a
// second remote for the sidebar switch rather than a default. It still moves
// the view immediately, because `setDefaultCurrency` carries the session with
// it; the sidebar toggle does not come back the other way.
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
  /* A GRID, like the theme and language controls beside it. A flex track
  shrink-wraps, so a fixed `calc(50% − N)` chip only lands when both
  labels happen to be the same width — «₴ UAH» and «$ USD» are, which is
  the only reason this one never drifted. That is a bet on the font
  resolving U+20B4 at the mono advance and on nobody relabelling it; the
  dataset switch lost the same bet with «Демо» / «Живий». Two `1fr`
  columns take the widest content, so the chip fits by construction. */
  return (
    <div
      data-filled-track
      className="relative grid grid-cols-2 gap-1 rounded-[12px] border border-ink bg-ink p-1"
    >
      {/* sliding thumb (D7): both segments share the same mono-font width, so
          translateX(100% + gap) lands it exactly under the other one */}
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

// The Light / Dark / System control (P5 S1). Three segments on the same track
// as the CurrencyControl above — same tokens, same D56 radii (segment 7; track
// concentric at 7 + 4 padding + 1 border = 12). No icons: the reference rules
// them out, and the words are the whole label.
//
// GRID, not flex, and that is load-bearing. `flex-1` is `flex:1 1 0%`, which
// only equalises segments that can shrink to their basis — and text cannot go
// below its min-content, so "Light"/"Dark"/"System" measured 60/52.8/67.2px.
// `grid-cols-3` is `repeat(3, minmax(0,1fr))`, whose columns are equal by
// construction whatever the words are, which also means A10 can translate the
// labels without re-measuring anything. The two-segment control keeps flex only
// because ₴ UAH and $ USD are the same length in a mono face.
//
// The thumb's width is DERIVED, not fitted: its containing block is the track's
// padding box, so with p-1 (4) and gap-1 (4) between three columns each is
// (100% - 16px) / 3. The same derivation gives the two-segment control above
// its (100% - 12px)/2, i.e. the 50% - 6px it already carries.
// ORDER here, LABELS in the dictionary — the same split the transaction
// selects use. Light before Dark before System is the reference's order.
const THEME_ORDER: Theme[] = ['light', 'dark', 'system'];

function ThemeControl() {
  const t = useT();
  const { theme, setTheme } = useSettings();
  const index = THEME_ORDER.indexOf(theme);
  return (
    <div
      role="radiogroup"
      aria-label={t.settings.theme.ariaLabel}
      // Wraps to its own line under `sm` rather than squeezing three segments
      // into the row: at 360px the label and a three-up control cannot share it.
      data-filled-track
      className="relative grid grid-cols-3 gap-1 rounded-[12px] border border-ink bg-ink p-1 max-sm:w-full"
    >
      {/* sliding thumb (D7), same as the two-segment control: `100%` in the
          transform is the THUMB's own width, so one step is that width plus the
          4px gap. `data-owns-motion` keeps the theme cross-fade from replacing
          this transition during the very flip that moves it. */}
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

// The Українська / English control (P5 S2). Two segments, so it keeps flex and
// the 50% - 6px thumb of its CurrencyControl twin rather than the three-column
// grid the theme control needed. Both labels are the same length in neither
// language, but a two-segment flex track distributes what is left evenly and
// the thumb is derived from the TRACK, not from the words.
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

// S8 — editable ₴/$ rate. Validation = core/schemas.quoteInputSchema (the
// app-wide "positive number, comma or dot decimals" input rule); an invalid
// or ≤0 value never reaches the store — the last valid rate stays in effect.
// Empty input only errors on blur (arming is progressive).
const USD_RATE_ERROR_ID = 'usd-rate-error';

function UsdRateField() {
  const t = useT();
  const { usdRate, setUsdRate } = useSettings();
  const f = useFormat();
  // A36's third site, and the one its own commit wrongly called done: this
  // field sat one component away from an NBU line rendering «44,6988» through
  // the formatter while showing "44.83" with a dot. `NbuRateFetch`'s comment
  // says a dot form "makes the same number look like a different one".
  // `f.input` and not `f.num`: a fetched rate carries four decimals and `num`
  // would round it to two before the user ever saw it.
  const [raw, setRaw] = useState(() => f.input(usdRate));
  const [error, setError] = useState(false);

  function handleChange(value: string) {
    setRaw(value);
    const parsed = quoteInputSchema.safeParse(value);
    if (parsed.success) {
      setError(false);
      setUsdRate(parsed.data);
    } else {
      setError(value.trim() !== '');
    }
  }

  // A5: the fetched rate is applied HERE rather than by the fetch control, so
  // the stored number and the draft string this input shows can never disagree.
  function applyFetched(rate: number) {
    setRaw(f.input(rate));
    setError(false);
    setUsdRate(rate);
  }

  return (
    // ml-auto so the block still hugs the right edge on the narrow widths where
    // SettingRow wraps it onto its own line — every other control in this card
    // sits right, and a left-aligned one reads as a mistake.
    // The input goes INSIDE the fetch block: the two are one control — the
    // rate, and a way to refresh it — and only that nesting keeps them on one
    // line. See NbuRateFetchProps.children for what stacking them cost.
    <div className="ml-auto flex flex-col items-end gap-2">
      <NbuRateFetch onApply={applyFetched}>
        {/* The error travels WITH the input, not after the fetch block: as a
            sibling below it, the message rendered under the NBU status line —
            two rows away from the field it describes. `aria-describedby` links
            it for the same reason LeadDaysField links its own; `aria-invalid`
            alone announces "invalid" with no reason. */}
        <div className="flex flex-col items-end gap-1">
          <input
            id="usd-rate"
            name="usdRate"
            value={raw}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={() => setError(!quoteInputSchema.safeParse(raw).success)}
            inputMode="decimal"
            aria-label={t.settings.rate.ariaLabel}
            aria-invalid={error}
            aria-describedby={error ? USD_RATE_ERROR_ID : undefined}
            className={`h-9 w-[110px] rounded-[9px] border bg-page px-3 text-right text-[13px] transition ${error ? 'border-neg' : 'border-hairline hover:border-faint'}`}
          />
          {error && (
            <div
              id={USD_RATE_ERROR_ID}
              className="animate-in text-right text-[11px] text-neg duration-200 fade-in slide-in-from-top-1"
            >
              {t.settings.rate.invalid}
            </div>
          )}
        </div>
      </NbuRateFetch>
    </div>
  );
}

// S8 row 4 — "Lead time, days": how far ahead coupon reminders appear. Same
// arming rule as the ₴/$ rate above (validation via a pure parser; an invalid
// entry never reaches the store, so the last valid lead time stays in effect
// and the banners keep using it), and empty only errors on blur.
const LEAD_DAYS_ERROR_ID = 'reminder-lead-days-error';

function LeadDaysField() {
  const t = useT();
  const { reminderLeadDays, setReminderLeadDays } = useSettings();
  const f = useFormat();
  // Renders identically today — lead days are small integers, so `f.input` and
  // `String` agree — and it is changed anyway so the rule has no exceptions to
  // remember. An exception is what A36 was.
  const [raw, setRaw] = useState(() => f.input(reminderLeadDays));
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
        // The message lives outside the label, so the link has to be explicit —
        // otherwise assistive tech announces "invalid" with no reason.
        aria-describedby={error ? LEAD_DAYS_ERROR_ID : undefined}
        className={`h-9 w-[72px] rounded-[9px] border bg-page px-2.5 text-right text-[13px] transition ${error ? 'border-neg' : 'border-hairline hover:border-faint'}`}
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

// S8 row 5 — the only way back from a dismissal (banner ✕ or an S5 card skip):
// clears `dismissedReminders` wholesale, re-surfacing everything still in
// window. Disabled with no count while nothing is dismissed; the label re-keys
// so a count change fades (D7).
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

// S8 (design/extensions/automation.dc.html) — the suggestion switches plus the
// reminders block (gate + lead time + restore). All three features are pure
// local derivations, so the card is identical in demo and live (fetching itself
// has no toggle: it is a manual click by construction).
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
      {/* The two sub-rows belong to the row above: indented behind a hairline
          left rule, no dividers between them, and they collapse with the gate
          (300ms both ways — the shared Reveal idiom). */}
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
        {/* A7 — read-only. The controls that let the owner tune parsing need
            the B3 user model (PLAN-OPEN O14); seeing what the parse did needs
            nothing, and that is the half that was missing. */}
        <SettingRow title={t.settings.parse.title} helper={t.settings.parse.helper}>
          <ParseSkips className="ml-auto text-right" />
        </SettingRow>
      </Reveal>
    </>
  );
}

// /settings — the Settings home (NEXT-PHASE-PLAN P2, design/extensions/
// settings.dc.html S1/S2/S5/S6/S7/S8 + asset-form.dc.html S3): four stacked
// section cards in the pinned order, with the relocated Backup, the live
// Appearance controls, the Portfolio asset manager + targets editor, the
// S5 dataset switch and the S6 typed-name erase/reset danger zone.
export function Settings() {
  const t = useT();
  return (
    <div>
      <ScreenHeader title={t.screen.settings.title} subtitle={t.screen.settings.subtitle} />

      <div className="flex flex-col gap-3.5">
        {/* THE PORTFOLIO CARD IS GONE (A31). Its two halves went to the screens
            that draw what they edit: the targets to /allocation (A30) and the
            asset manager to /portfolio. Settings keeps what belongs to the
            BROWSER — data, automation, appearance — and nothing that belongs to
            the portfolio. The stagger delays below are left as they are: they
            are `delay-75`/`delay-150`/`delay-200` on three cards rather than
            four, which reads as the same cadence starting one step in. */}
        <Card
          radius={24}
          className="animate-in p-[22px] delay-75 duration-300 fade-in slide-in-from-bottom-1"
        >
          <SectionLabel>{t.settings.sections.data}</SectionLabel>
          <SettingRow title={t.settings.dataset.title} helper={t.settings.dataset.helper}>
            <DatasetSwitch />
          </SettingRow>
          <Divider />
          {/* Helper superseded by P4 S1: the P2 promise ("Restore arrives with
              import in a later release.") is kept, and now points at the row
              that keeps it. */}
          <SettingRow title={t.settings.backup.title} helper={t.settings.backup.helper}>
            <BackupButton />
          </SettingRow>
          <Divider />
          {/* S2 — the label block spans the full row: the one "Choose file…"
              button lives inside the drop panel. */}
          <ImportRow />
          <Divider />
          {/* S5 — row 4 of the pinned order (Dataset → Backup → Import →
              Spreadsheet export → [file mirror] → Danger zone). */}
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
          {/* Theme is the FIRST row, above Currency — the brief places it there
              (phase-5 Surface 1), and its copy is the brief's verbatim: a brief
              wins copy disputes even after its extension has merged (D14). */}
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
