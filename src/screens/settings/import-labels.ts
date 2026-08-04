// English copy for the import surfaces (S2 file rejections, S3 preview + diff
// warnings, S4 problem list). The pure modules return codes + params (D8);
// every sentence below is the brief's verbatim copy, and this file is what
// Phase 5's i18n sweep translates.
import type {
  DiffWarning,
  FileRejectionCode,
  FormatRejectionCode,
} from '../../core/backup/import';
import type { Dataset, RowIssue } from '../../core/backup/json';
import { fmtDate } from '../../core/money';

// --- S2: file-level rejections (warn, never neg) ---------------------------
export const FILE_REJECTION: Record<FileRejectionCode, string> = {
  type: "That file type isn't supported — pick a .json backup or a .csv table.",
  size: "That file is larger than 25 MB — it doesn't look like a Kubushka export.",
  count: 'Drop one file at a time.',
  empty: 'That file is empty.',
};

// --- S2: the row itself ----------------------------------------------------
export const IMPORT_ROW = {
  title: 'Import',
  helper:
    'Restore a JSON backup, or load a CSV of snapshots. Import replaces everything in the active dataset — you review a summary first, and a safety backup downloads automatically.',
  dropLine: 'Drop a .json or .csv file here',
  dropHint: 'or use Choose file…',
  dragLine: 'Release to read the file',
  choose: 'Choose file…',
  demoNote:
    'You\'re in the demo dataset — importing here replaces the reference portfolio. "Reset demo data…" brings it back.',
  reading: (name: string) => `Reading ${name}…`,
} as const;

// --- S4: format-level rejections (one sentence + one mono detail) ----------
export function formatReasonSentence(code: FormatRejectionCode, version?: number): string {
  switch (code) {
    case 'not-json':
      return "That file isn't valid JSON.";
    case 'not-a-backup':
      return 'This isn\'t a Kubushka backup — it has no "kubushka-backup" marker.';
    case 'newer-format':
      return `This backup was written by a newer version of the app (format ${version ?? '?'}). Update the app, or export again from the version that wrote it.`;
    // A hand-edited or otherwise unreadable version: the sentence above would
    // claim something about a newer app that isn't true.
    case 'unsupported-format':
      return "This backup's format version isn't one this app can read.";
  }
}

// --- S4: the row-addressed problem list -----------------------------------
// Location first, then the reason — the S4 items verbatim
// (`transactions.tx-0007 — unknown asset id "a-9"`).
export function issueLine(issue: RowIssue): string {
  const location = [issue.table, issue.at, issue.code === 'duplicate-key' ? undefined : issue.field]
    .filter(Boolean)
    .join('.');
  return `${location} — ${issueReason(issue)}`;
}

function issueReason(issue: RowIssue): string {
  switch (issue.code) {
    case 'unknown-asset-id':
      return `unknown asset id "${issue.value ?? ''}"`;
    case 'unknown-quote-asset':
      return `quote for an unknown asset "${issue.value ?? ''}"`;
    case 'duplicate-key':
      return issue.field === 'date'
        ? `duplicate date ${issue.value ?? ''} (date is the primary key)`
        : `duplicate id "${issue.value ?? ''}" (id is the primary key)`;
    case 'unknown-key':
      return `unexpected field "${issue.value ?? ''}"`;
    case 'expected-datetime':
      return 'expected timezone-less yyyy-MM-ddTHH:mm:ss';
    case 'expected-date':
      return 'expected a yyyy-MM-dd date';
    case 'expected-positive-amount':
      return 'expected a positive number';
    // Last resort: state the validator's own words rather than swallow a
    // reason the user needs in order to fix the file.
    case 'invalid':
      return issue.detail ?? 'invalid value';
  }
}

export function problemCount(total: number, shown: number): string {
  const found = total === 1 ? '1 problem found' : `${total} problems found`;
  return shown < total ? `${found} — showing the first ${shown}` : found;
}

export const REPORT = {
  title: "This file can't be imported",
  lead: 'Nothing was changed. Fix the file and try again.',
  hint: 'Rows are checked before anything is written — one bad row stops the whole import.',
  close: 'Close',
  another: 'Choose another file…',
} as const;

