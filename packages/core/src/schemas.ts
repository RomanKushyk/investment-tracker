// zod schemas for the forms. Inputs arrive as strings and are read under ONE
// LANGUAGE’S GRAMMAR — whitespace groups in both, and the comma is the one mark
// they disagree about. Schemas emit no English; the component layer maps paths.
import { z } from 'zod';

// TYPE-ONLY, and it has to stay that way: `money.ts` imports VALUES from here, so
// a value import would close the cycle and this module’s prebuilt records would be
// read mid-initialization.
import type { Lang } from './money';
import { isPayout, movesPosition, targetsAsset } from './types';

/**
 * One number, two conventions. A comma is the DECIMAL mark in Ukrainian
 * (`68 702,10`) and the THOUSANDS mark in English (`10,000.00`), and each
 * language's field offers its own — so a parser that only ever read the comma
 * as a decimal point rejected the very text the English placeholder showed
 * (`10,000.00` → `10.000.00` → NaN).
 *
 * Three rules, and only the last knows the language (*Language, numbers, fonts*):
 *
 * 1. When BOTH marks appear, the last one is the decimal and the other is
 *    grouping. `1,234.56` and `1.234,56` both read as 1234.56 in either
 *    language, which is what makes a pasted value safe wherever it came from.
 * 2. Under the English grammar, commas that ALL group three digits are
 *    grouping. `f.units(6164)` prefills an English field with `6,164`, so
 *    reading that comma as a decimal point turned 6164 units into 6.164 the
 *    moment the user pressed Save — a silent 1000× loss on an asset that had
 *    been opened, not edited.
 * 3. A LONE comma is the decimal under Ukrainian (`16,5`, `1 240,00`) and
 *    nothing at all under English, where the dot is the decimal mark and a
 *    comma that groups nothing is text nobody wrote. It is left UNREADABLE
 *    rather than guessed at: the guess is a thousandfold and its result is a
 *    legal positive number, so no screen downstream could refuse it.
 *
 * Rule 3's cost, accepted rather than overlooked: Ukrainian `10,000` is ten. A
 * SECOND comma is refused outright there — `1,000,000` is not Ukrainian writing
 * and there is no lone comma left to be the decimal.
 */
const GROUPED_INTEGER = /^[+-]?\d{1,3}(,\d{3})+$/;

/**
 * A currency token at either edge — what a bank page or the app’s own prose pastes
 * beside a number. Dropped BEFORE whitespace and before the mark rules: `грн.`
 * carries a dot that would otherwise be read as a decimal mark. A closed list on
 * purpose, so `12abc` is refused rather than read as 12. The `g` flag reaches both
 * edges and gives the regex a `lastIndex`, so use it only through `replace()`.
 */
const CURRENCY_EDGE = /^\s*(?:₴|\$|грн\.?|uah|usd)\s*|\s*(?:₴|\$|грн\.?|uah|usd)\s*$/giu;

/**
 * `groupsWithComma` picks the grammar, and it only ever settles one shape: three
 * digits after a lone comma. `0,125` is an eighth to a Ukrainian typist and 125 to
 * an English one, so the caller says whose text this is rather than the parser
 * guessing. Get it from `groupsWithCommaFor`.
 */
export function normalizeNumberInput(input: string, groupsWithComma: boolean): string {
  const stripped = input.replace(CURRENCY_EDGE, '');
  // A strip that leaves nothing was a currency alone, not a number beside one.
  // Keep the original so `Number()` still says NaN — `''` would read as 0, and
  // a field whose floor is 0 would accept `$` as a value.
  const bare = (stripped.trim() === '' ? input : stripped).replace(/\s/g, '');
  const comma = bare.lastIndexOf(',');
  const dot = bare.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const [decimal, grouping] = comma > dot ? [',', '.'] : ['.', ','];
    return bare.split(grouping).join('').replace(decimal, '.');
  }
  // Either way an unreadable value keeps its comma, which is what makes
  // `Number()` say NaN: English needs the comma to group, Ukrainian needs there
  // to be exactly one for it to be the decimal.
  if (groupsWithComma) return GROUPED_INTEGER.test(bare) ? bare.split(',').join('') : bare;
  return bare.indexOf(',') === bare.lastIndexOf(',') ? bare.replace(',', '.') : bare;
}
/**
 * WHICH FAILURE A SCHEMA REFUSED: text with no reading is `invalid_type`, a number
 * merely out of range is refused by its own bound. Exported so the component maps
 * what the schema said — `error.type` is a bare `string`, one typo from the wrong
 * message.
 */
