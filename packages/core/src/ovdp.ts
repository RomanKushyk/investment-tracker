// The OVDP coupon convention. A LEAF MODULE, importing nothing but the type of
// its own key: `inzhur/parse.ts` shares it with `accrual.ts`, and `infra` compiles
// `parse.ts`, so importing `accrual.ts` there would pull `derive.ts`, `period.ts`
// and `xirr.ts` into the backend typecheck.
import type { PayoutSchedule } from './types';

export const PAYMENTS_PER_YEAR: Record<PayoutSchedule, number> = {
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  maturity: 1,
  none: 0,
};

/** A semiannual OVDP's coupon period: an issue's published dates fall 182 days apart, not on a
 *  month grid, with a rare day's shift. The feed-fixture test in `accrual.test.ts` measures it. */
export const OVDP_COUPON_PERIOD_DAYS = 182;

/**
 * The UAH OVDP nominal — MEASURED, not assumed, with the limits of that
 * measurement in `docs/reference/OVDP-COUPON-STRUCTURE.md`. It holds for every
 * UAH bond and no USD/EUR one; the tell that it has stopped holding is a
 * principal row that is not 100000 kopecks.
 */
export const OVDP_FACE_UAH = 1000;
