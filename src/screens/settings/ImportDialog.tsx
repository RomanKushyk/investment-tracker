// S3 preview/diff + S4 rejected-file report (design/extensions/
// import-dialog.dc.html). One shell, two contents — the D17 AlertDialog idiom
// widened to the 480px band.
//
// SAFETY-FIRST (the phase's binding doctrine): the Confirm press is the SOLE
// write path. Opening this dialog, reading its diff, toggling the settings
// checkbox and cancelling all leave the dataset byte-identical. The safety
// backup is handed to the browser BEFORE repo.replaceAll, and a safety backup
// that cannot be built stops the import.
import { AlertTriangle, Download } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../components/ui/Button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogBody,
  DialogFooter,
  DialogHeader,
} from '../../components/ui/Dialog';
import { todayIso } from '../../core/dates';
import { signed } from '../../core/money';
import { useReplaceAll } from '../../hooks/queries';
import { useDraft } from '../../state/draft';
import { migrateSettings, useDataset, useSettings } from '../../state/settings';
import {
  fileSubline,
  importToasts,
  formatReasonSentence,
  issueLine,
  problemCount,
  resultLine,
  safetyBackupLine,
  settingsOptInHelper,
  warningSentence,
} from './import-labels';
import { useBackupDownload } from './useBackupDownload';
import type {
  BackupDiff,
  ImportRejection,
  TableDiff,
} from '../../core/backup/import';
import type { BackupEnvelope, Dataset } from '../../core/backup/json';
import { useFormat } from '../../hooks/useFormat';
import type { Dict } from '../../i18n/messages';
import { useT } from '../../i18n/useT';
import { Scroller } from '../../components/ui/Scroller';

/** What the S2 row produced: either a validated file, or the reason it failed. */
export type ImportAttempt =
  | {
      kind: 'preview';
      name: string;
      envelope: BackupEnvelope;
      diff: BackupDiff;
    }
  | { kind: 'report'; name: string; rejection: ImportRejection };

