import { useId, useRef, useState } from 'react';
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
import { useClearAll } from '../../hooks/queries';
import { useDraft } from '../../state/draft';
import { useDataset } from '../../state/settings';
import { useBackupDownload } from '../../hooks/useBackupDownload';
import type { Dataset } from '../../core/backup/json';
import type { Dict } from '../../i18n/messages';
import { useT } from '../../i18n/useT';

// S6 copy (brief = copy authority). The erase body's middle sentence
// documents the D17 erase scope: the kubushka-draft quote draft goes with the
// data, kubushka-settings is retained.
// Was a module constant; the copy now comes from the dictionary, and the one
// piece that must NOT be translated is passed as DATA: `typeToConfirm(dataset)`
// keeps the literal `live`/`demo` the confirm compares against, so no
// translation can make the button unarmable.
function variantCopy(t: Dict, dataset: Dataset) {
  const v = dataset === 'live' ? t.danger.live : t.danger.demo;
  return { ...v, inputLabel: t.danger.typeToConfirm(dataset) };
}

// Settings→Data danger zone (S6/D17): one trigger per dataset — "Erase live
// data…" only ever renders in live (clearAll({reseed:false})), "Reset demo
// data…" only in demo (clearAll({reseed:true})) — both opening the typed-name
// AlertDialog below. A fresh session key per open resets the typed/backed-up
// state while the closed dialog stays mounted through its 220ms symmetric
// exit (D7/S6 — unmounting on close would skip the animation).
export function DangerZone() {
  const t = useT();
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
        {variantCopy(t, dataset).trigger}
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
  const t = useT();
  const v = variantCopy(t, dataset);
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
        onError: () => toast.error(t.danger.failed),
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
      <DialogHeader>
        <AlertDialogTitle asChild>
          <h3 className="m-0 text-lg">{v.title}</h3>
        </AlertDialogTitle>
      </DialogHeader>
      <DialogBody>
        <AlertDialogDescription asChild>
          <p className="text-muted m-0 mb-3.5 text-[13px] leading-normal">{v.body}</p>
        </AlertDialogDescription>
        <label htmlFor={inputId} className="text-muted mb-1 block text-[11px]">
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
            {backedUp ? t.danger.backupDone : t.danger.backupFirst}
          </span>
        </Button>
      </DialogBody>
      <DialogFooter>
        <div className="flex flex-wrap justify-end gap-2.5">
          <AlertDialogCancel asChild>
            <Button variant="ghost">{t.assets.cancel}</Button>
          </AlertDialogCancel>
          <Button variant="danger" disabled={!armed || clearAll.isPending} onClick={confirm}>
            {v.action}
          </Button>
        </div>
      </DialogFooter>
    </AlertDialog>
  );
}
