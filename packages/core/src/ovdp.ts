// The OVDP coupon convention. A LEAF MODULE, importing nothing but the type of
// its own key: `accrual.ts` and `inzhur/parse.ts` both need these, and two
// private copies is a second answer waiting for one of them to change.
//
// NOT AN IMPORT OF `accrual.ts` FROM `parse.ts`, which is what it was: `infra`
// compiles `parse.ts`, so that pulled `derive.ts`, `period.ts` and `xirr.ts` into
// the backend typecheck, and every edit to `derive.ts` then silently owed an
// infra gate nothing asks for until `deploy-backend.yml` runs, after the merge.
import type { PayoutSchedule } from './types';

export const PAYMENTS_PER_YEAR: Record<PayoutSchedule, number> = {
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  maturity: 1,
  none: 0,
};

/**
 * The UAH OVDP nominal — MEASURED, not assumed, with the limits of that
 * measurement in `docs/reference/OVDP-COUPON-STRUCTURE.md`. It holds for every
 * UAH bond and no USD/EUR one; the tell that it has stopped holding is a
 * principal row that is not 100000 kopecks.
 */
export const OVDP_FACE_UAH = 1000;
