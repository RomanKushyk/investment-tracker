import { describe, expect, it } from 'vitest';

import { fundHistoryParts, zipOf } from './__fixtures__/xlsx';
import {
  excelSerialToIso,
  fundHistoryRows,
  parseUkrainianDecimal,
  priceFileLink,
} from './fund-history';
import { readXlsx, type XlsxCell, type XlsxWorkbook } from './xlsx';

const CDN = 'https://d2zk2gr3fhkmim.cloudfront.net';
const anchor = (file: string) => `<a href="${CDN}/${file}" target="_blank" rel="noopener">xlsx</a>`;

describe('priceFileLink', () => {
  it('takes the one price file and never the dividend file beside it', () => {
    const html = `<div>${anchor('Inzhur_REIT_czina_06_07_2026_346a256fc9.xlsx')}${anchor('Inzhur_REIT_dividendi_28_07_29bd9cd4a8.xlsx')}</div>`;
    expect(priceFileLink(html)).toBe(`${CDN}/Inzhur_REIT_czina_06_07_2026_346a256fc9.xlsx`);
  });

  it('counts the same link twice as one', () => {
    const a = anchor('Enerdzhi_czina_06_07_2026_2c553a3277.xlsx');
    expect(priceFileLink(a + a)).toBe(`${CDN}/Enerdzhi_czina_06_07_2026_2c553a3277.xlsx`);
  });

  it('refuses a page with no price file, listing what it saw', () => {
    expect(() => priceFileLink(anchor('Inzhur_REIT_dividendi_28_07_29bd9cd4a8.xlsx'))).toThrow(
      /no price file.*dividendi/,
    );
  });

  it('refuses two different price files rather than choosing', () => {
    const html = anchor('A_czina_1_aa.xlsx') + anchor('A_czina_2_bb.xlsx');
    expect(() => priceFileLink(html)).toThrow(/2 price files/);
  });

  it('decodes an entity-escaped href', () => {
    expect(priceFileLink(`<a href="${CDN}/x_czina.xlsx?a=1&amp;b=2">`)).toBe(
      `${CDN}/x_czina.xlsx?a=1&b=2`,
    );
  });
});

describe('excelSerialToIso', () => {
  it('counts days from 1899-12-30', () => {
    expect(excelSerialToIso(45909)).toBe('2025-09-09');
    expect(excelSerialToIso(46022)).toBe('2025-12-31');
    expect(excelSerialToIso(46023)).toBe('2026-01-01');
  });

  it('refuses a fraction, which would be a time of day', () => {
    expect(() => excelSerialToIso(45909.5)).toThrow(/45909\.5/);
  });

  it('refuses the serials before 1900-03-01, where Excel counts a day that never was', () => {
    expect(excelSerialToIso(61)).toBe('1900-03-01');
    for (const serial of [60, 1, 0, -1]) {
      expect(() => excelSerialToIso(serial), String(serial)).toThrow(/not a date/);
    }
  });
});

describe('parseUkrainianDecimal', () => {
  it('reads the provider spelling with either space as the thousands separator', () => {
    expect(parseUkrainianDecimal('6 234,8244')).toBe(6234.8244);
    expect(parseUkrainianDecimal('6 234,8244')).toBe(6234.8244);
    expect(parseUkrainianDecimal('12,5')).toBe(12.5);
    expect(parseUkrainianDecimal('1 234 567')).toBe(1234567);
  });

  it('reads an ungrouped integer part, which a comma decimal leaves unambiguous', () => {
    expect(parseUkrainianDecimal('6234,8244')).toBe(6234.8244);
    expect(parseUkrainianDecimal('1234,5')).toBe(1234.5);
  });

  it('refuses anything else instead of guessing', () => {
    for (const text of ['6234.82', 'abc', '', '6 234,8244 ', '6,234.82', '1 2345,5']) {
      expect(() => parseUkrainianDecimal(text), text).toThrow(/unreadable price/);
    }
  });
});

