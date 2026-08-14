import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { AssetForm } from '../../components/forms/AssetForm';
import { Button } from '../../components/ui/Button';
import { ColorDot } from '../../components/ui/ColorDot';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
  Dialog,
} from '../../components/ui/Dialog';
import { assetFromForm, assetPatchFromForm } from '../../core/asset-builder';
import type { AssetFormValues } from '../../core/schemas';
import type { Asset } from '../../core/types';
import {
  useAddAsset,
  useAssets,
  useDeleteAsset,
  useSnapshots,
  useTransactions,
  useUpdateAsset,
} from '../../hooks/queries';
import { cascadeCounts } from './settings';
import { useBackupDownload } from './useBackupDownload';
import { useT } from '../../i18n/useT';

type DialogState =
  | { kind: 'create' }
  | { kind: 'edit'; asset: Asset }
  | { kind: 'delete'; asset: Asset }
  | null;

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

  const counts = cascadeCounts(asset.id, transactions, snapshots);
  const txNoun = counts.transactions === 1 ? 'transaction' : 'transactions';
  const dayNoun = counts.quoteDays === 1 ? 'day' : 'days';

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
      <AlertDialogTitle asChild>
        <h3 className="mt-0 mb-2 text-lg">{t.assets.deleteTitle(asset.name)}</h3>
      </AlertDialogTitle>
      <AlertDialogDescription asChild>
        <p className="text-label m-0 mb-3.5 text-[13px] leading-normal">
          This removes the asset and everything recorded for it — {counts.transactions} {txNoun}{' '}
          and quotes on {counts.quoteDays} {dayNoun}. This cannot be undone.
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
      <div className="mt-3.5 flex flex-wrap justify-end gap-2.5">
        <AlertDialogCancel asChild>
          <Button variant="ghost">{t.assets.cancel}</Button>
        </AlertDialogCancel>
        <Button variant="danger" disabled={deleteAsset.isPending} onClick={confirm}>
          {t.assets.deleteAction}
        </Button>
      </div>
    </AlertDialog>
  );
}

// Settings→Portfolio asset manager (S2): every existing asset as a row
// (dot · name · short yield label · Edit/Delete), footer "+ Add asset" —
// both open the standalone AssetForm in a dialog (S3).
export function AssetManager() {
  const t = useT();
  const assets = useAssets().data ?? [];
  const addAsset = useAddAsset();
  const updateAsset = useUpdateAsset();
  const [dialog, setDialog] = useState<DialogState>(null);
  // `dialog` drives the open flags; `shown` keeps the LAST dialog's content
  // rendered while it plays its 220ms symmetric exit (D7 — Radix only
  // animates data-[state=closed] on a still-mounted node). Sanctioned
  // adjust-state-on-render; the session key gives each open a fresh mount
  // (form defaults / backup state reset).
  const [shown, setShown] = useState<Exclude<DialogState, null> | null>(null);
  if (dialog !== null && dialog !== shown) setShown(dialog);
  const [session, setSession] = useState(0);

  const openDialog = (d: Exclude<DialogState, null>) => {
    setSession((s) => s + 1);
    setDialog(d);
  };
  const close = () => setDialog(null);

  function submitCreate(values: AssetFormValues) {
    addAsset.mutate(assetFromForm(values, values.firstPurchase, assets.length), {
      onSuccess: () => {
        toast.success(t.assets.addedToast);
        close();
      },
      onError: () => toast.error(t.assets.saveFailed),
    });
  }

  function submitEdit(asset: Asset, values: AssetFormValues) {
    updateAsset.mutate(
      { id: asset.id, patch: assetPatchFromForm(values) },
      {
        onSuccess: () => {
          toast.success(t.assets.updatedToast);
          close();
        },
        onError: () => toast.error(t.assets.saveFailed),
      },
    );
  }

  return (
    <div>
      {assets.length === 0 ? (
        <div className="text-muted text-[13px] leading-normal">
          {t.assets.empty}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {assets.map((a) => (
            <div
              key={a.id}
              // flex-wrap + the name's 120px basis: one line on desktop, and
              // at the 136px-rail widths the label/buttons wrap below the
              // name instead of overflowing the card (S2 wrap rule, 360px).
              className="hover:bg-page/60 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-xl px-3 py-2 transition"
            >
              <ColorDot colorKey={a.colorKey} />
              <span className="min-w-0 flex-[1_1_120px] truncate text-[13.5px] font-semibold">
                {a.name}
              </span>
              <span className="text-muted text-xs whitespace-nowrap">
                {t.asset.yieldShort[a.yieldType]}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openDialog({ kind: 'edit', asset: a })}
              >
                {t.assets.edit}
              </Button>
              <Button
                variant="outlineDanger"
                size="sm"
                onClick={() => openDialog({ kind: 'delete', asset: a })}
              >
                {t.assets.delete}
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3">
        <Button variant="outline" onClick={() => openDialog({ kind: 'create' })}>
          <Plus size={13} strokeWidth={2.75} />
          {t.assets.add}
        </Button>
      </div>

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
            existingAssetCount={assets.length}
            pending={addAsset.isPending || updateAsset.isPending}
            onCancel={close}
            onSubmit={(values) =>
              shown.kind === 'edit' ? submitEdit(shown.asset, values) : submitCreate(values)
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
    </div>
  );
}
