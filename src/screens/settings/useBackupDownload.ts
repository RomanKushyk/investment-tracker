// One backup-download path for every Settings surface that offers it (the S7
// Data-card button, the destructive dialogs' "Download backup first" CTA and
// the S3 import's automatic pre-import safety backup):
// repo.exportAll → buildBackup → lib/download. Resolves true only when the file
// actually reached the disk, so CTAs can flip to their success label — and so
// the import can refuse to start when the safety backup could not be created.
import { toast } from 'sonner';

import { buildBackup } from '../../core/backup/json';
import { todayIso } from '../../core/dates';
import { useExportAll } from '../../hooks/queries';
import { saveTextFile } from '../../lib/download';
import { dbVersion } from '../../lib/repository';
import { useSettings } from '../../state/settings';

export const BACKUP_MIME = 'application/json';

export interface BackupDownloadOptions {
  /** File name without the extension. Defaults to `quirenote-backup-<today>`. */
  name?: string;
  /** Skip the generic failure toast — the caller reports it in its own words. */
  quiet?: boolean;
  /**
   * `'anchor'` forces the non-cancellable path. The pre-import safety backup
   * passes it: a Save-as dialog can be cancelled and that guarantee cannot
   * (D24, S5's one pinned exception to save-picker parity).
   */
  via?: 'picker' | 'anchor';
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
      const name = `${opts.name ?? `quirenote-backup-${todayIso()}`}.json`;
      // Save-picker parity where it exists, `<a download>` where it doesn't —
      // same bytes, same name, and a cancelled picker is silent (S5): it
      // resolves 'cancelled', so nothing was written and no CTA may claim it
      // was.
      const outcome = await saveTextFile(name, JSON.stringify(envelope, null, 2), {
        mime: BACKUP_MIME,
        via: opts.via,
      });
      return outcome === 'saved';
    } catch {
      if (!opts.quiet) toast.error('Could not build the backup — please try again.');
      return false;
    }
  }

  return { download, pending: exportAll.isPending };
}
