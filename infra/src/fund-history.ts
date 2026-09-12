// The provider's published fund price history, workbook to rows. Pure, for the
// reason `observation-rows.ts` gives: everything decidable from the file alone
// lives here and is tested; the DB half stays in `capture.ts`.
import { addDays } from '../../src/core/dates';
import type { XlsxCell, XlsxWorkbook } from './xlsx';

/** Stored per row, so a row derived by this parser is never mistaken for one
 *  the feed parser (`PARSER_VERSION`) wrote. */
export const FUND_HISTORY_PARSER_VERSION = 'fund-history-1';

/**
 * Where each fund's current price file is linked from. [External sources]:
 * the file name carries a content hash, so the link is re-read from the offer
 * page on every run and no file URL is ever polled.
 */
export const FUND_HISTORY_PAGES: Readonly<Record<string, string>> = {
  'inzhur-reit': 'https://www.inzhur.reit/offer/inzhur-reit',
  'inzhur-energy': 'https://www.inzhur.reit/offer/inzhur-energy',
};

export interface FundHistoryRow {
  ref: string;
  asOf: string;
  price: number;
}

function decodeHref(href: string): string {
  return href.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) =>
    e === 'amp' ? '&' : e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : "'",
  );
}

/**
 * The one price-file link on an offer page. The page also links a dividend
 * file, which is a payment series and not this import's; the price file is
 * the one whose name says `czina`. Anything but exactly one such link is a
 * changed page, and a changed page is refused rather than guessed at.
 */
export function priceFileLink(html: string): string {
  const seen = [...html.matchAll(/href="([^"]+\.xlsx(?:\?[^"]*)?)"/g)].map((m) => decodeHref(m[1]));
  const price = [...new Set(seen.filter((url) => url.split('?')[0].includes('czina')))];
  if (price.length === 0) {
    throw new Error(
      `fund-history: no price file link on the page; .xlsx links seen: ${seen.join(', ') || 'none'}`,
    );
  }
  if (price.length > 1) {
    throw new Error(`fund-history: ${price.length} price files on the page: ${price.join(', ')}`);
  }
  return price[0];
}

/**
 * Excel counts days from 1899-12-30; a fraction would be a time of day.
 * Serials below 61 are refused: Excel counts a 1900-02-29 that never was, so
 * the epoch is only right from 1900-03-01, and nothing this file holds is
 * older than that anyway.
 */
export function excelSerialToIso(serial: number): string {
  if (!Number.isInteger(serial)) {
    throw new Error(`fund-history: date serial ${serial} is not a whole day`);
  }
  if (serial < 61) throw new Error(`fund-history: serial ${serial} is not a date`);
  return addDays('1899-12-30', serial);
}

/**
 * The provider's text spelling of a price: a comma before the fraction, with
 * the integer part either ungrouped or grouped in threes by a space or a
 * no-break space. Exactly those shapes and nothing else, because a cast that
 * reads `6.234,82` or `6234.82` as some number is a wrong price, not a
 * missing one.
 */
export function parseUkrainianDecimal(text: string, at?: string): number {
  if (!/^(?:\d+|\d{1,3}(?:[ \u00A0]\d{3})+)(?:,\d+)?$/.test(text)) {
    throw new Error(`fund-history: unreadable price "${text}"${at ? ` at ${at}` : ''}`);
  }
  return Number(text.replace(/[ \u00A0]/g, '').replace(',', '.'));
}

const DATE_CAPTION = 'Дата';
const PRICE_CAPTIONS = new Set(['Вартість ВЧА 1 ЦП, грн', 'Вартість 1 ЦП, грн']);

function caption(cell: XlsxCell | undefined): string | undefined {
  return cell?.s?.replace(/\s+/g, ' ').trim();
}

/**
 * Every dated line of every sheet as a `nav` observation, sorted by date.
 *
 * Columns are found by caption, never by position: the two files caption the
 * price differently and nothing says a future cut keeps the order. A line is
 * skipped only when it has neither date nor price (the styled empty rows a
 * sheet ends with); half a line, a date that is not a serial, a price that is
 * neither a number nor the provider's text spelling, a date outside the year
 * its sheet is named for, and a date seen twice are each refused by address,
 * because `ON CONFLICT DO NOTHING` would hide the last one and a count would
 * then lie.
 */
export function fundHistoryRows(ref: string, workbook: XlsxWorkbook): FundHistoryRow[] {
  const out: FundHistoryRow[] = [];
  const seen = new Map<string, string>();
  for (const sheet of workbook.sheets) {
    const columns = [...(sheet.rows.get(1) ?? [])].map(
      ([column, cell]) => [column, caption(cell)] as const,
    );
    const dateColumn = columns.find(([, c]) => c === DATE_CAPTION)?.[0];
    const priceColumn = columns.find(([, c]) => c !== undefined && PRICE_CAPTIONS.has(c))?.[0];
    if (dateColumn === undefined || priceColumn === undefined) {
      const headers = columns.map(([, c]) => c ?? '').join(' · ');
      throw new Error(
        `fund-history: sheet "${sheet.name}" has no ${dateColumn === undefined ? 'date' : 'price'} column; headers: ${headers}`,
      );
    }
    for (const [row, cells] of sheet.rows) {
      if (row === 1) continue;
      const date = cells.get(dateColumn);
      const price = cells.get(priceColumn);
      if (date === undefined && price === undefined) continue;
      const at = (column: string) => `${sheet.name}!${column}${row}`;
      if (date === undefined)
        throw new Error(`fund-history: price without a date at ${at(dateColumn)}`);
      if (price === undefined)
        throw new Error(`fund-history: date without a price at ${at(priceColumn)}`);
      if (date.n === undefined)
        throw new Error(`fund-history: date is not a serial at ${at(dateColumn)}`);
      const asOf = excelSerialToIso(date.n);
      if (/^\d{4}$/.test(sheet.name) && !asOf.startsWith(sheet.name)) {
        throw new Error(`fund-history: ${asOf} on sheet "${sheet.name}" at ${at(dateColumn)}`);
      }
      const value = price.n ?? parseUkrainianDecimal(price.s ?? '', at(priceColumn));
      if (!(value > 0)) {
        throw new Error(`fund-history: price ${value} is not positive at ${at(priceColumn)}`);
      }
      const earlier = seen.get(asOf);
      if (earlier !== undefined) {
        throw new Error(`fund-history: ${asOf} twice, on sheets "${earlier}" and "${sheet.name}"`);
      }
      seen.set(asOf, sheet.name);
      out.push({ ref, asOf, price: value });
    }
  }
  return out.sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0));
}
