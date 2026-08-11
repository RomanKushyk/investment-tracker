// S5 — Settings → Data "Spreadsheet export (CSV)": one file per table
// (design/extensions/data-portability.dc.html S5). Export only — CSV import was
// cancelled (D29), so the JSON backup is the sole restore path and this row
// exists purely to hand the user their own numbers in a spreadsheet's language.
//
// Pill geometry per the reference note: the existing `header` size variant
// (padding 8/18, 13px) — the brief's "outline `sm`, 13px" names two different
// existing things and the 13px type scale wins, so no size variant is minted.
// Only the PRESSED button disables while its file is built; the other two stay
// live. No success toast — the browser's own download indication is the
// feedback (same as "Download backup", D12) — and a cancelled Save-as dialog is
// not an error (S5 parity, handled in lib/download).
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

const CSV_MIME = 'text/csv';

const CSV_ROW = {
  title: 'Spreadsheet export (CSV)',
  helper:
    'One file per table, ready for a spreadsheet. Snapshots export wide — one row per date, one column per asset; an empty cell means no quote was saved that day, never zero.',
  formatNote:
    "Machine format: dot decimals, comma separators, UTF-8, CRLF. The app's own 68 702,10 display formatting never goes into a file.",
  columnNote:
    'Snapshot columns are named "Asset name (id)" — the id in brackets names the asset unambiguously when two funds share a name.',
  failed: 'Could not build the CSV — please try again.',
} as const;

/** Pinned order, pinned file names (`kubushka-<table>-<date>.csv`). */
const TABLES = [
  { key: 'assets', label: 'Assets', build: (t: AllTables) => serializeAssetsCsv(t.assets) },
  {
    key: 'snapshots',
    label: 'Snapshots',
    build: (t: AllTables) => serializeSnapshotsCsv(t.snapshots, t.assets),
  },
  {
    key: 'transactions',
    label: 'Transactions',
    build: (t: AllTables) => serializeTransactionsCsv(t.transactions),
  },
] as const;

export function CsvExportRow() {
  const exportAll = useExportAll();
  const [building, setBuilding] = useState<string | null>(null);

  async function run(table: (typeof TABLES)[number]) {
    setBuilding(table.key);
    try {
      // Read fresh at click time (a mutation, not a cached query) — an export
      // must reflect the DB now, exactly like the JSON backup.
      const tables = await exportAll.mutateAsync();
      await saveTextFile(`kubushka-${table.key}-${todayIso()}.csv`, table.build(tables), {
        mime: CSV_MIME,
      });
    } catch {
      toast.error(CSV_ROW.failed);
    } finally {
      setBuilding(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-[min(200px,100%)] flex-[1_1_260px]">
          <div className="text-[13px] font-semibold">{CSV_ROW.title}</div>
          <div className="text-muted mt-[3px] text-xs leading-normal">{CSV_ROW.helper}</div>
        </div>
        {/* Wraps to its own line under the label block when the row narrows,
            and stacks full width at 360px. */}
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
              {table.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="text-muted mt-2.5 text-[11px] leading-relaxed">{CSV_ROW.formatNote}</div>
      <div className="text-muted mt-0.5 text-[11px] leading-relaxed">{CSV_ROW.columnNote}</div>
    </div>
  );
}
