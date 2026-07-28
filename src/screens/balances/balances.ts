// Pure data-shaping for the Balances screen (chart + paginated table) — not in
// src/lib, that layer stays untouched per this task's scope. Covered by
// balances.test.ts.
import { totalCapital } from '../../core/derive';
import type { Asset, Snapshot } from '../../core/types';

// A snapshot is "complete" if every asset that existed by that date (firstPurchase
// <= date) has a quote — an asset not yet purchased doesn't need one. Only the
// seeded 27.07 row (missing quotes for already-purchased assets) is incomplete.
export function isCompleteSnapshot(snapshot: Snapshot, assets: Asset[]): boolean {
  return assets.every((a) => a.firstPurchase > snapshot.date || snapshot.quotes[a.id] !== undefined);
}

// Ascending, complete-only — the Area chart's data (excludes the partial row).
export function completeSnapshots(snapshots: Snapshot[], assets: Asset[]): Snapshot[] {
  return snapshots
    .filter((s) => isCompleteSnapshot(s, assets))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface BalanceChartPoint {
  date: string;
  total: number;
}

export function balanceChartData(snapshots: Snapshot[], assets: Asset[]): BalanceChartPoint[] {
  return completeSnapshots(snapshots, assets).map((s) => ({ date: s.date, total: totalCapital(s) }));
}

export type BalanceCell =
  | { status: 'value'; amount: number }
  | { status: 'pending' }
  | { status: 'none' }; // asset didn't exist yet on this date

export interface BalanceRow {
  date: string;
  cells: BalanceCell[]; // aligned with the `assets` array passed in
  cash: number;
  total: number | null; // null when any cell is 'pending' (design: "—")
}

export function buildBalanceRow(snapshot: Snapshot, assets: Asset[]): BalanceRow {
  const cells = assets.map((a): BalanceCell => {
    if (a.firstPurchase > snapshot.date) return { status: 'none' };
    const amount = snapshot.quotes[a.id];
    return amount === undefined ? { status: 'pending' } : { status: 'value', amount };
  });
  const complete = cells.every((c) => c.status !== 'pending');
  return { date: snapshot.date, cells, cash: snapshot.cash, total: complete ? totalCapital(snapshot) : null };
}

export interface SnapshotPage {
  rows: Snapshot[];
  page: number;
  totalPages: number;
  total: number;
}

// Simple Prev/Next pagination over the FULL history, newest-first (design:
// "Showing last 6 snapshots · 174 total since 03.02.2026").
export function paginateSnapshots(snapshots: Snapshot[], page: number, pageSize = 6): SnapshotPage {
  const sorted = [...snapshots].sort((a, b) => b.date.localeCompare(a.date));
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const clamped = Math.min(Math.max(page, 0), totalPages - 1);
  const rows = sorted.slice(clamped * pageSize, clamped * pageSize + pageSize);
  return { rows, page: clamped, totalPages, total: sorted.length };
}
