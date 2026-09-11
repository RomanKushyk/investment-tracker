// zod schemas for the forms (README §3, NEXT-PHASE-PLAN P2). Inputs arrive as
// strings from react-hook-form and are read under ONE LANGUAGE'S GRAMMAR (D87,
// the three rules below) — whitespace groups in both languages, and the comma is
// the one mark they disagree about.
// Structured returns (D8): schemas emit no English — the component layer maps
// issue paths to the pinned per-field messages.
import { z } from 'zod';

// TYPE-ONLY, and it has to stay that way: `money.ts` imports values from here,
// so a value import would close the cycle and this module's prebuilt records
// would be read mid-initialization.
import type { Lang } from './money';
import { movesPosition, targetsAsset } from './types';

/**
 * One number, two conventions. A comma is the DECIMAL mark in Ukrainian
 * (`68 702,10`) and the THOUSANDS mark in English (`10,000.00`), and each
 * language's field offers its own — so a parser that only ever read the comma
 * as a decimal point rejected the very text the English placeholder showed
 * (`10,000.00` → `10.000.00` → NaN).
 *
 * Three rules, and only the last has to know the language (D87):
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
 * A currency token at either edge of the text — what a bank page or the app's
 * own prose pastes beside a number. Dropped BEFORE whitespace and before the
 * mark rules: `грн.` carries a dot that would otherwise be read as a decimal
 * mark (issue #1). A closed list on purpose — any other letter still makes the
 * value unreadable, so `12abc` is refused rather than read as 12. The `g` flag
 * is what reaches both edges; it also gives the regex a `lastIndex`, so use it
 * only through `replace()`, never `test()`.
 */
const CURRENCY_EDGE = /^\s*(?:₴|\$|грн\.?|uah|usd)\s*|\s*(?:₴|\$|грн\.?|uah|usd)\s*$/giu;

/**
 * `groupsWithComma` picks the grammar, and it only ever settles one shape: three
 * digits after a lone comma. `0,125` is an eighth to a Ukrainian typist and 125
 * to an English one, and both are legal numbers — so the caller says whose text
 * this is rather than the parser guessing. Get it from `groupsWithCommaFor`.
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
 * THE ONE PLACE A LANGUAGE BECOMES A GRAMMAR (D87). Written out three times it
 * was three chances to write it once inverted, and the failure is silent — a
 * lone comma read the wrong way is a thousandfold, not an error.
 */
export function groupsWithCommaFor(lang: Lang): boolean {
  return lang !== 'uk';
}

/** One prebuilt schema per language — the rule is still read from the one place. */
function byLang<T>(build: (groupsWithComma: boolean) => T): Record<Lang, T> {
  return { uk: build(groupsWithCommaFor('uk')), en: build(groupsWithCommaFor('en')) };
}

/**
 * A positive number under one language's grammar.
 *
 * EXPORTED FOR THE FIELDS THAT LIVE OUTSIDE A FORM SCHEMA: `CouponDueCard`
 * validates its own amount and writes a `Transaction` with it, the quote drafts
 * are read by the screen rather than by a resolver, and Settings' ₴/$ rate is a
 * `useState` string. On a hard-wired grammar the coupon card and the transaction
 * panel recorded the identical «1,240» 1000x apart into one ledger.
 *
 * Prebuilt per language: these callers sit on the keystroke path — a quote row
 * per asset, the ₴/$ rate — where the const this replaced cost nothing.
 */
