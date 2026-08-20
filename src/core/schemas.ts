// zod schemas for the forms (README §3, NEXT-PHASE-PLAN P2). Inputs arrive as
// strings from react-hook-form; money accepts the table format (NBSP/space
// thousands, comma or dot decimals) and parses to a positive number.
// Structured returns (D8): schemas emit no English — the component layer maps
// issue paths to the pinned per-field messages.
import { z } from 'zod';

/**
 * One number, two conventions. A comma is the DECIMAL mark in Ukrainian
 * (`68 702,10`) and the THOUSANDS mark in English (`10,000.00`), and each
 * language's field offers its own — so a parser that only ever read the comma
 * as a decimal point rejected the very text the English placeholder showed
 * (`10,000.00` → `10.000.00` → NaN).
 *
 * Two rules, neither of which needs to know the language:
 *
 * 1. When BOTH marks appear, the last one is the decimal and the other is
 *    grouping. `1,234.56` and `1.234,56` both read as 1234.56.
 * 2. When only commas appear AND every one of them groups three digits, they
 *    are grouping. This is the case that matters: `f.units(6164)` prefills the
 *    English Units field with `6,164`, so reading that comma as a decimal point
 *    turned 6164 units into 6.164 the moment the user pressed Save — a silent
 *    1000× loss on an asset that had been opened, not edited.
 *
 * Anything else keeps a lone comma as the decimal point, which is what the
 * Ukrainian input needs (`16,5`, `1 240,00`). The two rules can only disagree on
 * a Ukrainian value with exactly three decimals and no other mark — `1,234`
 * meaning 1.234 — which no field here produces: money carries two decimals,
 * units and percentages at most one.
 */
const GROUPED_INTEGER = /^[+-]?\d{1,3}(,\d{3})+$/;

export function normalizeNumberInput(input: string): string {
  const bare = input.replace(/\s/g, '');
  const comma = bare.lastIndexOf(',');
  const dot = bare.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const [decimal, grouping] = comma > dot ? [',', '.'] : ['.', ','];
    return bare.split(grouping).join('').replace(decimal, '.');
  }
  if (GROUPED_INTEGER.test(bare)) return bare.split(',').join('');
  return bare.replace(',', '.');
}

export const quoteInputSchema = z
  .string()
  .trim()
  .min(1)
  .transform((s) => Number(normalizeNumberInput(s)))
  .pipe(z.number().finite().positive());

// Same normalization, but 0 is a valid target share (README targets 40/40/17/3
// admit any 0–100 split). Shared by the AssetForm Target field and the
// Settings targets editor (screens/allocation/targets.ts) so both accept the
// exact same grammar.
export const percentInputSchema = z
  .string()
  .trim()
  .min(1)
  .transform((s) => Number(normalizeNumberInput(s)))
  .pipe(z.number().finite().min(0).max(100));

const isoDateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Optional text field: '' (an untouched input) parses to undefined.
const optionalText = z
  .string()
  .trim()
  .transform((s) => (s === '' ? undefined : s));

const optionalDate = z
  .string()
  .trim()
  .transform((s) => (s === '' ? undefined : s))
  .pipe(isoDateInput.optional());

const optionalAmount = z
  .string()
  .trim()
  .transform((s) => (s === '' ? undefined : s))
  .pipe(quoteInputSchema.optional());

// The AssetForm (NEXT-PHASE-PLAN P2 feat/asset-form, brief S3) — every
// editable Asset field. The Inzhur group is present only while the
// "Link to Inzhur" toggle is on (the component sets `inzhur: undefined`
// when off, mirroring the TransactionPanel newAsset-clearing rule).
const inzhurGroupSchema = z.object({
  kind: z.enum(['fund', 'bond']),
  ref: z.string().trim().min(1), // fund slug / bond ISIN — manual text this phase, live picker in P3
  units: quoteInputSchema, // positive number of units
});

const assetFormObject = z.object({
  name: z.string().trim().min(1),
  // 1–2 letters, shown in the avatar circle — auto-derived from the name
  // while untouched, editable (uppercased on parse).
  code: z
    .string()
    .trim()
    .regex(/^\p{L}{1,2}$/u)
    .transform((s) => s.toUpperCase()),
  yieldType: z.enum(['fixed_coupon', 'dividends', 'capitalization', 'div_cap']),
  expectedPct: quoteInputSchema,
  targetPct: percentInputSchema,
  // All 5 domain schedules here; the mode refinement below rejects the
  // seed-only 'none' on create (edit of a 'none' asset may keep it — S3).
  payoutSchedule: z.enum(['maturity', 'monthly', 'quarterly', 'semiannual', 'none']),
  firstPurchase: isoDateInput,
  // Fixed-coupon group (revealed when yieldType = fixed_coupon) — each field
  // stays optional (the Asset type allows their absence; Attributes shows —).
  maturity: optionalDate,
  couponAmount: optionalAmount,
  nextCoupon: optionalDate,
  reinvestPolicy: optionalText,
  inzhur: inzhurGroupSchema.optional(),
});

// Create never offers 'none' (README schedules); edit mode of an asset
// already holding the seed-only 'none' may keep it — brief S3.
export function assetFormSchema(mode: 'create' | 'edit') {
  return assetFormObject.superRefine((v, ctx) => {
    if (mode === 'create' && v.payoutSchedule === 'none') {
      ctx.addIssue({ code: 'custom', path: ['payoutSchedule'] });
    }
  });
}

export type AssetFormInput = z.input<typeof assetFormObject>;
export type AssetFormValues = z.output<typeof assetFormObject>;

export const transactionSchema = z.object({
  date: z.string().min(1),
  // Full TxType incl. 'withdrawal'/'redemption' — the domain accepts them
  // even though the TransactionPanel select only offers them from P2
  // feat/metrics-exposure.
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
  // 'new' = quick-create; the panel validates its separate AssetForm instance
  // (assetFormSchema above) before recording and swaps in the built asset id.
  assetId: z.string().min(1),
  amount: quoteInputSchema,
  source: z.enum(['own', 'accrual', 'reinvest_reit', 'reinvest_6475']),
});

export type TransactionFormInput = z.input<typeof transactionSchema>;
export type TransactionFormValues = z.output<typeof transactionSchema>;
