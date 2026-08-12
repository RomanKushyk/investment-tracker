// The National Bank's official exchange rate, PURE half — no fetch, no clock,
// no storage (G1). The network half is `src/hooks/useNbuRate.ts`.
//
//   GET https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange
//       ?valcode=usd&date=YYYYMMDD&json
//
// Public, `Access-Control-Allow-Origin: *`, so the browser calls it directly.
// This is a user-triggered request, the same shape as "Fetch quotes" — the
// "exactly one automation" ruling constrains TIMERS, not requests.
//
// MEASURED 2026-08-12, and two of these were assumptions worth checking:
//
//   * **Every failure is an HTTP 200.** A future date and an unknown currency
//     both return `[]`. A malformed date returns `[{ Wrong date format }]`,
//     which is not valid JSON at all and throws on parse. There is no status
//     code to branch on, so this parser takes the raw TEXT and is responsible
//     for never throwing.
//   * **Weekends and holidays do not 404 and are not empty.** NBU carries the
//     previous banking day forward: 2026-08-07 (Fri), 08 (Sat) and 09 (Sun) all
//     returned 44.7626. `exchangedate` echoes the date that was REQUESTED, so
//     the response never admits the value was carried. That is not a lie to
//     pass on — the official rate for a Sunday genuinely is Friday's — so this
//     module reports the date the rate applies to and makes no freshness claim
//     it cannot support.
//
// **Always send an explicit `date=`.** Omitting it returns whatever NBU
// considers current, which in the afternoon is already TOMORROW's rate — a
// silent off-by-one on every converted figure the user sees.

import { z } from 'zod';

import { nbuDateToIso } from './date';

/** One published rate. */
export interface NbuRate {
  /** Hryvnia per one unit of `currency`. */
  rate: number;
  /** ISO date the rate APPLIES to — NBU echoes the requested date here. */
  date: string;
  /** ISO-4217 code as published, e.g. `USD`. */
  currency: string;
}

/**
 * PICK, never `strictObject` — the directory carries `r030`, `txt` and
 * `special` too, and a third-party payload that gains a field must not start
 * failing. Same contract as the Inzhur parser (D19).
 */
const entrySchema = z.object({
  rate: z.number().finite().positive(),
  cc: z.string().min(1),
  exchangedate: z.string(),
});

/**
 * Parse the response BODY TEXT into the rate for `currency`.
 *
 * Takes text rather than parsed JSON on purpose: one of the endpoint's error
 * responses is not JSON, so the `JSON.parse` has to live inside the tolerant
 * boundary rather than in the caller where it would throw.
 *
 * Returns `undefined` for every "no answer" the endpoint has: an empty array, a
 * body that is not JSON, an entry missing the fields that make it meaningful,
 * or a payload that simply does not carry the currency asked for. The caller
 * degrades to its stored value — it never sees a zero or a NaN.
 */
export function parseNbuRate(body: string, currency = 'USD'): NbuRate | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return undefined; // `[{ Wrong date format }]` — a 200 that is not JSON
  }
  if (!Array.isArray(raw)) return undefined;

  const wanted = currency.toUpperCase();
  for (const item of raw) {
    // Per-entry skip, never all-or-nothing: one malformed row must not discard
    // a good one beside it.
    const parsed = entrySchema.safeParse(item);
    if (!parsed.success) continue;
    if (parsed.data.cc.toUpperCase() !== wanted) continue;
    const date = nbuDateToIso(parsed.data.exchangedate);
    if (date === undefined) continue;
    return { rate: parsed.data.rate, date, currency: parsed.data.cc.toUpperCase() };
  }
  return undefined;
}

/**
 * The request URL for one date.
 *
 * `date` is an ISO day; NBU wants `YYYYMMDD`. Building it here rather than at
 * the call site keeps the explicit-date rule in the same file as the comment
 * explaining why omitting it is wrong.
 */
export function nbuRateUrl(date: string, currency = 'usd'): string {
  const compact = date.replaceAll('-', '');
  return (
    'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange' +
    `?valcode=${currency.toLowerCase()}&date=${compact}&json`
  );
}
