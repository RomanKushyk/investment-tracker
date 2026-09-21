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

export const SNAPSHOT_WIDE_LEAD_COLUMNS = ['date', 'cash'] as const;

/** `Inzhur REIT (reit)` — the bracketed id names the asset unambiguously. */
export function snapshotColumnHeader(asset: Asset): string {
  return `${asset.name} (${asset.id})`;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvFile(rows: string[][]): string {
  return CSV_BOM + rows.map((cells) => cells.map(csvField).join(',')).join(CSV_EOL) + CSV_EOL;
}

/** 2 dp minimum, more only when the value actually carries more. */
function money(value: number): string {
  const fixed = value.toFixed(2);
  return Number(fixed) === value ? fixed : String(value);
}

/** Counts and percentages: exactly the number, no padding, no grouping. */
function plain(value: number): string {
  return String(value);
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
      // A NOTE BEGINNING `=` OR `@` IS PASSED THROUGH AS TYPED, accepted rather
      // than overlooked: quoting does not stop a spreadsheet evaluating it, and the
      // usual defence is a leading apostrophe that corrupts the value for every
      // other reader. This is the user’s own data going to their own spreadsheet.
      t.note ?? '',
    ]),
  ]);
}

/**
 * WIDE: `date,cash,<Asset name (id)>…`, one row per date ascending. A quote the
 * day never recorded is an EMPTY cell — never 0, never the word "pending".
 */
export function serializeSnapshotsCsv(snapshots: Snapshot[], assets: Asset[]): string {
  const dated = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  return csvFile([
    [...SNAPSHOT_WIDE_LEAD_COLUMNS, ...assets.map(snapshotColumnHeader)],
    ...dated.map((s) => [
      s.date,
      money(s.cash),
      ...assets.map((a) => (a.id in s.quotes ? money(s.quotes[a.id]) : '')),
    ]),
  ]);
}
