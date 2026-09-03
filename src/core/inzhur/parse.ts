// The Inzhur public feed (GET https://www.inzhur.reit/_api/assets), PURE half:
// a tolerant pick-parse plus portfolio matching. Policy, endpoint constraints
// and the kopecks unit are recorded in docs/DECISIONS.md D19; the network half
// is src/hooks/useInzhurAssets.ts (core never fetches, G1).
//
// TOLERANCE IS THE CONTRACT: the payload is third-party and WILL drift, so
// every schema here PICKS the few fields we need and IGNORES everything else
// (never strictObject), and a per-entry failure skips that entry instead of
// killing the parse. Fixture of the live shape (2026-07-28):
// __fixtures__/assets-sample.json.
import { z } from 'zod';

import { kyivDateIso } from '../dates';
// IMPORTED, NOT MIRRORED. Both were private copies in this file, under a comment
// claiming a test pinned them equal to `accrual.ts`'s — no such test existed —
// and that importing would cycle. `ovdp.ts` is a leaf that imports one type, so
// there is nothing to cycle with and nothing extra reaches the backend's
// typecheck (D122). D119 rests on the rate and the ₴ `couponPerPayment` derives
// from it agreeing BY CONSTRUCTION; two copies of the divisor is exactly how
// that stops being true.
import { OVDP_FACE_UAH, PAYMENTS_PER_YEAR } from '../ovdp';
import { normalizeRef } from './ref';
import type { Asset, PayoutSchedule } from '../types';

/** The feed publishes bond payment amounts in integer kopecks per bond. */
export const KOPECKS_PER_UAH = 100;

export interface InzhurPayment {
  /** Kyiv calendar date (yyyy-MM-dd) — see kopecksToUah's sibling note below. */
  date: string;
  /** ₴ per unit. */
  amount: number;
}

/** Published annual yield, percent. Bonds only — funds carry none. */
export interface InzhurReturnRates {
  buy?: number;
  sell?: number;
}

export interface InzhurQuote {
  kind: 'fund' | 'bond';
  /** Fund slug ('inzhur-reit') or bond ISIN ('UA4000238976'), as published. */
  ref: string;
  /**
   * The feed's own display title ('Inzhur REIT'), whitespace-collapsed — the
   * S7 picker's primary text for funds. Absent when the feed omits it; bonds
   * carry a generic Ukrainian title and are labeled by ISIN instead.
   */
  title?: string;
  sellUAH: number;
  buyUAH?: number;
  navUAH?: number;
  /** Bonds only (yyyy-MM-dd). */
  maturity?: string;
  /** Bonds only; ascending by date then amount. Funds get an empty list. */
  paymentSchedule: InzhurPayment[];
  /**
   * Bonds only. The feed's bond price is not a market quote but a discounted
   * cash flow over `paymentSchedule` whose ONLY free parameter is this rate
   * (verified out-of-sample 2026-07-28 → 2026-08-10: predicted 1063.1288 vs
   * quoted 1063.13). So it is the one field that lets a stored price be
   * re-derived, date-stamped, or checked for a silent yield revision — none of
   * which is possible from the price alone. Absent on funds.
   */
  returnRates?: InzhurReturnRates;
  /**
   * The feed's lifecycle flag, verbatim — 'active' and 'completed' are the only
   * live values, but it is kept as a plain string so a third one is captured
   * rather than dropped.
   *
   * Recorded, NEVER filtered on (D19): a completed bond the user still holds
   * must keep matching. Worth capturing because it flips WITHOUT the price
   * moving — a matured bond keeps quoting its last value indefinitely — so the
   * flip is observable only if it is recorded on the day it happens.
   */
  status?: string;
}

/**
 * One entry the parse could not read, and WHY.
 *
 * The reason is the point. A bare list of refs says an asset vanished; it does
 * not say that `prices.sellUAH` was renamed, which is the single most likely
 * way this feed breaks and the one thing that turns a silent disappearance into
 * a five-minute fix. Tokens, never English — the words live in the components
 * (D8).
 */
