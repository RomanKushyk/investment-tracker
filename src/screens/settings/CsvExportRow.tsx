// One file per table. Export only — CSV import was cancelled, so the JSON backup
// is the sole restore path and this row exists purely to hand the user their own
// numbers in a spreadsheet's language.
// Only the PRESSED button disables while its file is built. No success toast:
// the browser's own download indication is the feedback, and a cancelled Save-as
// dialog is not an error.
import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../components/ui/Button';
import {
  serializeAssetsCsv,
  serializeSnapshotsCsv,
  serializeTransactionsCsv,
} from '../../core/backup/csv';
import { todayIso } from '../../core/dates';
import { useExportAll } from '../../hooks/queries';
import { saveTextFile } from '../../lib/download';
import type { AllTables } from '../../lib/repository';
import { useT } from '../../i18n/useT';

const CSV_MIME = 'text/csv';

/** Pinned order, pinned file names. */
const TABLES = [
  {
    key: 'assets',
    labelKey: 'assets' as const,
    build: (t: AllTables) => serializeAssetsCsv(t.assets),
  },
  {
    key: 'snapshots',
    labelKey: 'snapshots' as const,
    build: (t: AllTables) => serializeSnapshotsCsv(t.snapshots, t.assets),
  },
  {
    key: 'transactions',
    labelKey: 'transactions' as const,
    build: (t: AllTables) => serializeTransactionsCsv(t.transactions),
  },
] as const;

export function CsvExportRow() {
  const t = useT();
  const exportAll = useExportAll();
  const [building, setBuilding] = useState<string | null>(null);

  async function run(table: (typeof TABLES)[number]) {
    setBuilding(table.key);
    try {
      // Read fresh at click time — an export must reflect the DB now, exactly like the
      // JSON backup.
      const tables = await exportAll.mutateAsync();
      await saveTextFile(`quirenote-${table.key}-${todayIso()}.csv`, table.build(tables), {
        mime: CSV_MIME,
      });
    } catch {
      toast.error(t.csv.failed);
    } finally {
      setBuilding(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-[min(200px,100%)] flex-[1_1_260px]">
          <div className="text-[13px] font-semibold">{t.csv.title}</div>
          <div className="mt-[3px] text-xs leading-normal text-muted">{t.csv.helper}</div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 max-[420px]:w-full max-[420px]:flex-col">
          {TABLES.map((table) => (
            <Button
              key={table.key}
              variant="outline"
              size="header"
              disabled={building === table.key}
              onClick={() => void run(table)}
            >
              <Download size={13} strokeWidth={2.75} />
              {t.csv[table.labelKey]}
            </Button>
          ))}
        </div>
      </div>
      <div className="mt-2.5 text-[11px] leading-relaxed text-muted">{t.csv.formatNote}</div>
      <div className="mt-0.5 text-[11px] leading-relaxed text-muted">{t.csv.columnNote}</div>
    </div>
  );
}
