// S2 — Settings → Data "Import": the file field + the solid drop target
// (design/extensions/data-portability.dc.html S2). The single way data comes
// into the app.
//
// Nothing here reads, parses or writes until a file arrives, and reading always
// resolves into exactly one of two dialogs — the S3 preview or the S4 report —
// never a silent no-op and never a write. Import is never disabled: it is the
// recovery path in every dataset, demo included (it targets the ACTIVE one, and
// "Reset demo data…" is the escape hatch, G4/D16).
import { Download, FileText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../components/ui/Button';
import {
  classifyImportFiles,
  diffBackup,
  validateImport,
} from '../../core/backup/import';
import { todayIso } from '../../core/dates';
import { useExportAll } from '../../hooks/queries';
import { dbVersion } from '../../lib/repository';
import { useDataset } from '../../state/settings';
import { fileRejection, importToasts } from './import-labels';
import { ImportDialog, type ImportAttempt } from './ImportDialog';
import type { FileRejectionCode } from '../../core/backup/import';
import { useT } from '../../i18n/useT';

/** A file-level rejection is transient — it clears on the next attempt too. */
const REJECTION_MS = 5000;

export function ImportRow() {
  const t = useT();
  const dataset = useDataset();
  const exportAll = useExportAll();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [rejection, setRejection] = useState<FileRejectionCode | null>(null);
  const [attempt, setAttempt] = useState<ImportAttempt | null>(null);
  const [open, setOpen] = useState(false);
  // A fresh session key per attempt resets the dialog's opt-in/pending state
  // while a closed dialog stays mounted through its 220ms exit (D7/D17).
  const [session, setSession] = useState(0);

  useEffect(() => {
    if (!rejection) return;
    const timer = setTimeout(() => setRejection(null), REJECTION_MS);
    return () => clearTimeout(timer);
  }, [rejection]);

  async function handleFiles(files: File[]) {
    setRejection(null);
    const classified = classifyImportFiles(
      files.map((f) => ({ name: f.name, size: f.size })),
    );
    if (!classified.ok) {
      setRejection(classified.code);
      return;
    }
    const [file] = files;
    setReading(file.name);
    try {
      // Reading resolves into exactly one of two dialogs — never a silent
      // no-op, so even a failed read says so (nothing was changed either way).
      const text = await file.text();
      // Read fresh from the DB rather than off a cached query: the diff is what
      // the user is about to authorise.
      const current = await exportAll.mutateAsync();
      const validation = validateImport(text);
      setAttempt(
        validation.ok
          ? {
              kind: 'preview',
              name: file.name,
              envelope: validation.envelope,
              diff: diffBackup(current, validation.envelope, {
                dataset,
                today: todayIso(),
                dbVersion,
              }),
            }
          : {
              kind: 'report',
              name: file.name,
              rejection: validation.rejection,
            },
      );
      setSession((s) => s + 1);
      setOpen(true);
    } catch {
      toast.error(importToasts(t).failed);
    } finally {
      setReading(null);
    }
  }

  function pick() {
    // Clearing the value first so re-picking the same file still fires change.
    if (inputRef.current) inputRef.current.value = '';
    inputRef.current?.click();
  }

  const busy = reading !== null;

  return (
    <div>
      <div className="text-[13px] font-semibold">{t.importing.row.title}</div>
      <div className="text-muted mt-[3px] max-w-[520px] text-xs leading-normal">
        {t.importing.row.helper}
      </div>
      {dataset === 'demo' && (
        <div className="text-muted mt-1.5 max-w-[520px] text-[11px] leading-relaxed">
          {t.importing.row.demoNote}
        </div>
      )}

      {/* SOLID border, never dashed: a dashed affordance would read as a
          machine's guess (P3's dashed = proposed rule). The panel is a
          container, not a pressable — no lift, no scale, and it adds no second
          tab stop (drop is a pointer-only enhancement). */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setDragOver(false);
        }}
        onDrop={(e) => {
          // Without this the browser navigates the tab to the dropped file.
          e.preventDefault();
          setDragOver(false);
          if (!busy) void handleFiles(Array.from(e.dataTransfer.files));
        }}
        className={`mt-3 flex flex-col items-center gap-1.5 rounded-2xl border p-5 text-center transition duration-150 max-sm:p-4 ${
          dragOver
            ? 'border-ink bg-hairline'
            : 'bg-panel border-panel-border hover:border-faint'
        }`}
      >
        {busy ? (
          <>
            <FileText
              size={16}
              strokeWidth={2.25}
              className="text-muted opacity-75"
            />
            {/* Long names truncate in the MIDDLE and the line never wraps. */}
            <div className="max-w-full animate-pulse truncate text-[13px] opacity-70 [animation-duration:1.2s]">
              {t.importing.row.reading(middleTruncate(reading))}
            </div>
          </>
        ) : (
          <>
            <Download
              size={16}
              strokeWidth={2.25}
              className={dragOver ? 'text-ink' : 'text-muted'}
            />
            <div
              className={`text-[13px] leading-snug ${dragOver ? 'font-semibold' : ''}`}
            >
              {dragOver ? t.importing.row.dragLine : t.importing.row.dropLine}
            </div>
            <div className="text-muted text-[11px]">
              {t.importing.row.dropHint}
            </div>
          </>
        )}
        {/* Auto width per the reference; only the 360px drawing caps it at a
            full-width 200px pill. */}
        <Button
          variant="outline"
          className="mt-1.5 max-sm:w-full max-sm:max-w-[200px]"
          disabled={busy}
          onClick={pick}
        >
          {t.importing.row.choose}
        </Button>
        {/* Label-bound file field: keyboard users never meet the drag path.
            `.json` only — CSV is export-only (D29). */}
        <input
          ref={inputRef}
          type="file"
          accept=".json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => void handleFiles(Array.from(e.target.files ?? []))}
        />
      </div>

      {rejection && (
        // `warn`, never `neg`: picking the wrong file is not an error worth
        // alarming about — and the dataset is untouched.
        <div
          role="status"
          className="text-warn animate-in fade-in slide-in-from-top-1 mt-2 text-xs leading-normal duration-200"
        >
          {fileRejection(rejection, t)}
        </div>
      )}

      {session > 0 && attempt && (
        <ImportDialog
          key={session}
          attempt={attempt}
          open={open}
          onClose={() => setOpen(false)}
          onChooseAnother={() => {
            setOpen(false);
            pick();
          }}
        />
      )}
    </div>
  );
}

/** quirenote-backup-2026-08-04.json → quirenote-bac…-08-04.json */
function middleTruncate(name: string, max = 34): string {
  if (name.length <= max) return name;
  const head = Math.ceil((max - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(-(max - 1 - head))}`;
}
