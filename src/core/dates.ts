// Pure date math (ISO yyyy-MM-dd strings in, ISO strings/numbers out).
// English date labels ("10 Aug", "10th", month names) live in
// components/ui/date-labels.ts — core returns tokens only (G1).
import type { Snapshot } from './types';

// Local-time today (daily quotes are local-day based) — the single source,
// was triplicated in Overview/DailyQuotes/TransactionPanel.
export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

// Max snapshot date across the store — the "now" basis for annualized/weeks-held copy.
export function latestSnapshotDate(snapshots: Snapshot[]): string | undefined {
  return snapshots.reduce<string | undefined>(
    (max, s) => (!max || s.date > max ? s.date : max),
    undefined,
  );
}

// Same day-of-month N months later (Next payouts' estimated dividend date),
// clamped to the target month's last day: 2026-08-31 +6m -> 2027-02-28 (G1).
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m + months, 0)).getUTCDate();
  const date = new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay)));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
