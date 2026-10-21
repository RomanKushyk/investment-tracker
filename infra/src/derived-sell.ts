// `sell` for days before the first capture, divided out of the owner's tracker: an imputation,
// never a measurement (*The price archive*). Pure; the DB half is in `capture.ts`.
import { addDays } from '@quirenote/core/dates';
import { caption, excelSerialToIso, FUND_HISTORY_PARSER_VERSION } from './fund-history';
import type { XlsxCell, XlsxSheet, XlsxWorkbook } from './xlsx';

/** Stored per row, so a reader tells this import apart from `1`, `2` and `fund-history-1`. A
 *  change to `DERIVED_SELL_RUNS` is a new version. */
export const DERIVED_SELL_PARSER_VERSION = 'derived-sell-2';

/** Any version of this import, so a later one never takes an earlier one's rows as evidence. */
export const isDerivedSell = (parserVersion: string) => parserVersion.startsWith('derived-sell-');

/** Written from `from` to the day before the next holding, or to the span's end; its divisor holds
 *  from the change that opened it, and the last one's up to the next change. */
export interface Holding {
  from: string;
  divisor: number;
  /** Written with no observed quote to check it, by the owner's ruling: named, never assumed. */
  unchecked?: true;
}

export interface DerivedSellRun {
  /** As the archive stores it: ISINs upper-case, slugs lower-case. */
  ref: string;
  /** The tracker's `Актив` caption. */
  asset: string;
  /** A fund's quote has four decimals and a bond's two, which sets what a quotient may be. */
  kind: 'fund' | 'bond';
  /** In date order; each after the first opens on a position change. */
  holdings: readonly Holding[];
  /** Days that are not a holding at a quote: never written and never evidence. */
  exclude: readonly string[];
}

/** Each excluded day is no holding at the observed quote: a hand entry, a cell past kopecks, or a
 *  quote a kopeck off. */
export const DERIVED_SELL_RUNS: readonly DerivedSellRun[] = [
  {
    ref: 'inzhur-energy',
    asset: 'Inzhur Energy',
    kind: 'fund',
    holdings: [{ from: '2026-05-08', divisor: 9 }],
    // 06-27 is the off-quote day `fund-history.local.test.ts` names.
    exclude: ['2026-06-27', '2026-10-08'],
  },
  {
    ref: 'UA4000238976',
    asset: 'ОВДП UA4000238976',
    kind: 'bond',
    holdings: [{ from: '2026-05-21', divisor: 15 }],
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
    holdings: [{ from: '2026-04-23', divisor: 4 }],
    exclude: ['2026-05-23', '2026-09-26', '2026-10-18', '2026-10-19'],
  },
  {
    ref: 'inzhur-reit',
    asset: 'Inzhur REIT',
    kind: 'fund',
    // The owner ruled the unchecked holdings written with no observed quote to check them.
    holdings: [
      { from: '2026-04-23', divisor: 4404, unchecked: true },
      { from: '2026-05-08', divisor: 5164 },
      { from: '2026-05-11', divisor: 5194 },
      { from: '2026-07-02', divisor: 6128, unchecked: true },
      { from: '2026-07-13', divisor: 6164 },
      { from: '2026-08-10', divisor: 6207 },
    ],
    exclude: ['2026-08-10', '2026-08-20', '2026-09-02'],
  },
];

/** The divisor of the holding that covers `asOf` in `ref`'s run, so a stored row is judged by the
 *  holding that wrote it. */
export function divisorOn(ref: string, asOf: string): number | undefined {
  return holdingOn(ref, asOf)?.divisor;
}

/** The holding in `ref`'s run that covers `asOf`; none before its first holding. */
function holdingOn(ref: string, asOf: string): Holding | undefined {
  const holdings = DERIVED_SELL_RUNS.find((r) => r.ref === ref)?.holdings ?? [];
  return holdings[holdingIndex(holdings, asOf)];
}

/** The holding that covers `day`, -1 before the first; the plan also gives the first holding the
 *  days from its opening change. */