export const UNREADABLE = 'invalid_type';

/** WHAT A FIELD MAY HOLD AS A NUMBER. Both readers need it — this file’s transform
 *  and `money.ts`’s `storedNumber` — and two copies is how they came to disagree. */
export const CANONICAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** THE ONE READER of a field’s text: bare `Number()` also reads `1.2E+09`, `0x10`
 *  and `0b101`, which no field here can produce and none should record. */
export function readNumber(text: string, lang: Lang): number | undefined {
  return readUnder(text, groupsWithCommaFor(lang));
}

function readUnder(text: string, groupsWithComma: boolean): number | undefined {
  const normalized = normalizeNumberInput(text, groupsWithComma);
  return CANONICAL.test(normalized) ? Number(normalized) : undefined;
}

/** ONE RULE, two carriers: react-hook-form flattens an issue into `error.type`,
 *  a raw `safeParse` keeps the array. Both read the one constant. */
export function couldNotRead(issues: readonly { code: string }[]): boolean {
  return issues.some((issue) => issue.code === UNREADABLE);
}

/**
 * THE ONE PLACE A LANGUAGE BECOMES A GRAMMAR. Written out three times it was three
 * chances to write it once inverted, and the failure is silent — a lone comma read
 * the wrong way is a thousandfold, not an error.
 */
export function groupsWithCommaFor(lang: Lang): boolean {
  return lang !== 'uk';
}

function byLang<T>(build: (groupsWithComma: boolean) => T): Record<Lang, T> {
  return { uk: build(groupsWithCommaFor('uk')), en: build(groupsWithCommaFor('en')) };
}

/**
 * EXPORTED FOR THE FIELDS OUTSIDE A FORM SCHEMA — the coupon card and the quote
 * drafts. On a hard-wired grammar the coupon card and the transaction panel
 * recorded the identical «1,240» 1000x apart into one ledger.
 */
export function amountInputSchema(lang: Lang) {
  return AMOUNT_INPUT[lang];
}

/** The half every numeric field shares, split out so the schemas below DIFFER
 *  only in their range — copied, it was free to drift. */
function numberInput(groupsWithComma: boolean) {
  return (
    z
      .string()
      .trim()
      .min(1)
      // NaN IS THE SIGNAL: a spreadsheet cell pasted into an amount used to record
      // `1.2E+09` as 1.2 billion, because bare `Number()` read it while the field
      // showing it would not.
      .transform((s) => readUnder(s, groupsWithComma) ?? NaN)
  );
}

function positiveNumberInput(groupsWithComma: boolean) {
  return numberInput(groupsWithComma).pipe(z.number().finite().positive());
}

/**
 * A 0–100 share — THE one definition. TWO ENTRY POINTS AND ONE BODY, because the
 * callers hold different halves of the same fact. It takes the language because
 * without it «17,500» was 17.5 at one door and 17500 at the other, on one stored
 * field the two editors must never disagree about.
 */
function percentInputSchemaWith(groupsWithComma: boolean) {
  return numberInput(groupsWithComma).pipe(z.number().finite().min(0).max(100));
}

// BELOW BOTH FACTORIES, not above them: these run at module load, so placing them
// earlier would work only by function hoisting and would break the moment either
// factory became a `const` arrow — at import, for every screen.
const AMOUNT_INPUT = byLang(positiveNumberInput);
const PERCENT_INPUT = byLang(percentInputSchemaWith);

/** Prebuilt per language — `/allocation` calls this per row per render. */
export function percentInputSchemaFor(lang: Lang) {
  return PERCENT_INPUT[lang];
}

const isoDateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const optionalDate = z
  .string()
  .trim()
  .transform((s) => (s === '' ? undefined : s))
  .pipe(isoDateInput.optional());

