// `sell` for days before the first capture, divided out of the owner's tracker: an imputation,
// never a measurement (*The price archive*). Pure; the DB half is in `capture.ts`.
import { addDays } from '@quirenote/core/dates';
import { caption, excelSerialToIso } from './fund-history';
import type { XlsxCell, XlsxSheet, XlsxWorkbook } from './xlsx';

/** Stored per row, so a reader tells this import apart from `1`, `2` and `fund-history-1`. A
 *  change to `DERIVED_SELL_RUNS` is a new version. */
export const DERIVED_SELL_PARSER_VERSION = 'derived-sell-1';

/** Any version of this import, so a later one never takes an earlier one's rows as evidence. */
export const isDerivedSell = (parserVersion: string) => parserVersion.startsWith('derived-sell-');

export interface DerivedSellRun {
  /** As the archive stores it: ISINs upper-case, slugs lower-case. */
  ref: string;
  /** The tracker's `Актив` caption. */
  asset: string;
  /** A fund's quote has four decimals and a bond's two, which sets what a quotient may be. */
  kind: 'fund' | 'bond';
  /** Units held from `start` on. */
  divisor: number;
  start: string;
  /** Days that are not a holding at a quote: never written and never evidence. */
  exclude: readonly string[];
}

/** Each start is the ref's last position change before the first capture. Each excluded day is no
 *  holding at the captured quote: a hand entry, a cell past kopecks, or a quote a kopeck off. */
export const DERIVED_SELL_RUNS: readonly DerivedSellRun[] = [
  {
    ref: 'inzhur-energy',
    asset: 'Inzhur Energy',
    kind: 'fund',
    divisor: 9,
    start: '2026-05-08',
    // 06-27 is the off-quote day `fund-history.local.test.ts` names.
    exclude: ['2026-06-27', '2026-10-08'],
  },
  {
    ref: 'UA4000238976',
    asset: 'ОВДП UA4000238976',
    kind: 'bond',
    divisor: 15,
    start: '2026-05-21',
    exclude: [
      '2026-05-23',
      '2026-08-06',
      '2026-09-05',
      '2026-09-06',
      '2026-09-26',
      '2026-10-03',
      '2026-10-11',
    ],
  },
  {
    ref: 'UA4000236475',
    asset: 'ОВДП UA4000236475',
    kind: 'bond',
    divisor: 4,
    start: '2026-04-23',
    exclude: ['2026-05-23', '2026-09-26', '2026-10-18', '2026-10-19'],
  },
];

/** An archived `inzhur` `sell` row, its price as the archive's numeric prints it. */
export interface ArchiveSell {
  asOf: string;
  price: string;
  parserVersion: string;
}

export interface DerivedSellRow {
  ref: string;
  asOf: string;
  /** Fixed-point text, so the numeric column stores exactly these digits. */
  price: string;
}

/** What a run reports. No money figure: the report is posted and the tracker is private. */
export interface DerivedSellReport {
  ref: string;
  divisor: number;
  start: string;
  exclude: readonly string[];
  /** The span written, `from`..`to`, and its row count. */
  from: string;
  to: string;
  rows: number;
  /** Overlap days the divisor was checked on. */
  checked: number;
  /** Dates the tracker repeats with an equal value, each read once. */
  collapsed: string[];
}

/** Moves the position, on its own date. Every other type on a run's asset is refused. */
const POSITION_TYPES = new Set(['Купівля', 'Реінвест']);
const CASH_TYPES = new Set([
  'Поповнення рахунку',
  'Виплата відсотків',
  'Нарахування дивідендів',
  'Податок',
]);

const QUOTES_SHEET = 'Котирування';
const OPERATIONS_SHEET = 'Транзакції';

/** Ten-thousandths of a hryvnia, the finest a fund quote carries. */
const SCALE = 10_000;
/** `|value − divisor × sell| ≤ 0.005`: half a kopeck, the tracker's own rounding. */
const TOLERANCE = 50;

function sheetOf(workbook: XlsxWorkbook, name: string): XlsxSheet {
  const sheet = workbook.sheets.find((s) => s.name === name);
  if (!sheet) throw new Error(`derived-sell: no sheet "${name}"`);
  return sheet;
}

/** Columns by caption, never by position, as `fundHistoryRows` finds them. */
function columnsOf(sheet: XlsxSheet, captions: string[]): string[] {
  const header = [...(sheet.rows.get(1) ?? [])].map(([column, cell]) => [column, caption(cell)]);
  return captions.map((wanted) => {
    const column = header.find(([, c]) => c === wanted)?.[0];
    if (column === undefined) {
      throw new Error(`derived-sell: sheet "${sheet.name}" has no "${wanted}" column`);
    }
    return column;
  });
}

