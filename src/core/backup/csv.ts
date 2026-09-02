// Per-table CSV EXPORT. PURE (G1): no File, no Blob, no DOM. The serializer is
// hand-rolled RFC 4180 — a writer this small earns no dependency.
//
// **Export only, deliberately.** CSV import was cancelled with the cloud move
// (NEXT-PHASE-PLAN "Retired"): reading a spreadsheet back was a restore path
// for a database living in the browser, and the server answers that. What
// survives is the half that was never about durability — handing you your own
// numbers in a form a spreadsheet opens. The lossless restore path is, and
// stays, the JSON envelope.
//
// THE DIALECT (pinned contract, restated in the S5 row's own copy):
//   comma separators · dot decimals · NO thousands grouping · UTF-8 with BOM ·
//   CRLF line endings (incl. after the last record) · a field containing a
//   comma, a double quote or a newline is quoted, and inner quotes are doubled.
// Money carries at least 2 decimals (`68702.10` — kopeck precision, and the
// exact bytes the S6 reference draws) and never fewer digits than the value
// needs, so the file states the stored number exactly. Quantities and
// percentages are written as they are (`6164`, `16.4`) — padding a unit count
// to 2 dp would invent precision the domain does not have.
//
// LAYOUTS: snapshots serialize WIDE (one row per date, one column per asset,
// plus cash), assets and transactions serialize LONG (one row per record).
// **AN EMPTY CELL MEANS PENDING, NEVER 0** (D5#1, the standing invariant): a
// day that recorded no quote for an asset writes nothing there, so a
// spreadsheet's own SUM and AVERAGE skip it instead of averaging in a zero.
import type { Asset, Snapshot, Transaction } from '../types';

/** U+FEFF — written as an escape so the byte can never be lost in an edit. */
export const CSV_BOM = '\uFEFF';
export const CSV_EOL = '\r\n';

// --- Column orders (pinned) -------------------------------------------------
// The domain field order of each row type — the same shape the JSON envelope
// stores, so a spreadsheet column always answers to exactly one Asset /
// Transaction field. `inzhur` is flattened into its three leaf columns.

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
  'reinvestPolicy',
  'inzhurKind',
  'inzhurRef',
  'inzhurUnits',
  // APPENDED, never inserted (D119) — `couponAmount` above is the legacy stored
  // ₴ figure and keeps its position so an existing spreadsheet's formulas hold;
  // this is the rate that replaced it as the thing the form asks for.
  'couponRatePct',
] as const;

export const TRANSACTION_CSV_COLUMNS = [
  'id',
  'date',
  'type',
  'assetId',
  'amount',
  'source',
  // ISSUE #31. APPENDED, never inserted: a column order is what a spreadsheet
  // someone already built its formulas against depends on, and there is no CSV
  // importer to keep in step (export only — `CsvExportRow` is the sole caller),
  // so the one compatibility that exists here is with files already on disk.
  // Empty for every row that carries no units, which is every row recorded
  // before these existed and every row that moves no position.
  'quantity',
  'unitPrice',
] as const;

/** Wide snapshots: these two, then one column per asset. */
export const SNAPSHOT_WIDE_LEAD_COLUMNS = ['date', 'cash'] as const;

/** `Inzhur REIT (reit)` — the bracketed id names the asset unambiguously. */
export function snapshotColumnHeader(asset: Asset): string {
  return `${asset.name} (${asset.id})`;
}

// --- RFC 4180 writer --------------------------------------------------------

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvFile(rows: string[][]): string {
  return CSV_BOM + rows.map((cells) => cells.map(csvField).join(',')).join(CSV_EOL) + CSV_EOL;
}

/** Money: 2 dp minimum, more only when the value actually carries more. */
function money(value: number): string {
  const fixed = value.toFixed(2);
  return Number(fixed) === value ? fixed : String(value);
}

/** Quantities/percentages: exactly the number, no padding, no grouping. */
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
      // Timezone-less, exactly like the JSON envelope normalizes it (D12).
      a.createdAt.slice(0, 19),
      optional(a.maturity),
      a.couponAmount === undefined ? '' : money(a.couponAmount),
      optional(a.nextCoupon),
      optional(a.reinvestPolicy),
      optional(a.inzhur?.kind),
      optional(a.inzhur?.ref),
      // EMPTY for a link made after D117 as well as for no link at all — the
      // column is the legacy count, and it is exported precisely because a value
      // nothing writes any more still has to leave the database somewhere.
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
      t.source,
      // `plain` on the COUNT only: a count is not money and must not be padded
      // to two decimals — a reinvestment buys a fractional number of units, and
      // `money()` would round 43.4785 to 43.48 in the one column whose whole
      // purpose is to be exact.
      t.quantity === undefined ? '' : plain(t.quantity),
      // `money` on the PRICE: it is ₴, and this file's dialect pins money at two
      // decimals minimum. `money()` is right for both shapes — it keeps every
      // decimal of 11.1389 (the `toFixed(2)` round-trip fails, so it falls
      // through to `String`) while padding a whole-hryvnia price to `1000.00`,
      // matching the `amount` column beside it.
      t.unitPrice === undefined ? '' : money(t.unitPrice),
    ]),
  ]);
}

/**
 * WIDE: `date,cash,<Asset name (id)>…`, one row per date ascending, one column
 * per asset in the order given (the repository's own asset order). A quote the
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