// Bounded (0, 100] — DELIBERATELY NOT `percentInputSchemaFor(lang).optional()`,
// which admits 0: a 0 % TARGET share is a real answer, a 0 % coupon is not a
// coupon. `couponPerPayment` gates on `rate > 0`, so a stored 0 reads as ABSENT
// and falls back to the legacy amount with no screen able to say which it shows.
function optionalPercentFor(groupsWithComma: boolean) {
  // COMPOSED from `numberInput`, not a second copy of it: this field is pinned
  // against `core/backup/json.ts` AND `asset_coupon_rate_pct_ck`, so a drift here
  // disagrees with two other doors.
  return z
    .string()
    .trim()
    .transform((s) => (s === '' ? undefined : s))
    .pipe(numberInput(groupsWithComma).pipe(z.number().finite().positive().max(100)).optional());
}

const inzhurGroupSchema = z.object({
  kind: z.enum(['fund', 'bond']),
  ref: z.string().trim().min(1), // fund slug / bond ISIN — manual text this phase, live picker in P3
});

// WHY THIS SCHEMA TAKES A GRAMMAR: it reaches the PERCENT fields. `targetPct` and
// `couponRatePct` are bounded at 100, so a misread «10,500» is merely REFUSED;
// `expectedPct` has no `max`, so a Ukrainian «16,400» read under the English rule
// stores 16400 and drives `dailyAccrual` and `/yield` with it. The unbounded
// field is the one nothing downstream can catch.
function assetFormObjectFor(groupsWithComma: boolean) {
  return z.object({
    name: z.string().trim().min(1),
    // 1–2 letters for the avatar circle — auto-derived from the name while
    // untouched, editable, uppercased on parse.
    code: z
      .string()
      .trim()
      .regex(/^\p{L}{1,2}$/u)
      .transform((s) => s.toUpperCase()),
    yieldType: z.enum(['fixed_coupon', 'dividends', 'capitalization', 'div_cap']),
    expectedPct: positiveNumberInput(groupsWithComma),
    targetPct: percentInputSchemaWith(groupsWithComma),
    payoutSchedule: z.enum(['maturity', 'monthly', 'quarterly', 'semiannual', 'none']),
    firstPurchase: isoDateInput,
    maturity: optionalDate,
    // THE RATE, not the amount: a bond’s rate is fixed at issuance while the ₴ it
    // pays scales with the holding, so the amount is derived rather than asked for.
    couponRatePct: optionalPercentFor(groupsWithComma),
    nextCoupon: optionalDate,
    inzhur: inzhurGroupSchema.optional(),
  });
}

// Create never offers 'none'; edit of an asset already holding the seed-only
// 'none' may keep it.
export function assetFormSchema(mode: 'create' | 'edit', lang: Lang) {
  return assetFormObjectFor(groupsWithCommaFor(lang)).superRefine((v, ctx) => {
    if (mode === 'create' && v.payoutSchedule === 'none') {
      ctx.addIssue({ code: 'custom', path: ['payoutSchedule'] });
    }
  });
}

// FROM THE SCHEMA THE RESOLVER RUNS, not the bare object it is built on: an alias
// on the bare object keeps compiling while the two diverge. Both twins take the
// treatment, or this would have to explain why one is exempt.
export type AssetFormInput = z.input<ReturnType<typeof assetFormSchema>>;
export type AssetFormValues = z.output<ReturnType<typeof assetFormSchema>>;

/**
 * A FACTORY over the language. `amount` in per-unit mode and `quantity` are what a
 * Ukrainian typist writes with three decimals and a comma — the one shape
 * `normalizeNumberInput` cannot disambiguate — and this row goes straight to the
 * ledger.
 */