/** A price as an integer count of `SCALE`, from its text and never through a float. */
export function scaled(text: string): number | undefined {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  const fraction = (match?.[2] ?? '').replace(/0+$/, '');
  if (!match || fraction.length > 4) return undefined;
  return Number(match[1]) * SCALE + Number(fraction.padEnd(4, '0'));
}

const fixed = (units: number, decimals: number) => {
  const per = 10 ** decimals;
  return `${Math.floor(units / per)}.${String(units % per).padStart(decimals, '0')}`;
};

interface Value {
  kopecks: number;
  at: string;
}

/**
 * Every run's rows and report, or every refusal of every run in one throw: a run that writes two
 * refs of three is the outcome to avoid. A refusal names dates and cell addresses, never a value.
 * `captureStart` is the source's first capture in this archive.
 */
export function derivedSellPlan(
  workbook: XlsxWorkbook,
  archive: ReadonlyMap<string, readonly ArchiveSell[]>,
  captureStart: string,
  runs: readonly DerivedSellRun[] = DERIVED_SELL_RUNS,
): { rows: DerivedSellRow[]; reports: DerivedSellReport[] } {
  const quotes = sheetOf(workbook, QUOTES_SHEET);
  const [qDate, qAsset, qValue] = columnsOf(quotes, ['Дата зрізу', 'Актив', 'Поточна ціна']);
  const operations = sheetOf(workbook, OPERATIONS_SHEET);
  const [oDate, oAsset, oType] = columnsOf(operations, ['Дата', 'Актив', 'Тип операції']);

  const refusals: string[] = [];
  const rows: DerivedSellRow[] = [];
  const reports: DerivedSellReport[] = [];

  for (const run of runs) {
    const refuse = (why: string) => refusals.push(`${run.ref} ÷${run.divisor}: ${why}`);
    const before = refusals.length;
    const excluded = new Set(run.exclude);
    const dateAt = (cell: XlsxCell | undefined, at: string) => {
      try {
        if (cell?.n !== undefined) return excelSerialToIso(cell.n);
      } catch {
        // A fractional or pre-1900 serial: refused below, by address.
      }
      refuse(`no whole-day date at ${at}`);
      return undefined;
    };

    const changes: string[] = [];
    for (const [row, cells] of operations.rows) {
      if (row === 1 || caption(cells.get(oAsset)) !== run.asset) continue;
      const at = (column: string) => `${operations.name}!${column}${row}`;
      const type = caption(cells.get(oType)) ?? '';
      if (POSITION_TYPES.has(type)) {
        const asOf = dateAt(cells.get(oDate), at(oDate));
        if (asOf !== undefined) changes.push(asOf);
      } else if (!CASH_TYPES.has(type)) refuse(`unknown operation type at ${at(oType)}`);
    }
    changes.sort();

    // Only captured rows are evidence; this import's own are compared below, never checked against.
    const all = archive.get(run.ref) ?? [];
    const captured = all
      .filter((r) => !isDerivedSell(r.parserVersion))
      .sort((a, b) => (a.asOf < b.asOf ? -1 : 1));
    if (captured.length === 0) {
      refuse('no captured sell to check the divisor against');
      continue;
    }
    // A ref the first captures skipped may have payloads for those days, and an imputed row there
    // would keep a replay's measured one out.
    if (captured[0].asOf > captureStart) {
      refuse(
        `first captured sell on ${captured[0].asOf} is after the capture start ${captureStart}`,
      );
    }
    const to = addDays(captured[0].asOf, -1);
    if (run.start > to) refuse(`start ${run.start} is not before the first capture`);
    // The holding the divisor names runs from the last change on or before the span's end to the
    // next one; a change on its own date already shows in that day's value.
    const last = changes.filter((d) => d <= to).at(-1);
    if (last === undefined) refuse(`no purchase or reinvestment on or before ${to}`);
    else if (run.start < last)
      refuse(`start ${run.start} is before the position change on ${last}`);
    const next = changes.find((d) => d > to);
    const overlap = captured.filter((r) => next === undefined || r.asOf < next);
    const overlapDays = new Set(overlap.map((r) => r.asOf));

    // Only the days written or checked are read: a cell outside them decides nothing. A date
    // repeated with an equal value hides nothing, so it is read once; a different value is two
    // claims about one day, and neither is chosen.
    const values = new Map<string, Value>();
    const collapsed = new Set<string>();
    const met = new Set<string>();
    for (const [row, cells] of quotes.rows) {
      if (row === 1 || caption(cells.get(qAsset)) !== run.asset) continue;
      const at = (column: string) => `${quotes.name}!${column}${row}`;
      const asOf = dateAt(cells.get(qDate), at(qDate));
      if (asOf === undefined) continue;
      if (excluded.has(asOf)) {
        met.add(asOf);
        continue;
      }
      if (!((asOf >= run.start && asOf <= to) || overlapDays.has(asOf))) continue;
      const n = cells.get(qValue)?.n;
      const kopecks = n === undefined ? NaN : Math.round(n * 100);
      if (n === undefined || !(n > 0) || Math.abs(n * 100 - kopecks) > 1e-6) {
        refuse(`no kopeck value at ${at(qValue)}`);
        continue;
      }
      const earlier = values.get(asOf);
      if (earlier === undefined) values.set(asOf, { kopecks, at: at(qValue) });
      else if (earlier.kopecks === kopecks) collapsed.add(asOf);
      else refuse(`${asOf} twice with different values, at ${earlier.at} and ${at(qValue)}`);
    }

    const missed: string[] = [];
    let checked = 0;
    for (const sell of overlap) {
      const value = values.get(sell.asOf);
      if (value === undefined) continue;
      const price = scaled(sell.price);
      if (price === undefined) {
        refuse(`unreadable captured sell on ${sell.asOf}`);
        continue;
      }
      checked += 1;
      if (Math.abs(value.kopecks * 100 - run.divisor * price) > TOLERANCE) missed.push(sell.asOf);
    }
    if (missed.length > 0) refuse(`does not reproduce the captured sell on ${missed.join(', ')}`);
    if (checked === 0) refuse('no overlap day checks the divisor');

    const offQuote: string[] = [];
    const written: DerivedSellRow[] = [];
    for (const asOf of [...values.keys()].sort()) {
      if (asOf < run.start || asOf > to) continue;
      const { kopecks } = values.get(asOf)!;
      let price: string;
      if (run.kind === 'bond') {
        // A bond quote ends at kopecks, so a quotient past them is no holding at any quote.
        if (kopecks % run.divisor !== 0) {
          offQuote.push(asOf);
          continue;
        }
        price = fixed(kopecks / run.divisor, 2);
      } else {
        // Half away from zero at four decimals, the feed's own precision (NIST SP 811 B.7.2).
        price = fixed(Math.floor((2 * kopecks * 100 + run.divisor) / (2 * run.divisor)), 4);
      }
      written.push({ ref: run.ref, asOf, price });
    }
    if (offQuote.length > 0) refuse(`not a two-decimal quote on ${offQuote.join(', ')}`);
    if (written.length === 0) refuse(`nothing to write from ${run.start} to ${to}`);

    const unheld = run.exclude.filter((d) => !met.has(d));
    if (unheld.length > 0) refuse(`excludes days the tracker does not hold: ${unheld.join(', ')}`);

    // `ON CONFLICT DO NOTHING` would keep an earlier run's row unseen, and no code deletes one, so
    // a day stored at another price, or stored and no longer written, refuses.
    const stored = new Map(
      all.filter((r) => isDerivedSell(r.parserVersion)).map((r) => [r.asOf, r]),
    );
    const planned = new Map(written.map((w) => [w.asOf, w]));
    const changed = written.filter((w) => {
      const s = stored.get(w.asOf);
      return s !== undefined && scaled(s.price) !== scaled(w.price);
    });
    if (changed.length > 0) {
      refuse(`already derived at another price on ${changed.map((w) => w.asOf).join(', ')}`);
    }
    const orphaned = [...stored.keys()].filter((d) => !planned.has(d)).sort();
    if (orphaned.length > 0) {
      refuse(`already derived on ${orphaned.join(', ')}, which this run does not write`);
    }

    if (refusals.length > before) continue;
    rows.push(...written);
    reports.push({
      ref: run.ref,
      divisor: run.divisor,
      start: run.start,
      exclude: run.exclude,
      from: written[0].asOf,
      to: written[written.length - 1].asOf,
      rows: written.length,
      checked,
      collapsed: [...collapsed].sort(),
    });
  }

  if (refusals.length > 0) throw new Error(`derived-sell refused:\n${refusals.join('\n')}`);
  return { rows, reports };
}
