import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../components/ui/Button';
import { Dialog, DialogTitle } from '../../components/ui/Dialog';
import { useClearAll } from '../../hooks/queries';
import { useBackupDownload } from './useBackupDownload';

// "Reset demo data" (G4/D16) — clearAll({reseed:true}) behind a simple
// confirm (rendered in demo mode only). The S6 typed-name arming and the
// live "Erase live data" variant land with feat/clear-data; this interim
// dialog already honors the standing invariant: destructive confirms always
// offer a one-click backup first.
export function ResetDemoButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outlineDanger" onClick={() => setOpen(true)}>
        Reset demo data…
      </Button>
      {open && <ResetDemoDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ResetDemoDialog({ onClose }: { onClose: () => void }) {
  const clearAll = useClearAll();
  const backup = useBackupDownload();
  const [backedUp, setBackedUp] = useState(false);

  function confirm() {
    clearAll.mutate(
      { reseed: true },
      {
        onSuccess: () => {
          toast.success('Demo data reset');
          onClose();
        },
        onError: () => toast.error('Could not complete — nothing was deleted.'),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogTitle asChild>
        <h3 className="mt-0 mb-2 text-lg">Reset demo data?</h3>
      </DialogTitle>
      <p className="text-label m-0 mb-3.5 text-[13px] leading-normal">
        This replaces everything in the demo dataset with the built-in reference portfolio. Any
        changes you made in demo mode are lost.
      </p>
      <Button
        variant="outline"
        className="w-full"
        disabled={backup.pending || backedUp}
        onClick={() => {
          void backup.download().then((ok) => ok && setBackedUp(true));
        }}
      >
        {backedUp ? 'Backup downloaded ✓' : 'Download backup first'}
      </Button>
      <div className="mt-3.5 flex flex-wrap justify-end gap-2.5">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" disabled={clearAll.isPending} onClick={confirm}>
          Reset demo data
        </Button>
      </div>
    </Dialog>
  );
}
