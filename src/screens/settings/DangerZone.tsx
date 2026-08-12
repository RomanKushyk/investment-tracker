import { useId, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../components/ui/Button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
} from '../../components/ui/Dialog';
import { useClearAll } from '../../hooks/queries';
import { useDraft } from '../../state/draft';
import { useDataset } from '../../state/settings';
import { useBackupDownload } from './useBackupDownload';
import type { Dataset } from '../../core/backup/json';

// S6 copy (brief = copy authority). The erase body's middle sentence
// documents the D17 erase scope: the kubushka-draft quote draft goes with the
// data, kubushka-settings is retained.
const VARIANTS: Record<
  Dataset,
  { trigger: string; title: string; body: string; inputLabel: string; action: string; success: string }
> = {
  live: {
    trigger: 'Erase live data…',
    title: 'Erase live data?',
    body: 'This permanently deletes every asset, snapshot and transaction in the live dataset. The unsaved quote draft is cleared too — settings are kept. This cannot be undone.',
    inputLabel: 'Type live to confirm',
    action: 'Erase live data',
    success: 'Live data erased',
  },
  demo: {
    trigger: 'Reset demo data…',
    title: 'Reset demo data?',
    body: 'This replaces everything in the demo dataset with the built-in reference portfolio. Any changes you made in demo mode are lost.',
    inputLabel: 'Type demo to confirm',
    action: 'Reset demo data',
    success: 'Demo data reset',
  },
};

// Settings→Data danger zone (S6/D17): one trigger per dataset — "Erase live
// data…" only ever renders in live (clearAll({reseed:false})), "Reset demo
// data…" only in demo (clearAll({reseed:true})) — both opening the typed-name
// AlertDialog below. A fresh session key per open resets the typed/backed-up
// state while the closed dialog stays mounted through its 220ms symmetric
// exit (D7/S6 — unmounting on close would skip the animation).
export function DangerZone() {
  const dataset = useDataset();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button
        variant="outlineDanger"
        onClick={() => {
          setSession((s) => s + 1);
          setOpen(true);
        }}
      >
        {VARIANTS[dataset].trigger}
      </Button>
      {session > 0 && (
        <ClearDataDialog
          key={session}
          dataset={dataset}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ClearDataDialog({
  dataset,
  open,
  onClose,
}: {
  dataset: Dataset;
  open: boolean;
  onClose: () => void;
}) {
  const v = VARIANTS[dataset];
  const clearAll = useClearAll();
  const backup = useBackupDownload();
  const [typed, setTyped] = useState('');
  const [backedUp, setBackedUp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  // Progressive arming (S6): the destructive button stays disabled until the
  // typed name matches the dataset name — case-insensitive, trimmed.
  const armed = typed.trim().toLowerCase() === dataset;

  function confirm() {
    clearAll.mutate(
      { reseed: dataset === 'demo' },
      {
        onSuccess: () => {
          if (dataset === 'live') {
            // D17 erase scope: the quote draft references erased asset ids —
            // reset it (kubushka-draft) with the data; settings are retained.
            useDraft.getState().setDate('');
          }
          toast.success(v.success);
          onClose();
        },
        // Atomic clearAll: a failure commits nothing (dialog stays open).
        onError: () => toast.error('Could not complete — nothing was deleted.'),
      },
    );
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      onOpenAutoFocus={(e) => {
        e.preventDefault(); // Radix would focus the Cancel button
        inputRef.current?.focus();
      }}
    >
      <AlertDialogTitle asChild>
        <h3 className="mt-0 mb-2 text-lg">{v.title}</h3>
      </AlertDialogTitle>
      <AlertDialogDescription asChild>
        <p className="text-label m-0 mb-3.5 text-[13px] leading-normal">{v.body}</p>
      </AlertDialogDescription>
      <label htmlFor={inputId} className="text-label mb-1 block text-[11px]">
        {v.inputLabel}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        className="border-hairline bg-page hover:border-faint h-9 w-full rounded-[9px] border px-3 text-[13px] transition"
      />
      <Button
        variant={backedUp ? 'outlineMuted' : 'outline'}
        className="mt-3 w-full"
        disabled={backup.pending}
        aria-disabled={backedUp || undefined}
        tabIndex={backedUp ? -1 : undefined}
        onClick={() => {
          void backup.download().then((ok) => ok && setBackedUp(true));
        }}
      >
        {/* re-keyed label = D7 crossfade on success (enter-only idiom) */}
        <span key={String(backedUp)} className="animate-in fade-in duration-200">
          {backedUp ? 'Backup downloaded ✓' : 'Download backup first'}
        </span>
      </Button>
      <div className="mt-3.5 flex flex-wrap justify-end gap-2.5">
        <AlertDialogCancel asChild>
          <Button variant="ghost">Cancel</Button>
        </AlertDialogCancel>
        <Button variant="danger" disabled={!armed || clearAll.isPending} onClick={confirm}>
          {v.action}
        </Button>
      </div>
    </AlertDialog>
  );
}
