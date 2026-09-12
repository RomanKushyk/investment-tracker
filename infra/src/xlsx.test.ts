import { describe, expect, it } from 'vitest';

import { fundHistoryParts, zipOf } from './__fixtures__/xlsx';
import { readXlsx, sharedStrings, sheetCells, zipEntries } from './xlsx';

const decode = (b: Uint8Array) => Buffer.from(b).toString('utf8');

describe('zipEntries', () => {
  it('reads deflated and stored entries alike, by name', () => {
    const entries = { 'a.txt': 'hello', 'dir/b.bin': Uint8Array.from([0, 255, 7]) };
    for (const method of [8, 0]) {
      const z = zipEntries(zipOf(entries, method));
      expect([...z.keys()]).toEqual(['a.txt', 'dir/b.bin']);
      expect(decode(z.get('a.txt')!)).toBe('hello');
      expect([...z.get('dir/b.bin')!]).toEqual([0, 255, 7]);
    }
  });

  it('refuses a compression method it does not implement, naming the entry', () => {
    expect(() => zipEntries(zipOf({ 'x.xml': '<x/>' }, 99))).toThrow(/method 99.*x\.xml/);
  });
});

describe('sharedStrings', () => {
  it('returns the strings in index order with entities decoded', () => {
    const xml =
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">' +
      '<si><t>a &amp; b &lt;c&gt;</t></si><si><t xml:space="preserve"> x</t></si></sst>';
    expect(sharedStrings(xml)).toEqual(['a & b <c>', ' x']);
  });

  it('keeps an empty entry in its index, so later strings do not shift', () => {
    expect(sharedStrings('<sst><si><t>a</t></si><si/><si><t>c</t></si></sst>')).toEqual([
      'a',
      '',
      'c',
    ]);
  });

  it('decodes a hexadecimal reference in either case', () => {
    expect(sharedStrings('<sst><si><t>&#x41;&#X42;&#67;</t></si></sst>')).toEqual(['ABC']);
  });
});

describe('sheetCells', () => {
  const sheet = (cells: string) =>
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="4" spans="1:4">${cells}</row></sheetData></worksheet>`;

  it('keeps the cached text of a formula string cell', () => {
    const rows = sheetCells(sheet('<c r="B4" t="str"><f>A4&amp;"!"</f><v>hi</v></c>'), [], '2025');
    expect(rows.get(4)?.get('B')).toEqual({ s: 'hi' });
  });

  it('refuses a cell type it does not read, naming sheet and cell', () => {
    expect(() => sheetCells(sheet('<c r="C4" t="e"><v>#DIV/0!</v></c>'), [], '2025')).toThrow(
      /2025!C4/,
    );
  });

  it('refuses an inline string, which carries no <v> to skip on', () => {
    expect(() =>
      sheetCells(sheet('<c r="B4" t="inlineStr"><is><t>6 234,8244</t></is></c>'), [], '2025'),
    ).toThrow(/inlineStr.*2025!B4/);
  });

  it('refuses a shared-string reference that is blank or not an index', () => {
    expect(() => sheetCells(sheet('<c r="B4" t="s"><v></v></c>'), ['Дата'], '2025')).toThrow(
      /2025!B4/,
    );
    expect(() => sheetCells(sheet('<c r="B4" t="s"><v>0.5</v></c>'), ['Дата'], '2025')).toThrow(
      /2025!B4/,
    );
  });

  it('refuses a number it cannot read rather than storing NaN', () => {
    expect(() => sheetCells(sheet('<c r="B4"><v>1,5</v></c>'), [], '2025')).toThrow(/2025!B4/);
  });
});

describe('readXlsx over the synthetic fund-history workbook', () => {
  const wb = readXlsx(zipOf(fundHistoryParts()));

  it('lists the sheets in workbook order, by name', () => {
    expect(wb.sheets.map((s) => s.name)).toEqual(['2025', '2026']);
  });

  it('reads shared-string, numeric and cached-formula cells', () => {
    const rows = wb.sheets[0].rows;
    expect(rows.get(1)?.get('A')).toEqual({ s: 'Дата' });
    expect(rows.get(1)?.get('B')).toEqual({ s: 'Вартість 1 ЦП, грн' });
    expect(rows.get(2)?.get('A')).toEqual({ n: 46017 });
    expect(rows.get(2)?.get('B')).toEqual({ n: 6212.3195999999998 });
    expect(rows.get(2)?.get('D')).toEqual({ n: 147.14894866869267 });
  });

  it('hands the text-formatted price over as the string it is', () => {
    const row = wb.sheets[0].rows.get(7);
    expect(row?.get('B')).toEqual({ s: '6 234,8244' });
    expect(row?.get('C')).toBeUndefined();
  });

  it('leaves a styled empty row out entirely', () => {
    expect(wb.sheets[0].rows.has(8)).toBe(false);
    expect(wb.sheets[0].rows.has(9)).toBe(false);
    expect(wb.sheets[1].rows.has(5)).toBe(false);
  });

  it('names the part that is missing', () => {
    const parts = fundHistoryParts();
    delete parts['xl/worksheets/sheet2.xml'];
    expect(() => readXlsx(zipOf(parts))).toThrow(/xl\/worksheets\/sheet2\.xml/);
  });

  it('treats a workbook without shared strings as one with none', () => {
    const parts = fundHistoryParts();
    delete parts['xl/sharedStrings.xml'];
    expect(() => readXlsx(zipOf(parts))).toThrow(/2025!A1/);
  });
});