function holdingIndex(holdings: readonly Holding[], day: string): number {
  return holdings.findLastIndex((h) => h.from <= day);
}

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

export interface HoldingReport {
  from: string;
  to: string;
  divisor: number;
  rows: number;
  /** Observed days, copied or captured, the divisor was checked on. */
  checked: number;
  unchecked: boolean;
}

/** What a run reports. No money figure: the report is posted and the tracker is private. */
export interface DerivedSellReport {
  ref: string;
  exclude: readonly string[];
  /** The span written, `from`..`to`, and its row count. */
  from: string;
  to: string;
  rows: number;
  holdings: HoldingReport[];
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

/** An archive row on a key an import also quotes, its price as the numeric prints it. */
export interface ArchivedRow {
  asOf: string;
  ref: string;
  basis: string;
  price: string;
  parserVersion: string;
}

/** A derived row is a kopeck value over its divisor, rounded again: it agrees within half a kopeck
 *  over the divisor plus half a ten-thousandth. Any other row agrees to the stored digit. */
export function agrees(existing: ArchivedRow, price: number): boolean {
  const held = scaled(existing.price);
  const served = scaled(String(price));
  if (held === undefined || served === undefined) return false;
  const delta = Math.abs(held - served);
  if (existing.parserVersion === FUND_HISTORY_PARSER_VERSION) return delta === 0;
  if (isDerivedSell(existing.parserVersion)) {
    const divisor = divisorOn(existing.ref, existing.asOf);
    if (divisor !== undefined) return 2 * delta * divisor <= 100 + divisor;
  }
  return delta === 0;
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
 * `captureStart` is the source's first capture in this archive; the span ends the day before it.
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
  const to = addDays(captureStart, -1);

  const refusals: string[] = [];
  const rows: DerivedSellRow[] = [];
  const reports: DerivedSellReport[] = [];

  for (const run of runs) {
    const refuse = (why: string) => refusals.push(`${run.ref}: ${why}`);
    const before = refusals.length;
    const excluded = new Set(run.exclude);
    const holdings = run.holdings;
    const ends = holdings.map((_, i) =>
      i + 1 < holdings.length ? addDays(holdings[i + 1].from, -1) : to,
    );
    const label = (i: number) => `from ${holdings[i].from} ÷${holdings[i].divisor}`;
    const refuseIn = (i: number, why: string) => refusals.push(`${run.ref} ${label(i)}: ${why}`);
    if (holdings.length === 0 || holdings.some((h, i) => i > 0 && h.from <= holdings[i - 1].from)) {
      refuse('holdings are not in date order');
      continue;
    }
    const start = holdings[0].from;
    // A day from the first holding's opening change to its `from` is its too.
    const holdingOf = (day: string) => Math.max(0, holdingIndex(holdings, day));
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

    // A divisor holds between two position changes, a change showing in its own day's value: the
    // first holding opens on or after one, every later holding on one, and none falls inside.
    if (start > to) refuse(`start ${start} is not before the capture start ${captureStart}`);
    if (!changes.some((d) => d <= start))
      refuse(`no purchase or reinvestment on or before ${start}`);
    holdings.forEach((h, i) => {
      if (i > 0 && h.from > to) refuseIn(i, `opens on or after the capture start ${captureStart}`);
      if (i > 0 && !changes.includes(h.from)) refuseIn(i, 'no position change opens it');
      const inside = changes.filter((d) => d > h.from && d <= ends[i]);
      if (inside.length > 0) refuseIn(i, `position change on ${inside.join(', ')} inside it`);
    });

    // Rows this import wrote are compared below and never checked against. The rest is evidence:
    // copied from a third party before the capture start, captured from it on.
    const all = archive.get(run.ref) ?? [];
    const evidence = all
      .filter((r) => !isDerivedSell(r.parserVersion))
      .sort((a, b) => (a.asOf < b.asOf ? -1 : 1));
    const captured = evidence.filter((r) => r.asOf >= captureStart);
    const observed = evidence.filter((r) => r.asOf < captureStart);
    if (captured.length === 0) {
      refuse('no captured sell to check against');
      continue;
    }
    // A ref the first captures skipped may have payloads for those days, and an imputed row there
    // would keep a replay's measured one out.
    if (captured[0].asOf > captureStart) {
      refuse(
        `first captured sell on ${captured[0].asOf} is after the capture start ${captureStart}`,
      );
    }
    const next = changes.find((d) => d > to);
    // The first holding's checks reach back to the change that opened it.
    const opened = changes.filter((d) => d <= start).at(-1) ?? start;
    const checks = [
      ...observed.filter((r) => r.asOf >= opened),
      ...captured.filter((r) => next === undefined || r.asOf < next),
    ];
    const checkDays = new Set(checks.map((r) => r.asOf));
    const observedDays = new Set(observed.map((r) => r.asOf));

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
      if (!((asOf >= start && asOf <= to) || checkDays.has(asOf))) continue;
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

    // Each holding is checked against the evidence inside it; the last one also against the
    // captured era, up to the next position change.
    const checked = holdings.map(() => 0);
    const missed = holdings.map(() => ({ observed: [] as string[], captured: [] as string[] }));
    for (const sell of checks) {
      const value = values.get(sell.asOf);
      if (value === undefined) continue;
      const i = holdingOf(sell.asOf);
      const price = scaled(sell.price);
      if (price === undefined) {
        refuse(`unreadable sell on ${sell.asOf}`);
        continue;
      }
      checked[i] += 1;
      if (Math.abs(value.kopecks * 100 - holdings[i].divisor * price) > TOLERANCE) {
        missed[i][sell.asOf < captureStart ? 'observed' : 'captured'].push(sell.asOf);
      }
    }
    holdings.forEach((h, i) => {
      const misses = (['observed', 'captured'] as const)
        .filter((kind) => missed[i][kind].length > 0)
        .map((kind) => `the ${kind} sell on ${missed[i][kind].join(', ')}`);
      if (misses.length > 0) refuseIn(i, `does not reproduce ${misses.join('; ')}`);
      if (checked[i] === 0 && h.unchecked !== true) refuseIn(i, 'no observed sell checks it');
      // A ruling for a holding no quote reached goes stale once one does.
      if (checked[i] > 0 && h.unchecked === true) {
        refuseIn(i, 'is marked unchecked but an observed sell checks it');
      }
    });

    const offQuote: string[] = [];
    const written: DerivedSellRow[] = [];
    const perHolding = holdings.map(() => 0);
    for (const asOf of [...values.keys()].sort()) {
      // An observed day keeps its observation, never an imputation beside it.
      if (asOf < start || asOf > to || observedDays.has(asOf)) continue;
      const { kopecks } = values.get(asOf)!;
      const i = holdingOf(asOf);
      const divisor = holdings[i].divisor;
      let price: string;
      if (run.kind === 'bond') {
        // A bond quote ends at kopecks, so a quotient past them is no holding at any quote.
        if (kopecks % divisor !== 0) {
          offQuote.push(asOf);
          continue;
        }
        price = fixed(kopecks / divisor, 2);
      } else {
        // Half away from zero at four decimals, the feed's own precision (NIST SP 811 B.7.2).
        price = fixed(Math.floor((2 * kopecks * 100 + divisor) / (2 * divisor)), 4);
      }
      perHolding[i] += 1;
      written.push({ ref: run.ref, asOf, price });
    }
    if (offQuote.length > 0) refuse(`not a two-decimal quote on ${offQuote.join(', ')}`);
    if (written.length === 0) refuse(`nothing to write from ${start} to ${to}`);

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
      exclude: run.exclude,
      from: written[0].asOf,
      to: written[written.length - 1].asOf,
      rows: written.length,
      holdings: holdings.map((h, i) => ({
        from: h.from,
        to: ends[i],
        divisor: h.divisor,
        rows: perHolding[i],
        checked: checked[i],
        unchecked: h.unchecked === true,
      })),
      collapsed: [...collapsed].sort(),
    });
  }

  if (refusals.length > 0) throw new Error(`derived-sell refused:\n${refusals.join('\n')}`);
  return { rows, reports };
}
