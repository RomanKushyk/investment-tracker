// The file field and the drop target — the single way data comes into the app.
// Nothing here reads, parses or writes until a file arrives, and reading always
// resolves into exactly one of two dialogs, never a silent no-op and never a
// write. Import is never disabled: it is the recovery path.
import { Download, FileText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../components/ui/Button';
import {
  classifyImportFiles,
  diffBackup,
  rowsRejection,
  validateImport,
} from '@quirenote/core/backup/import';
import { importParts } from '@quirenote/core/backup/parts';
import { todayIso } from '@quirenote/core/dates';
import { useExportState } from '../../hooks/queries';
import { csvTablesOf } from '../../lib/backup';
import { fileRejection, importToasts } from './import-labels';
import { ImportDialog, type ImportAttempt } from './ImportDialog';
import type { FileRejectionCode } from '@quirenote/core/backup/import';
import { useT } from '../../i18n/useT';

/** A file-level rejection is transient — it clears on the next attempt too. */
const REJECTION_MS = 5000;

export function ImportRow() {
  const t = useT();
  const exportState = useExportState();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [rejection, setRejection] = useState<FileRejectionCode | null>(null);
  const [attempt, setAttempt] = useState<ImportAttempt | null>(null);
  const [open, setOpen] = useState(false);
  // A fresh session key per attempt resets the dialog's state while a closed
  // dialog stays mounted through its exit.
  const [session, setSession] = useState(0);

  useEffect(() => {
    if (!rejection) return;
    const timer = setTimeout(() => setRejection(null), REJECTION_MS);
    return () => clearTimeout(timer);
  }, [rejection]);

  async function handleFiles(files: File[]) {
    setRejection(null);
    const classified = classifyImportFiles(files.map((f) => ({ name: f.name, size: f.size })));
    if (!classified.ok) {
      setRejection(classified.code);
      return;
    }
    const [file] = files;
    setReading(file.name);
    try {
      const text = await file.text();
      const validation = validateImport(text);
      if (!validation.ok) {
        setAttempt({ kind: 'report', name: file.name, rejection: validation.rejection });
      } else {
        // THE ROWS THE API WOULD REFUSE, found before anything is sent: a part it refuses stages
        // nothing, and the import could then never be committed.
        const plan = await importParts(validation.envelope);
        if (!plan.ok) {
          setAttempt({ kind: 'report', name: file.name, rejection: rowsRejection(plan.issues) });
        } else {
          // Read fresh from the API rather than off a cached query: the diff is what the user is
          // about to authorise.
          const state = await exportState.mutateAsync();
          setAttempt({
            kind: 'preview',
            name: file.name,
            envelope: validation.envelope,
            plan,
            diff: diffBackup(csvTablesOf(state), validation.envelope, { today: todayIso() }),
            etag: state.etag,
          });
        }
      }
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
      <div className="mt-[3px] max-w-[520px] text-xs leading-normal text-muted">
        {t.importing.row.helper}
      </div>

      {/* SOLID border, never dashed: a dashed affordance would read as a machine's
          guess. The panel is a container, not a pressable, and adds no second tab stop
          — drop is a pointer-only enhancement. It still wears the control-boundary
          rank, because the copy says WHAT and only this border says WHERE. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={(e) => {
          // Without this the browser navigates the tab to the dropped file.
          e.preventDefault();
          setDragOver(false);
          if (!busy) void handleFiles(Array.from(e.dataTransfer.files));
        }}
        className={`mt-3 flex flex-col items-center gap-1.5 rounded-2xl border p-5 text-center transition duration-150 max-sm:p-4 ${
          dragOver ? 'border-ink bg-hairline' : 'border-field-border bg-panel hover:border-muted'
        }`}
      >
        {busy ? (
          <>
            <FileText size={16} strokeWidth={2.25} className="text-muted opacity-75" />
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
            <div className={`text-[13px] leading-snug ${dragOver ? 'font-semibold' : ''}`}>
              {dragOver ? t.importing.row.dragLine : t.importing.row.dropLine}
            </div>
            <div className="text-[11px] text-muted">{t.importing.row.dropHint}</div>
          </>
        )}
        <Button
          variant="outline"
          className="mt-1.5 max-sm:w-full max-sm:max-w-[200px]"
          disabled={busy}
          onClick={pick}
        >
          {t.importing.row.choose}
        </Button>
        {/* Label-bound file field: keyboard users never meet the drag path. `.json`
            only — CSV is export-only. */}
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
        // `warn`, never `neg`: picking the wrong file is not an error worth alarming
        // about, and the portfolio is untouched.
        <div
          role="status"
          className="mt-2 animate-in text-xs leading-normal text-warn duration-200 fade-in slide-in-from-top-1"
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

function middleTruncate(name: string, max = 34): string {
  if (name.length <= max) return name;
  const head = Math.ceil((max - 1) / 2);
  return `${name.slice(0, head)}…${name.slice(-(max - 1 - head))}`;
}