export function amountInputSchema(lang: Lang) {
  return AMOUNT_INPUT[lang];
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

// Same normalization, but 0 is a valid target share (README targets 40/40/17/3
// admit any 0–100 split). Shared by the AssetForm Target field and the
// Settings targets editor (screens/allocation/targets.ts) so both accept the
// exact same grammar.
/**
 * A 0–100 share — THE one definition of that grammar, in both spellings.
 *
 * TWO ENTRY POINTS AND ONE BODY, because the two callers hold different halves
 * of the same fact: `assetFormObjectFor` already has the boolean, and
 * `/allocation`'s target editor has the language. An earlier cut gave them a
 * factory each and left the chain written out twice in this file — which is the
 * duplication `numberInput` exists to prevent, arriving in the very change that
 * was fixing it.
 *
 * WHY IT TOOK THE LANGUAGE AT ALL: the asset form regained its `lang` and this
 * editor did not, so under Ukrainian `17,500` was 17.5 in one door and 17500 —
 * refused by the cap — in the other, on one stored field whose own comment
 * promised the two editors "can never disagree".
 */
function percentInputSchemaWith(groupsWithComma: boolean) {
  return numberInput(groupsWithComma).pipe(z.number().finite().min(0).max(100));
}

// BELOW BOTH FACTORIES, not above them: these run at module load, so placing
// them earlier would work only by function hoisting and would break the moment
// either factory became a `const` arrow — at import, for every screen.
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

// A percentage that may be left blank, bounded (0, 100]. The upper bound is the
// right one for a coupon rate — the widest measured across the provider's 32 live
// bonds is 18.50 % (`docs/reference/OVDP-COUPON-STRUCTURE.md`).
//
// DELIBERATELY NOT `percentInputSchemaFor(lang).optional()`, which is where a reader will
// reach first, because it is `[0, 100]` and admits 0: a 0 % TARGET share is a
// real answer, a 0 % coupon is not a coupon. `couponPerPayment` gates on
// `rate > 0`, so a stored 0 does not read as a smaller rate — it reads as ABSENT
// and falls silently back to the legacy `couponAmount`, with no screen able to
// say which figure it is showing. Refuse it at the door; `core/backup/json.ts`
// and `asset_coupon_rate_pct_ck` refuse it at the other two.
function optionalPercentFor(groupsWithComma: boolean) {
  // COMPOSED from `numberInput`, not a second copy of it, and following
  // `optionalDate`'s shape: empty → `undefined` first, then the shared parse
  // half, then this schema's own range. `numberInput`'s doc gives the reason —
  // "copied, the shared half was free to drift from the rule it is supposed to
  // be" — and this field is the one pinned against `core/backup/json.ts` AND
  // `asset_coupon_rate_pct_ck`, so a drift here disagrees with two other doors.
  return z
    .string()
    .trim()
    .transform((s) => (s === '' ? undefined : s))
    .pipe(numberInput(groupsWithComma).pipe(z.number().finite().positive().max(100)).optional());
}

// The AssetForm (NEXT-PHASE-PLAN P2 feat/asset-form, brief S3) — every
// editable Asset field. The Inzhur group is present only while the
// "Link to Inzhur" toggle is on (the component sets `inzhur: undefined`
// when off, mirroring the TransactionPanel newAsset-clearing rule).
// `units` LEFT this group on 2026-08-31 (D117) — units are `Σ quantity` over the
// ledger now (D112), and the form no longer asks. What the link still holds is
// where to look the instrument up.
//
// WHY THE SCHEMA STILL TAKES A GRAMMAR now that `units` is gone: it reaches the
// PERCENT fields. `targetPct` and `couponRatePct` are bounded at 100, so a
// misread «10,500» is merely REFUSED; `expectedPct` is `positiveNumberInput`
// with no `max`, so a Ukrainian «16,400» read under the English rule stores
// 16400 and drives `dailyAccrual`'s fallback, `couponProjection`'s estimate and
// `/yield` with it. The unbounded field is the one nothing downstream can catch.

const inzhurGroupSchema = z.object({
  kind: z.enum(['fund', 'bond']),
  ref: z.string().trim().min(1), // fund slug / bond ISIN — manual text this phase, live picker in P3
});

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
    expectedPct: positiveNumberInput(groupsWithComma),
    targetPct: percentInputSchemaWith(groupsWithComma),
    // All 5 domain schedules here; the mode refinement below rejects the
    // seed-only 'none' on create (edit of a 'none' asset may keep it — S3).
    payoutSchedule: z.enum(['maturity', 'monthly', 'quarterly', 'semiannual', 'none']),
    firstPurchase: isoDateInput,
    // Fixed-coupon group (revealed when yieldType = fixed_coupon) — each field
    // stays optional (the Asset type allows their absence; Attributes shows —).
    maturity: optionalDate,
    // THE RATE, not the amount (D119). A bond's coupon rate is fixed at issuance;
    // the ₴ it pays scales with the holding, so the amount is derived
    // (`couponPerPayment`) rather than asked for. `couponAmount` is legacy and the
    // form no longer writes it — see `Asset`.
    couponRatePct: optionalPercentFor(groupsWithComma),
    nextCoupon: optionalDate,
    inzhur: inzhurGroupSchema.optional(),
  });
}

// Create never offers 'none' (README schedules); edit mode of an asset
// already holding the seed-only 'none' may keep it — brief S3.
export function assetFormSchema(mode: 'create' | 'edit', lang: Lang) {
  return assetFormObjectFor(groupsWithCommaFor(lang)).superRefine((v, ctx) => {
    if (mode === 'create' && v.payoutSchedule === 'none') {
      ctx.addIssue({ code: 'custom', path: ['payoutSchedule'] });
    }
  });
}

// FROM THE SCHEMA THE RESOLVER RUNS, for the reason its transaction twin below
// spells out: an alias on the bare object keeps compiling while the two diverge.
// `assetFormSchema` carries only a `superRefine` today, so the shapes coincide —
// which is exactly the state the transaction pair was in until D129 gave it a
// `.transform`, and the pair that was NOT derived this way is the one that would
// have gone wrong quietly. Both twins take the treatment, or the comment would
// have to explain why one is exempt.
export type AssetFormInput = z.input<ReturnType<typeof assetFormSchema>>;
export type AssetFormValues = z.output<ReturnType<typeof assetFormSchema>>;