export function ImportDialog({
  attempt,
  open,
  onClose,
  onChooseAnother,
}: {
  attempt: ImportAttempt;
  open: boolean;
  onClose: () => void;
  onChooseAnother: () => void;
}) {
  const t = useT();
  const dataset = useDataset();
  const replaceAll = useReplaceAll();
  const backup = useBackupDownload();
  const [applySettings, setApplySettings] = useState(false);
  const [pending, setPending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  // One press = one run: the confirm awaits two async steps, and a second click
  // inside that window must not start a second import (the P3 CouponDueCard
  // latch — a ref, so it is set before React can re-render).
  const running = useRef(false);

  const safetyName = `quirenote-before-import-${todayIso()}`;

  async function confirm() {
    if (running.current || attempt.kind !== 'preview') return;
    running.current = true;
    setPending(true);
    const { envelope, diff } = attempt;
    try {
      // ACCEPTANCE CRITERION: the safety backup downloads BEFORE anything is
      // replaced, and a failure to build it means nothing is imported at all.
      // `via: 'anchor'` is what keeps that true now that exports can open a
      // Save-as dialog: a modal in front of a guarantee is a modal the user can
      // cancel, and this one must not be cancellable (D24).
      const saved = await backup.download({
        name: safetyName,
        quiet: true,
        via: 'anchor',
      });
      if (!saved) {
        toast.error(importToasts(t).safetyFailed);
        return;
      }
      setBackedUp(true);
      await replaceAll.mutateAsync({
        data: {
          assets: envelope.assets,
          snapshots: envelope.snapshots,
          transactions: envelope.transactions,
        },
        onBlocked: () => setWaiting(true),
      });
      // The imported dataset has its own asset ids: a draft left over from the
      // replaced one would show phantom values against them (the D17 erase
      // scope, same hazard).
      useDraft.getState().setDate('');
      if (applySettings && envelope.settings) {
        // Through the store's setters and the D11 sanitizer — never a direct
        // localStorage write, and never dataset/automation/reminder fields.
        const sane = migrateSettings(envelope.settings);
        useSettings.getState().setCurrency(sane.currency);
        useSettings.getState().setUsdRate(sane.usdRate);
      }
      toast.success(importToasts(t).success(diff.after));
      onClose();
    } catch {
      // replaceAll is all-or-nothing: nothing was written, so the dialog stays
      // open on the same diff.
      toast.error(importToasts(t).failed);
    } finally {
      setWaiting(false);
      setPending(false);
      running.current = false;
    }
  }

  return (
    <AlertDialog
      open={open}
      width={480}
      onOpenChange={(o) => !o && !pending && onClose()}
      // Pending blocks Esc as well as the (already inert) outside click.
      onEscapeKeyDown={(e) => pending && e.preventDefault()}
    >
      {attempt.kind === 'preview' ? (
        <Preview
          attempt={attempt}
          dataset={dataset}
          pending={pending}
          waiting={waiting}
          backedUp={backedUp}
          safetyName={safetyName}
          applySettings={applySettings}
          onApplySettings={setApplySettings}
          onConfirm={() => void confirm()}
        />
      ) : (
        <Report attempt={attempt} onChooseAnother={onChooseAnother} />
      )}
    </AlertDialog>
  );
}

// --- S3 --------------------------------------------------------------------

function Preview({
  attempt,
  dataset,
  pending,
  waiting,
  backedUp,
  safetyName,
  applySettings,
  onApplySettings,
  onConfirm,
}: {
  attempt: Extract<ImportAttempt, { kind: 'preview' }>;
  dataset: Dataset;
  pending: boolean;
  waiting: boolean;
  backedUp: boolean;
  safetyName: string;
  applySettings: boolean;
  onApplySettings: (on: boolean) => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const f = useFormat();
  const { name, envelope, diff } = attempt;
  return (
    <>
      <DialogHeader>
        <AlertDialogTitle asChild>
          <h3 className="m-0 text-lg">
            {t.importing.preview.title(dataset)}
          </h3>
        </AlertDialogTitle>
      </DialogHeader>
      <DialogBody>
        <div className="text-muted mb-3.5 text-[11px] leading-relaxed [overflow-wrap:anywhere]">
          {fileSubline(name, envelope.exportedAt, envelope.dataset, f, t)}
        </div>

        {/* Replace banner — never dismissible, and it names the dataset it
            destroys. `neg-tint` at block scale (the widened rule, site 1 of 2). */}
        <AlertDialogDescription asChild>
          <div className="bg-neg-tint text-neg-tint-text mb-4 flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-[12.5px] leading-[1.55]">
            <AlertTriangle
              size={16}
              strokeWidth={2.25}
              className="mt-0.5 flex-none"
            />
            <span>
              {t.importing.preview.banner(dataset)}
              {dataset === 'demo' ? t.importing.preview.bannerDemoSuffix : ''}
            </span>
          </div>
        </AlertDialogDescription>

        <DiffPanel diff={diff} dimmed={pending} />
        <div className="mt-3.5 text-[13px] leading-normal">
          {resultLine(diff.after, t)}
        </div>

        {diff.warnings.length > 0 && (
          <>
            <div className="text-muted mt-4 mb-2 text-[10px] tracking-[.12em] uppercase">
              {t.importing.preview.warningsLabel}
            </div>
            {/* One warn-tint block: a list of cautions reads as one object. Every
                warning is non-blocking — the confirm stays enabled. */}
            <div className="bg-warn-tint text-warn-tint-text animate-in fade-in slide-in-from-top-1 flex flex-col gap-2 rounded-2xl px-3.5 py-3 duration-300">
              {diff.warnings.map((w) => (
                <div
                  key={w.code}
                  className="flex items-start gap-2 text-xs leading-normal"
                >
                  <span className="flex-none font-bold">!</span>
                  <span>{warningSentence(w, dataset, f, t)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {envelope.settings ? (
          <label
            className={`hover:bg-page/60 mt-4 flex items-start gap-2.5 rounded-xl p-2 transition ${
              pending ? 'pointer-events-none opacity-70' : 'cursor-pointer'
            }`}
          >
            <input
              type="checkbox"
              checked={applySettings}
              disabled={pending}
              onChange={(e) => onApplySettings(e.target.checked)}
              className="accent-ink border-panel-border bg-page mt-px size-4 flex-none rounded-[5px] transition active:scale-[.97]"
            />
            <span className="flex-1">
              <span className="block text-[13px]">
                {t.importing.preview.settingsOptIn}
              </span>
              <span className="text-muted mt-[3px] block text-[11px] leading-relaxed">
                {settingsOptInHelper(envelope.settings, f, t)}
              </span>
            </span>
          </label>
        ) : (
          // Never a disabled checkbox: there is nothing to opt into.
          <div className="text-muted mt-4 text-[11px]">
            {t.importing.preview.noSettings}
          </div>
        )}

        <div className="text-muted mt-3.5 flex items-start gap-2 text-[11px] leading-relaxed">
          <Download size={13} strokeWidth={2.5} className="mt-[3px] flex-none" />
          <span className="[overflow-wrap:anywhere]">
            {safetyBackupLine(dataset, safetyName, backedUp, t)}
          </span>
        </div>
      </DialogBody>
      <DialogFooter>
        {/* At 360px the buttons stack full width with the destructive one LAST. */}
        <div className="flex flex-col gap-2 @min-[420px]:flex-row @min-[420px]:flex-wrap @min-[420px]:justify-end">
          <AlertDialogCancel asChild>
            <Button
              variant="ghost"
              disabled={pending}
              className="@max-[419px]:w-full"
            >
              {t.importing.preview.cancel}
            </Button>
          </AlertDialogCancel>
          <Button
            variant="danger"
            disabled={pending}
            disabledTone="busy"
            className="@max-[419px]:w-full"
            onClick={onConfirm}
          >
            {/* No percentage bar anywhere: the write is one atomic transaction and
                a progress number would be fiction. Lock contention swaps the word
                in the same slot. */}
            <span
              key={pending ? (waiting ? 'waiting' : 'pending') : 'idle'}
              className={
                pending
                  ? 'animate-pulse [animation-duration:1.2s]'
                  : 'animate-in fade-in duration-200'
              }
            >
              {pending
                ? waiting
                  ? t.importing.preview.waiting
                  : t.importing.preview.pending
                : t.importing.preview.confirm}
            </span>
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

// The row ORDER is a design decision and stays here; the labels come from the
// dictionary.
function diffRows(t: Dict) {
  return [
    ['assets', t.importing.preview.rowAssets],
    ['snapshots', t.importing.preview.rowSnapshots],
    ['transactions', t.importing.preview.rowTransactions],
  ] as const;
}

// The one DASHED element of the phase (P3's rule: dashed = proposed, and this
// is data that is not written yet — "Replace all data" is the press that
// crosses the line). One DOM, two layouts: at ≥420px of DIALOG width each
// table's cells join the parent grid through `display:contents`; below that
// each table is its own block with the column words as micro-labels.
function DiffPanel({ diff, dimmed }: { diff: BackupDiff; dimmed: boolean }) {
  const t = useT();
  return (
    <div
      className={`border-faint rounded-2xl border border-dashed px-4 py-3.5 transition-opacity ${
        dimmed ? 'opacity-70' : ''
      }`}
    >
      <div className="text-muted mb-2.5 text-[10px] tracking-[.12em] uppercase">
        {t.importing.preview.diffLabel}
      </div>
      <div className="flex flex-col gap-2.5 text-[12.5px] @min-[420px]:grid @min-[420px]:grid-cols-[1fr_auto_auto_auto] @min-[420px]:items-center @min-[420px]:gap-x-3.5 @min-[420px]:gap-y-1">
        <div className="text-muted hidden text-[10px] tracking-[.08em] uppercase @min-[420px]:block">
          {t.importing.preview.colTable}
        </div>
        {[
          t.importing.preview.colAdded,
          t.importing.preview.colReplaced,
          t.importing.preview.colRemoved,
        ].map((c) => (
          <div
            key={c}
            className="text-muted hidden text-right text-[10px] tracking-[.08em] uppercase @min-[420px]:block"
          >
            {c}
          </div>
        ))}
        {diffRows(t).map(([key, label], index) => (
          <DiffRow key={key} label={label} counts={diff[key]} index={index} />
        ))}
      </div>
    </div>
  );
}

// A `display:contents` box paints neither border nor padding, so the narrow
// layout's separator rule is inert at wide widths without an override — the
// cells carry their own top rule there instead.
function DiffRow({
  label,
  counts,
  index,
}: {
  label: string;
  counts: TableDiff;
  index: number;
}) {
  const t = useT();
  const cell = 'border-hairline @min-[420px]:border-t @min-[420px]:pt-2';
  return (
    <div
      // fade + slide, staggered 40ms per TABLE row (never per cell)
      style={{ animationDelay: `${index * 40}ms` }}
      className={`animate-in fade-in slide-in-from-top-1 duration-200 @min-[420px]:contents ${
        index === 0 ? '' : 'border-hairline border-t pt-2'
      }`}
    >
      <div className={`font-semibold @min-[420px]:font-normal ${cell}`}>
        {label}
      </div>
      <div className="mt-0.5 flex gap-3.5 @min-[420px]:contents">
        <Count
          value={counts.added}
          tone="pos"
          sign
          label={t.importing.preview.colAdded}
          cell={cell}
        />
        <Count
          value={counts.replaced}
          tone="warn"
          label={t.importing.preview.colReplaced}
          cell={cell}
        />
        <Count
          value={counts.removed}
          tone="neg"
          negative
          label={t.importing.preview.colRemoved}
          cell={cell}
        />
      </div>
    </div>
  );
}

// Raw accents, never tinted pills — the tint families keep meaning "block",
// not "number". A zero is muted with no accent at all.
const TONE = {
  pos: 'text-pos font-bold',
  warn: 'text-warn font-bold',
  neg: 'text-neg font-bold',
};

function Count({
  value,
  tone,
  sign = false,
  negative = false,
  label,
  cell,
}: {
  value: number;
  tone: keyof typeof TONE;
  sign?: boolean;
  negative?: boolean;
  label: string;
  cell: string;
}) {
  const body = String(value);
  const text =
    value === 0
      ? '0'
      : sign
        ? signed(value, body)
        : negative
          ? signed(-value, body)
          : body;
  return (
    <span className={`@min-[420px]:block @min-[420px]:text-right ${cell}`}>
      <span className="text-muted text-[10px] tracking-[.08em] uppercase @min-[420px]:hidden">
        {label}{' '}
      </span>
      <span className={value === 0 ? 'text-muted' : TONE[tone]}>{text}</span>
    </span>
  );
}

// --- S4 --------------------------------------------------------------------

function Report({
  attempt,
  onChooseAnother,
}: {
  attempt: Extract<ImportAttempt, { kind: 'report' }>;
  onChooseAnother: () => void;
}) {
  const t = useT();
  const { name, rejection } = attempt;
  return (
    <>
      <DialogHeader>
        <AlertDialogTitle asChild>
          <h3 className="m-0 text-lg">{t.importing.report.title}</h3>
        </AlertDialogTitle>
      </DialogHeader>
      <DialogBody>
        <div className="text-muted font-body mb-3 text-[11px] [overflow-wrap:anywhere]">
          {name}
        </div>
        <AlertDialogDescription asChild>
          <p className="text-neg m-0 mb-3.5 text-[13px] leading-normal">
            {t.importing.report.lead}
          </p>
        </AlertDialogDescription>

        {rejection.kind === 'format' ? (
          // A format-level rejection is ONE sentence, never a list.
          <div className="animate-in fade-in duration-200">
            <div className="text-[13px] leading-normal">
              {formatReasonSentence(rejection.code, rejection.version, t)}
            </div>
            {/* The ONE place the D12 parser's own sentence appears on screen. */}
            <div className="text-muted font-body mt-1.5 text-[11.5px] [overflow-wrap:anywhere]">
              {rejection.detail}
            </div>
          </div>
        ) : (
          <>
            <div className="text-muted mb-2 text-[10px] tracking-[.12em] uppercase">
              {problemCount(rejection.total, rejection.issues.length, t)}
            </div>
            {/* The list scrolls inside its own sub-panel — the page never does.
                Fade only, no stagger: a wall of staggered errors reads as an
                animation, not a report. */}
            <div className="bg-panel animate-in fade-in rounded-2xl duration-200">
              {/* The height limit sits on the Scroller's viewport; the INLINE
                  padding must not. Passing `radius` already opens the gutter
                  from the root — adding px here inset the issue lines a second
                  time and took the column they wrap in from ~404 to ~308. */}
              <Scroller radius={16} className="max-h-[200px] py-3">
                <div className="font-body text-[11.5px] leading-[1.9] [overflow-wrap:anywhere]">
                  {rejection.issues.map((issue, i) => (
                    <div
                      key={`${issue.table}-${issue.at ?? i}-${issue.field ?? ''}-${i}`}
                    >
                      {issueLine(issue, t)}
                    </div>
                  ))}
                </div>
              </Scroller>
            </div>
            <div className="text-muted mt-2.5 text-xs leading-relaxed">
              {t.importing.report.hint}
            </div>
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <div className="flex flex-col gap-2 @min-[420px]:flex-row @min-[420px]:flex-wrap @min-[420px]:justify-end">
          <AlertDialogCancel asChild>
            <Button variant="ghost" className="@max-[419px]:w-full">
              {t.importing.report.close}
            </Button>
          </AlertDialogCancel>
          {/* Re-opens the file dialog directly — never a dead end. */}
          <Button
            variant="outline"
            className="@max-[419px]:w-full"
            onClick={onChooseAnother}
          >
            {t.importing.report.another}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}
