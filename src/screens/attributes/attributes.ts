// Pure glue for the Attributes screen's fact labels — not in src/lib, that
// layer stays untouched per this task's scope. Covered by attributes.test.ts.
import { annualizedPct } from '../../lib/derive';
import type { Asset, PayoutSchedule, Transaction } from '../../lib/types';
import { ordinal } from '../shared/dates';

const SCHEDULE_LABEL: Record<PayoutSchedule, string> = {
  maturity: 'At maturity',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannual: 'Semi-annual',
  none: 'None (price only)',
};

// Latest dividend_accrual's day-of-month for this asset (drives "Monthly · ~10th").
export function dividendDayOfMonth(transactions: Transaction[], assetId: string): number | undefined {
  const matches = transactions.filter((t) => t.type === 'dividend_accrual' && t.assetId === assetId);
  if (matches.length === 0) return undefined;
  const latest = matches.reduce((a, b) => (a.date > b.date ? a : b));
  return Number(latest.date.slice(-2));
}

// Attributes card "Payout schedule" fact for non-bond assets (design line
// 354: "Monthly · ~10th"; Energy's 'none' schedule renders bare per line 369).
export function payoutScheduleLabel(asset: Asset, transactions: Transaction[]): string {
  if (asset.payoutSchedule === 'none') return SCHEDULE_LABEL.none;
  const day = dividendDayOfMonth(transactions, asset.id);
  const base = SCHEDULE_LABEL[asset.payoutSchedule];
  return day ? `${base} · ~${ordinal(day)}` : base;
}

const COUPON_FREQUENCY: Record<PayoutSchedule, string> = {
  maturity: 'at maturity',
  monthly: 'monthly',
  quarterly: 'quarterly',
  semiannual: 'semi-annual',
  none: '',
};

// Bond card "Coupon" fact frequency word (design line 383: "₴1,240 semi-annual").
export function couponFrequencyLabel(schedule: PayoutSchedule): string {
  return COUPON_FREQUENCY[schedule];
}

// "Actual (ann.)" fact: undefined until the asset has an actual quote. A
// freshly created asset has invested capital but no snapshot yet — value
// would fall back to 0, making yieldSinceStart read -100% and annualizedPct
// blow that up against the global daysHeld basis (e.g. -209.8%). Guarding
// here (render shows "—" for undefined) keeps annualizedPct/derive.ts itself
// untouched per this task's scope.
export function actualAnnualizedPct(
  value: number | undefined,
  invested: number,
  daysHeld: number,
): number | undefined {
  if (value === undefined) return undefined;
  return annualizedPct(value, invested, daysHeld);
}
