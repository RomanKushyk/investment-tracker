// The NBU’s daily fair-value file for Ukrainian government bonds. Pure, and in
// core rather than `infra/` because the backend and any future reader must agree
// what a row MEANS — two parsers eventually disagree about a price.
//
// Постанова Правління НБУ № 732 (26.10.2015), published at
// `https://bank.gov.ua/files/Fair_value/{YYYYMM}/{YYYYMMDD}_fv.txt`. A MODEL
// valuation, NOT a quote — which is why `source` is in the observation key and it
// is never merged with a dealer price.

import { nbuDateToIso } from './date';

/** Fields absent in older layouts are `undefined`, NEVER guessed — an invented
 *  value is worse than a missing one. */
export interface NbuFairValueRow {
  /** The file’s own claim about which day it is for, which the caller should check
   *  against the date it asked for. */
  calcDate: string;
  isin: string;
  /** Denomination currency of the instrument. NOT a valuation dimension: the ₴/$
   *  toggle is a serve-time conversion. */
  currency: string;
  fairValue: number;
  ytm: number | undefined;
  /** Price excluding accrued interest, percent of par. */
  cleanRate: number | undefined;
  maturity: string | undefined;
  /** `ОВДП` / `ОВМП`. Absent before 2022 — see `cptypeOf`. */
  cpType: string | undefined;
}

function num(value: string | undefined): number | undefined {
  const t = value?.trim();
  if (t === undefined || t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The instrument type is the LAST field, AT AN INDEX THAT MOVES: the file has had
 * four layouts and the type is not at a fixed offset in any two of them.
 *
 * Identified by SHAPE, and it needs BOTH conditions. It must sit past the base
 * layout, or the narrowest file reports its `maturity` as an instrument type; and
 * it must not parse as a number, because every padding field in the wider layouts
 * is zero. Together they survive a fifth layout; either alone does not.
 */
const NBU_BASE_FIELDS = 8;

function cptypeOf(fields: string[]): string | undefined {
  if (fields.length <= NBU_BASE_FIELDS) return undefined;
  const last = fields[fields.length - 1]?.trim();
  if (last === undefined || last === '') return undefined;
  return Number.isFinite(Number(last)) ? undefined : last;
}

/**
 * PARSE BY FIXED INDEX, never by zipping the header against the row: the header
 * is malformed — its last field is literally `g_spread,z_spread,cptype`, three
 * comma-separated names in one semicolon-separated field — so zipping mislabels
 * the tail and invents columns the data does not have.
 *
 * Per-entry skip: one malformed line must not cost a whole day of history,
 * because the provider will not republish it.
 */
export function parseNbuFairValue(body: string): NbuFairValueRow[] {
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== '');
  const rows: NbuFairValueRow[] = [];
  // Header identified by CONTENT rather than position, so a body that has somehow
  // lost its header does not lose its first instrument.
  const data = lines[0]?.startsWith('calc_date') === true ? lines.slice(1) : lines;
  for (const line of data) {
    const f = line.split(';');
    const calcDate = nbuDateToIso(f[0]);
    const isin = f[1]?.trim();
    const fairValue = num(f[3]);
    // The three that make a row meaningful: without any one it cannot become an
    // observation, so it is skipped rather than half-stored.
    if (calcDate === undefined || isin === undefined || isin === '' || fairValue === undefined) {
      continue;
    }
    rows.push({
      calcDate,
      isin,
      currency: f[2]?.trim() ?? '',
      fairValue,
      ytm: num(f[4]),
      cleanRate: num(f[5]),
      maturity: nbuDateToIso(f[7]),
      cpType: cptypeOf(f),
    });
  }
  return rows;
}
