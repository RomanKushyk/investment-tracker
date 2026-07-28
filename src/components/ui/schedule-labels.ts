import type { PayoutSchedule } from '../../core/types';

// English payout-schedule labels — component layer on purpose: the pure
// module (screens/attributes) returns {schedule, day} tokens and the UI
// assembles the words (structured-returns rule, docs/NEXT-PHASE-PLAN.md G1).

// Attributes card "Payout schedule" fact (design line 354; Energy's 'none'
// renders "None (price only)" per line 369).
export const SCHEDULE_LABEL: Record<PayoutSchedule, string> = {
  maturity: 'At maturity',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannual: 'Semi-annual',
  none: 'None (price only)',
};

// Bond card "Coupon" fact frequency word (design line 383: "₴1,240 semi-annual").
export const COUPON_FREQUENCY: Record<PayoutSchedule, string> = {
  maturity: 'at maturity',
  monthly: 'monthly',
  quarterly: 'quarterly',
  semiannual: 'semi-annual',
  none: '',
};
