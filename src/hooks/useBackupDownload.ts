// One backup-download path for every Settings surface that offers it: the Data-card
// button, the destructive dialogs' "Download backup first" CTA and the import's
// automatic pre-import safety backup. GET /state → buildBackup → lib/download.
// Resolves true only when the file actually reached the disk, so a CTA can flip to
// its success label and the import can refuse to start when the safety backup could
// not be created.
import { toast } from 'sonner';

import { buildBackup, parseBackup } from '@quirenote/core/backup/json';
import { todayIso } from '@quirenote/core/dates';
import { useExportState } from './queries';
import type { ExportedState } from '../lib/backup';
import { saveTextFile } from '../lib/download';
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
  /** The export to write, where the caller has just read one it goes on to act on. */
  state?: ExportedState;
}

export function useBackupDownload() {
  const t = useT();
  const exportState = useExportState();
  // The PREFERENCE, not the session value: a backup carries what the user chose,
  // never what they were glancing at when they pressed Export — and it restores
  // through `setDefaultCurrency`, so the two ends match.
  const { defaultCurrency: currency, usdRate } = useSettings();

  async function download(opts: BackupDownloadOptions = {}): Promise<boolean> {
    try {
      const tables = opts.state ?? (await exportState.mutateAsync());
      const envelope = buildBackup(
        tables.assets,
        // The API stores per-unit prices, and the file carries them as they are (*Persistence today*).
        tables.prices,
        tables.transactions,
        { currency, usdRate },
        new Date().toISOString().slice(0, 19), // timezone-less, as the file's own stamps are
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

  return { download, pending: exportState.isPending };
}