export interface SkippedEntry {
  /** ISIN, slug, `#index` when the entry carries neither, or `(root)`. */
  ref: string;
  /**
   * `not_an_array` — the payload itself was not a list (an error page, an
   *   envelope change). `entries` is empty and nothing else can be said.
   * `shape` — the entry failed validation; `fields` names what.
   * `no_ref` — it validated but carries neither ISIN nor slug, so nothing
   *   could key it.
   */
  reason: 'not_an_array' | 'shape' | 'no_ref';
  /** Dotted paths zod rejected, e.g. `assetDetails.prices.sellUAH`. Only on
   *  `shape`, and deduped — one rename usually raises several issues. */
  fields?: string[];
}

export interface ParsedFeed {
  entries: InzhurQuote[];
  /** Everything the parse could not read, with the reason for each. */
  skipped: SkippedEntry[];
}

// Money created here (a quote value, a coupon forecast) is rounded once, at
// creation, to kopecks: it is about to be shown as an amount and saved as one.
// D13's "round at display only" governs derivations OVER stored data — it does
// not ask us to persist 68 660.179600000004 as a quote.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Kopecks → ₴ — THE one conversion place in the app (7840 → 78.40,
 * 100000 → 1 000.00). Nothing else divides feed amounts by 100.
 */
export function kopecksToUah(kopecks: number): number {
  return round2(kopecks / KOPECKS_PER_UAH);
}

/**
 * A linked position's ₴ value: units × the feed's sell price
 * (6 164 × 11.1389 = 68 660.18). Also the units × per-unit-money arithmetic
 * behind couponForecast — one rounding place for both.
 */
export function positionValue(units: number, sellUAH: number): number {
  return round2(units * sellUAH);
}

const pricesSchema = z.object({
  sellUAH: z.number(),
  buyUAH: z.number().optional(),
  navUAH: z.number().optional(),
});

const paymentSchema = z.object({
  date: z.string(),
  // Kopecks arrive as a STRING ("7840") in every live entry; a number is
  // accepted too in case that drifts.
  amount: z.union([z.number(), z.string().regex(/^-?\d+(?:\.\d+)?$/)]),
});

const ratesSchema = z.object({
  buy: z.number().optional(),
  sell: z.number().optional(),
});

const detailsSchema = z.object({
  isin: z.string().optional(),
  prices: pricesSchema,
  maturityDate: z.string().optional(),
  // Rows are validated one by one below, so one malformed payment cannot cost
  // the bond its quote.
  paymentSchedule: z.array(z.unknown()).optional(),
  // Validated separately (pickRates) for the same reason: returnRates is a
  // nice-to-have for the quote path, so a drift in its shape must never cost
  // the entry its price.
  returnRates: z.unknown().optional(),
});

