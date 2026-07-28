import type { YieldType } from '../../core/types';

// Split into its own module (not Tag.tsx) so react-refresh/only-export-components
// doesn't flag a file that exports both a component and plain constants —
// same rationale as button-variants.ts.

// Long-form labels — Attributes cards (design lines 349/364/379/394).
export const YIELD_LABEL_LONG: Record<YieldType, string> = {
  div_cap: 'div + cap',
  capitalization: 'capitalization',
  fixed_coupon: 'fixed coupon',
  dividends: 'dividends',
};

// Short-form labels — Portfolio table + Overview asset-row meta (design lines
// 177-180, 467-470).
export const YIELD_LABEL_SHORT: Record<YieldType, string> = {
  div_cap: 'div + cap',
  capitalization: 'cap',
  fixed_coupon: 'coupon',
  dividends: 'dividends',
};
