import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { addDays } from '../../src/core/dates';
import { fundHistoryRows, type FundHistoryRow } from './fund-history';
import { readXlsx } from './xlsx';

// The provider's files and the owner's tracker are real financial data and
// never committed, so this runs only where they are and skips everywhere
// else. What it pins is the reason the files are stored as `nav`: the
// tracker values a holding at the dealer's sell price, which is nav × 1.009,
// so the implied unit count is whole after dividing by the spread and never
// before. Same arithmetic that settled the basis, reused as a regression test.
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

/** Distance of `x` from the nearest whole number. */
const wobble = (x: number) => Math.abs(x - Math.round(x));

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

function assertWholeUnitsAfterSpread(
  ref: string,
  file: string | undefined,
  fund: string,
  tolerance: number,
  holdings: number[],
) {
  const nav = new Map(history(ref, file).map((r) => [r.asOf, r.price]));
  const values = trackerValues(fund);
  const units = new Set<number>();
  let days = 0;
  for (let day = OVERLAP_FROM; day <= OVERLAP_TO; day = addDays(day, 1)) {
    const value = values.get(day);
    const price = nav.get(day);
    expect(value, `${fund} on ${day}`).toBeDefined();
    expect(price, `${ref} on ${day}`).toBeDefined();
    const spread = value! / (price! * SPREAD);
    const raw = value! / price!;
    expect(wobble(spread), `${ref} ÷ ${SPREAD} on ${day}`).toBeLessThanOrEqual(tolerance);
    expect(wobble(raw), `${ref} raw on ${day}`).toBeGreaterThanOrEqual(0.07);
    expect(wobble(raw)).toBeGreaterThan(wobble(spread));
    units.add(Math.round(spread));
    days += 1;
  }
  expect(days).toBe(75);
  expect([...units]).toEqual(holdings);
}

describe.skipIf(!present)('the provider files against the owner’s tracker', () => {
  it('REIT is one row per calendar day from its first file date', () => {
    assertDaily(history('inzhur-reit', files.reit), '2025-09-09', '2026-07-06', 301);
  });

  it('Energy is one row per calendar day from its first file date, across the text row', () => {
    assertDaily(history('inzhur-energy', files.energy), '2024-11-14', '2026-07-06', 600);
  });

  it('REIT units are whole only after dividing by the spread, over the whole overlap', () => {
    // The tolerance is the tracker's own rounding to the kopeck at a
    // four-thousand-unit holding of an eleven-hryvnia certificate.
    assertWholeUnitsAfterSpread(
      'inzhur-reit',
      files.reit,
      'Inzhur REIT',
      0.1,
      [4404, 5164, 5194, 6128],
    );
  });

  it('Energy units are whole only after dividing by the spread, over the whole overlap', () => {
    assertWholeUnitsAfterSpread('inzhur-energy', files.energy, 'Inzhur Energy', 0.02, [8, 9]);
  });
});
