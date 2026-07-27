import { expect, it } from 'vitest';

import {
  fmtDate,
  fmtDateShort,
  fmtPct,
  fmtProse,
  fmtProseWhole,
  fmtSavedAt,
  fmtTable,
  toUsd,
} from './format';

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
  expect(fmtPct(-0.064)).toBe('-6.40%');
  expect(fmtPct(0.0308)).toBe('+3.08%');
  expect(fmtPct(0.093, 1)).toBe('+9.3%'); // Yield table annualized column
  expect(fmtPct(0.109, 1)).toBe('+10.9%');
});

it('dates: dd.MM.yyyy / dd.MM / saved-at', () => {
  expect(fmtDate('2026-07-27')).toBe('27.07.2026');
  expect(fmtDateShort('2026-07-25')).toBe('25.07');
  expect(fmtSavedAt('2026-07-25T21:14:00')).toBe('25.07, 21:14');
});
