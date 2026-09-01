// zod schemas for the forms (README §3, NEXT-PHASE-PLAN P2). Inputs arrive as
// strings from react-hook-form; money accepts the table format (NBSP/space
// thousands, comma or dot decimals) and parses to a positive number.
// Structured returns (D8): schemas emit no English — the component layer maps
// issue paths to the pinned per-field messages.
import { z } from 'zod';

import type { Lang } from './money';
import { movesPosition } from './types';

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

/**
 * `groupsWithComma` — whether a LONE comma may be read as a thousands mark.
 *
 * Rule 2 above is the only ambiguous one, and it is ambiguous in exactly one
 * shape: three decimals, a comma, and no dot. Measured — `0,125` → 125,
 * `43,478` → 43478, `11,138` → 11138. In English those are groupings; in
 * Ukrainian, where a lone comma is ALWAYS the decimal mark, every one of them is
 * a 1000× error, and the value that results is a legal positive number so
 * nothing downstream refuses it.
 *
 * The comment above justified the rule with "no field here produces that shape:
 * money carries two decimals, units and percentages at most one". #31 makes that
 * false — a reinvestment buys a fractional count, and the amount field now holds
 * a per-unit price with up to four decimals. So the caller says which convention
 * its user is typing in, and the two fields #31 adds say `false` under Ukrainian.
 *
 * Defaulted to `true` so every pre-existing caller keeps its behaviour exactly:
 * this branch closes the risk it introduces, and does not silently re-decide the
 * fields it did not touch.
 */
export function normalizeNumberInput(input: string, groupsWithComma: boolean): string {
  const bare = input.replace(/\s/g, '');
  const comma = bare.lastIndexOf(',');
  const dot = bare.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const [decimal, grouping] = comma > dot ? [',', '.'] : ['.', ','];
    return bare.split(grouping).join('').replace(decimal, '.');
  }
  if (groupsWithComma && GROUPED_INTEGER.test(bare)) return bare.split(',').join('');
  return bare.replace(',', '.');
}

/**
 * THE ONE PLACE A LANGUAGE BECOMES A GRAMMAR (D87). Written out three times it
 * was three chances to write it once inverted, and the failure is silent — a
 * lone comma read the wrong way is a thousandfold, not an error.
 */
function groupsWithCommaFor(lang: Lang): boolean {
  return lang !== 'uk';
}

/**
 * `quoteInputSchema`, told which convention the typist is using.
 *
 * EXPORTED FOR THE FIELDS THAT LIVE OUTSIDE A FORM SCHEMA. `CouponDueCard`
 * validates its own amount and writes a `Transaction` with it, so it has to
 * read «1,240» the same way the transaction panel does — left on the grouping
 * default, the two fields recorded the identical text 1000x apart into one
 * ledger.
 */
export function amountInputSchema(lang: Lang) {
  return positiveNumberInput(groupsWithCommaFor(lang));
}

/**
 * The half every numeric field shares: a trimmed, non-empty string read under
 * one grammar. Split out so the schemas below DIFFER only in their range —
 * copied, the shared half was free to drift from the rule it is supposed to be.
 */
function numberInput(groupsWithComma: boolean) {
  return z
    .string()
    .trim()
    .min(1)
    .transform((s) => Number(normalizeNumberInput(s, groupsWithComma)));
}

function positiveNumberInput(groupsWithComma: boolean) {
  return numberInput(groupsWithComma).pipe(z.number().finite().positive());
}

/**
 * The grouping convention, for every field whose typist is not known — and it
 * is DERIVED from the factory rather than a second copy of the same chain, so
 * the two can never disagree about what a positive number is.
 */
export const quoteInputSchema = positiveNumberInput(true);

// Same normalization, but 0 is a valid target share (README targets 40/40/17/3
// admit any 0–100 split). Shared by the AssetForm Target field and the
// Settings targets editor (screens/allocation/targets.ts) so both accept the
// exact same grammar.
export const percentInputSchema = numberInput(true).pipe(z.number().finite().min(0).max(100));

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
function inzhurGroupSchemaFor(groupsWithComma: boolean) {
  return z.object({
    kind: z.enum(['fund', 'bond']),
    ref: z.string().trim().min(1), // fund slug / bond ISIN — manual text this phase, live picker in P3
    // THE SAME FIELD AS THE TRANSACTION PANEL'S «Одиниці», one form over, and it
    // needs the same rule: `43,478` is 43.478 to a Ukrainian typist and 43478
    // under the grouping rule. Fixing one and leaving this one had the two
    // sources `matchAssets` treats as interchangeable — `unitsFrom: 'ledger'`
    // and `'link'` — parsing identical text a thousandfold apart.
    units: positiveNumberInput(groupsWithComma),
  });
}

