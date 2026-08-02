import { useState, type ReactNode } from 'react';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { quoteInputSchema } from '../core/schemas';
import { useSettings } from '../state/settings';
import { AssetManager } from './settings/AssetManager';
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

// /settings — the Settings home (NEXT-PHASE-PLAN P2, design/extensions/
// settings.dc.html S1/S2/S7/S8 + asset-form.dc.html S3): four stacked section
// cards in the pinned order, with the relocated Backup, the live Appearance
// controls and the Portfolio asset manager (feat/asset-form); the targets
// editor, dataset switch and erase/reset dialogs land in the remaining P2
// tasks.
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
          <Placeholder>Dataset switching (demo / live) arrives later in this release.</Placeholder>
          <Divider />
          <SettingRow
            title="Backup"
            helper={
              'Full JSON backup of the active dataset — kubushka-backup-<date>.json. Restore arrives with import in a later release.'
            }
          >
            <BackupButton />
          </SettingRow>
          <Divider />
          <Placeholder>Erase and reset controls arrive later in this release.</Placeholder>
        </Card>

        <Card
          radius={24}
          className="animate-in fade-in slide-in-from-bottom-1 p-[22px] delay-150 duration-300"
        >
          <SectionLabel className="mb-2.5">Automation</SectionLabel>
          <Placeholder>
            Nothing to configure yet — Inzhur quote fetching, coupon suggestions and reminders
            arrive in the next release.
          </Placeholder>
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
