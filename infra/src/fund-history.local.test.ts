import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { addDays } from '@quirenote/core/dates';
import { fundHistoryRows, type FundHistoryRow } from './fund-history';
import { readXlsx } from './xlsx';

// The provider's files and the owner's tracker are real financial data and never
// committed, so this runs only where they are and skips everywhere else. It pins why the
// files are stored as `nav` — on all but one overlap day per fund the tracker values a
// holding at the dealer's quote, nav × SPREAD to four decimals — and why the provider's
// quarter-end reports cannot check them to the digit.
const DIR = join(homedir(), '.quirenote');
const SPREAD = 1.009;
const OVERLAP_FROM = '2026-04-23';
const OVERLAP_TO = '2026-07-06';

function find(prefix: string): string | undefined {
  if (!existsSync(DIR)) return undefined;
  return readdirSync(DIR).find((f) => f.startsWith(prefix) && f.endsWith('.xlsx'));
}

const files = {
  reit: find('Inzhur_REIT_czina_'),
  energy: find('Enerdzhi_czina_'),
  tracker: find('Інвестиційний трекер'),
};
const present =
  files.reit !== undefined && files.energy !== undefined && files.tracker !== undefined;

const workbook = (name: string | undefined) => readXlsx(readFileSync(join(DIR, name ?? '')));
const history = (ref: string, name: string | undefined) => fundHistoryRows(ref, workbook(name));

// ВЧА per certificate as each quarter-end «Довідка ВЧА» in the provider's CMS gives it
// (Таблиця 2, row 13), at the decimals it prints.
const REPORTED: Record<string, Record<string, string>> = {
  'inzhur-reit': {
    '2025-09-30': '10.0958',
    '2025-12-31': '10.4705',
    '2026-03-31': '10.7650',
    '2026-06-30': '11.0940',
  },
  'inzhur-energy': {
    '2024-12-31': '6116.94',
    '2025-03-31': '6131.11',
    '2025-06-30': '6157.08',
    '2025-09-30': '6104.0814',
    '2025-12-31': '6261.0608',
    '2026-03-31': '6464.5262',
    '2026-06-30': '6622.1989',
  },
};

/** Distance of `x` from the nearest whole number. */
const wobble = (x: number) => Math.abs(x - Math.round(x));

/** The dealer's sell quote on a price, as the feed prints it. */
const quote = (price: number) => Math.round(price * SPREAD * 1e4) / 1e4;

/** Position value per day for one fund, from the tracker's balance sheet. */
function trackerValues(fund: string): Map<string, number> {
  const sheet = workbook(files.tracker).sheets.find((s) => s.name === 'Баланси');
  if (!sheet) throw new Error('tracker: no Баланси sheet');
  const column = [...(sheet.rows.get(1) ?? [])].find(([, c]) => c.s === fund)?.[0];
  if (!column) throw new Error(`tracker: no ${fund} column`);
  const out = new Map<string, number>();
  for (const [row, cells] of sheet.rows) {
    const serial = cells.get('A')?.n;
    const value = cells.get(column)?.n;
    if (row === 1 || serial === undefined || value === undefined) continue;
    out.set(addDays('1899-12-30', serial), value);
  }
  return out;
}

function assertDaily(rows: FundHistoryRow[], from: string, to: string, count: number) {
  expect(rows).toHaveLength(count);
  expect(rows[0].asOf).toBe(from);
  expect(rows[rows.length - 1].asOf).toBe(to);
  for (let i = 1; i < rows.length; i += 1) expect(rows[i].asOf).toBe(addDays(rows[i - 1].asOf, 1));
}

/** `offQuote` names the days whose tracker value is not a whole holding at that day's quote. */
function assertHoldingTimesQuote(
  ref: string,
  file: string | undefined,
  fund: string,
  holdings: number[],
  offQuote: string[],
) {
  const nav = new Map(history(ref, file).map((r) => [r.asOf, r.price]));
  const values = trackerValues(fund);
  const units = new Set<number>();
  const off: string[] = [];
  let days = 0;
  for (let day = OVERLAP_FROM; day <= OVERLAP_TO; day = addDays(day, 1)) {
    const value = values.get(day);
    const price = nav.get(day);
    expect(value, `${fund} on ${day}`).toBeDefined();
    expect(price, `${ref} on ${day}`).toBeDefined();
    const held = Math.round(value! / quote(price!));
    expect(wobble(value! / price!), `${ref} raw on ${day}`).toBeGreaterThanOrEqual(0.07);
    // Half a kopeck: the tracker's own rounding of the value.
    if (Math.abs(value! - held * quote(price!)) > 0.005 + 1e-9) off.push(day);
    else units.add(held);
    days += 1;
  }
  expect(days).toBe(75);
  expect([...units]).toEqual(holdings);
  expect(off).toEqual(offQuote);
}

describe.skipIf(!present)('the provider files against the owner’s tracker', () => {
  it('REIT is one row per calendar day from its first file date', () => {
    assertDaily(history('inzhur-reit', files.reit), '2025-09-09', '2026-07-06', 301);
  });

  it('Energy is one row per calendar day from its first file date, across the text row', () => {
    assertDaily(history('inzhur-energy', files.energy), '2024-11-14', '2026-07-06', 600);
  });

  it('REIT values are a whole holding at the quote on the file, every overlap day but one', () => {
    assertHoldingTimesQuote(
      'inzhur-reit',
      files.reit,
      'Inzhur REIT',
      [4404, 5164, 5194, 6128],
      ['2026-04-29'],
    );
  });

  it('Energy values are a whole holding at the quote on the file, every overlap day but one', () => {
    assertHoldingTimesQuote('inzhur-energy', files.energy, 'Inzhur Energy', [8, 9], ['2026-06-27']);
  });

  it('no file carries its reported quarter-end ВЧА that day, one the day after, all within 1 %', () => {
    const carried: string[] = [];
    for (const [ref, file] of [
      ['inzhur-reit', files.reit],
      ['inzhur-energy', files.energy],
    ] as const) {
      const nav = new Map(history(ref, file).map((r) => [r.asOf, r.price]));
      for (const [day, reported] of Object.entries(REPORTED[ref])) {
        const decimals = reported.split('.')[1].length;
        for (const shift of [0, 1]) {
          const price = nav.get(addDays(day, shift));
          expect(price, `${ref} on ${day} + ${shift}`).toBeDefined();
          if (price!.toFixed(decimals) === reported) carried.push(`${ref} ${day} + ${shift}`);
        }
        // Close enough to catch a gross misparse on the day, never close enough to check digits.
        const gap = Math.abs(nav.get(day)! / Number(reported) - 1);
        expect(gap, `${ref} on ${day}`).toBeLessThan(0.01);
      }
    }
    expect(carried).toEqual(['inzhur-energy 2025-06-30 + 1']);
  });
});
