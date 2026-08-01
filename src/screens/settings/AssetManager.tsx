import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { AssetForm } from '../../components/forms/AssetForm';
import { Button } from '../../components/ui/Button';
import { ColorDot } from '../../components/ui/ColorDot';
import { Dialog, DialogTitle } from '../../components/ui/Dialog';
import { YIELD_LABEL_SHORT } from '../../components/ui/yield-labels';
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

type DialogState =
  | { kind: 'create' }
  | { kind: 'edit'; asset: Asset }
  | { kind: 'delete'; asset: Asset }
  | null;

// Simple confirm with cascade counts + backup CTA — the S6 dialog idiom
// without the typed-name arming (per the task brief: typed confirm is
// reserved for the whole-dataset erase/reset).
function DeleteAssetDialog({
  asset,
  onClose,
}: {
  asset: Asset;
  onClose: () => void;
}) {
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
        toast.success('Asset deleted');
        onClose();
      },
      onError: () => toast.error('Could not complete — nothing was deleted.'),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogTitle asChild>
        <h3 className="mt-0 mb-2 text-lg">Delete {asset.name}?</h3>
      </DialogTitle>
      <p className="text-label m-0 mb-3.5 text-[13px] leading-normal">
        This removes the asset and everything recorded for it — {counts.transactions} {txNoun} and
        quotes on {counts.quoteDays} {dayNoun}. This cannot be undone.
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
        <Button variant="danger" disabled={deleteAsset.isPending} onClick={confirm}>
          Delete asset
        </Button>
      </div>
    </Dialog>
  );
}

// Settings→Portfolio asset manager (S2): every existing asset as a row
// (dot · name · short yield label · Edit/Delete), footer "+ Add asset" —
// both open the standalone AssetForm in a dialog (S3).
export function AssetManager() {
  const assets = useAssets().data ?? [];
  const addAsset = useAddAsset();
  const updateAsset = useUpdateAsset();
  const [dialog, setDialog] = useState<DialogState>(null);

  const close = () => setDialog(null);

  function submitCreate(values: AssetFormValues) {
    addAsset.mutate(assetFromForm(values, values.firstPurchase, assets.length), {
      onSuccess: () => {
        toast.success('Asset added');
        close();
      },
      onError: () => toast.error('Could not save the asset — please try again.'),
    });
  }

  function submitEdit(asset: Asset, values: AssetFormValues) {
    updateAsset.mutate(
      { id: asset.id, patch: assetPatchFromForm(values) },
      {
        onSuccess: () => {
          toast.success('Asset updated');
          close();
        },
        onError: () => toast.error('Could not save the asset — please try again.'),
      },
    );
  }

  return (
    <div>
      {assets.length === 0 ? (
        <div className="text-muted text-[13px] leading-normal">
          No assets yet — add your first asset to start tracking.
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
                {YIELD_LABEL_SHORT[a.yieldType]}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDialog({ kind: 'edit', asset: a })}
              >
                Edit
              </Button>
              <Button
                variant="outlineDanger"
                size="sm"
                onClick={() => setDialog({ kind: 'delete', asset: a })}
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3">
        <Button variant="outline" onClick={() => setDialog({ kind: 'create' })}>
          <Plus size={13} strokeWidth={2.75} />
          Add asset
        </Button>
      </div>

      {(dialog?.kind === 'create' || dialog?.kind === 'edit') && (
        <Dialog open onOpenChange={(open) => !open && close()} width={520}>
          <AssetForm
            key={dialog.kind === 'edit' ? dialog.asset.id : 'create'}
            mode={dialog.kind}
            asset={dialog.kind === 'edit' ? dialog.asset : undefined}
            existingAssetCount={assets.length}
            pending={addAsset.isPending || updateAsset.isPending}
            onCancel={close}
            onSubmit={(values) =>
              dialog.kind === 'edit' ? submitEdit(dialog.asset, values) : submitCreate(values)
            }
          />
        </Dialog>
      )}

      {dialog?.kind === 'delete' && <DeleteAssetDialog asset={dialog.asset} onClose={close} />}
    </div>
  );
}
