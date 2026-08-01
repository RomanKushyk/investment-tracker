// One backup-download path for every Settings surface that offers it (the S7
// Data-card button and the destructive dialogs' "Download backup first" CTA):
// repo.exportAll → buildBackup → Blob link. Resolves true only when the file
// actually downloaded, so CTAs can flip to their success label.
import { toast } from 'sonner';

import { buildBackup } from '../../core/backup/json';
import { todayIso } from '../../core/dates';
import { useExportAll } from '../../hooks/queries';
import { dbVersion } from '../../lib/repository';
import { useSettings } from '../../state/settings';

export function useBackupDownload() {
  const exportAll = useExportAll();
  const { currency, usdRate } = useSettings();

  async function download(): Promise<boolean> {
    try {
      const tables = await exportAll.mutateAsync();
      const envelope = buildBackup(
        tables.assets,
        tables.snapshots,
        tables.transactions,
        { currency, usdRate },
        'demo', // the dataset flag lands in P2 feat/dataset-split (G4) — today everything IS the demo dataset
        new Date().toISOString().slice(0, 19), // timezone-less, same stamp as saveSnapshot
        dbVersion,
      );
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kubushka-backup-${todayIso()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return true;
    } catch {
      toast.error('Could not build the backup — please try again.');
      return false;
    }
  }

  return { download, pending: exportAll.isPending };
}
