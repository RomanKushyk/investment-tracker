// Pure date glue shared by Overview/Portfolio/Attributes (not in src/lib —
// that layer stays untouched per this task's scope). Covered by dates.test.ts.
import type { Snapshot } from '../../lib/types';

// Exported so Payouts/Seasonality can label months without re-deriving the list.
export const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

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

// Same day-of-month N months later (Next payouts' estimated dividend date).
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, d));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// '2026-08-10' -> '10 Aug' (Next payouts date column).
export function fmtPayoutDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_SHORT[m - 1]}`;
}

// 10 -> '10th', 1 -> '1st', 21 -> '21st' (Attributes "Monthly · ~10th").
export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
