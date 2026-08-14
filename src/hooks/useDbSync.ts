// Cross-tab freshness (P4 `feat/backup-import`, DECISIONS D24). Hosted in
// app/Layout — the one mount point that spans every route, so a tab left open
// on any screen still hears that its data was replaced elsewhere.
//
// The channel never delivers to the tab that posted (lib/sync.ts), so this
// only ever fires in the OTHER tabs: exactly one plain toast (the one
// cross-tab visible element the design allows) plus a full invalidation, which
// is what re-renders every screen from the new data. Nothing here writes.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { onDbSync } from '../lib/sync';
import { useT } from '../i18n/useT';

export function useDbSync(): void {
  const qc = useQueryClient();
  const t = useT();
  useEffect(
    () =>
      onDbSync(() => {
        void qc.invalidateQueries();
        toast(t.sync.replacedInOtherTab);
      }),
    [qc, t],
  );
}
