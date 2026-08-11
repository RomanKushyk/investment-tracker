// English date-label assembly (month names, "10 Aug", ordinals) — component
// layer on purpose: core/ returns ISO dates / numeric tokens and the UI owns
// the words (structured-returns rule, docs/plans/NEXT-PHASE-PLAN.md G1). Same
// rationale as yield-labels.ts.

// Exported so Payouts/Seasonality can label months without re-deriving the list.
export const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

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
