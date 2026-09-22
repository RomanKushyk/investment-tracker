import { useState } from 'react';
import { toast } from 'sonner';

import { assetFromForm, assetPatchFromForm } from '@quirenote/core/asset-builder';
import type { AssetFormValues } from '@quirenote/core/schemas';
import type { Asset } from '@quirenote/core/types';
import { useAddAsset, useUpdateAsset } from '../../hooks/queries';
import { useT } from '../../i18n/useT';

export type DialogState =
  { kind: 'create' } | { kind: 'edit'; asset: Asset } | { kind: 'delete'; asset: Asset } | null;

/**
 * The state and the writes behind the asset create / edit / delete dialogs — no
 * JSX, which is why this is a `.ts` beside the `.tsx` that renders it:
 * `react-refresh/only-export-components` refuses a `.tsx` whose only export is a
 * hook.
 *
 * Returns the STATE and the openers; `<AssetDialogs/>` renders from it.
 *
 * `assets` is PASSED IN, not read again: the calling screen already holds the
 * list, and subscribing a second observer only adds another re-render on every
 * asset invalidation for two values.
 */
export function useAssetDialogs(assets: Asset[]) {
  const t = useT();
  const addAsset = useAddAsset();
  const updateAsset = useUpdateAsset();
  const [dialog, setDialog] = useState<DialogState>(null);
  // `dialog` drives the open flags; `shown` keeps the LAST dialog's content
  // rendered while it plays its exit, because Radix only animates
  // `data-[state=closed]` on a still-mounted node. The session key gives each open
  // a fresh mount.
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
      // `asset` so the patch can carry a legacy `inzhur.units` across.
      { id: asset.id, patch: assetPatchFromForm(values, asset) },
      {
        onSuccess: () => {
          toast.success(t.assets.updatedToast);
          close();
        },
        onError: () => toast.error(t.assets.saveFailed),
      },
    );
  }

  return {
    openCreate: () => openDialog({ kind: 'create' }),
    openEdit: (asset: Asset) => openDialog({ kind: 'edit', asset }),
    openDelete: (asset: Asset) => openDialog({ kind: 'delete', asset }),
    // Read by <AssetDialogs/>, which is the only renderer of this state.
    dialog,
    shown,
    session,
    close,
    submitCreate,
    submitEdit,
    assetCount: assets.length,
    pending: addAsset.isPending || updateAsset.isPending,
  };
}

export type AssetDialogsControl = ReturnType<typeof useAssetDialogs>;
