// Pure glue for the Attributes screen's facts — imports core/ only, returns
// structured tokens (G1): the schedule label words + ordinal assembly live in
// the component layer. Covered by attributes.test.ts.
import { annualizedPct } from '../../core/derive';
import type { Asset, PayoutSchedule, Transaction } from '../../core/types';

// Latest dividend_accrual's day-of-month for this asset (drives "Monthly · ~10th").
export function dividendDayOfMonth(transactions: Transaction[], assetId: string): number | undefined {
  const matches = transactions.filter((t) => t.type === 'dividend_accrual' && t.assetId === assetId);
  if (matches.length === 0) return undefined;
  const latest = matches.reduce((a, b) => (a.date > b.date ? a : b));
  return Number(latest.date.slice(-2));
}

export interface PayoutScheduleFact {
  schedule: PayoutSchedule;
  day?: number; // latest dividend day-of-month; undefined for 'none' or no history
}

// Attributes card "Payout schedule" fact for non-bond assets (design line
// 354: "Monthly · ~10th"; Energy's 'none' schedule renders bare per line 369).
// Attributes.tsx assembles the label from SCHEDULE_LABEL + ordinal(day).
export function payoutScheduleFact(asset: Asset, transactions: Transaction[]): PayoutScheduleFact {
  if (asset.payoutSchedule === 'none') return { schedule: 'none' };
  return { schedule: asset.payoutSchedule, day: dividendDayOfMonth(transactions, asset.id) };
}

// "Actual (ann.)" fact: undefined until the asset has an actual quote. A
// freshly created asset has invested capital but no snapshot yet — value
// would fall back to 0, making yieldSinceStart read -100% and annualizedPct
// blow that up against the global daysHeld basis (e.g. -209.8%). Guarding
// here (render shows "—" for undefined) keeps annualizedPct itself a plain
// numeric derivation.
export function actualAnnualizedPct(
  value: number | undefined,
  invested: number,
  daysHeld: number,
): number | undefined {
  if (value === undefined) return undefined;
  return annualizedPct(value, invested, daysHeld);
}
