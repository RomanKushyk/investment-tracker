import { describe, expect, it } from 'vitest';

import { addDays } from '@quirenote/core/dates';
import {
  DERIVED_SELL_RUNS,
  derivedSellPlan as planFrom,
  type ArchiveSell,
  type DerivedSellRun,
} from './derived-sell';
import type { XlsxCell, XlsxWorkbook } from './xlsx';

/** Every fixture's archive starts capturing here, as the deployed one does. */
const CAPTURE_START = '2026-08-11';
const derivedSellPlan = (
  workbook: XlsxWorkbook,
  archive: ReadonlyMap<string, readonly ArchiveSell[]>,
  runs: readonly DerivedSellRun[],
) => planFrom(workbook, archive, CAPTURE_START, runs);

/** Days since Excel's 1899-12-30 epoch, the serial a tracker's date cell carries. */
const serial = (iso: string) => (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 864e5;

type Quote = [date: string, asset: string, value: number];
type Operation = [date: string, asset: string, type: string];

/** The purchase each test holding starts from. */
const BOUGHT: Operation[] = [
  ['2026-08-08', 'ОВДП UA4000236475', 'Купівля'],
  ['2026-08-08', 'Inzhur Energy', 'Купівля'],
];

/** A tracker with only the two sheets the import reads, captioned as the owner's is. */
function tracker(quotes: Quote[], operations: Operation[] = BOUGHT): XlsxWorkbook {
  const sheet = (name: string, captions: string[], lines: XlsxCell[][]) => {
    const rows = new Map<number, Map<string, XlsxCell>>();
    [captions.map((s) => ({ s })), ...lines].forEach((line, i) =>
      rows.set(i + 1, new Map(line.map((cell, c) => [String.fromCharCode(65 + c), cell]))),
    );
    return { name, rows };
  };
  return {
    sheets: [
      sheet(
        'Котирування',
        ['Дата зрізу', 'Актив', 'Поточна ціна'],
        quotes.map(([d, a, v]) => [{ n: serial(d) }, { s: a }, { n: v }]),
      ),
      sheet(
        'Транзакції',
        ['Дата', 'Актив', 'Тип операції', 'Джерело коштів', 'Сума', 'Коментар'],
        operations.map(([d, a, t]) => [{ n: serial(d) }, { s: a }, { s: t }]),
      ),
    ],
  };
}

const BOND: DerivedSellRun = {
  ref: 'UA4000236475',
  asset: 'ОВДП UA4000236475',
  kind: 'bond',
  divisor: 4,
  start: '2026-08-08',
  exclude: [],
};

const FUND: DerivedSellRun = {
  ref: 'inzhur-energy',
  asset: 'Inzhur Energy',
  kind: 'fund',
  divisor: 9,
  start: '2026-08-08',
  exclude: [],
};

const captured = (
  ref: string,
  rows: [string, string][],
  parserVersion = '1',
): Map<string, ArchiveSell[]> =>
  new Map([[ref, rows.map(([asOf, price]) => ({ asOf, price, parserVersion }))]]);

/** The message a plan refuses with, or a failure when it does not refuse. */
function refusal(run: () => unknown): string {
  try {
    run();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected a refusal');
}

/** A bond held at ÷4 from 08-08, priced 1050.00 + 0.10 a day, captured from 08-11. */
const bondDays = (to = '2026-08-14'): Quote[] => {
  const out: Quote[] = [];
  for (let d = '2026-08-08', i = 0; d <= to; d = addDays(d, 1), i += 1) {
    out.push([d, BOND.asset, 4 * (1050 + i / 10)]);
  }
  return out;
};
const bondArchive = (from = '2026-08-11', to = '2026-08-14') => {
  const out: [string, string][] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const i = (Date.parse(d) - Date.parse('2026-08-08')) / 864e5;
    out.push([d, (1050 + i / 10).toFixed(2)]);
  }
  return captured(BOND.ref, out);
};

describe('derivedSellPlan, the overlap check', () => {
  it('refuses a divisor that misses the captured sell, naming the days and no figure', () => {
    const quotes: Quote[] = [
      ['2026-08-08', BOND.asset, 4200],
      ['2026-08-09', BOND.asset, 4200.4],
      ['2026-08-10', BOND.asset, 4200.8],
      ['2026-08-11', BOND.asset, 4201.2],
      ['2026-08-12', BOND.asset, 4201.61],
      ['2026-08-13', BOND.asset, 4202],
      ['2026-08-14', BOND.asset, 4202.41],
    ];
    const archive = captured(BOND.ref, [
      ['2026-08-11', '1050.30'],
      ['2026-08-12', '1050.40'],
      ['2026-08-13', '1050.50'],
      ['2026-08-14', '1050.60'],
    ]);
    const message = refusal(() => derivedSellPlan(tracker(quotes), archive, [BOND]));
    expect(message).toMatch(/UA4000236475.*÷4.*2026-08-12, 2026-08-14/);
    expect(message).not.toMatch(/4201|1050/);
  });

  it('holds a fund to half a kopeck, inclusive, on both sides', () => {
    // 9 × 5837.0050 = 52533.0450: a kopeck value either side is exactly 0.005 away.
    const archive = captured(FUND.ref, [['2026-08-11', '5837.0050']]);
    const at = (value: number) =>
      tracker([
        [FUND.start, FUND.asset, 52000],
        ['2026-08-11', FUND.asset, value],
      ]);
    expect(() => derivedSellPlan(at(52533.04), archive, [FUND])).not.toThrow();
    expect(() => derivedSellPlan(at(52533.05), archive, [FUND])).not.toThrow();
    expect(refusal(() => derivedSellPlan(at(52533.06), archive, [FUND]))).toMatch(
      /does not reproduce the captured sell on 2026-08-11/,
    );
  });

  it('does not check an excluded overlap day, and reports it', () => {
    const quotes = bondDays().map(([d, a, v]): Quote => [d, a, d === '2026-08-12' ? v + 0.01 : v]);
    const run = { ...BOND, exclude: ['2026-08-12'] };
    const { reports } = derivedSellPlan(tracker(quotes), bondArchive(), [run]);
    expect(reports[0]).toMatchObject({ checked: 3, exclude: ['2026-08-12'] });
  });

  it('refuses a ref no overlap day checks', () => {
    const quotes = bondDays('2026-08-10');
    expect(refusal(() => derivedSellPlan(tracker(quotes), bondArchive(), [BOND]))).toMatch(
      /UA4000236475 ÷4: no overlap day checks the divisor/,
    );
  });

  it('refuses a ref with no captured sell at all', () => {
    expect(refusal(() => derivedSellPlan(tracker(bondDays()), new Map(), [BOND]))).toMatch(
      /no captured sell/,
    );
  });
});

describe('derivedSellPlan, the holding a divisor names', () => {
  it('refuses a start before the last purchase or reinvestment the span holds', () => {
    for (const type of ['Купівля', 'Реінвест']) {
      const ops: Operation[] = [['2026-08-09', BOND.asset, type]];
      expect(
        refusal(() => derivedSellPlan(tracker(bondDays(), ops), bondArchive(), [BOND])),
      ).toMatch(/start 2026-08-08 is before the position change on 2026-08-09/);
    }
  });

  it('takes a purchase on the start day, whose value already holds it', () => {
    const ops: Operation[] = [['2026-08-08', BOND.asset, 'Купівля']];
    expect(() => derivedSellPlan(tracker(bondDays(), ops), bondArchive(), [BOND])).not.toThrow();
  });

  it('stops the overlap check at a later purchase, which no written day depends on', () => {
    // From 08-13 the holding is five, so 4 × sell no longer describes the value.
    const quotes = bondDays().map(([d, a, v]): Quote => [
      d,
      a,
      d >= '2026-08-13' ? (v / 4) * 5 : v,
    ]);
    const ops: Operation[] = [BOUGHT[0], ['2026-08-13', BOND.asset, 'Купівля']];
    const { reports } = derivedSellPlan(tracker(quotes, ops), bondArchive(), [BOND]);
    expect(reports[0]).toMatchObject({ checked: 2, from: '2026-08-08', to: '2026-08-10' });
  });

  it('reads cash-only operations as no position change, and refuses any other type by address', () => {
    const cash: Operation[] = [
      BOUGHT[0],
      ['2026-08-09', BOND.asset, 'Виплата відсотків'],
      ['2026-08-09', BOND.asset, 'Податок'],
      ['2026-08-09', BOND.asset, 'Нарахування дивідендів'],
      ['2026-08-09', BOND.asset, 'Поповнення рахунку'],
      ['2026-08-09', 'Inzhur REIT', 'Продаж'],
    ];
    expect(() => derivedSellPlan(tracker(bondDays(), cash), bondArchive(), [BOND])).not.toThrow();
    const sale: Operation[] = [...cash, ['2026-08-09', BOND.asset, 'Продаж']];
    expect(
      refusal(() => derivedSellPlan(tracker(bondDays(), sale), bondArchive(), [BOND])),
    ).toMatch(/unknown operation type at Транзакції!C8/);
  });
});

describe('derivedSellPlan, the rows', () => {
  it('writes from the start to the day before the first captured sell, and no overlap day', () => {
    const quotes: Quote[] = [['2026-08-07', BOND.asset, 4199.6], ...bondDays()];
    const { rows, reports } = derivedSellPlan(tracker(quotes), bondArchive(), [BOND]);
    expect(rows).toEqual([
      { ref: BOND.ref, asOf: '2026-08-08', price: '1050.00' },
      { ref: BOND.ref, asOf: '2026-08-09', price: '1050.10' },
      { ref: BOND.ref, asOf: '2026-08-10', price: '1050.20' },
    ]);
    expect(reports[0]).toMatchObject({ from: '2026-08-08', to: '2026-08-10', rows: 3, checked: 4 });
  });

  it('refuses a start on or after the first capture, which leaves it nothing to write', () => {
    const run = { ...BOND, start: '2026-08-11' };
    expect(refusal(() => derivedSellPlan(tracker(bondDays()), bondArchive(), [run]))).toBe(
      'derived-sell refused:\n' +
        'UA4000236475 ÷4: start 2026-08-11 is not before the first capture\n' +
        'UA4000236475 ÷4: nothing to write from 2026-08-11 to 2026-08-10',
    );
  });

  it('refuses a bond day whose quotient does not end at two decimals, by date', () => {
    const quotes = bondDays().map(([d, a, v]): Quote => [d, a, d === '2026-08-09' ? v + 0.01 : v]);
    expect(refusal(() => derivedSellPlan(tracker(quotes), bondArchive(), [BOND]))).toMatch(
      /UA4000236475 ÷4: not a two-decimal quote on 2026-08-09$/,
    );
  });

  it('neither writes nor checks an excluded bond day, and reports it', () => {
    const quotes = bondDays().map(([d, a, v]): Quote => [d, a, d === '2026-08-09' ? v + 0.01 : v]);
    const run = { ...BOND, exclude: ['2026-08-09'] };
    const { rows, reports } = derivedSellPlan(tracker(quotes), bondArchive(), [run]);
    expect(rows.map((r) => r.asOf)).toEqual(['2026-08-08', '2026-08-10']);
    expect(reports[0]).toMatchObject({ exclude: ['2026-08-09'], rows: 2 });
  });

  it('stores a fund quotient at four decimals, half away from zero', () => {
    // ÷8 is the one divisor here with a four-decimal tie: 100.01 ÷ 8 = 12.50125.
    const run: DerivedSellRun = { ...FUND, divisor: 8, start: '2026-08-09' };
    const quotes: Quote[] = [
      ['2026-08-09', FUND.asset, 100.01],
      ['2026-08-10', FUND.asset, 1000.06],
      ['2026-08-11', FUND.asset, 1000.1],
    ];
    const archive = captured(FUND.ref, [['2026-08-11', '125.0125']]);
    expect(derivedSellPlan(tracker(quotes), archive, [run]).rows.map((r) => r.price)).toEqual([
      '12.5013',
      '125.0075',
    ]);
  });

  it('values every fund row back to the tracker’s figure by the app’s own rounding step', () => {
    // `packages/core/src/valuation.ts`'s `round2`, which is not exported.
    const round2 = (n: number) => Math.round(n * 100) / 100;
    for (const divisor of [4, 9, 15]) {
      const quotes: Quote[] = [];
      let d = '2020-01-01';
      // 1000.00 to 60000.00 by a prime step of kopecks, one row a day.
      for (let kopecks = 100_000; kopecks <= 6_000_000; kopecks += 2_011) {
        quotes.push([d, FUND.asset, kopecks / 100]);
        d = addDays(d, 1);
      }
      const archive = captured(FUND.ref, [[d, '1000.0000']]);
      quotes.push([d, FUND.asset, divisor * 1000]);
      const run = { ...FUND, divisor, start: '2020-01-01' };
      const bought: Operation[] = [[run.start, FUND.asset, 'Купівля']];
      // The sweep's archive starts capturing on its own day.
      const { rows } = planFrom(tracker(quotes, bought), archive, d, [run]);
      expect(rows).toHaveLength(quotes.length - 1);
      const value = new Map(quotes.map(([day, , v]) => [day, v]));
      const off = rows.filter((r) => round2(divisor * Number(r.price)) !== value.get(r.asOf));
      expect(off, `÷${divisor}`).toEqual([]);
      expect(rows.every((r) => /^\d+\.\d{4}$/.test(r.price))).toBe(true);
    }
  });

  it('reads a date repeated with an equal value once, and reports it', () => {
    const quotes = [...bondDays(), ['2026-08-09', BOND.asset, 4200.4] as Quote];
    const { rows, reports } = derivedSellPlan(tracker(quotes), bondArchive(), [BOND]);
    expect(rows.filter((r) => r.asOf === '2026-08-09')).toHaveLength(1);
    expect(reports[0].collapsed).toEqual(['2026-08-09']);
  });

  it('refuses a date repeated with a different value, by cell address', () => {
    const quotes = [...bondDays(), ['2026-08-09', BOND.asset, 4200.8] as Quote];
    expect(refusal(() => derivedSellPlan(tracker(quotes), bondArchive(), [BOND]))).toMatch(
      /2026-08-09 twice with different values, at Котирування!C3 and Котирування!C9/,
    );
  });

  it('writes nothing for any ref when one is refused', () => {
    const quotes = [...bondDays(), ['2026-08-09', FUND.asset, 1] as Quote];
    const archive = new Map([...bondArchive(), ...captured(FUND.ref, [])]);
    expect(refusal(() => derivedSellPlan(tracker(quotes), archive, [BOND, FUND]))).toMatch(
      /^derived-sell refused:\ninzhur-energy ÷9: no captured sell/,
    );
  });
});

describe('derivedSellPlan, what it reads', () => {
  it('refuses a holding with no purchase or reinvestment recorded', () => {
    expect(refusal(() => derivedSellPlan(tracker(bondDays(), []), bondArchive(), [BOND]))).toMatch(
      /UA4000236475 ÷4: no purchase or reinvestment on or before 2026-08-10/,
    );
  });

  it('matches an asset spelled with a no-break or doubled space, as fund-history does', () => {
    const spaced = 'ОВДП  UA4000236475';
    const quotes = bondDays().map(([d, , v]): Quote => [d, spaced, v]);
    const ops: Operation[] = [['2026-08-09', spaced, 'Купівля']];
    expect(refusal(() => derivedSellPlan(tracker(quotes, ops), bondArchive(), [BOND]))).toMatch(
      /before the position change on 2026-08-09/,
    );
  });

  it('decides nothing by a cell on a day it neither writes nor checks', () => {
    const quotes: Quote[] = [
      ['2025-01-01', BOND.asset, 0],
      ['2025-01-02', BOND.asset, 1],
      ['2025-01-02', BOND.asset, 2],
      ...bondDays(),
      ['2026-08-20', BOND.asset, 4200.333],
    ];
    expect(() => derivedSellPlan(tracker(quotes), bondArchive(), [BOND])).not.toThrow();
    const inSpan = bondDays().map(([d, a, v]): Quote => [d, a, d === '2026-08-09' ? 4200.333 : v]);
    expect(refusal(() => derivedSellPlan(tracker(inSpan), bondArchive(), [BOND]))).toMatch(
      /no kopeck value at Котирування!C3$/,
    );
  });

  it('refuses a date cell that is not a whole day, by address', () => {
    const workbook = tracker(bondDays());
    workbook.sheets[0].rows.get(3)!.set('A', { n: serial('2026-08-09') + 0.5 });
    expect(refusal(() => derivedSellPlan(workbook, bondArchive(), [BOND]))).toMatch(
      /no whole-day date at Котирування!A3$/,
    );
  });

  it('refuses an unreadable captured price by its date, and names no figure', () => {
    const archive = bondArchive();
    archive.get(BOND.ref)![1].price = '1050.123456';
    const message = refusal(() => derivedSellPlan(tracker(bondDays()), archive, [BOND]));
    expect(message).toMatch(/unreadable captured sell on 2026-08-12/);
    expect(message).not.toMatch(/1050/);
  });

  it('never checks against its own rows, and refuses a day they priced otherwise', () => {
    const derived = (price: string) =>
      new Map([
        [
          BOND.ref,
          [
            ...bondArchive().get(BOND.ref)!,
            ...captured(
              BOND.ref,
              [
                ['2026-08-08', '1050.00'],
                ['2026-08-09', price],
              ],
              // An earlier version's rows are this import's too.
              'derived-sell-0',
            ).get(BOND.ref)!,
          ],
        ],
      ]);
    const { rows, reports } = derivedSellPlan(tracker(bondDays()), derived('1050.10'), [BOND]);
    expect(rows).toHaveLength(3);
    expect(reports[0]).toMatchObject({ to: '2026-08-10', checked: 4 });
    expect(refusal(() => derivedSellPlan(tracker(bondDays()), derived('1050.11'), [BOND]))).toMatch(
      /UA4000236475 ÷4: already derived at another price on 2026-08-09$/,
    );
  });

  it('refuses a day an earlier run derived and this one does not write', () => {
    const archive = new Map([
      [
        BOND.ref,
        [
          ...bondArchive().get(BOND.ref)!,
          ...captured(BOND.ref, [['2026-08-09', '1050.10']], 'derived-sell-1').get(BOND.ref)!,
        ],
      ],
    ]);
    const run = { ...BOND, exclude: ['2026-08-09'] };
    expect(refusal(() => derivedSellPlan(tracker(bondDays()), archive, [run]))).toMatch(
      /UA4000236475 ÷4: already derived on 2026-08-09, which this run does not write$/,
    );
  });

  it('refuses a ref first captured after the capture start, whatever it derived before', () => {
    const archive = new Map([
      [
        BOND.ref,
        [
          ...bondArchive('2026-08-12').get(BOND.ref)!,
          ...captured(BOND.ref, [['2026-08-08', '1050.00']], 'derived-sell-1').get(BOND.ref)!,
        ],
      ],
    ]);
    expect(refusal(() => derivedSellPlan(tracker(bondDays()), archive, [BOND]))).toMatch(
      /UA4000236475 ÷4: first captured sell on 2026-08-12 is after the capture start 2026-08-11/,
    );
  });

  it('refuses an excluded day the tracker does not hold, so a mistyped one cannot pass', () => {
    const run = { ...BOND, exclude: ['2026-8-09'] };
    expect(refusal(() => derivedSellPlan(tracker(bondDays()), bondArchive(), [run]))).toMatch(
      /UA4000236475 ÷4: excludes days the tracker does not hold: 2026-8-09$/,
    );
  });
});

describe('DERIVED_SELL_RUNS', () => {
  it('holds each ref from its last position change, by its divisor, with its exclusions', () => {
    expect(
      DERIVED_SELL_RUNS.map(({ ref, kind, divisor, start, exclude }) => [
        ref,
        kind,
        divisor,
        start,
        exclude,
      ]),
    ).toEqual([
      ['inzhur-energy', 'fund', 9, '2026-05-08', ['2026-06-27', '2026-10-08']],
      [
        'UA4000238976',
        'bond',
        15,
        '2026-05-21',
        [
          '2026-05-23',
          '2026-08-06',
          '2026-09-05',
          '2026-09-06',
          '2026-09-26',
          '2026-10-03',
          '2026-10-11',
        ],
      ],
      [
        'UA4000236475',
        'bond',
        4,
        '2026-04-23',
        ['2026-05-23', '2026-09-26', '2026-10-18', '2026-10-19'],
      ],
    ]);
  });

  it('is echoed by the report', () => {
    const { reports } = derivedSellPlan(tracker(bondDays()), bondArchive(), [BOND]);
    expect(reports[0]).toMatchObject({ ref: BOND.ref, divisor: 4, start: BOND.start, exclude: [] });
  });
});
