// The sources the capture writes, in a module of their own, so a route that names them bundles
// none of the capture.

/** `inzhur` is the provider's own DEALER QUOTE; `nbu_fv` is the National Bank's MODEL valuation.
 *  They are NOT substitutes and are never merged, so storing them without distinguishing the
 *  source would silently present one as the other. */
export const SOURCE = {
  inzhur: 'inzhur',
  nbuFairValue: 'nbu_fv',
} as const;
