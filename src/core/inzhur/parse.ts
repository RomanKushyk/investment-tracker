// The Inzhur public feed (GET https://www.inzhur.reit/_api/assets), PURE half:
// a tolerant pick-parse plus portfolio matching. Policy, endpoint constraints
// and the kopecks unit are recorded in docs/decisions/README.md D19; the network half
// is src/hooks/useInzhurAssets.ts (core never fetches, G1).
//
// TOLERANCE IS THE CONTRACT: the payload is third-party and WILL drift, so
// every schema here PICKS the few fields we need and IGNORES everything else
// (never strictObject), and a per-entry failure skips that entry instead of
// killing the parse. Fixture of the live shape (2026-07-28):
// __fixtures__/assets-sample.json.
import { z } from 'zod';

import { kyivDateIso } from '../dates';
import type { Asset } from '../types';

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

export interface ParsedFeed {
  entries: InzhurQuote[];
  /** Refs (or '#index' / '(root)') of everything the parse could not read. */
  skipped: string[];
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
  if (!Array.isArray(payload)) return { entries: [], skipped: ['(root)'] };

  const entries: InzhurQuote[] = [];
  const skipped: string[] = [];

  payload.forEach((raw, index) => {
    const parsed = entrySchema.safeParse(raw);
    if (!parsed.success) {
      skipped.push(labelOf(raw, index));
      return;
    }
    const { slug, title, status, assetDetails: details } = parsed.data;
    const isin = details.isin?.trim() ?? '';
    // Funds are keyed by slug, bonds by ISIN — ISIN presence IS the kind (no
    // live fund carries one, and every live bond does).
    const ref = isin !== '' ? isin : (slug?.trim() ?? '');
    if (ref === '') {
      skipped.push(labelOf(raw, index));
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

export interface InzhurMatch {
  asset: Asset;
  quote: InzhurQuote;
  /** units × sellUAH — the value the fetch offers for this row. */
  value: number;
}

export interface MatchedAssets {
  linked: InzhurMatch[];
  /** Linked assets whose ref is absent from the feed. */
  unmatched: Asset[];
}

// Refs are compared trimmed + lower-cased: ISINs are published upper-case but
// may be typed either way, slugs are lower-case by convention.
function matchKey(kind: 'fund' | 'bond', ref: string): string {
  return `${kind}:${ref.trim().toLowerCase()}`;
}

/**
 * Split the portfolio's Inzhur-LINKED assets against a parsed feed. Assets
 * without a link appear in neither list — they are not part of a fetch.
 */
export function matchAssets(assets: Asset[], feed: ParsedFeed): MatchedAssets {
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
    linked.push({ asset, quote, value: positionValue(link.units, quote.sellUAH) });
  }

  return { linked, unmatched };
}
