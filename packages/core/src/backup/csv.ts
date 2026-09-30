// Per-table CSV EXPORT ONLY, and PURE: no File, no Blob, no DOM. The lossless
// restore path is, and stays, the JSON envelope — this hands you your own numbers
// in a form a spreadsheet opens.
//
// THE DIALECT, a pinned contract: comma separators · dot decimals · NO thousands
// grouping · UTF-8 with BOM · CRLF line endings including after the last record ·
// RFC 4180 quoting, inner quotes doubled. Money carries at least 2 decimals and
// never fewer digits than the value needs, so the file states the stored number
// exactly; counts and percentages are written as they are, because padding a unit
// count to 2 dp would invent precision the domain does not have.
//
// **AN EMPTY CELL MEANS PENDING, NEVER 0** — a day that recorded no quote writes
// nothing there, so a spreadsheet’s own SUM and AVERAGE skip it rather than
// averaging in a zero.
//
// **A TEXT CELL NEVER STARTS A FORMULA** — one beginning with a character OWASP lists gets
// an apostrophe; a number never does, so a negative amount stays one. *Persistence today*
import type { Asset, Snapshot, Transaction } from '../types';

/** U+FEFF — written as an escape so the byte can never be lost in an edit. */
export const CSV_BOM = '\uFEFF';
export const CSV_EOL = '\r\n';

// COLUMNS ARE APPENDED, NEVER INSERTED: a column order is what a spreadsheet
// someone already built formulas against depends on, and there is no importer to
// keep in step, so the only compatibility that exists is with files already on
// disk. `inzhur` is flattened into its three leaf columns.
//
// A COLUMN WHOSE FIELD LEAVES THE MODEL LEAVES THE FILE, and every column after it
// SHIFTS ONE PLACE LEFT. That is the one break the rule above permits, and it is not
// free: a formula bound to a POSITION keeps that position and so picks up the field
// that used to sit one to its RIGHT — a total over `quantity` totals `unitPrice`. It
// is allowed only because the alternative is carrying a column the model can no longer
// fill, an always-empty cell that still has to be explained to whoever reads the file.

export const ASSET_CSV_COLUMNS = [
  'id',
  'name',
  'code',
  'colorKey',
  'yieldType',
  'expectedPct',
  'targetPct',
  'payoutSchedule',
  'firstPurchase',
  'createdAt',
  'maturity',
  'couponAmount',
  'nextCoupon',
  'inzhurKind',
  'inzhurRef',
  'inzhurUnits',
  'couponRatePct',
] as const;

export const TRANSACTION_CSV_COLUMNS = [
  'id',
  'date',
  'type',
  'assetId',
  'amount',
  'quantity',
  'unitPrice',
  'taxWithheld',
  'note',
] as const;

export const SNAPSHOT_WIDE_LEAD_COLUMNS = ['date'] as const;

/** `Inzhur REIT (reit)` — the bracketed id names the asset unambiguously. */
export function snapshotColumnHeader(asset: Asset): string {
  return `${asset.name} (${asset.id})`;
}

/**
 * The one cell never guarded, so only `money` and `plain` make one, and only from a value
 * that is a number at run time: the store is unvalidated, and anything else stays text.
 */
class NumberCell {
  readonly number: string;
  constructor(number: string) {
    this.number = number;
  }
}

// OWASP's list; the full-width four are escapes so an edit cannot swap them for look-alikes.
const FORMULA_START = /^[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/;

// Anything but a NumberCell is text, so a column added later is guarded unasked; a value
// the row lacks writes an empty cell.
function csvField(cell: string | NumberCell): string {
  if (cell instanceof NumberCell) return cell.number;
  const text = String(cell ?? '');
  const value = FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvFile(rows: (string | NumberCell)[][]): string {
  return CSV_BOM + rows.map((cells) => cells.map(csvField).join(',')).join(CSV_EOL) + CSV_EOL;
}

/** 2 dp minimum, more only when the value actually carries more. */
function money(value: number): string | NumberCell {
  if (typeof value !== 'number') return value; // text at run time, so `csvField` guards it
  const fixed = value.toFixed(2);
  return new NumberCell(Number(fixed) === value ? fixed : String(value));
}

/** Counts and percentages: exactly the number, no padding, no grouping. */
function plain(value: number): string | NumberCell {
  if (typeof value !== 'number') return value; // text at run time, so `csvField` guards it
  return new NumberCell(String(value));
}

function optional(value: string | undefined): string {
  return value ?? '';
}

export function serializeAssetsCsv(assets: Asset[]): string {
  return csvFile([
    [...ASSET_CSV_COLUMNS],
    ...assets.map((a) => [
      a.id,
      a.name,
      a.code,
      a.colorKey,
      a.yieldType,
      plain(a.expectedPct),
      plain(a.targetPct),
      a.payoutSchedule,
      a.firstPurchase,
      a.createdAt.slice(0, 19),
      optional(a.maturity),
      a.couponAmount === undefined ? '' : money(a.couponAmount),
      optional(a.nextCoupon),
      optional(a.inzhur?.kind),
      optional(a.inzhur?.ref),
      // The LEGACY count, exported precisely because a value nothing writes any
      // more still has to leave the database somewhere.
      a.inzhur?.units === undefined ? '' : plain(a.inzhur.units),
      a.couponRatePct === undefined ? '' : plain(a.couponRatePct),
    ]),
  ]);
}

export function serializeTransactionsCsv(transactions: Transaction[]): string {
  return csvFile([
    [...TRANSACTION_CSV_COLUMNS],
    ...transactions.map((t) => [
      t.id,
      t.date,
      t.type,
      t.assetId,
      money(t.amount),
      // `plain` on the COUNT: a count is not money and must not be padded — a
      // reinvestment buys a fractional number of units, and `money()` would round
      // the one column whose whole purpose is to be exact.
      t.quantity === undefined ? '' : plain(t.quantity),
      // `money` on the PRICE and the WITHHOLDING: both are ₴, and a money column
      // that padded differently from `amount` would not subtract cleanly in the
      // spreadsheet this file exists for.
      t.unitPrice === undefined ? '' : money(t.unitPrice),
      t.taxWithheld === undefined ? '' : money(t.taxWithheld),
      t.note ?? '',
    ]),
  ]);
}

/**
 * WIDE: `date,<Asset name (id)>…`, one row per date ascending. A quote the
 * day never recorded is an EMPTY cell — never 0, never the word "pending".
 */
export function serializeSnapshotsCsv(snapshots: Snapshot[], assets: Asset[]): string {
  const dated = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  return csvFile([
    [...SNAPSHOT_WIDE_LEAD_COLUMNS, ...assets.map(snapshotColumnHeader)],
    ...dated.map((s) => [
      s.date,
      ...assets.map((a) => (Object.hasOwn(s.quotes, a.id) ? money(s.quotes[a.id]) : '')),
    ]),
  ]);
}
