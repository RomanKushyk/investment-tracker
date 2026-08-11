// The NBU's daily fair-value file for Ukrainian government bonds, parsed into
// rows. Pure: no fetch, no clock, no storage.
//
// Lives in core rather than in `infra/` because the backend and any future
// reader must agree about what a row MEANS. Two parsers eventually disagree
// about a price and only one of them is tested.
//
// Published under Постанова Правління НБУ № 732 (26.10.2015) at
// `https://bank.gov.ua/files/Fair_value/{YYYYMM}/{YYYYMMDD}_fv.txt`, archived
// back to 2016-01-04. It is a MODEL valuation, not a quote — measured ~0.9%
// apart from the provider's dealer price on the same ISIN the same day, which is
// why `source` is in the observation key and the two are never merged.

/** One instrument's row. Fields absent in older layouts are `undefined`, never
 *  guessed — an invented value is worse than a missing one. */
export interface NbuFairValueRow {
  /** `calc_date`, normalised to ISO. The file's own claim about which day it is
   *  for, which the caller should check against the date it asked for. */
  calcDate: string;
  /** `cpcode` — the ISIN, and the instrument ref for bonds (D30). */
  isin: string;
  /** Denomination currency of the instrument itself, e.g. `UAH`. NOT a
   *  valuation dimension: the ₴/$ toggle is a serve-time conversion (D31). */
  currency: string;
  /** `fair_value` — the number this whole file exists for. */
  fairValue: number;
  /** `ytm` — yield to maturity, percent. */
  ytm: number | undefined;
  /** `clean_rate` — price excluding accrued interest, percent of par. */
  cleanRate: number | undefined;
  /** ISO. Absent from no layout seen so far, but treated as optional because a
   *  future one may drop it. */
  maturity: string | undefined;
  /** `ОВДП` / `ОВМП`. Absent before 2022 — see `cptypeOf`. */
  cpType: string | undefined;
}

/**
 * `dd.MM.yyyy` -> `yyyy-MM-dd`. The file uses the Ukrainian civil format
 * throughout, and reading it as ISO silently transposes day and month for every
 * date in the first twelve days of a month — a corruption that looks like valid
 * data.
 */
function isoDate(value: string | undefined): string | undefined {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value?.trim() ?? '');
  if (m === null) return undefined;
  const [, dd, mm, yyyy] = m;
  const iso = `${yyyy}-${mm}-${dd}`;
  // Rejects 31.02: the regex only proves the shape, not that the day exists.
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? undefined : iso;
}

function num(value: string | undefined): number | undefined {
  const t = value?.trim();
  if (t === undefined || t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The instrument type, which is the LAST field — at an index that moves.
 *
 * Measured across the archive: the file has had **four** layouts, and the type
 * is not at a fixed offset in any two of them.
 *
 * | Layout | Fields | `cptype` |
 * |---|---|---|
 * | 2016 | 8 | absent |
 * | 2018 | 16 | absent |
 * | 2022 | 17 | index **16** |
 * | 2024–2026 | 18 | index **17** |
 *
 * So reading index 17 — which is what "17 cptype" in the original index map
 * means if taken literally — yields `undefined` for every file of 2022 and
 * silently mislabels nothing else, which is why it went unnoticed.
 *
 * Identified by SHAPE instead, with two conditions rather than one:
 *
 * 1. it sits at index >= 8, i.e. past the base layout. Without this the 8-field
 *    file reports its `maturity` as an instrument type, because `10.05.2016` is
 *    a trailing field that is not a number. A test caught exactly that.
 * 2. it does not parse as a number. Every padding field in the wider layouts is
 *    `0` or `0.0`, so this separates a real type from padding.
 *
 * Both together survive a fifth layout; either alone does not.
 */
const NBU_BASE_FIELDS = 8;

function cptypeOf(fields: string[]): string | undefined {
  if (fields.length <= NBU_BASE_FIELDS) return undefined;
  const last = fields[fields.length - 1]?.trim();
  if (last === undefined || last === '') return undefined;
  return Number.isFinite(Number(last)) ? undefined : last;
}

/**
 * Parse the file body into rows, skipping any line that cannot be trusted.
 *
 * PARSE BY FIXED INDEX, never by zipping the header against the row. The header
 * is malformed: its last field is literally `g_spread,z_spread,cptype` — three
 * comma-separated names in one semicolon-separated field — so zipping mislabels
 * the tail and invents two columns that the data does not have.
 *
 * Index map, verified against live files from 2016, 2018, 2022, 2024 and 2026:
 * 0 `calc_date` · 1 `cpcode` · 2 `ccy` · 3 `fair_value` · 4 `ytm` ·
 * 5 `clean_rate` · 7 `maturity`. Fields 0–5 and 7 are identical in all four
 * layouts; only the tail moved.
 *
 * Per-entry skip, never all-or-nothing — the same rule as the Inzhur parser. A
 * single malformed line must not cost a whole day of history, because the
 * provider will not republish it.
 */
export function parseNbuFairValue(body: string): NbuFairValueRow[] {
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== '');
  const rows: NbuFairValueRow[] = [];
  // Drop the header row. Identified by content rather than position so that a
  // body which has somehow lost its header does not lose its first instrument.
  const data = lines[0]?.startsWith('calc_date') === true ? lines.slice(1) : lines;
  for (const line of data) {
    const f = line.split(';');
    const calcDate = isoDate(f[0]);
    const isin = f[1]?.trim();
    const fairValue = num(f[3]);
    // The three that make a row meaningful. Without any one of them the row
    // cannot become an observation, so it is skipped rather than half-stored.
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
      maturity: isoDate(f[7]),
      cpType: cptypeOf(f),
    });
  }
  return rows;
}