function assetFormObjectFor(groupsWithComma: boolean) {
  return z.object({
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
    inzhur: inzhurGroupSchemaFor(groupsWithComma).optional(),
  });
}

/** The shape for TYPES — the language changes a parse rule, never the fields. */
type AssetFormObject = ReturnType<typeof assetFormObjectFor>;

// Create never offers 'none' (README schedules); edit mode of an asset
// already holding the seed-only 'none' may keep it — brief S3.
export function assetFormSchema(mode: 'create' | 'edit', lang: Lang) {
  return assetFormObjectFor(groupsWithCommaFor(lang)).superRefine((v, ctx) => {
    if (mode === 'create' && v.payoutSchedule === 'none') {
      ctx.addIssue({ code: 'custom', path: ['payoutSchedule'] });
    }
  });
}

export type AssetFormInput = z.input<AssetFormObject>;
export type AssetFormValues = z.output<AssetFormObject>;

/**
 * A FACTORY over the language, like `assetFormSchema` is over the mode — and for
 * the same kind of reason: the shape is fixed, one rule inside it is not.
 *
 * ONLY the two fields #31 adds take the language. `amount` in per-unit mode and
 * `quantity` are the values a Ukrainian typist writes with three decimals and a
 * comma, which is the one shape `normalizeNumberInput` cannot disambiguate on
 * its own. Everything else keeps `quoteInputSchema` verbatim.
 */
function transactionObjectFor(lang: Lang) {
  const groupsWithComma = groupsWithCommaFor(lang);
  return z.object({
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
    amount: positiveNumberInput(groupsWithComma),
    source: z.enum(['own', 'accrual', 'reinvest_reit', 'reinvest_6475']),
    // ISSUE #31 — units at the point of entry. Optional, and it has to stay
    // optional: a payout or a tax row moves no position, and a `buy` recorded
    // before this field existed has no count that could be recovered.
    //
    // ABSENT and '' both mean "no units". The panel always sends a string, but a
    // schema that could not parse a transaction without these two fields would
    // make every other constructor say `priceMode: 'total', quantity: ''` to mean
    // nothing at all — so the minimal transaction stays valid.
    quantity: z
      .string()
      .optional()
      .transform((s) => (s === undefined || s.trim() === '' ? undefined : s.trim()))
      .pipe(positiveNumberInput(groupsWithComma).optional()),
    // WHAT THE AMOUNT FIELD MEANS, not a second amount. `total` is the ₴ the
    // transaction moved (what the field has always held, and what `amount`
    // stores either way); `unit` is ₴ per unit, from which the panel computes the
    // total. It lives in the schema rather than in component state so the
    // refinement below can see it — in `unit` mode a quantity is not optional,
    // because without one there is no total to record.
    priceMode: z.enum(['total', 'unit']).default('total'),
  });
}

/** The shape for TYPES — the language changes a parse rule, never the fields. */
type TransactionObject = ReturnType<typeof transactionObjectFor>;

export function transactionSchema(lang: Lang) {
  return transactionObjectFor(lang).superRefine((v, ctx) => {
    if (v.priceMode === 'unit' && v.quantity === undefined) {
      ctx.addIssue({ code: 'custom', path: ['quantity'] });
    }
    // ONE WAY ONLY, mirroring W7's `transaction_quantity_absent_ck`: a row that
    // moves no position must not carry units. The converse is deliberately not
    // enforced — a position-moving row is allowed to lack a quantity, which is
    // the state every row recorded before #31 is in.
    if (v.quantity !== undefined && !movesPosition(v.type)) {
      ctx.addIssue({ code: 'custom', path: ['quantity'] });
    }
  });
}

export type TransactionFormInput = z.input<TransactionObject>;
export type TransactionFormValues = z.output<TransactionObject>;
