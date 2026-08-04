// One backup-download path for every Settings surface that offers it (the S7
// Data-card button, the destructive dialogs' "Download backup first" CTA and
// the S3 import's automatic pre-import safety backup):
// repo.exportAll → buildBackup → Blob link. Resolves true only when the file
// actually downloaded, so CTAs can flip to their success label — and so the
// import can refuse to start when the safety backup could not be created.
import { toast } from 'sonner';

import { buildBackup } from '../../core/backup/json';
import { todayIso } from '../../core/dates';
import { useExportAll } from '../../hooks/queries';
import { dbVersion } from '../../lib/repository';
import { useSettings } from '../../state/settings';

export interface BackupDownloadOptions {
  /** File name without the extension. Defaults to `kubushka-backup-<today>`. */
  name?: string;
  /** Skip the generic failure toast — the caller reports it in its own words. */
  quiet?: boolean;
}

export function useBackupDownload() {
  const exportAll = useExportAll();
  const { currency, usdRate, dataset } = useSettings();

  async function download(opts: BackupDownloadOptions = {}): Promise<boolean> {
    try {
      const tables = await exportAll.mutateAsync();
      const envelope = buildBackup(
        tables.assets,
        tables.snapshots,
        tables.transactions,
        { currency, usdRate },
        dataset, // the ACTIVE dataset — exportAll reads the DB bound to it (G4)
        new Date().toISOString().slice(0, 19), // timezone-less, same stamp as saveSnapshot
        dbVersion,
      );
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Always <a download>, never showSaveFilePicker: a Save-as dialog is
      // cancellable, and the pre-import safety backup is a guarantee (S5's one
      // pinned exception to save-picker parity).
      a.download = `${opts.name ?? `kubushka-backup-${todayIso()}`}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return true;
    } catch {
      if (!opts.quiet) toast.error('Could not build the backup — please try again.');
      return false;
    }
  }

  return { download, pending: exportAll.isPending };
}