function transactionObjectFor(lang: Lang) {
  const groupsWithComma = groupsWithCommaFor(lang);
  return z.object({
    date: z.string().min(1),
    type: z.enum([
      'buy',
      'sell',
      'deposit',
      'withdrawal',
      'dividend_accrual',
      'interest_payout',
      'reinvest',
      'redemption',
    ]),
    // NO `.min(1)` HERE, because whether an id is required depends on the type and
    // this object cannot see one — the rule is in the refinement below.
    assetId: z.string(),
    amount: positiveNumberInput(groupsWithComma),
    // Optional, and it has to stay optional: a payout moves no position, and a `buy`
    // recorded before this field existed has no count that could be recovered. ABSENT
    // and '' both mean "no units", so the minimal transaction stays valid.
    quantity: z
      .string()
      .optional()
      .transform((s) => (s === undefined || s.trim() === '' ? undefined : s.trim()))
      .pipe(positiveNumberInput(groupsWithComma).optional()),
    // WHAT THE AMOUNT FIELD MEANS, not a second amount. It lives in the schema rather
    // than in component state so the refinement below can see it — in `unit` mode a
    // quantity is not optional, because without one there is no total to record.
    priceMode: z.enum(['total', 'unit']).default('total'),
    // TAKES `quantity`’s IDIOM EXACTLY, down to treating an absent field and a blank
    // one as one state. The other two rules need the type and the amount.
    taxWithheld: z
      .string()
      .optional()
      .transform((s) => (s === undefined || s.trim() === '' ? undefined : s.trim()))
      .pipe(positiveNumberInput(groupsWithComma).optional()),
    // The trim is what makes "blank means absent" true. `[...s].length` RATHER THAN
    // `.max(100)`: `String.length` counts UTF-16 units while the CHECK counts
    // characters, so a hundred emoji measure 200 here and 100 there.
    note: z
      .string()
      .optional()
      .transform((s) => (s === undefined || s.trim() === '' ? undefined : s.trim()))
      .pipe(
        z
          .string()
          .refine((v) => [...v].length <= 100)
          .optional(),
      ),
  });
}

export function transactionSchema(lang: Lang) {
  return transactionObjectFor(lang)
    .superRefine((v, ctx) => {
      // BOTH WAYS: a row that moves no position must not carry units, and one that DOES
      // must. The converse was unenforced because old rows lack a count — but that is
      // about rows already STORED, and this schema only sees a row being typed now.
      // A buy with the quantity blank produces a bond whose coupon reads «—».
      if (movesPosition(v.type) && v.quantity === undefined) {
        ctx.addIssue({ code: 'custom', path: ['quantity'] });
      }
      if (v.quantity !== undefined && !movesPosition(v.type)) {
        ctx.addIssue({ code: 'custom', path: ['quantity'] });
      }
      // THE WITHHOLDING REFUSES RATHER THAN NORMALIZING, which is `quantity`’s precedent
      // and NOT `assetId`’s below: a number input CAN be held empty, where a Radix
      // `Select` cannot, so the refusal never fires at a control nobody can see.
      if (v.taxWithheld !== undefined && !isPayout(v.type)) {
        ctx.addIssue({ code: 'custom', path: ['taxWithheld'], params: { rule: 'type' } });
      }
      // STRICTLY below: a withholding that is the whole payout leaves nothing received.
      // `amount` IS THE TOTAL here whatever the price mode says — `isPayout` implies
      // `!movesPosition`, and the panel forces `total` on such a type.
      if (v.taxWithheld !== undefined && v.taxWithheld >= v.amount) {
        ctx.addIssue({ code: 'custom', path: ['taxWithheld'], params: { rule: 'bound' } });
      }

      // THE ASSET, ONLY WHERE THERE IS ONE. A bare `.min(1)` asked one question of every
      // type and made the form the only door that could not write the portfolio-level
      // shape the rest of the app reads.
      if (targetsAsset(v.type) && v.assetId === '') {
        ctx.addIssue({ code: 'custom', path: ['assetId'] });
      }
    })
    .transform((v) =>
      // THE CONVERSE NORMALIZES RATHER THAN REFUSING: a refusal has to be SHOWN, and the
      // panel hides this control on exactly these types. Nor could it be obeyed — a
      // Radix `Select` echoes away a value written in the commit that mounts it.
      targetsAsset(v.type) ? v : { ...v, assetId: '' },
    );
}

// BOTH SIDES FROM THE SCHEMA THE RESOLVER RUNS, for the reason its asset twin
// gives. The argument is symmetric — a `z.preprocess` would part the input type
// from what `zodResolver` accepts, with `useForm` none the wiser.
export type TransactionFormInput = z.input<ReturnType<typeof transactionSchema>>;
export type TransactionFormValues = z.output<ReturnType<typeof transactionSchema>>;
