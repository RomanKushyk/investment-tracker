import { describe, expect, it } from 'vitest';

import { ARCHIVE_FLOOR_YEAR, YEARS_PER_PAGE, yearBounds, yearPage } from './date-picker-years';

describe('the picker span', () => {
  it('is ±20 years around the current one', () => {
    expect(yearBounds(2026)).toEqual({ first: 2006, last: 2046 });
  });

  // The assertion that has to be about the LIVE span, not about a literal: a
  // relative-only bound passes forever against `yearBounds(2026)` and still
  // stops reaching 2016 in 2037.
  it('reaches the archive’s floor whatever the current year is', () => {
    expect(yearBounds(new Date().getFullYear()).first).toBeLessThanOrEqual(ARCHIVE_FLOOR_YEAR);
    expect(yearBounds(2037).first).toBe(ARCHIVE_FLOOR_YEAR);
    expect(yearBounds(2099).first).toBe(ARCHIVE_FLOOR_YEAR);
  });

  it('widens to hold a year outside it, in either direction', () => {
    expect(yearBounds(2026, 1998)).toEqual({ first: 1998, last: 2046 });
    expect(yearBounds(2026, 2060)).toEqual({ first: 2006, last: 2060 });
    expect(yearBounds(2026, 2030)).toEqual({ first: 2006, last: 2046 }); // already inside
  });
});

describe('the year grid pages that span', () => {
  const { first, last } = yearBounds(2026); // 2006 … 2046

  it('pages by twelve from the span start, not from the year on screen', () => {
    expect(yearPage(2026, first, last)).toEqual([
      2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029,
    ]);
    expect(yearPage(2006, first, last)[0]).toBe(2006);
    expect(yearPage(2017, first, last)[0]).toBe(2006);
    expect(yearPage(2018, first, last)[0]).toBe(2018);
  });

  // The property the anchor exists for: step off either end of a page and back,
  // and the same twelve return. An anchor on the shown year does not do this.
  it('is stable across a step out and back', () => {
    const page = yearPage(2026, first, last);
    const before = yearPage(page[0] - 1, first, last);
    const after = yearPage(before[before.length - 1] + 1, first, last);
    expect(after).toEqual(page);
  });

  it('cuts the last page short rather than running past the bound', () => {
    const tail = yearPage(2046, first, last);
    expect(tail).toEqual([2042, 2043, 2044, 2045, 2046]);
    expect(tail.length).toBeLessThan(YEARS_PER_PAGE);
  });

  it('clamps a year from outside the span onto the nearest page', () => {
    expect(yearPage(1990, first, last)).toEqual(yearPage(first, first, last));
    expect(yearPage(2100, first, last)).toEqual(yearPage(last, first, last));
  });
});
