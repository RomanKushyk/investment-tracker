// zod schemas for the two forms (README §3). Inputs arrive as strings from
// react-hook-form; money accepts the table format (NBSP/space thousands, comma
// or dot decimals) and parses to a positive number.
import { z } from 'zod';

export const quoteInputSchema = z
  .string()
  .trim()
  .min(1)
  .transform((s) => Number(s.replace(/\s/g, '').replace(',', '.')))
  .pipe(z.number().finite().positive());

// The New-asset form offers only the 4 README schedules — 'none' is seed-only.
export const newAssetSchema = z.object({
  name: z.string().trim().min(1),
  yieldType: z.enum(['fixed_coupon', 'dividends', 'capitalization', 'div_cap']),
  expectedPct: z.coerce.number().positive(),
  targetPct: z.coerce.number().min(0).max(100),
  payoutSchedule: z.enum(['maturity', 'monthly', 'quarterly', 'semiannual']),
});

export const transactionSchema = z
  .object({
    date: z.string().min(1),
    // Full TxType incl. 'withdrawal'/'redemption' — the domain accepts them
    // even though the TransactionPanel select only offers them from P2.
    type: z.enum([
      'buy',
      'sell',
      'deposit',
      'withdrawal',
      'dividend_accrual',
      'interest_payout',
      'reinvest',
      'redemption',
      'tax',
    ]),
    assetId: z.string().min(1), // 'new' = create the asset from newAsset
    amount: quoteInputSchema,
    source: z.enum(['own', 'accrual', 'reinvest_reit', 'reinvest_6475']),
    newAsset: newAssetSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.assetId === 'new' && !data.newAsset) {
      ctx.addIssue({ code: 'custom', message: 'New asset details required', path: ['newAsset'] });
    }
  });

export type TransactionFormInput = z.input<typeof transactionSchema>;
export type TransactionFormValues = z.output<typeof transactionSchema>;
