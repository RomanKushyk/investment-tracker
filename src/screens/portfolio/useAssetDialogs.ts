import { useState } from 'react';
import { toast } from 'sonner';

import { assetFromForm, assetPatchFromForm } from '../../core/asset-builder';
import type { AssetFormValues } from '../../core/schemas';
import type { Asset } from '../../core/types';
import { useAddAsset, useUpdateAsset } from '../../hooks/queries';
import { useT } from '../../i18n/useT';

export type DialogState =
  | { kind: 'create' }
  | { kind: 'edit'; asset: Asset }
  | { kind: 'delete'; asset: Asset }
  | null;

/**
 * The state and the writes behind the asset create / edit / delete dialogs
 * (A31) — no JSX, which is why this is a `.ts` beside the `.tsx` that renders
 * it. `react-refresh/only-export-components` refuses a `.tsx` whose only export
 * is a hook, and the split it forces is the one this project makes everywhere
 * else anyway: logic in a module, rendering in a component.
 *
 * This was `screens/settings/AssetManager.tsx`, which owned both the dialogs
 * and the rows that opened them. A31 moved asset management onto `/portfolio`,
 * where the rows already exist — as a table at and above `md` and as record
 * cards below it — so the rows stay with the screen that draws them and only
 * the dialog machinery moves. `AssetForm` and the D17 delete confirm are reused
 * with no contract change.
 *
 * Returns the STATE and the openers; `<AssetDialogs/>` renders from it. The
 * first draft's doc promised a `dialogs` node, which this has never had —
 * corrected in the A31 review before a second caller destructured it and got
 * `undefined`.
 *
 * `assets` is PASSED IN, not read again (A31 review). The calling screen already
 * holds the list; subscribing a second observer only added another re-render on
 * every asset invalidation, for two values — the hue index a new asset takes and
 * the count the form shows.
 */
export function useAssetDialogs(assets: Asset[]) {
  const t = useT();
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
