// One backup-download path for every Settings surface that offers it: the Data-card
// button, the destructive dialogs' "Download backup first" CTA and the import's
// automatic pre-import safety backup. repo.exportAll → buildBackup → lib/download.
// Resolves true only when the file actually reached the disk, so a CTA can flip to
// its success label and the import can refuse to start when the safety backup could
// not be created.
import { toast } from 'sonner';

import { buildBackup, parseBackup } from '@quirenote/core/backup/json';
import { todayIso } from '@quirenote/core/dates';
import { useExportAll } from './queries';
import { saveTextFile } from '../lib/download';
import { dbVersion } from '../lib/repository';
import { useSettings } from '../state/settings';
import { useT } from '../i18n/useT';

export const BACKUP_MIME = 'application/json';

export interface BackupDownloadOptions {
  /** File name without the extension. Defaults to `quirenote-backup-<today>`. */
  name?: string;
  /** Skip the generic failure toast — the caller reports it in its own words. */
  quiet?: boolean;
  /**
   * `'anchor'` forces the non-cancellable path. The pre-import safety backup
   * passes it: a Save-as dialog can be cancelled and that guarantee cannot — the
   * one pinned exception to save-picker parity. *Persistence today*
   */
  via?: 'picker' | 'anchor';
}

export function useBackupDownload() {
  const t = useT();
  const exportAll = useExportAll();
  // The PREFERENCE, not the session value: a backup carries what the user chose,
  // never what they were glancing at when they pressed Export — and it restores
  // through `setDefaultCurrency`, so the two ends match.
  const { defaultCurrency: currency, usdRate, dataset } = useSettings();

  async function download(opts: BackupDownloadOptions = {}): Promise<boolean> {
    try {
      const tables = await exportAll.mutateAsync();
      const envelope = buildBackup(
        tables.assets,
        tables.snapshots,
        tables.transactions,
        { currency, usdRate },
        dataset, // the ACTIVE dataset — exportAll reads the DB bound to it
        new Date().toISOString().slice(0, 19), // timezone-less, same stamp as saveSnapshot
        dbVersion,
      );
      // NEVER WRITE WHAT YOU CANNOT READ: the export parses its own output through
      // the parser that will read it back, and checks the WHOLE envelope rather than
      // any one rule. `core/backup/json.test.ts` holds the why and the cases.
      const text = JSON.stringify(envelope, null, 2);
      const readBack = parseBackup(text);
      if (!readBack.ok) {
        if (!opts.quiet) {
          toast.error(t.settings.backup.unreadableToast(readBack.issues[0] ?? ''), {
            id: 'backup-unrestorable',
            duration: 12000,
          });
        }
        return false;
      }

      const name = `${opts.name ?? `quirenote-backup-${todayIso()}`}.json`;
      // Save-picker parity where it exists, `<a download>` where it doesn't — same
      // bytes, same name, and a cancelled picker is silent: it resolves 'cancelled',
      // so nothing was written and no CTA may claim it was.
      const outcome = await saveTextFile(name, text, {
        mime: BACKUP_MIME,
        via: opts.via,
      });
      return outcome === 'saved';
    } catch {
      if (!opts.quiet) toast.error(t.settings.backup.failedToast);
      return false;
    }
  }

  return { download, pending: exportAll.isPending };
}