/**
 * A FACTORY over the language, like `assetFormSchema` is over the mode — and for
 * the same kind of reason: the shape is fixed, one rule inside it is not.
 *
 * The numeric fields all take it. `amount` in per-unit mode and `quantity` are
 * the values a Ukrainian typist writes with three decimals and a comma, which
 * is the one shape `normalizeNumberInput` cannot disambiguate on its own — and
 * a row this form writes goes straight into the ledger.
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
    //
    // NO `.min(1)` HERE, because whether an id is required depends on the type
    // and this object cannot see one — the rule is in the refinement below.
    assetId: z.string(),
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

export function transactionSchema(lang: Lang) {
  return transactionObjectFor(lang)
    .superRefine((v, ctx) => {
      // BOTH WAYS NOW (D124, owner's ruling). A row that moves no position must
      // not carry units, and a row that DOES move one must carry them.
      //
      // The converse used to be deliberately unenforced, on the ground that every
      // row recorded before #31 lacks a count and demanding one would make an old
      // habit unenterable. That reasoning protected the wrong thing: it is about
      // rows already STORED, and this schema only ever sees a row being typed now.
      // Meanwhile D119 made every coupon figure `rate × units`, so a buy recorded
      // in the default `total` mode with the quantity left blank produced a bond
      // whose coupon reads «—» on `/attributes`, drops out of `/seasonality`'s
      // coupon season, falls back to an `expectedPct` estimate on `/overview` and
      // prefills nothing in the due card — with nothing anywhere saying why.
      //
      // This subsumes the old `priceMode === 'unit'` check: the panel forces
      // `total` on any type that takes no units, so `unit` implies a moving row.
      //
      // THE OTHER DOORS ENFORCE IT TOO, and that is a later ruling than this
      // block's first draft. D125 put the same rule on the JSON importer and on
      // `transaction_quantity_required_ck`; D126 removed the backup half and D127
      // — the owner's — put it back. `Transaction.quantity` stays optional in the
      // TYPE, because a row that moves no position has none to state.
      //
      // What made all three safe is D128: no door can produce a count-less moving
      // row any more, so there is no legacy population for them to lock out. This
      // comment used to say storage was deliberately left permissive; that was
      // true of the branch that wrote it and is not true of the merge.
      if (movesPosition(v.type) && v.quantity === undefined) {
        ctx.addIssue({ code: 'custom', path: ['quantity'] });
      }
      if (v.quantity !== undefined && !movesPosition(v.type)) {
        ctx.addIssue({ code: 'custom', path: ['quantity'] });
      }

      // THE ASSET, ONLY WHERE THERE IS ONE (D129). This field used to carry a
      // bare `.min(1)`, which asked one question of all nine types and made the
      // form the only door that could not write the portfolio-level shape every
      // other part of the app already reads. So a deposit had to borrow whichever
      // asset the select happened to be showing — `derive.ts` calls that id noise
      // and steps around it — and with no assets yet it could not be recorded at
      // all, which is the first transaction anyone makes.
      if (targetsAsset(v.type) && v.assetId === '') {
        ctx.addIssue({ code: 'custom', path: ['assetId'] });
      }
    })
    .transform((v) =>
      // THE CONVERSE NORMALIZES RATHER THAN REFUSING, and that is the difference
      // between this field and the quantity above it. A refusal has to be shown,
      // and the panel HIDES this control on exactly these types — so the message
      // would land on something nobody can see. It also cannot be obeyed: the
      // control is a Radix `Select`, and a value written into one in the same
      // commit that mounts it is echoed away again (`TransactionPanel`'s own
      // note), so "leave it empty" is not a state the UI can be held in.
      //
      // Blanking here needs no timing to be right and no cooperation from the
      // panel: whatever the hidden picker still holds, a row that crosses the
      // portfolio's edge is stored the way the seed writes one.
      targetsAsset(v.type) ? v : { ...v, assetId: '' },
    );
}

// BOTH SIDES COME FROM THE SCHEMA THE RESOLVER RUNS, not from the bare object it
// is built on. D129 gave `transactionSchema` a `.transform`, and an alias
// pointing at the bare object keeps compiling while the two diverge, because
// the transform happens to return the same shape today. The argument is
// symmetric — a `z.preprocess` on the input side would part `TransactionFormInput`
// from what `zodResolver` actually accepts, with `useForm` none the wiser — so
// the input takes the same treatment rather than a comment explaining why not.
export type TransactionFormInput = z.input<ReturnType<typeof transactionSchema>>;
export type TransactionFormValues = z.output<ReturnType<typeof transactionSchema>>;
