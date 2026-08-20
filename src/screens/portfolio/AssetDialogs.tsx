import { useState } from 'react';
import { toast } from 'sonner';

import { AssetForm } from '../../components/forms/AssetForm';
import { Button } from '../../components/ui/Button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Dialog,
} from '../../components/ui/Dialog';
import type { Asset } from '../../core/types';
import { useDeleteAsset, useSnapshots, useTransactions } from '../../hooks/queries';
import { cascadeCounts } from './portfolio';
import { useBackupDownload } from '../../hooks/useBackupDownload';
import { useT } from '../../i18n/useT';
import type { AssetDialogsControl } from './useAssetDialogs';

// Destructive confirm with cascade counts + backup CTA on the D17 AlertDialog
// idiom (outside click never dismisses, Esc cancels, focus trapped) — but
// WITHOUT the typed-name arming: per the task brief that stays reserved for
// the whole-dataset erase/reset (brief S2 addendum, 2026-08-02).
function DeleteAssetDialog({
  asset,
  open,
  onClose,
}: {
  asset: Asset;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const transactions = useTransactions().data ?? [];
  const snapshots = useSnapshots().data ?? [];
  const deleteAsset = useDeleteAsset();
  const backup = useBackupDownload();
  const [backedUp, setBackedUp] = useState(false);

  // FROZEN AT OPEN, not recomputed (A31 review). `useDeleteAsset` invalidates
  // every query on success, and this node stays MOUNTED for its 220 ms exit
  // (only `open` flips) — so a live computation repainted the sentence as
  // "0 транзакцій і котирування за 0 днів" while the dialog was still fading,
  // turning the last thing the user sees into a lie about what was deleted.
  const [counts] = useState(() => cascadeCounts(asset.id, transactions, snapshots));

  function confirm() {
    deleteAsset.mutate(asset.id, {
      onSuccess: () => {
        toast.success(t.assets.deletedToast);
        onClose();
      },
      onError: () => toast.error(t.assets.deleteFailed),
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogHeader>
        <AlertDialogTitle asChild>
          <h3 className="m-0 text-lg">{t.assets.deleteTitle(asset.name)}</h3>
        </AlertDialogTitle>
      </DialogHeader>
      <DialogBody>
        <AlertDialogDescription asChild>
          <p className="text-muted m-0 mb-3.5 text-[13px] leading-normal">
            {t.assets.deleteBody(counts.transactions, counts.quoteDays)}
          </p>
        </AlertDialogDescription>
        <Button
          variant="outline"
          className="w-full"
          disabled={backup.pending || backedUp}
          onClick={() => {
            void backup.download().then((ok) => ok && setBackedUp(true));
          }}
        >
          {backedUp ? t.danger.backupDone : t.danger.backupFirst}
        </Button>
      </DialogBody>
      <DialogFooter>
        <div className="flex flex-wrap justify-end gap-2.5">
          <AlertDialogCancel asChild>
            <Button variant="ghost">{t.assets.cancel}</Button>
          </AlertDialogCancel>
          <Button variant="danger" disabled={deleteAsset.isPending} onClick={confirm}>
            {t.assets.deleteAction}
          </Button>
        </div>
      </DialogFooter>
    </AlertDialog>
  );
}

/**
 * The three asset dialogs, rendered ONCE by whoever owns the control (A31).
 *
 * They are portalled, so where this sits in the tree does not matter — but
 * keeping it out of a table row is what stops four rows mounting four copies.
 */
export function AssetDialogs({ ctl }: { ctl: AssetDialogsControl }) {
  const { dialog, shown, session, close } = ctl;
  return (
    <>
      {(shown?.kind === 'create' || shown?.kind === 'edit') && (
        <Dialog
          open={dialog?.kind === 'create' || dialog?.kind === 'edit'}
          onOpenChange={(open) => !open && close()}
          width={520}
        >
          <AssetForm
            key={session}
            mode={shown.kind}
            asset={shown.kind === 'edit' ? shown.asset : undefined}
            existingAssetCount={ctl.assetCount}
            pending={ctl.pending}
            onCancel={close}
            onSubmit={(values) =>
              shown.kind === 'edit' ? ctl.submitEdit(shown.asset, values) : ctl.submitCreate(values)
            }
          />
        </Dialog>
      )}

      {shown?.kind === 'delete' && (
        <DeleteAssetDialog
          key={session}
          asset={shown.asset}
          open={dialog?.kind === 'delete'}
          onClose={close}
        />
      )}
    </>
  );
}
