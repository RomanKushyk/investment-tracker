// The provider's published fund price history, workbook to rows. Pure: everything decidable from
// the file alone lives here and is tested, and the DB half stays in `capture.ts`.
import { addDays } from '@quirenote/core/dates';
import type { XlsxCell, XlsxWorkbook } from './xlsx';

/** Stored per row, so a row derived by this parser is never mistaken for one the feed parser
 *  (`PARSER_VERSION`) wrote. */
export const FUND_HISTORY_PARSER_VERSION = 'fund-history-1';

/** Each fund's document category in the provider's CMS, the list its offer page renders its
 *  documents from. Held fixed rather than discovered, so an id the CMS no longer answers throws
 *  instead of importing from a guessed link (*External sources*). */
export const FUND_HISTORY_CATEGORIES: Readonly<Record<string, number>> = {
  'inzhur-reit': 19,
  'inzhur-energy': 18,
};

/** The request the offer page's documents section sends, as its `qs.stringify(…,
 *  { encodeValuesOnly: true })` spells it. Each upload's URL carries a random suffix, so this list
 *  is re-read on every run and no file URL is ever polled. */
export function documentListUrl(category: number): string {
  return (
    'https://api.inzhur.reit/cms/api/general-document-categories' +
    `?filters[id]=${category}` +
    '&populate[documents][populate][documents][fields][0]=date' +
    '&populate[documents][populate][documents][populate][file][populate]=%2A' +
    '&populate[documents][populate][documents][sort][0]=date%3ADESC' +
    '&populate[fund][fields][0]=licenses'
  );
}

export interface FundHistoryRow {
  ref: string;
  asOf: string;
  price: number;
}

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;

/** Every file URL the category lists, down Strapi 4's nesting. An entry with no file is skipped;
 *  any other departure throws, because a changed shape or id must not yield a guessed link. */
function listedFiles(body: string, category: number): string[] {
  const refuse = (why: string) =>
    new Error(`fund-history: category ${category} is not the expected document list: ${why}`);
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw refuse('not JSON');
  }
  const categories = field(json, 'data');
  if (!Array.isArray(categories)) throw refuse('no data array');
  if (categories.length !== 1) throw refuse(`${categories.length} categories`);
  const id = field(categories[0], 'id');
  if (id !== category) throw refuse(`it answered category ${String(id)}`);
  const documents = field(field(field(categories[0], 'attributes'), 'documents'), 'data');
  if (!Array.isArray(documents)) throw refuse('no documents');
  return documents.flatMap((document, d) => {
    const entries = field(field(document, 'attributes'), 'documents');
    if (!Array.isArray(entries)) throw refuse(`document ${d} has no entries`);
    return entries.flatMap((entry, e) => {
      const file = field(field(entry, 'file'), 'data');
      if (file === null) return [];
      const url = field(field(file, 'attributes'), 'url');
      if (typeof url !== 'string') throw refuse(`document ${d} entry ${e} has no file url`);
      return [url];
    });
  });
}

/** The category also lists a dividend file, which is a payment series and not this import's; the
 *  price file is the one whose name says `czina`. */
export function priceFileLink(body: string, category: number): string {
  const seen = listedFiles(body, category).filter((url) => url.split('?')[0].endsWith('.xlsx'));
  const price = [...new Set(seen.filter((url) => url.split('?')[0].includes('czina')))];
  if (price.length === 0) {
    throw new Error(
      `fund-history: no price file in category ${category}; .xlsx files listed: ${seen.join(', ') || 'none'}`,
    );
  }
  if (price.length > 1) {
    throw new Error(
      `fund-history: ${price.length} price files in category ${category}: ${price.join(', ')}`,
    );
  }
  return price[0];
}

/** Excel counts days from 1899-12-30. Serials below 61 are refused: Excel counts a 1900-02-29
 *  that never was, so the epoch is only right from 1900-03-01. */
export function excelSerialToIso(serial: number): string {
  if (!Number.isInteger(serial)) {
    throw new Error(`fund-history: date serial ${serial} is not a whole day`);
  }
  if (serial < 61) throw new Error(`fund-history: serial ${serial} is not a date`);
  return addDays('1899-12-30', serial);
}

/** A comma before the fraction, the integer part ungrouped or grouped in threes by a space or a
 *  no-break space. Exactly those shapes, because a cast that reads `6.234,82` or `6234.82` as
 *  some number gives a wrong price rather than a missing one. */
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

/** Columns are found by CAPTION, never by position: the two files caption the price differently
 *  and nothing says a future cut keeps the order. A line is skipped only when it has NEITHER date
 *  nor price, which is the styled empty row a sheet ends with; every OTHER anomaly is refused by
 *  address rather than absorbed, because `ON CONFLICT DO NOTHING` would hide it and a count would
 *  then lie. */
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
