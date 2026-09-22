// The Inzhur public feed (GET https://www.inzhur.reit/_api/assets), PURE half;
// the network half is `src/hooks/useInzhurAssets.ts`. *The price archive*
//
// TOLERANCE IS THE CONTRACT: the payload is third-party and WILL drift, so every
// schema PICKS the fields we need and ignores the rest (never `strictObject`),
// and a per-entry failure SKIPS that entry rather than killing the parse.
import { z } from 'zod';

import { kyivDateIso } from '../dates';
// IMPORTED, NOT MIRRORED: the coupon rate and the ₴ derived from it agree BY
// CONSTRUCTION, and two copies of the divisor is how that stops being true.
import { OVDP_FACE_UAH, PAYMENTS_PER_YEAR } from '../ovdp';
import { normalizeRef } from './ref';
import type { Asset, PayoutSchedule } from '../types';

/** The feed publishes bond payment amounts in integer kopecks per bond. */
export const KOPECKS_PER_UAH = 100;
/** Kyiv calendar dates; ₴ per unit, converted from the feed’s kopecks. */
export interface InzhurPayment {
  date: string;
  amount: number;
}

export interface InzhurReturnRates {
  buy?: number;
  sell?: number;
}

export interface InzhurQuote {
  kind: 'fund' | 'bond';
  /** Fund slug ('inzhur-reit') or bond ISIN ('UA4000238976'), as published. */
  ref: string;
  /** The feed’s own display title, whitespace-collapsed. Absent when the feed
   *  omits it; bonds carry a generic title and are labeled by ISIN. */
  title?: string;
  sellUAH: number;
  buyUAH?: number;
  navUAH?: number;
  maturity?: string;
  paymentSchedule: InzhurPayment[];
  /**
   * The feed’s bond price is a discounted cash flow over `paymentSchedule` whose
   * ONLY free parameter is this rate — the one field that lets a stored price be
   * re-derived or checked for a silent yield revision.
   */
  returnRates?: InzhurReturnRates;
  /**
   * VERBATIM, and NEVER filtered on: a completed bond the user still holds must
   * keep matching. Worth capturing because it flips WITHOUT the price moving.
   */
  status?: string;
}

/**
 * One entry the parse could not read, and WHY — a bare list of refs says an asset
 * vanished, not that `prices.sellUAH` was renamed. Tokens, never English.
 */
export interface SkippedEntry {
  ref: string;
  /**
   * `not_an_array` — the payload was not a list, so nothing else can be said.
   * `shape` — validation failed; `fields` names what.
   * `no_ref` — it validated but carries neither ISIN nor slug.
   */
  reason: 'not_an_array' | 'shape' | 'no_ref';
  fields?: string[];
}

export interface ParsedFeed {
  entries: InzhurQuote[];
  skipped: SkippedEntry[];
}

// Rounded ONCE, at creation, to kopecks: about to be shown and saved as an amount.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** THE one conversion place in the app. Nothing else divides feed amounts by 100. */
export function kopecksToUah(kopecks: number): number {
  return round2(kopecks / KOPECKS_PER_UAH);
}

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
  // Kopecks arrive as a STRING in every live entry; a number is accepted if that drifts.
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
  paymentSchedule: z.array(z.unknown()).optional(),
  returnRates: z.unknown().optional(),
});

