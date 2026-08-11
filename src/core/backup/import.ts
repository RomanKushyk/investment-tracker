// Import validation + preview diff (P4 `feat/backup-import`, DECISIONS D24).
// PURE (G1): no DOM, no File, no repository — the caller reads the file and
// hands over its text plus the tables currently in the DB.
//
// This module EXTENDS the D12 envelope contract in ./json.ts, never forks it:
// the format/version gate (`readEnvelopeHead`), the row schemas
// (`backupEnvelopeSchema`) and the referential-integrity pass
// (`integrityIssues`) are that module's, unchanged. What lands here is what
// the S3/S4 surfaces need on top: zod issues mapped onto the same structured
// `RowIssue` shape (D8 — codes + params, every sentence lives in
// screens/settings/import-labels.ts) and the per-table diff the preview shows.
//
// SAFETY-FIRST DOCTRINE (the phase's binding rule): validate fully → show a
// diff → the user confirms → ONE rw transaction. Nothing in this module
// writes, and nothing downstream may write from a parse or a preview.
//
// ROW ADDRESSING (matches the S4 reference + brief items verbatim):
//   snapshots → their `date`, transactions → their `id` (the keys the
//   integrity pass already speaks in and the keys the DB stores them under),
//   assets → their ARRAY INDEX. An asset id is the referential anchor every
//   other table's error quotes, so addressing a malformed asset ROW by index
//   keeps "this row is broken" distinguishable from "something points at this
//   id" — and the index is the only address a file with a broken id still
//   has. A row whose own key field is the invalid one always falls back to the
//   index for the same reason.
import { daysBetween } from '../dates';
import type { Asset, Snapshot, Transaction } from '../types';
import {
  BACKUP_FORMAT_VERSION,
  backupEnvelopeSchema,
  integrityIssues,
  readEnvelopeHead,
  type BackupEnvelope,
  type Dataset,
  type EnvelopeHeadCode,
  type IssueCode,
  type IssueTable,
  type RowIssue,
} from './json';

/** The three tables, as `repo.exportAll()` returns them. */
export interface PortfolioTables {
  assets: Asset[];
  snapshots: Snapshot[];
  transactions: Transaction[];
}

// --- File gate (S2) --------------------------------------------------------
// The four file-level rejections happen BEFORE anything is read: a wrong file
// is not an error worth alarming about, and none of them touches the data.

/** A Quirenote export is ~300 KB at seed scale; 25 MB is not one. */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

/**
 * Extensions the import row accepts — JSON alone, permanently. CSV import was
 * cancelled with the cloud move (D29): reading a spreadsheet back was a restore
 * path for a database living in the browser. CSV EXPORT still ships.
 */
export const IMPORT_EXTENSIONS = ['.json'] as const;

export type ImportFileKind = 'json';
export type FileRejectionCode = 'count' | 'type' | 'empty' | 'size';

export type FileClassification =
  | { ok: true; kind: ImportFileKind; name: string; size: number }
  | { ok: false; code: FileRejectionCode };

export function classifyImportFiles(
  files: { name: string; size: number }[],
): FileClassification {
  // A drag that carried no file at all (a text selection, a link) reads as the
  // same mistake as a wrong type: there is nothing importable in it.
  if (files.length !== 1) return { ok: false, code: files.length > 1 ? 'count' : 'type' };
  const [file] = files;
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!IMPORT_EXTENSIONS.includes(ext as (typeof IMPORT_EXTENSIONS)[number])) {
    return { ok: false, code: 'type' };
  }
  if (file.size === 0) return { ok: false, code: 'empty' };
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, code: 'size' };
  return { ok: true, kind: 'json', name: file.name, size: file.size };
}

// --- Validation (S3 entry / S4 report) -------------------------------------

/** The S4 report caps the visible list and states the exact total. */
export const ISSUE_LIST_CAP = 10;

export type FormatRejectionCode =
  | 'not-json'
  | 'not-a-backup'
  | 'newer-format'
  | 'unsupported-format';

/** A format-level rejection is ONE sentence + one mono detail, never a list. */
export interface FormatRejection {
  kind: 'format';
  code: FormatRejectionCode;
  /** The `formatVersion` found in the file (the two format-version codes). */
  version?: number;
  /** The D12 parser's own sentence, verbatim — the mono technical detail. */
  detail: string;
}

export interface RowsRejection {
  kind: 'rows';
  /** Capped at ISSUE_LIST_CAP — the report shows these. */
  issues: RowIssue[];
  /** Exact number found, however many are shown. */
  total: number;
}