describe('fundHistoryRows over the synthetic workbook', () => {
  const rows = fundHistoryRows('inzhur-energy', readXlsx(zipOf(fundHistoryParts())));

  it('yields one row per dated line, sorted, across the year sheets', () => {
    expect(rows.map((r) => r.asOf)).toEqual([
      '2025-12-26',
      '2025-12-27',
      '2025-12-28',
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
    expect(new Set(rows.map((r) => r.ref))).toEqual(new Set(['inzhur-energy']));
  });

  it('keeps a weekend plateau as the observations it is', () => {
    expect(rows.slice(0, 3).map((r) => r.price)).toEqual([
      6212.3195999999998, 6212.3195999999998, 6212.3195999999998,
    ]);
  });

  it('reads the text-formatted row to the same price its numeric neighbour carries', () => {
    expect(rows[5]).toEqual({ ref: 'inzhur-energy', asOf: '2025-12-31', price: 6234.8244 });
    expect(rows[6].price).toBe(6234.8244000000004);
  });
});

describe('fundHistoryRows on hand-built workbooks', () => {
  const n = (n: number): XlsxCell => ({ n });
  const s = (s: string): XlsxCell => ({ s });
  const sheet = (name: string, header: string[], lines: (XlsxCell | undefined)[][]) => ({
    name,
    rows: new Map(
      [header.map(s), ...lines].map((cells, i) => [
        i + 1,
        new Map(
          cells.flatMap((c, j) => (c === undefined ? [] : [[String.fromCharCode(65 + j), c]])),
        ),
      ]),
    ),
  });
  const wb = (...sheets: XlsxWorkbook['sheets']): XlsxWorkbook => ({ sheets });
  const DATE = 'Дата';
  const RATE = 'Курс долара';
  const REIT_PRICE = 'Вартість ВЧА 1 ЦП, грн';
  const ENERGY_PRICE = 'Вартість 1 ЦП, грн';

  it('finds the columns by caption, not by position, under either caption', () => {
    const swapped = wb(sheet('2025', [DATE, RATE, REIT_PRICE], [[n(45909), n(41.25), n(10)]]));
    expect(fundHistoryRows('inzhur-reit', swapped)).toEqual([
      { ref: 'inzhur-reit', asOf: '2025-09-09', price: 10 },
    ]);
    const spaced = wb(sheet('2025', [` ${DATE} `, `${ENERGY_PRICE}\n`], [[n(45909), n(6034.19)]]));
    expect(fundHistoryRows('inzhur-energy', spaced)[0].price).toBe(6034.19);
  });

  it('refuses a sheet whose header names no price column, listing the headers', () => {
    const w = wb(sheet('2024', [DATE, 'Ціна', RATE], [[n(45610), n(1), n(2)]]));
    expect(() => fundHistoryRows('inzhur-energy', w)).toThrow(/sheet "2024".*Ціна/);
  });

  it('refuses a date that is not a serial, by address', () => {
    const w = wb(sheet('2025', [DATE, ENERGY_PRICE], [[s('2025-09-09'), n(1)]]));
    expect(() => fundHistoryRows('inzhur-energy', w)).toThrow(/2025!A2/);
  });

  it('refuses a line with a date and no price, or a price and no date, by address', () => {
    const noPrice = wb(sheet('2025', [DATE, ENERGY_PRICE], [[n(45909), undefined]]));
    expect(() => fundHistoryRows('inzhur-energy', noPrice)).toThrow(/2025!B2/);
    const noDate = wb(sheet('2025', [DATE, ENERGY_PRICE], [[undefined, n(1)]]));
    expect(() => fundHistoryRows('inzhur-energy', noDate)).toThrow(/2025!A2/);
  });

  it('refuses a price that is not positive', () => {
    const w = wb(sheet('2025', [DATE, ENERGY_PRICE], [[n(45909), n(0)]]));
    expect(() => fundHistoryRows('inzhur-energy', w)).toThrow(/2025!B2/);
  });

  it('refuses a date outside the year its sheet is named for', () => {
    const w = wb(sheet('2026', [DATE, ENERGY_PRICE], [[n(46022), n(1)]]));
    expect(() => fundHistoryRows('inzhur-energy', w)).toThrow(/2025-12-31.*"2026"/);
  });

  it('refuses a date that appears twice, which DO NOTHING would otherwise hide', () => {
    const w = wb(
      sheet('2025', [DATE, ENERGY_PRICE], [[n(46022), n(1)]]),
      sheet('2025', [DATE, ENERGY_PRICE], [[n(46022), n(1)]]),
    );
    expect(() => fundHistoryRows('inzhur-energy', w)).toThrow(/2025-12-31 twice/);
  });
});
