// Import validation and preview diff. PURE: no DOM, no File, no repository, and it
// EXTENDS the envelope contract in `./json.ts` rather than forking it — the format
// gate, the row schemas and the integrity pass are that module’s, unchanged.
//
// SAFETY-FIRST DOCTRINE: validate fully → show a diff → the user confirms → ONE rw
// transaction. NOTHING here writes, and nothing downstream may write from a parse
// or a preview.
//
// ROW ADDRESSING: snapshots by `date`, transactions by `id`, assets by ARRAY
// INDEX. An asset id is the referential anchor every other table’s error quotes,
// so addressing a malformed asset ROW by index keeps "this row is broken" apart
// from "something points at this id" — and the index is the only address a file
// with a broken id still has.
import { daysBetween } from '../dates';
import type { Asset, Snapshot, Transaction } from '../types';
import {
  BACKUP_FORMAT_VERSION,
  backupEnvelopeSchema,
  blankPortfolioAssetIds,
  integrityIssues,
  readEnvelopeHead,
  type BackupEnvelope,
  type Dataset,
  type EnvelopeHeadCode,
  type IssueCode,
  type IssueTable,
  type RowIssue,
} from './json';

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

/** JSON alone, permanently: CSV import was cancelled with the cloud move, because
 *  reading a spreadsheet back was a restore path for a browser database. CSV
 *  EXPORT still ships. */
export const IMPORT_EXTENSIONS = ['.json'] as const;

export type ImportFileKind = 'json';
export type FileRejectionCode = 'count' | 'type' | 'empty' | 'size';

export type FileClassification =
  | { ok: true; kind: ImportFileKind; name: string; size: number }
  | { ok: false; code: FileRejectionCode };

export function classifyImportFiles(files: { name: string; size: number }[]): FileClassification {
  // A drag carrying no file at all — a text selection, a link — reads as the same
  // mistake as a wrong type: there is nothing importable in it.
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

/** The report caps the visible list and states the exact total. */
export const ISSUE_LIST_CAP = 10;

export type FormatRejectionCode =
  'not-json' | 'not-a-backup' | 'newer-format' | 'older-format' | 'unsupported-format';

/** A format-level rejection is ONE sentence plus one mono detail, never a list. */
export interface FormatRejection {
  kind: 'format';
  code: FormatRejectionCode;
  version?: number;
  /** The parser’s own sentence, verbatim — the mono technical detail. */
  detail: string;
}

export interface RowsRejection {
  kind: 'rows';
  issues: RowIssue[];
  total: number;
}

export type ImportRejection = FormatRejection | RowsRejection;

export type ImportValidation =
  { ok: true; envelope: BackupEnvelope } | { ok: false; rejection: ImportRejection };

/**
 * Format marker → version → row schemas → referential integrity. NOTHING PARTIAL
 * EVER PASSES: one bad row stops the whole import.
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
  // Validate as written, THEN normalize what gets stored. The blanking must not run
  // before `integrityIssues`, or a deposit naming an asset the file does not carry
  // is tidied away instead of reported.
  return { ok: true, envelope: blankPortfolioAssetIds(parsed.data) };
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
      // THREE CASES, NOT TWO: a file from a FUTURE app is what the copy was written
      // for, while one from an OLDER app is a real backup the owner may hold, and
      // "unsupported" hides which it is. INTEGER, because a version counts format
      // revisions — a bare `>= 1` named `1.5` a real older backup.
      code:
        found === undefined
          ? 'unsupported-format'
          : found > BACKUP_FORMAT_VERSION
            ? 'newer-format'
            : Number.isInteger(found) && found >= 1
              ? 'older-format'
              : 'unsupported-format',
      ...(found !== undefined ? { version: found } : {}),
      detail,
    };
  }
  // A pre-rename file is rejected on purpose: there is one user and no real data, so
  // dual-marker acceptance was flexibility nobody asked for.
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
  /** Two OPPOSITE rules land on `[i, 'quantity']` — a count on a row that takes
   *  none, and no count on a row that requires one — and they need different
   *  words. `params` discriminates them without putting English in `core/`. */
  params?: { rule?: string };
}

/** zod issues → the shared structured shape, with the addressing rule above. */
function schemaIssues(issues: ZodIssueLike[], raw: Record<string, unknown>): RowIssue[] {
  return issues.map((issue) => {
    const path = issue.path.map(String);
    const [first, second, ...rest] = path;
    const table = (
      ROW_TABLES.has(first as IssueTable) ? first : first === 'settings' ? 'settings' : 'envelope'
    ) as IssueTable;

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
  // The one-way units rule. `custom` with no message is the shape
  // `transactionRowsSchema` emits for it — this is where it gets its words.
  if (issue.code === 'custom' && (field === 'quantity' || field === 'unitPrice')) {
    return issue.params?.rule === 'missing'
      ? 'units-missing-on-position-row'
      : 'units-on-non-position-row';
  }
  // Gated on `custom` so a hand-edited value that is not a number at all falls
  // through to `invalid` with the validator’s own words, rather than being reported
  // as a rule it never reached.
  if (issue.code === 'custom' && field === 'taxWithheld') {
    return issue.params?.rule === 'bound'
      ? 'withholding-above-amount'
      : 'withholding-on-non-payout-row';
  }
  // ONE code because the note has ONE rule — a single refinement covering both ends.
  // Left to fall through it would print the VALIDATOR’s English verbatim into a
  // report the rest of which is in the reader’s language.
  if (field === 'note' && issue.code === 'custom') {
    return 'note-length';
  }
  return 'invalid';
}

function valueOf(issue: ZodIssueLike): { value?: string } {
  return Array.isArray(issue.keys) && issue.keys.length > 0
    ? { value: issue.keys.map(String).join(', ') }
    : {};
}

// A row is addressed by its own primary key when the file supplies a usable one
// AND that key is not itself the invalid field; assets always fall back to their
// index (see the header rule).
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
  const row = Array.isArray(rows)
    ? (rows[Number(index)] as Record<string, unknown> | undefined)
    : undefined;
  const key = row?.[keyField];
  return typeof key === 'string' && key !== '' ? key : index;
}

export interface TableDiff {
  added: number;
  replaced: number;
  removed: number;
}

/** Non-blocking cautions the dialog lists. Tokens only — the sentences live in
 *  `screens/settings/import-labels.ts`. */
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
  after: { assets: number; snapshots: number; transactions: number };
  hasSettings: boolean;
  warnings: DiffWarning[];
}

/** A backup older than this is worth a word before it overwrites today. */
export const STALE_BACKUP_DAYS = 7;

/** An incoming key already present is `replaced`, a new one `added`, and a current
 *  key the file lacks is `removed`: an import REPLACES the dataset. */
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
  // Wholesale loss first — each of these supersedes the partial-removal line for its
  // own table, so a table the file empties is stated once, not twice.
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