export type ImportRejection = FormatRejection | RowsRejection;

export type ImportValidation =
  | { ok: true; envelope: BackupEnvelope }
  | { ok: false; rejection: ImportRejection };

/**
 * Full validation of a JSON backup: format marker → version → row schemas →
 * referential integrity. Nothing partial ever passes — one bad row stops the
 * whole import (that is the contract the S4 closing hint states).
 */
export function validateImport(text: string): ImportValidation {
  const head = readEnvelopeHead(text);
  if (!head.ok) {
    return { ok: false, rejection: formatRejection(head.code, head.version, head.issue) };
  }
  const parsed = backupEnvelopeSchema.safeParse(head.raw);
  if (!parsed.success) {
    return { ok: false, rejection: rowsRejection(schemaIssues(parsed.error.issues, head.raw)) };
  }
  const integrity = integrityIssues(parsed.data);
  if (integrity.length > 0) return { ok: false, rejection: rowsRejection(integrity) };
  return { ok: true, envelope: parsed.data };
}

function formatRejection(
  code: EnvelopeHeadCode,
  version: unknown,
  detail: string,
): FormatRejection {
  if (code === 'unsupported-version') {
    const found = typeof version === 'number' ? version : undefined;
    return {
      kind: 'format',
      // A file from a FUTURE app is the case the copy is written for; any
      // other unreadable version (a hand-edited 0, a string) gets its own
      // honest sentence rather than a claim about a newer app.
      code: found !== undefined && found > BACKUP_FORMAT_VERSION ? 'newer-format' : 'unsupported-format',
      ...(found !== undefined ? { version: found } : {}),
      detail,
    };
  }
  // 'not-an-object' and 'not-a-backup' are the same thing to a reader: the
  // file carries no kubushka-backup marker.
  return { kind: 'format', code: code === 'not-json' ? 'not-json' : 'not-a-backup', detail };
}

function rowsRejection(issues: RowIssue[]): RowsRejection {
  return { kind: 'rows', issues: issues.slice(0, ISSUE_LIST_CAP), total: issues.length };
}

const DATETIME_FIELDS = new Set(['createdAt', 'savedAt']);
const DATE_FIELDS = new Set(['date', 'firstPurchase', 'maturity', 'nextCoupon']);
const ROW_TABLES = new Set<IssueTable>(['assets', 'snapshots', 'transactions']);

interface ZodIssueLike {
  code: string;
  path: PropertyKey[];
  message: string;
  keys?: unknown;
}

/** zod issues → the shared structured shape, with the addressing rule above. */
function schemaIssues(issues: ZodIssueLike[], raw: Record<string, unknown>): RowIssue[] {
  return issues.map((issue) => {
    const path = issue.path.map(String);
    const [first, second, ...rest] = path;
    const table = (ROW_TABLES.has(first as IssueTable) ? first : first === 'settings' ? 'settings' : 'envelope') as IssueTable;

    if (table === 'envelope' || table === 'settings') {
      return {
        table,
        field: path.join('.') || undefined,
        code: codeFor(issue, path.at(-1)),
        ...valueOf(issue),
        detail: issue.message,
      };
    }

    const field = rest.length > 0 ? rest.join('.') : undefined;
    return {
      table,
      at: rowAddress(table, raw, second, field),
      field,
      code: codeFor(issue, path.at(-1)),
      ...valueOf(issue),
      detail: issue.message,
    };
  });
}

function codeFor(issue: ZodIssueLike, field: string | undefined): IssueCode {
  if (issue.code === 'unrecognized_keys') return 'unknown-key';
  if (field !== undefined && DATETIME_FIELDS.has(field)) return 'expected-datetime';
  if (field !== undefined && DATE_FIELDS.has(field)) return 'expected-date';
  if (field === 'amount') return 'expected-positive-amount';
  return 'invalid';
}

function valueOf(issue: ZodIssueLike): { value?: string } {
  return Array.isArray(issue.keys) && issue.keys.length > 0
    ? { value: issue.keys.map(String).join(', ') }
    : {};
}

