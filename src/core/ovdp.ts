// The OVDP coupon convention — the two constants that decide what one payment
// pays. A LEAF MODULE, importing nothing but the type of its own key, and that
// is the point: `accrual.ts` and `inzhur/parse.ts` both need them, and both
// having a private copy is a second answer waiting for one of the two to change
// (D119 rests on the rate and the ₴ agreeing BY CONSTRUCTION).
//
// WHY NOT JUST IMPORT `accrual.ts` FROM `parse.ts` — the first cut did, and it
// widened a compile surface nobody was watching. `infra/tsconfig.json` compiles
// `parse.ts`, so it compiled `accrual.ts` and, behind it, `derive.ts`,
// `period.ts` and `xirr.ts` (measured with `--listFiles` before and after the
// extraction). `derive.ts` is one of the most frequently edited files in the
// repo, and CLAUDE.md's gate names the shared files by hand — so every future
// edit to it would have silently owed an `infra` typecheck that nothing asks for
// until `deploy-backend.yml` runs, after the merge. A leaf costs one file and
// keeps the boundary where the rule can state it.
//
// The current set is EIGHT files and `--listFiles` is the only honest way to
// know it; two earlier versions of this comment stated the count by arithmetic
// and both were wrong.
import type { PayoutSchedule } from './types';

/** Coupon payments per year, by payout schedule (0 = the schedule pays none). */
export const PAYMENTS_PER_YEAR: Record<PayoutSchedule, number> = {
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  maturity: 1,
  none: 0,
};

/**
 * The UAH OVDP nominal — the principal one unit repays at maturity.
 *
 * MEASURED, not assumed: all 32 bonds the provider listed on 2026-08-31 repay
 * exactly 100000 kopecks per unit, and each publishes exactly ONE distinct coupon
 * value, which is what proves the convention is a fixed amount per period rather
 * than a day count. Full measurement and its limits:
 * `docs/reference/OVDP-COUPON-STRUCTURE.md`.
 *
 * A CONSTANT, not a field, and the doc says why: it holds for every UAH bond and
 * for no USD/EUR one, and the provider lists only UAH. The tell that it has
 * stopped holding is a principal row that is not 100000 kopecks.
 */
export const OVDP_FACE_UAH = 1000;
