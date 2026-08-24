import { describe, expect, it } from 'vitest';

import { parseNbuFairValue } from './fair-value';

// Every fixture below is a VERBATIM line from a real file at
// https://bank.gov.ua/files/Fair_value/{YYYYMM}/{YYYYMMDD}_fv.txt, fetched
// 2026-08-11. The point of the file is that its shape changed four times, so
// invented fixtures would test the parser against the wrong thing.
const HEADER_2026 =
  'calc_date;cpcode;ccy;fair_value;ytm;clean_rate;cor_coef;maturity;cor_coef_cash;cor_coef_swap;notional;avr_rate;option_value;intrinsic_value;time_value;delta_per;delta_equ;g_spread,z_spread,cptype';

const ROW_2016 = '04.01.2016;UA4000050017;UAH;972.67;20.575473;96.771;0.92;10.05.2016';
const ROW_2018 =
  '03.01.2018;UA4000061790;UAH;1012.13;16.097029;98.655;0.92;28.03.2018;0.92;0;0;0;0;0;0;0';
const ROW_2022 =
  '04.01.2022;UA4000063143;UAH;1003.76;11.092452;99.489;0.92;01.06.2022;0.92;0.0;0.0;0.0;0.0;0.0;0.0;0.0;ОВДП';
const ROW_2026 =
  '10.08.2026;UA4000187348;UAH;1001.64;14.526121;96.215;0.79;12.10.2029;0.79;0.79;0.0;0.0;0.0;0.0;0.0;0.0;0.0;ОВДП';

describe('parseNbuFairValue', () => {
  it('reads the current 18-field layout', () => {
    const [row] = parseNbuFairValue(`${HEADER_2026}\n${ROW_2026}`);
    expect(row).toEqual({
      calcDate: '2026-08-10',
      isin: 'UA4000187348',
      currency: 'UAH',
      fairValue: 1001.64,
      ytm: 14.526121,
      cleanRate: 96.215,
      maturity: '2029-10-12',
      cpType: 'ОВДП',
    });
  });

  // The whole reason the archive reaches back to 2016: the oldest files carry
  // eight fields and nothing after `maturity`. A parser that requires the tail
  // would drop a decade.
  it('reads the 8-field layout of 2016, with no instrument type', () => {
    const [row] = parseNbuFairValue(ROW_2016);
    expect(row.calcDate).toBe('2016-01-04');
    expect(row.fairValue).toBe(972.67);
    expect(row.maturity).toBe('2016-05-10');
    expect(row.cpType).toBeUndefined();
  });

  // The padding fields of the 16-field layout are bare `0`. If `cptype` were
  // taken as "the last field" without checking it is not a number, this row
  // would report an instrument type of "0".
  it('does not mistake trailing numeric padding for an instrument type', () => {
    const [row] = parseNbuFairValue(ROW_2018);
    expect(row.cleanRate).toBe(98.655);
    expect(row.cpType).toBeUndefined();
  });

  // The trap this parser exists to avoid: in 2022 the file had SEVENTEEN
  // fields, so `cptype` sits at index 16. Reading a fixed index 17 — the
  // literal reading of the documented index map — returns undefined for every
  // file of that year.
  it('finds the instrument type in the 17-field layout, where it is not at index 17', () => {
    const [row] = parseNbuFairValue(ROW_2022);
    expect(row.cpType).toBe('ОВДП');
    expect(row.calcDate).toBe('2022-01-04');
  });

  // dd.MM.yyyy read as ISO transposes day and month for the first twelve days
  // of every month — a corruption that produces a valid-looking date.
  it('reads dates as dd.MM.yyyy, not ISO', () => {
    const [row] = parseNbuFairValue('04.01.2016;UA4000050017;UAH;972.67;20.5;96.7;0.92;10.05.2016');
    expect(row.calcDate).toBe('2016-01-04');
    expect(row.maturity).toBe('2016-05-10');
  });

  it('rejects a date that has the right shape but does not exist', () => {
    const [row] = parseNbuFairValue(
      '31.02.2026;UA4000187348;UAH;1001.64;14.5;96.2;0.79;12.10.2029',
    );
    expect(row).toBeUndefined();
  });

  // Per-entry skip, never all-or-nothing. The provider does not republish, so a
  // single bad line must not cost the other 184 instruments of that day.
  it('skips an unusable line and keeps the rest of the day', () => {
    const rows = parseNbuFairValue(
      [
        HEADER_2026,
        ROW_2026,
        ';;;;;;;',
        '10.08.2026;UA4000190441;UAH;;15.2;99.4;0.92;14.10.2026',
        ROW_2022,
      ].join('\n'),
    );
    expect(rows.map((r) => r.isin)).toEqual(['UA4000187348', 'UA4000063143']);
  });

  it('parses a body that has lost its header rather than eating its first row', () => {
    expect(parseNbuFairValue(ROW_2026)).toHaveLength(1);
  });

  it('returns nothing for an empty body', () => {
    expect(parseNbuFairValue('')).toEqual([]);
  });
});
