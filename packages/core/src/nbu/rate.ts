// The National Bank’s official exchange rate, PURE half — no fetch, no clock, no
// storage. The network half is `src/hooks/useNbuRate.ts`.
//
//   GET https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange
//       ?valcode=usd&date=YYYYMMDD&json
//
// Endpoint behaviour a caller cannot discover from the code:
//
//   * EVERY FAILURE IS AN HTTP 200 — a future date or unknown currency returns
//     `[]`, a malformed date returns a body that is not JSON at all. No status to
//     branch on, so this parser takes raw TEXT and must never throw.
//   * WEEKENDS AND HOLIDAYS DO NOT 404 and are not empty: NBU carries the previous
//     banking day forward while `exchangedate` echoes the date REQUESTED.
//   * ALWAYS SEND AN EXPLICIT `date=` — omitting it returns whatever NBU considers
//     current, which in the afternoon is already TOMORROW’s rate.

import { z } from 'zod';

import { nbuDateToIso } from './date';

export interface NbuRate {
  /** Hryvnia per one unit of `currency`. */
  rate: number;
  /** ISO date the rate APPLIES to — NBU echoes the requested date here. */
  date: string;
  currency: string;
}

/**
 * PICK, never `strictObject` — the directory carries `r030`, `txt` and `special`
 * too, and a third-party payload that gains a field must not start failing.
 */
const entrySchema = z.object({
  rate: z.number().finite().positive(),
  cc: z.string().min(1),
  exchangedate: z.string(),
});

/**
 * Takes BODY TEXT rather than parsed JSON on purpose: one error response is not
 * JSON, so the `JSON.parse` has to live inside the tolerant boundary rather than
 * in the caller, where it would throw. `undefined` for every "no answer" the
 * endpoint has — the caller degrades to its stored value, never a zero or a NaN.
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
    // Per-entry skip, never all-or-nothing: one malformed row must not discard a
    // good one beside it.
    const parsed = entrySchema.safeParse(item);
    if (!parsed.success) continue;
    if (parsed.data.cc.toUpperCase() !== wanted) continue;
    const date = nbuDateToIso(parsed.data.exchangedate);
    if (date === undefined) continue;
    return { rate: parsed.data.rate, date, currency: parsed.data.cc.toUpperCase() };
  }
  return undefined;
}

/** NBU wants `YYYYMMDD`. Built here so the explicit-date rule sits in the same
 *  file as the note explaining why omitting it is wrong. */
export function nbuRateUrl(date: string, currency = 'usd'): string {
  const compact = date.replaceAll('-', '');
  return (
    'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange' +
    `?valcode=${currency.toLowerCase()}&date=${compact}&json`
  );
}