const entrySchema = z.object({
  slug: z.string().optional(),
  title: z.string().optional(),
  status: z.string().optional(),
  assetDetails: detailsSchema,
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// maturityDate is already a plain date; paymentSchedule dates are instants at
// midnight Kyiv ('2027-03-23T22:00:00.000Z' = 24.03.2027 locally), so they must
// be read in Kyiv time or they land a day early and contradict maturityDate.
function feedDate(raw: string): string | undefined {
  const value = raw.trim();
  if (ISO_DATE.test(value)) return value;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : kyivDateIso(new Date(ms));
}

function pickSchedule(rows: unknown[] | undefined): InzhurPayment[] {
  const payments: InzhurPayment[] = [];
  for (const row of rows ?? []) {
    const parsed = paymentSchema.safeParse(row);
    if (!parsed.success) continue;
    const date = feedDate(parsed.data.date);
    const kopecks = Number(parsed.data.amount);
    if (date === undefined || !Number.isFinite(kopecks)) continue;
    payments.push({ date, amount: kopecksToUah(kopecks) });
  }
  return payments.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
}

// Yields are picked, never required: an unreadable or absent returnRates yields
// `undefined` and the entry keeps its price. A rate that is present but not a
// finite number is dropped rather than stored, so a consumer never has to guard
// against NaN in the DCF.
function pickRates(raw: unknown): InzhurReturnRates | undefined {
  const parsed = ratesSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const buy = Number.isFinite(parsed.data.buy) ? parsed.data.buy : undefined;
  const sell = Number.isFinite(parsed.data.sell) ? parsed.data.sell : undefined;
  if (buy === undefined && sell === undefined) return undefined;
  return { ...(buy === undefined ? {} : { buy }), ...(sell === undefined ? {} : { sell }) };
}

// Titles arrive with hard line breaks in them ("Державні \nоблігації України"),
// so runs of whitespace collapse to single spaces before the UI ever sees one.
function pickTitle(raw: string | undefined): string | undefined {
  const title = raw?.replace(/\s+/g, ' ').trim() ?? '';
  return title === '' ? undefined : title;
}

// Best-effort identifier for an entry we are about to skip, so the caller can
// name what was dropped.
function labelOf(raw: unknown, index: number): string {
  const entry = raw as { slug?: unknown; assetDetails?: { isin?: unknown } } | null;
  const isin = entry?.assetDetails?.isin;
  if (typeof isin === 'string' && isin.trim() !== '') return isin.trim();
  if (typeof entry?.slug === 'string' && entry.slug.trim() !== '') return entry.slug.trim();
  return `#${index}`;
}

/**
 * Pick-parse the whole payload. Unknown fields are ignored; an entry that does
 * not carry a usable ref + sell price is skipped by ref (never thrown).
 */
export function parseAssetsFeed(payload: unknown): ParsedFeed {
  if (!Array.isArray(payload)) {
    return { entries: [], skipped: [{ ref: '(root)', reason: 'not_an_array' }] };
  }

  const entries: InzhurQuote[] = [];
  const skipped: SkippedEntry[] = [];

  payload.forEach((raw, index) => {
    const parsed = entrySchema.safeParse(raw);
    if (!parsed.success) {
      // The rejected PATHS, deduped: one renamed field typically raises several
      // issues, and a list repeating `assetDetails.prices.sellUAH` four times
      // reads as four problems.
      const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].filter(
        (p) => p !== '',
      );
      skipped.push({
        ref: labelOf(raw, index),
        reason: 'shape',
        ...(fields.length === 0 ? {} : { fields }),
      });
      return;
    }
    const { slug, title, status, assetDetails: details } = parsed.data;
    const isin = details.isin?.trim() ?? '';
    // Funds are keyed by slug, bonds by ISIN — ISIN presence IS the kind (no
    // live fund carries one, and every live bond does).
    const ref = isin !== '' ? isin : (slug?.trim() ?? '');
    if (ref === '') {
      skipped.push({ ref: labelOf(raw, index), reason: 'no_ref' });
      return;
    }
    const maturity =
      details.maturityDate === undefined ? undefined : feedDate(details.maturityDate);
    const label = pickTitle(title);
    const rates = pickRates(details.returnRates);
    const lifecycle = status?.trim();
    entries.push({
      kind: isin !== '' ? 'bond' : 'fund',
      ref,
      ...(label === undefined ? {} : { title: label }),
      sellUAH: details.prices.sellUAH,
      ...(details.prices.buyUAH === undefined ? {} : { buyUAH: details.prices.buyUAH }),
      ...(details.prices.navUAH === undefined ? {} : { navUAH: details.prices.navUAH }),
      ...(maturity === undefined ? {} : { maturity }),
      paymentSchedule: pickSchedule(details.paymentSchedule),
      ...(rates === undefined ? {} : { returnRates: rates }),
      ...(lifecycle === undefined || lifecycle === '' ? {} : { status: lifecycle }),
    });
  });

  return { entries, skipped };
}

/**
 * The next payment on/after `fromIso`, ₴ per unit. A maturity date carries the
 * final coupon AND the principal (7840 + 100000 kopecks); the smaller row is
 * the coupon, which is what a forecast wants — the tie-break is explicit here
 * so callers never depend on array order.
 */
export function nextPaymentOnOrAfter(
  schedule: InzhurPayment[],
  fromIso: string,
): InzhurPayment | undefined {
  return schedule.reduce<InzhurPayment | undefined>((best, payment) => {
    if (payment.date < fromIso) return best;
    if (best === undefined || payment.date < best.date) return payment;
    if (payment.date === best.date && payment.amount < best.amount) return payment;
    return best;
  }, undefined);
}

export interface CouponForecast {
  date: string;
  /** ₴ per unit, straight from the feed schedule. */
  perUnit: number;
  /** ₴ the position pays: perUnit × units (4 × 88.85 = 355.40). */
  amount: number;
}

/**
 * Coupon forecast for a linked bond — the amount the P3 coupon-confirm card
 * prefills (G5: a suggestion, editable, never written on its own).
 */
export function couponForecast(
  schedule: InzhurPayment[],
  fromIso: string,
  units: number,
): CouponForecast | undefined {
  const next = nextPaymentOnOrAfter(schedule, fromIso);
  if (next === undefined) return undefined;
  return { date: next.date, perUnit: next.amount, amount: positionValue(units, next.amount) };
}

/**
 * What the provider's own schedule already says about a bond, so a person is not
 * asked for it (D121). Every field is optional: the feed answers what it answers.
 *
 * These three used to be hand-typed, and they are NOT decorative —
 * [`D120`](../../../docs/DECISIONS.md) measured how load-bearing they are:
 * `nextCoupon` anchors the coupon grid and the payout projection, `maturity`
 * stops the ghost accrual and raises the maturity reminder, and
 * `payoutSchedule` is the divisor in `couponPerPayment`. Getting them from the
 * instrument itself is the same move `D119` made for the coupon rate.
 */
export interface ScheduleFacts {
  maturity?: string;
  nextCoupon?: string;
  payoutSchedule?: PayoutSchedule;
  /**
   * The annual coupon RATE, percent — `perUnitCoupon ÷ 5` on the ₴1000 nominal
   * every measured bond repays (`docs/reference/OVDP-COUPON-STRUCTURE.md`).
   *
   * The same `paymentSchedule` the three above come from already carries it, and
   * the rate is the field most expensive to get wrong: it is the multiplier in
   * every coupon figure the asset produces, so a typo of 15.86 for 15.68
   * mis-scales all of them with nothing to cross-check against. Filling the
   * other three and leaving this one to be hand-typed was the odd exception.
   */
  couponRatePct?: number;
}

/**
 * The most frequent value, and `undefined` when nothing repeats — a two-payment
 * schedule of two different amounts states no recurring coupon, so it gets no
 * rate rather than a coin flip.
 *
 * TIES BREAK TOWARD THE LARGER VALUE, and only among values that ALREADY
 * repeat. An earlier version of this doc promised the tie-break for a stub and a
 * full coupon appearing once each; the gate below discards that case before the
 * tie-break can see it, and `parse.test.ts` pins the `undefined`. Silence is the
 * intended answer there: one occurrence each is not evidence of a contract.
 */
function modeOf(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== undefined && value > best)) {
      best = value;
      bestCount = count;
    }
  }
  return bestCount > 1 || counts.size === 1 ? best : undefined;
}

