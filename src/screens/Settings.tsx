import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Reveal } from '../components/ui/Reveal';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Switch } from '../components/ui/Switch';
import { quoteInputSchema } from '../core/schemas';
import { useSettings } from '../state/settings';
import { AssetManager } from './settings/AssetManager';
import { CsvExportRow } from './settings/CsvExportRow';
import { DangerZone } from './settings/DangerZone';
import { DatasetSwitch } from './settings/DatasetSwitch';
import { ImportRow } from './settings/ImportRow';
import { parseLeadDays } from './settings/settings';
import { TargetsEditor } from './settings/TargetsEditor';
import { useBackupDownload } from './settings/useBackupDownload';

// Section microlabel — the card-label idiom shared with Overview's cards
// (design/extensions/settings.dc.html S2, 10px uppercase tracking .12em).
function SectionLabel({ className = 'mb-3.5', children }: { className?: string; children: string }) {
  return (
    <div className={`text-muted text-[10px] tracking-[.12em] uppercase ${className}`}>
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
        <div className="text-muted mt-[3px] text-xs leading-normal">{helper}</div>
      </div>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="bg-hairline my-4 h-px" />;
}

// Interim placeholder line (Automation-card idiom) for sections whose real
// controls land in the follow-up Phase 2 tasks.
function Placeholder({ children }: { children: string }) {
  return <div className="text-muted text-[13px] leading-normal">{children}</div>;
}

// S7 — the P1 sidebar Backup pill relocated to its designed home. Identical
// download path (repo.exportAll → buildBackup → Blob link, shared via
// useBackupDownload with the destructive dialogs' backup CTA); the outline
// variant is back on its native light palette, so the sidebar's
// ON_DARK_OUTLINE token remap is gone with the pill.
function BackupButton() {
  const backup = useBackupDownload();
  return (
    <Button
      variant="outline"
      disabled={backup.pending}
      onClick={() => {
        void backup.download();
      }}
    >
      Download backup
    </Button>
  );
}

// Light-surface twin of the sidebar currency toggle (S2/S8): track `panel`,
// thumb `card` with the card shadow, sliding-thumb motion cloned from the
// sidebar control (D7: transform 300ms soft; press scale; reduced-motion
// collapses via the global kill-switch). Same store — flipping here flips
// the sidebar and every headline KPI.
function CurrencyControl() {
  const { currency, setCurrency } = useSettings();
  const segment = (c: 'UAH' | 'USD', label: string) => (
    <button
      type="button"
      aria-pressed={currency === c}
      onClick={() => setCurrency(c)}
      className={`relative z-10 cursor-pointer rounded-full px-[18px] py-1.5 text-xs font-bold transition active:scale-[.97] ${currency === c ? 'text-ink' : 'text-muted hover:opacity-85'}`}
    >
      {label}
    </button>
  );
  return (
    <div className="border-panel-border bg-panel relative flex gap-1 rounded-full border p-1">
      {/* sliding thumb (D7): both segments share the same mono-font width, so
          translateX(100% + gap) lands it exactly under the other one */}
      <div
        aria-hidden
        className="bg-card absolute top-1 bottom-1 left-1 w-[calc(50%-6px)] rounded-full shadow-[0_1px_3px_rgba(38,38,42,.06)] transition-transform duration-300 ease-soft"
        style={{ transform: currency === 'UAH' ? 'translateX(0)' : 'translateX(calc(100% + 4px))' }}
      />
      {segment('UAH', '₴ UAH')}
      {segment('USD', '$ USD')}
    </div>
  );
}

// S8 — editable ₴/$ rate. Validation = core/schemas.quoteInputSchema (the
// app-wide "positive number, comma or dot decimals" input rule); an invalid
// or ≤0 value never reaches the store — the last valid rate stays in effect.
// Empty input only errors on blur (arming is progressive).
function UsdRateField() {
  const { usdRate, setUsdRate } = useSettings();
  const [raw, setRaw] = useState(() => String(usdRate));
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

  return (
    <div>
      <input
        id="usd-rate"
        name="usdRate"
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setError(!quoteInputSchema.safeParse(raw).success)}
        inputMode="decimal"
        aria-label="₴/$ rate"
        aria-invalid={error}
        className={`bg-page h-9 w-[110px] rounded-[10px] border px-3 text-right text-[13px] transition ${error ? 'border-neg' : 'border-hairline hover:border-faint'}`}
      />
      {error && (
        <div className="text-neg animate-in fade-in slide-in-from-top-1 mt-1 text-right text-[11px] duration-200">
          Enter a rate above 0.
        </div>
      )}
    </div>
  );
}

// S8 row 4 — "Lead time, days": how far ahead coupon reminders appear. Same
// arming rule as the ₴/$ rate above (validation via a pure parser; an invalid
// entry never reaches the store, so the last valid lead time stays in effect
// and the banners keep using it), and empty only errors on blur.
const LEAD_DAYS_ERROR_ID = 'reminder-lead-days-error';