const entrySchema = z.object({
  slug: z.string().optional(),
  title: z.string().optional(),
  status: z.string().optional(),
  assetDetails: detailsSchema,
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// `paymentSchedule` dates are instants at MIDNIGHT KYIV, so they must be read in
// Kyiv time or they land a day early and contradict `maturityDate`.
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

// A present but non-finite rate is dropped, so no consumer guards against NaN.
function pickRates(raw: unknown): InzhurReturnRates | undefined {
  const parsed = ratesSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const buy = Number.isFinite(parsed.data.buy) ? parsed.data.buy : undefined;
  const sell = Number.isFinite(parsed.data.sell) ? parsed.data.sell : undefined;
  if (buy === undefined && sell === undefined) return undefined;
  return { ...(buy === undefined ? {} : { buy }), ...(sell === undefined ? {} : { sell }) };
}

function pickTitle(raw: string | undefined): string | undefined {
  const title = raw?.replace(/\s+/g, ' ').trim() ?? '';
  return title === '' ? undefined : title;
}

function labelOf(raw: unknown, index: number): string {
  const entry = raw as { slug?: unknown; assetDetails?: { isin?: unknown } } | null;
  const isin = entry?.assetDetails?.isin;
  if (typeof isin === 'string' && isin.trim() !== '') return isin.trim();
  if (typeof entry?.slug === 'string' && entry.slug.trim() !== '') return entry.slug.trim();
  return `#${index}`;
}

export function parseAssetsFeed(payload: unknown): ParsedFeed {
  if (!Array.isArray(payload)) {
    return { entries: [], skipped: [{ ref: '(root)', reason: 'not_an_array' }] };
  }

  const entries: InzhurQuote[] = [];
  const skipped: SkippedEntry[] = [];

  payload.forEach((raw, index) => {
    const parsed = entrySchema.safeParse(raw);
    if (!parsed.success) {
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
    // Funds are keyed by slug, bonds by ISIN — ISIN PRESENCE IS THE KIND.
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
 * A maturity date carries the final coupon AND the principal; the SMALLER row is
 * the coupon, and the tie-break is explicit so callers never depend on array
 * order. `scheduleFacts` inherits it, which is what keeps the two agreeing.
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
  perUnit: number;
  amount: number;
}

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
 * What the provider’s schedule already says, so a person is not asked. NOT
 * DECORATIVE: `nextCoupon` anchors the coupon grid and the payout projection,
 * `maturity` stops the ghost accrual, `payoutSchedule` is `couponPerPayment`’s
 * divisor.
 */
export interface ScheduleFacts {
  maturity?: string;
  nextCoupon?: string;
  payoutSchedule?: PayoutSchedule;
  /**
   * Annual coupon RATE, percent — `perUnitCoupon ÷ 5` on the ₴1000 nominal
   * (`docs/reference/OVDP-COUPON-STRUCTURE.md`), and the field most expensive to
   * get wrong: it multiplies every coupon figure, with nothing to cross-check.
   */
  couponRatePct?: number;
}

/**
 * The most frequent value, `undefined` when nothing repeats — two payments of two
 * amounts state no recurring coupon, so that gets no rate rather than a coin
 * flip. Ties break toward the LARGER, among values that already repeat.
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
 * BANDS, NOT EQUALITY: the bonds pay every 182 days and one measured bond carries
 * a one-day shift, which matching 182 exactly would misread. ONE DATE MEANS
 * `maturity`. OUTSIDE THE BANDS RETURNS `undefined` — an annual bond has no member
 * in this enum, and guessing puts a wrong divisor into every coupon figure.
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
  const gap = gaps[Math.floor(gaps.length / 2)];
  if (gap < 45) return 'monthly';
  if (gap < 135) return 'quarterly';
  if (gap < 250) return 'semiannual';
  return undefined;
}

export function scheduleFacts(quote: InzhurQuote, fromIso: string): ScheduleFacts {
  const dates = [...new Set(quote.paymentSchedule.map((p) => p.date))].sort();
  const next = nextPaymentOnOrAfter(quote.paymentSchedule, fromIso);
  const cadence = cadenceOf(dates);
  // ONLY FROM A CADENCE WE READ — deriving against an assumed 2 would be the guess
  // `cadenceOf` refuses to make.
  const perYear = cadence === undefined ? undefined : PAYMENTS_PER_YEAR[cadence];
  const coupons = quote.paymentSchedule.filter((p) => p.amount !== OVDP_FACE_UAH);
  // THE RECURRING COUPON, NOT THE SMALLEST ONE. `Math.min` is wrong for a bond
  // issued mid-period: its first coupon is a short STUB, and taking it as the rate
  // halves every coupon figure. The MODE is the honest reading — the value that
  // repeats is the contract, whatever sits beside it.
  const perUnit = modeOf(coupons.map((p) => p.amount));
  // BOUNDED THE WAY THE FORM IS BOUNDED: `optionalPercentFor` refuses anything past
  // (0, 100], so a bond whose principal row is not exactly ₴1000 would derive a
  // rate above 100 and leave the field red for an error the user did not cause.
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
  /** units × sellUAH, ABSENT when no count is known — the asset still MATCHED, so
   *  it belongs in `linked`; there is simply nothing to offer. */
  value?: number;
  units?: number;
  /**
   * `no-position` — EXACTLY zero, covering a sold-out holding and a date before
   * the first purchase alike. `negative` — below zero, which no holding can be,
   * so it is a data error that must be reported; folding it into `no-position`
   * made a real defect look like an empty day.
   */
  noValue?: 'no-position' | 'negative' | 'no-count';
  /**
   * Not equally trustworthy: `ledger` is Σ quantity, correct by construction,
   * while `link` is one hand-typed total no purchase updates. NOT YET SURFACED —
   * nothing outside the tests reads it, so the stale-total case is invisible.
   */
  unitsFrom?: 'ledger' | 'link';
}

export interface MatchedAssets {
  linked: InzhurMatch[];
  unmatched: Asset[];
}

// The kind IS part of the key, because it selects which half of the feed the ref
// is looked for in. `sameInstrument` excludes it — see `ref.ts`.
function matchKey(kind: 'fund' | 'bond', ref: string): string {
  return `${kind}:${normalizeRef(ref)}`;
}

/**
 * Do these two links name the same feed ENTRY? THE one answer. KIND-SENSITIVE,
 * unlike `sameInstrument`; `ref.ts` holds the normalization so four call sites
 * cannot drift.
 */
export function sameRef(
  a: { kind: 'fund' | 'bond'; ref: string },
  b: { kind: 'fund' | 'bond'; ref: string },
): boolean {
  return matchKey(a.kind, a.ref) === matchKey(b.kind, b.ref);
}

/**
 * The empty units record. `Object.create(null)`, NOT `{}`, for the reason on
 * `unitsByAsset`’s map in `derive.ts`. EXPORTED so there is ONE of it, and FROZEN
 * because one of it is also one point of corruption — a caller writing back into
 * the record it was given would poison every other reader.
 */
export const NO_UNITS: Readonly<Record<string, number>> = Object.freeze(
  Object.create(null) as Record<string, number>,
);

/** Assets without a link appear in neither list — they are not part of a fetch. */
export function matchAssets(
  assets: Asset[],
  feed: ParsedFeed,
  // A PARAMETER rather than a field on the asset because core never reads the
  // store, and it cannot answer for transactions predating `Transaction.quantity`.
  // Then, and only then, the stale link total is the best number available.
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
    // PRESENCE decides, never truthiness — a sold position sums to 0, which `||`
    // would read as no answer. And it HAS TO MEAN OWN: `toString` is a legal asset
    // id, so a plain object answers that key with a Function, and NaN follows.
    const fromLedger = Object.hasOwn(units, asset.id) ? units[asset.id] : undefined;
    const held = fromLedger ?? link.units;
    // A NON-POSITIVE COUNT IS NOT A VALUATION: either reaching `positionValue` writes
    // "0,00" into the draft, which the amount schema rejects — so the row SHOWED a
    // fetched number and Save quietly omitted the asset, with no error anywhere.
    if (held !== undefined && held <= 0) {
      linked.push({ asset, quote, noValue: held < 0 ? 'negative' : 'no-position' });
      continue;
    }
    // THREE STATES, NOT TWO: the ledger knows, the legacy link total knows, or NOBODY
    // does. Valuing the third at 0 would be worse than silence — 0 is a real answer,
    // and it is the one a sold-out position gives. `no-count` NAMES it, so
    // `reconcileFetched` cannot skip the row in silence.
    linked.push({
      asset,
      quote,
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