// --- S3: the preview dialog ------------------------------------------------
export const PREVIEW = {
  title: (dataset: Dataset) => `Import into ${dataset}`,
  banner: (dataset: Dataset) =>
    `Replaces everything in the ${dataset} dataset. Every asset, snapshot and transaction is deleted and rebuilt from this file. This cannot be undone.`,
  bannerDemoSuffix: ' "Reset demo data…" restores the reference portfolio afterwards.',
  diffLabel: 'What changes',
  columns: { table: 'Table', added: 'Added', replaced: 'Replaced', removed: 'Removed' },
  rows: { assets: 'Assets', snapshots: 'Snapshots', transactions: 'Transactions' },
  warningsLabel: 'Check before you continue',
  settingsOptIn: 'Also apply the settings saved in this file',
  noSettings: 'This file carries no settings.',
  cancel: 'Cancel',
  confirm: 'Replace all data',
  pending: 'Replacing…',
  waiting: 'Waiting for another tab…',
} as const;

/** "kubushka-backup-2026-08-03.json · exported 03.08.2026 21:14 · from live" */
export function fileSubline(name: string, exportedAt: string, dataset: Dataset): string {
  return `${name} · exported ${fmtDate(exportedAt.slice(0, 10))} ${exportedAt.slice(11, 16)} · from ${dataset}`;
}

/** "After import: 4 assets · 173 snapshots · 18 transactions." */
export function resultLine(after: {
  assets: number;
  snapshots: number;
  transactions: number;
}): string {
  return `After import: ${plural(after.assets, 'asset')} · ${plural(after.snapshots, 'snapshot')} · ${plural(after.transactions, 'transaction')}.`;
}

export function settingsOptInHelper(settings: {
  currency: 'UAH' | 'USD';
  usdRate: number;
}): string {
  const symbol = settings.currency === 'UAH' ? '₴ UAH' : '$ USD';
  return `Replaces your currency and ₴/$ rate (${symbol} · ${settings.usdRate}). Dataset, automation and reminder preferences are never touched.`;
}

export function safetyBackupLine(dataset: Dataset, name: string, done: boolean): string {
  return done
    ? `Safety backup downloaded — ${name}.json.`
    : `A backup of your current ${dataset} data downloads automatically before anything is replaced — ${name}.json.`;
}

export function warningSentence(warning: DiffWarning, dataset: Dataset): string {
  switch (warning.code) {
    // The brief's sentence names snapshots and transactions; assets join it
    // when a file drops some but not all of them — the same fact, stated for
    // whichever tables actually lose rows.
    case 'rows-removed': {
      const parts = [
        warning.assets > 0 ? plural(warning.assets, 'asset') : null,
        warning.snapshots > 0 ? plural(warning.snapshots, 'snapshot') : null,
        warning.transactions > 0 ? plural(warning.transactions, 'transaction') : null,
      ].filter((p): p is string => p !== null);
      const single = parts.length === 1 && parts[0].startsWith('1 ');
      const subject =
        parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
      return single
        ? `${subject} in ${dataset} is missing from this file — it will be removed.`
        : `${subject} in ${dataset} are missing from this file — they will be removed.`;
    }
    case 'no-assets':
      return 'This file has no assets — the dataset will be empty after import.';
    case 'no-snapshots':
      return `This file has no snapshots — all ${warning.current} saved days in ${dataset} would be removed.`;
    case 'other-dataset':
      return `This file was exported from the ${warning.dataset} dataset.`;
    case 'exported-long-ago':
      return `Exported ${warning.days} days ago (${fmtDate(warning.date)}).`;
    case 'newer-db-version':
      return `The file comes from a newer database version (${warning.file} vs ${warning.app}) — fields this app doesn't know are ignored.`;
  }
}

export const IMPORT_TOASTS = {
  success: (after: { assets: number; snapshots: number; transactions: number }) =>
    `Data imported — ${plural(after.assets, 'asset')}, ${plural(after.snapshots, 'snapshot')}, ${plural(after.transactions, 'transaction')}.`,
  failed: 'Could not import — nothing was changed.',
  safetyFailed: 'Could not create the safety backup — nothing was imported.',
} as const;

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
