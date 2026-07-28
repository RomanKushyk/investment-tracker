import { describe, expect, it } from 'vitest';

import {
  fmtDate,
  fmtDateShort,
  fmtPct,
  fmtProse,
  fmtProseWhole,
  fmtSavedAt,
  fmtTable,
  signed,
  signedPp,
  signedProse,
  signedTable,
  toUsd,
} from './money';

it('prose/KPI format per README §8', () => {
  expect(fmtProse(68629.36)).toBe('₴68,629.36');
  expect(fmtProse(toUsd(149016.36, 44.83), 'USD')).toBe('$3,324.03');
  expect(fmtProse(toUsd(4452.61, 44.83), 'USD')).toBe('$99.32'); // renderVals ovNet USD
});

it('whole-hryvnia prose (sidebar capital, Deposited KPI)', () => {
  expect(fmtProseWhole(149016.36)).toBe('₴149,016');
  expect(fmtProseWhole(143176.37)).toBe('₴143,176');
  expect(fmtProseWhole(toUsd(143176.37, 44.83), 'USD')).toBe('$3,194'); // ovDep is ₴-whole only; USD uses fmtProse
});

it('table format: NBSP thousands, comma decimals', () => {
  expect(fmtTable(68702.1)).toBe('68 702,10');
  expect(fmtTable(7.75)).toBe('7,75');
  expect(fmtTable(1183.5)).toBe('1 183,50');
});

it('percent format: explicit sign, default 2 dp, optional dp override', () => {
  expect(fmtPct(0.0441)).toBe('+4.41%');
  expect(fmtPct(-0.064)).toBe('−6.40%'); // U+2212 — unified sign convention (D8)
  expect(fmtPct(0.0308)).toBe('+3.08%');
  expect(fmtPct(0.093, 1)).toBe('+9.3%'); // Yield table annualized column
  expect(fmtPct(0.109, 1)).toBe('+10.9%');
});

it('every signed helper routes through signed() and pins U+2212', () => {
  expect(signed(-1, 'x')).toBe('−x');
  expect(signed(1, 'x')).toBe('+x');
  expect(fmtPct(-0.064)).not.toContain('-'); // ASCII hyphen-minus must not appear
  expect(signedProse(-120)).toBe('−₴120.00');
  expect(signedProse(4452.61)).toBe('+₴4,452.61'); // Overview Net result
  expect(signedTable(-120)).toBe('−120,00');
  expect(signedTable(2902.1)).toBe('+2 902,10'); // NBSP thousands, Portfolio P&L
});

it('dates: dd.MM.yyyy / dd.MM / saved-at', () => {
  expect(fmtDate('2026-07-27')).toBe('27.07.2026');
  expect(fmtDateShort('2026-07-25')).toBe('25.07');
  expect(fmtSavedAt('2026-07-25T21:14:00')).toBe('25.07, 21:14');
});

describe('signedPp', () => {
  it('formats a positive gap with an explicit "+" and 1 decimal', () => {
    expect(signedPp(6.1)).toBe('+6.1');
  });

  it('formats a negative gap with U+2212 (not ASCII hyphen)', () => {
    const result = signedPp(-6.4);
    expect(result).toBe('−6.4');
    expect(result).not.toContain('-'); // ASCII hyphen-minus must not appear
  });

  it('appends an optional suffix (Overview "%", Yield " pp")', () => {
    expect(signedPp(-6.4, '%')).toBe('−6.4%');
    expect(signedPp(-4.7, ' pp')).toBe('−4.7 pp');
  });

  it('defaults to no suffix (Allocation pills)', () => {
    expect(signedPp(-0.1)).toBe('−0.1');
  });

  it('rounds to 1 decimal place', () => {
    expect(signedPp(6.14)).toBe('+6.1');
    expect(signedPp(6.16)).toBe('+6.2');
  });
});