// A row is addressed by its own primary key when the file supplies a usable
// one AND that key is not itself the invalid field; assets always fall back to
// their index (see the header rule).
function rowAddress(
  table: IssueTable,
  raw: Record<string, unknown>,
  index: string | undefined,
  field: string | undefined,
): string | undefined {
  if (index === undefined) return undefined;
  const keyField = table === 'snapshots' ? 'date' : 'id';
  if (table === 'assets' || field === keyField || field === undefined) return index;
  const rows = raw[table];
  const row = Array.isArray(rows) ? (rows[Number(index)] as Record<string, unknown> | undefined) : undefined;
  const key = row?.[keyField];
  return typeof key === 'string' && key !== '' ? key : index;
}

// --- Diff preview (S3) -----------------------------------------------------

export interface TableDiff {
  added: number;
  replaced: number;
  removed: number;
}

/**
 * Non-blocking cautions the S3 dialog lists. Tokens only — the sentences (and
 * the target dataset's name, which the component reads from the store) live in
 * screens/settings/import-labels.ts.
 */
export type DiffWarning =
  | { code: 'rows-removed'; assets: number; snapshots: number; transactions: number }
  | { code: 'no-assets' }
  | { code: 'no-snapshots'; current: number }
  | { code: 'other-dataset'; dataset: Dataset }
  | { code: 'exported-long-ago'; days: number; date: string }
  | { code: 'newer-db-version'; file: number; app: number };

export interface BackupDiff {
  assets: TableDiff;
  snapshots: TableDiff;
  transactions: TableDiff;
  /** Row counts after a confirmed import = added + replaced, per table. */
  after: { assets: number; snapshots: number; transactions: number };
  /** Does the file carry a settings block? Drives the S3 opt-in vs its line. */
  hasSettings: boolean;
  warnings: DiffWarning[];
}

/** A backup older than this is worth a word before it overwrites today. */
export const STALE_BACKUP_DAYS = 7;

/**
 * Exactly the numbers the S3 dialog shows. Matching keys: assets by id,
 * snapshots by date, transactions by id (the reference pins this) — an
 * incoming key already present is `replaced`, a new one is `added`, and a
 * current key the file lacks is `removed`, because an import REPLACES the
 * dataset rather than merging into it.
 */
export function diffBackup(
  current: PortfolioTables,
  incoming: BackupEnvelope,
  ctx: { dataset: Dataset; today: string; dbVersion: number },
): BackupDiff {
  const assets = countDiff(
    current.assets.map((a) => a.id),
    incoming.assets.map((a) => a.id),
  );
  const snapshots = countDiff(
    current.snapshots.map((s) => s.date),
    incoming.snapshots.map((s) => s.date),
  );
  const transactions = countDiff(
    current.transactions.map((t) => t.id),
    incoming.transactions.map((t) => t.id),
  );

  const warnings: DiffWarning[] = [];
  // Wholesale loss first — each of these supersedes the partial-removal line
  // for its own table (a table the file empties is stated once, not twice).
  if (incoming.assets.length === 0) warnings.push({ code: 'no-assets' });
  if (incoming.snapshots.length === 0 && current.snapshots.length > 0) {
    warnings.push({ code: 'no-snapshots', current: current.snapshots.length });
  }
  const removed = {
    assets: incoming.assets.length === 0 ? 0 : assets.removed,
    snapshots: incoming.snapshots.length === 0 ? 0 : snapshots.removed,
    transactions: transactions.removed,
  };
  if (removed.assets + removed.snapshots + removed.transactions > 0) {
    warnings.push({ code: 'rows-removed', ...removed });
  }
  if (incoming.dataset !== ctx.dataset) {
    warnings.push({ code: 'other-dataset', dataset: incoming.dataset });
  }
  const exportedOn = incoming.exportedAt.slice(0, 10);
  const age = daysBetween(exportedOn, ctx.today);
  if (age >= STALE_BACKUP_DAYS) {
    warnings.push({ code: 'exported-long-ago', days: age, date: exportedOn });
  }
  if (incoming.dbVersion > ctx.dbVersion) {
    warnings.push({ code: 'newer-db-version', file: incoming.dbVersion, app: ctx.dbVersion });
  }

  return {
    assets,
    snapshots,
    transactions,
    after: {
      assets: incoming.assets.length,
      snapshots: incoming.snapshots.length,
      transactions: incoming.transactions.length,
    },
    hasSettings: incoming.settings !== undefined,
    warnings,
  };
}

function countDiff(currentKeys: string[], incomingKeys: string[]): TableDiff {
  const before = new Set(currentKeys);
  const after = new Set(incomingKeys);
  let replaced = 0;
  for (const key of after) if (before.has(key)) replaced += 1;
  return { added: after.size - replaced, replaced, removed: before.size - replaced };
}