function LeadDaysField() {
  const { reminderLeadDays, setReminderLeadDays } = useSettings();
  const [raw, setRaw] = useState(() => String(reminderLeadDays));
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
        aria-label="Reminder lead time, days"
        aria-invalid={error}
        // The message lives outside the label, so the link has to be explicit —
        // otherwise assistive tech announces "invalid" with no reason.
        aria-describedby={error ? LEAD_DAYS_ERROR_ID : undefined}
        className={`bg-page h-9 w-[72px] rounded-[10px] border px-2.5 text-right text-[13px] transition ${error ? 'border-neg' : 'border-hairline hover:border-faint'}`}
      />
      {error && (
        <div
          id={LEAD_DAYS_ERROR_ID}
          className="text-neg animate-in fade-in slide-in-from-top-1 mt-1 text-right text-[11px] duration-200"
        >
          Enter 1–30 days.
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
  const { dismissedReminders, restoreDismissed } = useSettings();
  const count = dismissedReminders.length;
  return (
    <Button
      variant="outline"
      disabled={count === 0}
      onClick={() => {
        restoreDismissed();
        toast.success('Dismissed reminders restored');
      }}
    >
      <span key={count} className="animate-in fade-in duration-150">
        {count === 0 ? 'Restore dismissed' : `Restore dismissed (${count})`}
      </span>
    </Button>
  );
}

// S8 (design/extensions/automation.dc.html) — the suggestion switches plus the
// reminders block (gate + lead time + restore). All three features are pure
// local derivations, so the card is identical in demo and live (fetching itself
// has no toggle: it is a manual click by construction).
function AutomationRows() {
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
      <SettingRow
        title="Quote suggestions"
        helper="Pre-fill ghost values for unquoted fixed-coupon assets from coupon accrual. Suggestions stay ghosts until you accept them."
      >
        <Switch
          label="Quote suggestions"
          checked={autoQuoteSuggest}
          onCheckedChange={setAutoQuoteSuggest}
        />
      </SettingRow>
      <Divider />
      <SettingRow
        title="Coupon suggestions"
        helper="Offer one-tap recording when a coupon date arrives. Every entry is confirmed by you — amounts stay editable."
      >
        <Switch label="Coupon suggestions" checked={couponSuggest} onCheckedChange={setCouponSuggest} />
      </SettingRow>
      <Divider />
      <SettingRow
        title="Reminders"
        helper="In-app banners for missing quotes, upcoming and overdue coupons, and maturities. Nothing leaves the app."
      >
        <Switch
          label="Reminders"
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
        className="border-hairline mt-3.5 flex flex-col gap-3.5 border-l pl-3"
      >
        <SettingRow title="Lead time, days" helper="How many days ahead coupon reminders appear.">
          <LeadDaysField />
        </SettingRow>
        <SettingRow
          title="Dismissed reminders"
          helper="Dismissed banners stay hidden until their date passes."
        >
          <RestoreDismissedButton />
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
  return (
    <div>
      <ScreenHeader title="Settings" subtitle="Preferences, data and portfolio configuration" />

      <div className="flex flex-col gap-3.5">
        <Card radius={24} className="animate-in fade-in slide-in-from-bottom-1 p-[22px] duration-300">
          <SectionLabel>Portfolio</SectionLabel>
          <AssetManager />
          {/* S4 targets editor — brings its own divider + microlabel so the
              sub-section vanishes with the Portfolio empty state */}
          <TargetsEditor />
        </Card>

        <Card
          radius={24}
          className="animate-in fade-in slide-in-from-bottom-1 p-[22px] delay-75 duration-300"
        >
          <SectionLabel>Data</SectionLabel>
          <SettingRow
            title="Dataset"
            helper="Demo holds the built-in reference portfolio. Live starts empty and holds your real data. Switching reloads the app."
          >
            <DatasetSwitch />
          </SettingRow>
          <Divider />
          {/* Helper superseded by P4 S1: the P2 promise ("Restore arrives with
              import in a later release.") is kept, and now points at the row
              that keeps it. */}
          <SettingRow
            title="Backup"
            helper={
              'Full JSON backup of the active dataset — kubushka-backup-<date>.json. Restore it with Import below.'
            }
          >
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
          <SettingRow
            title="Danger zone"
            helper="Both actions ask for a typed confirmation and offer a backup first."
          >
            <DangerZone />
          </SettingRow>
        </Card>

        <Card
          radius={24}
          className="animate-in fade-in slide-in-from-bottom-1 p-[22px] delay-150 duration-300"
        >
          <SectionLabel>Automation</SectionLabel>
          <AutomationRows />
        </Card>

        <Card
          radius={24}
          className="animate-in fade-in slide-in-from-bottom-1 p-[22px] delay-200 duration-300"
        >
          <SectionLabel>Appearance</SectionLabel>
          <SettingRow title="Currency" helper="Mirrors the sidebar toggle — headline figures only.">
            <CurrencyControl />
          </SettingRow>
          <Divider />
          <SettingRow
            title="₴/$ rate"
            helper="Used for the $ view of headline figures. Tables always stay in ₴."
          >
            <UsdRateField />
          </SettingRow>
          <Divider />
          <Placeholder>Theme and language settings are coming later.</Placeholder>
        </Card>
      </div>
    </div>
  );
}
