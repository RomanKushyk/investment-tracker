// Pure data-shaping for the Balances screen. Covered by balances.test.ts.
import { freeCashFromLedger, holdsNone, ledgerUnits, totalCapital } from '../derive';
import type { Asset, Snapshot, Transaction } from '../types';
import type { LedgerInput } from './input';

// Whether an asset needs a quote on `date`: while the ledger holds units of it, or, where the
// ledger cannot count them, from its recorded first purchase on.
function needsQuote(asset: Asset, date: string, units: number | undefined): boolean {
  return units === undefined ? asset.firstPurchase <= date : units > 0;
}

// A snapshot is "complete" if every asset that needs a quote that day has one.
export function isCompleteSnapshot(
  snapshot: Snapshot,
  assets: Asset[],
  transactions: Transaction[],
): boolean {
  const units = ledgerUnits(transactions, snapshot.date).units;
  return assets.every(
    (a) => !needsQuote(a, snapshot.date, units[a.id]) || snapshot.quotes[a.id] !== undefined,
  );
}

export function completeSnapshots(
  snapshots: Snapshot[],
  assets: Asset[],
  transactions: Transaction[],
): Snapshot[] {
  return snapshots
    .filter((s) => isCompleteSnapshot(s, assets, transactions))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface BalanceChartPoint {
  date: string;
  total: number;
}

export function balanceChartData(
  snapshots: Snapshot[],
  assets: Asset[],
  transactions: Transaction[],
): BalanceChartPoint[] {
  return completeSnapshots(snapshots, assets, transactions).map((s) => ({
    date: s.date,
    total: totalCapital(s, transactions),
  }));
}

export type BalanceCell =
  // `notHeld` flags a stored quote for a day the ledger holds no units of the asset: shown,
  // and left out of the row's total.
  | { status: 'value'; amount: number; notHeld?: true }
  | { status: 'pending' }
  // No quote, and none is needed on this date.
  | { status: 'none' };

export interface BalanceRow {
  date: string;
  cells: BalanceCell[]; // aligned with the `assets` array passed in
  cash: number;
  total: number | null; // null when any cell is 'pending' (design: "—")
}

export function buildBalanceRow(
  snapshot: Snapshot,
  assets: Asset[],
  transactions: Transaction[],
): BalanceRow {
  const units = ledgerUnits(transactions, snapshot.date).units;
  const cells = assets.map((a): BalanceCell => {
    // A stored quote is never hidden. `totalCapital` leaves out the one the ledger holds no
    // units behind, and the mark says so, so the row still adds up.
    const amount = snapshot.quotes[a.id];
    if (amount === undefined) {
      return needsQuote(a, snapshot.date, units[a.id]) ? { status: 'pending' } : { status: 'none' };
    }
    return holdsNone(units[a.id])
      ? { status: 'value', amount, notHeld: true }
      : { status: 'value', amount };
  });
  // The same predicate the chart filters on — named once so the two cannot drift.
  const complete = isCompleteSnapshot(snapshot, assets, transactions);
  return {
    date: snapshot.date,
    cells,
    // The free cash ON THIS ROW’S DAY, not the latest: the column moves with the
    // ledger now, where a carried-forward balance repeated one figure down the page.
    cash: freeCashFromLedger(transactions, snapshot.date),
    total: complete ? totalCapital(snapshot, transactions) : null,
  };
}

/** Whether a page carries a marked cell — the only question the footnote asks. */
export function pageHasNotHeldQuote(rows: BalanceRow[]): boolean {
  return rows.some((r) => r.cells.some((c) => c.status === 'value' && c.notHeld));
}

export interface SnapshotPage {
  rows: Snapshot[];
  page: number;
  totalPages: number;
  total: number;
}

export function paginateSnapshots(snapshots: Snapshot[], page: number, pageSize = 6): SnapshotPage {
  const sorted = [...snapshots].sort((a, b) => b.date.localeCompare(a.date));
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const clamped = Math.min(Math.max(page, 0), totalPages - 1);
  const rows = sorted.slice(clamped * pageSize, clamped * pageSize + pageSize);
  return { rows, page: clamped, totalPages, total: sorted.length };
}

export interface BalancesView {
  chart: BalanceChartPoint[];
  /** The first snapshot's date, which the pager states; the table itself is read page
   *  by page. */
  earliest: string | undefined;
}

export function balancesView({ assets, snapshots, transactions }: LedgerInput): BalancesView {
  return {
    chart: balanceChartData(snapshots, assets, transactions),
    earliest: [...snapshots].sort((a, b) => a.date.localeCompare(b.date))[0]?.date,
  };
}
