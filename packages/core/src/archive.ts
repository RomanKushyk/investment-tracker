// The price archive's request vocabulary, a LEAF with no imports: the operations route builds its
// schema from these lists and the panel's forms offer them, so a fund added here is offered and
// accepted together. The order is the published document's.

/** `inzhur` is the provider's own DEALER QUOTE; `nbu_fv` is the National Bank's MODEL valuation.
 *  They are NOT substitutes and are never merged, so storing them without distinguishing the
 *  source would silently present one as the other. */
export const SOURCE = {
  inzhur: 'inzhur',
  nbuFairValue: 'nbu_fv',
} as const;
export type Source = (typeof SOURCE)[keyof typeof SOURCE];
export const SOURCES: readonly Source[] = Object.values(SOURCE);

/** The funds whose published history `importFundHistory` loads. infra keys each one's CMS id by
 *  these, so one added here without its id fails infra's typecheck. */
export const FUND_REFS = ['inzhur-reit', 'inzhur-energy'] as const;
export type FundRef = (typeof FUND_REFS)[number];

export const isFundRef = (ref: string): ref is FundRef => FUND_REFS.some((r) => r === ref);