/**
 * Coupon CADENCE from the gaps between payment dates.
 *
 * Bands, not equality: the provider's bonds pay every 182 days — 26 weeks, so the
 * weekday holds for life — and one of the 32 measured carries a single one-day
 * shift (183 then 181) around a moved date
 * (`docs/reference/OVDP-COUPON-STRUCTURE.md`). Matching 182 exactly would
 * misread that bond; the bands read it correctly.
 *
 * ONE DATE MEANS `maturity` — a zero-coupon bond pays once, at the end.
 *
 * ANYTHING OUTSIDE THE BANDS RETURNS `undefined`, deliberately. An annual bond
 * has no member in this enum, and an irregular schedule has no cadence at all;
 * saying nothing leaves the field to the user, while guessing would put a wrong
 * divisor into every coupon figure the asset produces.
 */
function cadenceOf(dates: readonly string[]): PayoutSchedule | undefined {
  if (dates.length === 0) return undefined;
  if (dates.length === 1) return 'maturity';
  const gaps = dates
    .slice(1)
    .map(
      (d, i) => (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${dates[i]}T00:00:00Z`)) / 86_400_000,
    )
    .sort((a, b) => a - b);
  // The MEDIAN, so one shifted date cannot move the answer.
  const gap = gaps[Math.floor(gaps.length / 2)];
  if (gap < 45) return 'monthly';
  if (gap < 135) return 'quarterly';
  if (gap < 250) return 'semiannual';
  return undefined;
}

/**
 * Read the three schedule facts out of one feed entry, as of `fromIso`.
 *
 * `nextCoupon` is `nextPaymentOnOrAfter`'s date, so it inherits that function's
 * tie-break: on a maturity date carrying both the final coupon and the principal
 * it takes the SMALLER row, which is the coupon. The date is the same either
 * way; the shared tie-break is what keeps this and the forecast agreeing.
 */
export function scheduleFacts(quote: InzhurQuote, fromIso: string): ScheduleFacts {
  const dates = [...new Set(quote.paymentSchedule.map((p) => p.date))].sort();
  const next = nextPaymentOnOrAfter(quote.paymentSchedule, fromIso);
  const cadence = cadenceOf(dates);
  // ONLY FROM A CADENCE WE READ. The rate is `perUnit × paymentsPerYear / FACE`,
  // so it needs the divisor the cadence supplies — deriving it against an
  // assumed 2 would be exactly the guess `cadenceOf` refuses to make. The
  // per-unit figure is the schedule's SMALLEST payment: the maturity date
  // carries the final coupon and the ₴1000 principal, and only one of them is a
  // coupon.
  const perYear = cadence === undefined ? undefined : PAYMENTS_PER_YEAR[cadence];
  const coupons = quote.paymentSchedule.filter((p) => p.amount !== OVDP_FACE_UAH);
  // THE RECURRING COUPON, NOT THE SMALLEST ONE. `Math.min` was wrong for a bond
  // issued mid-period: its first coupon is a short STUB (a part-period accrual),
  // and taking it as the rate halved every coupon figure the asset produces. The
  // measurement behind `OVDP-COUPON-STRUCTURE.md` — "exactly one distinct coupon
  // value per bond" — was one day's list of 32 live bonds, and a stub is exactly
  // the shape it would not have contained. The MODE is the honest reading: the
  // value that repeats is the contract, whatever else sits beside it.
  const perUnit = modeOf(coupons.map((p) => p.amount));
  // BOUNDED THE WAY THE FORM IS BOUNDED. This figure is written straight into
  // `couponRatePct` by the picker's effect, and `optionalPercent` refuses
  // anything outside (0, 100] — so a bond whose principal row is not exactly
  // ₴1000 (a non-UAH nominal, or a final row that pays coupon and principal
  // together as the only payment) derived a rate above 100 and left the field red
  // with an error the user did not cause and no way to see why. Offering nothing
  // is the honest answer: the schedule does not fit the ₴1000-face convention
  // this derivation rests on.
  // No `perYear === 0` case: `cadenceOf` returns only `maturity`, `monthly`,
  // `quarterly` or `semiannual`, and every one of those maps to a non-zero
  // entry. `'none'` is the single 0 in the table and this derivation can never
  // see it — a guard for it read as if a zero-payment cadence were reachable.
  const derived =
    perYear === undefined || perUnit === undefined
      ? undefined
      : round2((perUnit * perYear * 100) / OVDP_FACE_UAH);
  const ratePct = derived !== undefined && derived > 0 && derived <= 100 ? derived : undefined;
  return {
    ...(quote.maturity === undefined ? {} : { maturity: quote.maturity }),
    ...(next === undefined ? {} : { nextCoupon: next.date }),
    ...(cadence === undefined ? {} : { payoutSchedule: cadence }),
    ...(ratePct === undefined ? {} : { couponRatePct: ratePct }),
  };
}

export interface InzhurMatch {
  asset: Asset;
  quote: InzhurQuote;
  /**
   * units × sellUAH — the value the fetch offers for this row, and ABSENT when
   * no count is known (D117): the ledger has no quantities for this asset yet
   * and the link carries no legacy total. The asset still MATCHED — it is in the
   * feed — so it belongs in `linked`; there is simply nothing to offer.
   */
  value?: number;
  /** The count `value` was computed from. Absent with `value`. */
  units?: number;
  /**
   * WHY there is no `value`, when there is none.
   *
   * `no-position` — the count is EXACTLY zero. Nothing to fix and nothing to
   * say: on that date the position genuinely was not held. It covers both a
   * sold-out holding and a date before the first purchase, and the name says so
   * — an earlier `closed` read as the first only, while `unitsByAsset` bounds
   * its sum by `asOf` and produces the second just as readily.
   *
   * `negative` — the count is BELOW zero, which no holding can be. It means
   * recorded sales exceed recorded purchases, so it is a data error the owner
   * has to fix, and it must be reported rather than absorbed. Folding it into
   * `no-position` made a real defect indistinguishable from an ordinary empty
   * day, on the one screen positioned to notice.
   */
  noValue?: 'no-position' | 'negative' | 'no-count';
  /**
   * WHERE that count came from, and it is surfaced rather than inferred because
   * the two are not equally trustworthy. `ledger` is `Σ quantity` over the
   * asset's transactions — correct by construction, and what W7 will store.
   * `link` is `Asset.inzhur.units`, one hand-typed total that no purchase
   * updates: the defect issue #31 reported. A row valued from `link` is only as
   * current as the last time someone edited the asset.
   *
   * NOT YET SURFACED, and saying so here rather than claiming otherwise: nothing
   * outside the tests reads this. `reconcileFetched` and `QuoteRow` treat both
   * sources identically, so the stale-total case stays invisible in the product.
   * Recorded so the distinction survives until a row can show it.
   */
  unitsFrom?: 'ledger' | 'link';
}

export interface MatchedAssets {
  linked: InzhurMatch[];
  /** Linked assets whose ref is absent from the feed. */
  unmatched: Asset[];
}

// The lookup key: the kind IS part of it, because it selects which half of the
// feed the ref is looked for in. `sameInstrument` is the other question and
// deliberately excludes the kind — see `ref.ts`.
function matchKey(kind: 'fund' | 'bond', ref: string): string {
  return `${kind}:${normalizeRef(ref)}`;
}

/**
 * Do these two links name the same instrument? THE one answer — `matchKey` is
 * what decides whether a stored ref reaches the feed, so nothing else may hold a
 * private copy of the comparison.
 *
 * KIND-SENSITIVE, unlike `sameInstrument` — this asks whether two links resolve
 * to the same feed ENTRY, which is a question about where to look as much as
 * what to look for. `legacyUnitsOf` asks the other question and uses the other
 * helper; `ref.ts` carries why.
 *
 * The normalization itself lives in `ref.ts` so that four call sites across
 * three layers cannot drift: strip an ISIN check digit or normalize an NBSP in
 * one of them and the picker fills facts for an instrument the fetch will not
 * match, or an edit deletes the only unit count an asset had.
 */
export function sameRef(
  a: { kind: 'fund' | 'bond'; ref: string },
  b: { kind: 'fund' | 'bond'; ref: string },
): boolean {
  return matchKey(a.kind, a.ref) === matchKey(b.kind, b.ref);
}

/**
 * The empty units record — what a caller passes to `matchAssets` when it has no
 * count to offer and wants the link's own legacy figure, or nothing.
 *
 * `Object.create(null)`, NOT `{}`, for the reason spelled out on `unitsByAsset`'s
 * map in `derive.ts`: an asset id of `toString`, `constructor` or `valueOf` is a
 * legal id, and a plain object answers those keys with an inherited function. A
 * bare `{}` survives here only because `matchAssets` guards with `Object.hasOwn`
 * — by accident rather than by the rule, which is what this constant removes.
 *
 * EXPORTED so there is ONE of it: two screens wanted the idiom and only one had
 * it — `daily-quotes/suggestions.ts` declared it privately while
 * `attributes.ts` passed a bare `{}` beside it.
 *
 * FROZEN, because one of it is also one point of corruption. Three call sites
 * now hand the same object to a function whose whole job is to index a units
 * record by asset id; a future caller that writes back into the record it was
 * given would poison every other reader for the life of the module. The freeze
 * and the `Readonly` type cost nothing and make the single owner actually
 * single.
 */
export const NO_UNITS: Readonly<Record<string, number>> = Object.freeze(
  Object.create(null) as Record<string, number>,
);

/**
 * Split the portfolio's Inzhur-LINKED assets against a parsed feed. Assets
 * without a link appear in neither list — they are not part of a fetch.
 */
export function matchAssets(
  assets: Asset[],
  feed: ParsedFeed,
  // ISSUE #31. `units[assetId]` is `derive.ts`'s `unitsByAsset` — the ledger's
  // own count, which is the RIGHT number and the one W7 keeps. It is a
  // parameter rather than a second field on the asset because core never reads
  // the store, and optional because the ledger cannot answer for a position
  // whose transactions predate `Transaction.quantity`: those rows record ₴ and
  // nothing else, and §4 of the migration notes says the counts are
  // unrecoverable. In that case, and only then, the stale link total is still
  // the best number available — so it is used, and `unitsFrom` says so.
  units: Record<string, number>,
): MatchedAssets {
  const byRef = new Map(feed.entries.map((e) => [matchKey(e.kind, e.ref), e]));
  const linked: InzhurMatch[] = [];
  const unmatched: Asset[] = [];

  for (const asset of assets) {
    const link = asset.inzhur;
    if (link === undefined) continue;
    const quote = byRef.get(matchKey(link.kind, link.ref));
    if (quote === undefined) {
      unmatched.push(asset);
      continue;
    }
    // PRESENCE decides, never truthiness: a fully sold position sums to 0, and
    // `??` on a falsy 0 would fall back to the link's total and value a closed
    // holding at its old size — the very failure this parameter exists to end.
    //
    // `Object.hasOwn`, because PRESENCE HAS TO MEAN OWN. `derive.ts` builds its
    // map with `Object.create(null)` for this reason and explains it there, but
    // that guards the PRODUCER only: this function indexes whatever a caller
    // hands it. An asset id of `toString` passes `assetRowSchema`
    // (`z.string().min(1)`), so a plain object answers that key with a Function
    // off the prototype — and `positionValue(fn, price)` is NaN, filled into
    // the draft as a fetched number.
    const fromLedger = Object.hasOwn(units, asset.id) ? units[asset.id] : undefined;
    const held = fromLedger ?? link.units;
    // A NON-POSITIVE COUNT IS NOT A VALUATION. A sold-out position sums to 0 and
    // a mistyped `sell` can sum negative; either used to reach `positionValue`
    // and be written into the draft as "0,00", which `quoteInputSchema` then
    // rejected for being non-positive — so the row SHOWED a fetched number, the
    // progress pill did not count it, and Save quietly omitted the asset. No
    // error anywhere. It joins the no-count case instead: nothing is offered.
    if (held !== undefined && held <= 0) {
      linked.push({ asset, quote, noValue: held < 0 ? 'negative' : 'no-position' });
      continue;
    }
    // THREE STATES, NOT TWO, since D117 removed the form's Units field: the
    // ledger knows, the legacy link total knows, or NOBODY does — a link made
    // after that date carries no count and its asset has no quantities recorded
    // yet. The third gets a match with no `value`, and the fetch offers nothing
    // for that row rather than inventing a figure from a count it does not have.
    // Valuing it at 0 would be worse than silence: 0 is a real answer, and it is
    // the one a sold-out position gives.
    linked.push({
      asset,
      quote,
      // `no-count` NAMES THE THIRD STATE. It used to push a match with no
      // `value` and no reason either, so `reconcileFetched` skipped it in
      // silence: the fetch reported success, every other row filled, and this
      // one stayed empty forever with nothing said. Before D117 the state was
      // unreachable — the form required units, so a link always carried a count.
      ...(held === undefined
        ? { noValue: 'no-count' as const }
        : {
            value: positionValue(held, quote.sellUAH),
            units: held,
            unitsFrom: fromLedger === undefined ? ('link' as const) : ('ledger' as const),
          }),
    });
  }

  return { linked, unmatched };
}
