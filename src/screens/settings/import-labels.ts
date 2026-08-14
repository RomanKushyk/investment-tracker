// Sentence ASSEMBLY for the import surfaces. The words themselves live in the
// dictionary (t.importing) — the pure modules return codes + params (D8), this
// file turns a code into the right dictionary call, and the dictionary turns
// that into a sentence in the chosen language.
//
// Why the assembly did not move into the dictionary wholesale: mapping a
// `RowIssue` discriminant onto a message is app logic, not copy, and it is the
// same mapping in both languages. What DOES differ per language — plural forms,
// list joiners, verb agreement — is on the dictionary side.
import type {
  DiffWarning,
  FileRejectionCode,
  FormatRejectionCode,
} from '../../core/backup/import';
import type { Dataset, RowIssue } from '../../core/backup/json';
import type { Format } from '../../core/money';
import type { Dict } from '../../i18n/messages';

export function fileRejection(code: FileRejectionCode, t: Dict): string {
  return t.importing.fileRejection[code];
}

export function formatReasonSentence(
  code: FormatRejectionCode,
  version: number | undefined,
  t: Dict,
): string {
  const m = t.importing.formatRejection;
  switch (code) {
    case 'not-json':
      return m.notJson;
    case 'not-a-backup':
      return m.notABackup;
    case 'newer-format':
      return m.newerFormat(String(version ?? '?'));
    // A hand-edited or otherwise unreadable version: the sentence above would
    // claim something about a newer app that isn't true.
    case 'unsupported-format':
      return m.unsupportedFormat;
  }
}

// Location first, then the reason — the S4 items verbatim
// (`transactions.tx-0007 — unknown asset id "a-9"`).
export function issueLine(issue: RowIssue, t: Dict): string {
  const location = [
    issue.table,
    issue.at,
    issue.code === 'duplicate-key' ? undefined : issue.field,
  ]
    .filter(Boolean)
    .join('.');
  return `${location} — ${issueReason(issue, t)}`;
}

function issueReason(issue: RowIssue, t: Dict): string {
  const m = t.importing.issue;
  const value = issue.value ?? '';
  switch (issue.code) {
    case 'unknown-asset-id':
      return m.unknownAssetId(String(value));
    case 'unknown-quote-asset':
      return m.unknownQuoteAsset(String(value));
    case 'duplicate-key':
      return issue.field === 'date'
        ? m.duplicateDate(String(value))
        : m.duplicateId(String(value));
    case 'unknown-key':
      return m.unknownKey(String(value));
    case 'expected-datetime':
      return m.expectedDatetime;
    case 'expected-date':
      return m.expectedDate;
    case 'expected-positive-amount':
      return m.expectedPositiveAmount;
    // Last resort: state the validator's own words rather than swallow a
    // reason the user needs in order to fix the file.
    case 'invalid':
      return issue.detail ?? m.invalid;
  }
}

export function problemCount(total: number, shown: number, t: Dict): string {
  return t.importing.problemCount(total, shown);
}

/** "quirenote-backup-2026-08-03.json · exported 03.08.2026 21:14 · from live" */
export function fileSubline(
  name: string,
  exportedAt: string,
  dataset: Dataset,
  f: Format,
  t: Dict,
): string {
  return t.importing.fileSubline(
    name,
    f.date(exportedAt.slice(0, 10)),
    exportedAt.slice(11, 16),
    dataset,
  );
}

/** "After import: 4 assets · 173 snapshots · 18 transactions." */
export function resultLine(
  after: { assets: number; snapshots: number; transactions: number },
  t: Dict,
): string {
  const c = t.importing.count;
  return t.importing.resultLine(
    c.assets(after.assets),
    c.snapshots(after.snapshots),
    c.transactions(after.transactions),
  );
}

export function settingsOptInHelper(
  settings: { currency: 'UAH' | 'USD'; usdRate: number },
  f: Format,
  t: Dict,
): string {
  const symbol = settings.currency === 'UAH' ? '₴ UAH' : '$ USD';
  return t.importing.settingsOptInHelper(symbol, f.units(settings.usdRate));
}

export function safetyBackupLine(
  dataset: Dataset,
  name: string,
  done: boolean,
  t: Dict,
): string {
  return done
    ? t.importing.safetyBackupDone(name)
    : t.importing.safetyBackupPending(dataset, name);
}

export function warningSentence(
  warning: DiffWarning,
  dataset: Dataset,
  f: Format,
  t: Dict,
): string {
  const w = t.importing.warning;
  switch (warning.code) {
    // The brief's sentence names snapshots and transactions; assets join it
    // when a file drops some but not all of them — the same fact, stated for
    // whichever tables actually lose rows.
    case 'rows-removed': {
      const c = t.importing.count;
      const parts = [
        warning.assets > 0 ? c.assets(warning.assets) : null,
        warning.snapshots > 0 ? c.snapshots(warning.snapshots) : null,
        warning.transactions > 0 ? c.transactions(warning.transactions) : null,
      ].filter((part): part is string => part !== null);
      return w.rowsRemoved(parts, dataset);
    }
    case 'no-assets':
      return w.noAssets;
    case 'no-snapshots':
      return w.noSnapshots(warning.current, dataset);
    case 'other-dataset':
      return w.otherDataset(warning.dataset);
    case 'exported-long-ago':
      return w.exportedLongAgo(warning.days, f.date(warning.date));
    case 'newer-db-version':
      return w.newerDbVersion(String(warning.file), String(warning.app));
  }
}

export function importToasts(t: Dict) {
  const c = t.importing.count;
  return {
    success: (after: {
      assets: number;
      snapshots: number;
      transactions: number;
    }) =>
      t.importing.toast.success(
        c.assets(after.assets),
        c.snapshots(after.snapshots),
        c.transactions(after.transactions),
      ),
    failed: t.importing.toast.failed,
    safetyFailed: t.importing.toast.safetyFailed,
  };
}
