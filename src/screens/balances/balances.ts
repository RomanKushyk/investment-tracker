// Pure data-shaping for the Balances screen. Covered by balances.test.ts.
import { freeCashFromLedger, totalCapital } from '../../core/derive';
import type { Asset, Snapshot, Transaction } from '../../core/types';

// A snapshot is "complete" if every asset that existed by that date has a quote;
// an asset not yet purchased does not need one.
export function isCompleteSnapshot(snapshot: Snapshot, assets: Asset[]): boolean {
  return assets.every(
    (a) => a.firstPurchase > snapshot.date || snapshot.quotes[a.id] !== undefined,
  );
}

export function completeSnapshots(snapshots: Snapshot[], assets: Asset[]): Snapshot[] {
  return snapshots
    .filter((s) => isCompleteSnapshot(s, assets))
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
  return completeSnapshots(snapshots, assets).map((s) => ({
    date: s.date,
    total: totalCapital(s, transactions),
  }));
}

export type BalanceCell =
  // `beforeFirstPurchase` flags a stored quote dated earlier than the asset's own
  // first purchase — two stored facts that disagree, which the row states rather
  // than resolves.
  | { status: 'value'; amount: number; beforeFirstPurchase?: true }
  | { status: 'pending' }
  | { status: 'none' }; // no quote, and the asset did not exist yet on this date

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
  const cells = assets.map((a): BalanceCell => {
    // A stored quote is never hidden: `totalCapital` counts every one, so a cell
    // that withheld one printed a total its own row could not make.
    const amount = snapshot.quotes[a.id];
    const early = a.firstPurchase > snapshot.date;
    if (amount === undefined) return early ? { status: 'none' } : { status: 'pending' };
    return early
      ? { status: 'value', amount, beforeFirstPurchase: true }
      : { status: 'value', amount };
  });
  // The same predicate the chart filters on — named once so the two cannot drift.
  const complete = isCompleteSnapshot(snapshot, assets);
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
export function pageHasEarlyQuote(rows: BalanceRow[]): boolean {
  return rows.some((r) => r.cells.some((c) => c.status === 'value' && c.beforeFirstPurchase));
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
