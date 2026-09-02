// One backup-download path for every Settings surface that offers it (the S7
// Data-card button, the destructive dialogs' "Download backup first" CTA and
// the S3 import's automatic pre-import safety backup):
// repo.exportAll → buildBackup → lib/download. Resolves true only when the file
// actually reached the disk, so CTAs can flip to their success label — and so
// the import can refuse to start when the safety backup could not be created.
import { toast } from 'sonner';

import { buildBackup, parseBackup } from '../core/backup/json';
import { todayIso } from '../core/dates';
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
   * passes it: a Save-as dialog can be cancelled and that guarantee cannot
   * (D24, S5's one pinned exception to save-picker parity).
   */
  via?: 'picker' | 'anchor';
}

export function useBackupDownload() {
  const t = useT();
  const exportAll = useExportAll();
  // The PREFERENCE, not the session value (A21): a backup carries what the
  // user chose, never what they were glancing at when they pressed Export —
  // and it restores through `setDefaultCurrency`, so the two ends match.
  const { defaultCurrency: currency, usdRate, dataset } = useSettings();

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
      // THE EXPORT READS ITS OWN OUTPUT BEFORE OFFERING IT, through the very
      // parser that will read it back. A backup nobody can restore is worse than
      // no backup, because the owner finds out at the one moment they needed it.
      //
      // NO SPECIAL CASE FOR A MISSING UNIT COUNT, and D128 says why: there is no
      // way to reach one. Every door that can put a position-moving row into the
      // store now requires the count — the form (D124), the coupon card, the
      // importer (D125/D127) — and the seed carries seven of its own. A row
      // without one exists only in a database seeded before this branch, which
      // for a project with no live users is disposable local state, cleared and
      // re-seeded rather than migrated. An earlier cut carried a counting branch
      // and a message for it: error handling for a state nothing can produce.
      //
      // THE GUARD ITSELF STAYS, and checks the WHOLE envelope rather than any
      // one rule. The invariant is "never write what you cannot read" — it is
      // what turned a silent unrestorable file into a refusal at the moment of
      // writing, and it outlives whichever rule breaks it next. If it ever fires
      // it reports the parser's own first issue, which is the honest answer when
      // by construction it should not have fired at all.
      //
      // `opts.quiet` is honoured exactly as it is in the `catch` below — the
      // pre-import safety backup reports its own failure in its own words, and
      // two sentences about one refusal is what that flag exists to prevent.
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
      // Save-picker parity where it exists, `<a download>` where it doesn't —
      // same bytes, same name, and a cancelled picker is silent (S5): it
      // resolves 'cancelled', so nothing was written and no CTA may claim it
      // was.
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
