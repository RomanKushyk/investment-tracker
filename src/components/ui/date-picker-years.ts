// The year list's span, and the arithmetic that pages it.
//
// THE SPAN IS A45's AND UNCHANGED: ±20 years around the current one carries a
// first purchase well behind the archive's 2016 floor and the longest OVDP on
// offer. What changed is the SHAPE — the native `captionLayout="dropdown"` was
// refused on looks the day it shipped, so the years are a grid of twelve now.
// The bound itself is not cosmetic: react-day-picker's own year list defaults to
// the LAST 100 YEARS, which has no 2028 in it, so a bond maturity would be
// unreachable through the very control added to reach it.
//
// The page is anchored to the span's START, never to the year on screen, and
// that is the whole reason this is a function rather than two lines inline:
// paging must be stable. Anchored on the shown year, 2020 pages forward to
// 2020–2031, back to 2008–2019, and forward again to 2008–2019 — it never
// returns to where it was.
export const YEAR_SPAN = 20;
export const YEARS_PER_PAGE = 12;

// NBU's archive is backfilled to 2016-01-04, so 2016 is a fact about the DATA
// and not about today. As a relative bound it silently stops holding: from 2037
// a ±20 window starts at 2017 and the floor the comment above cites becomes
// unreachable through the picker, with no test failing anywhere.
export const ARCHIVE_FLOOR_YEAR = 2016;

/**
 * The inclusive year bounds of the picker, around `thisYear`.
 *
 * `mustInclude` WIDENS the span rather than clamping into it — pass the year the
 * field itself holds. react-day-picker clamps a controlled `month` into
 * `[startMonth, endMonth]` silently, without calling `onMonthChange`, so a date
 * outside the span would leave the caption naming a month the grid does not
 * show, and a click would then save the year the grid landed on.
 */
export function yearBounds(
  thisYear: number,
  mustInclude?: number,
): { first: number; last: number } {
  const first = Math.min(thisYear - YEAR_SPAN, ARCHIVE_FLOOR_YEAR, mustInclude ?? Infinity);
  const last = Math.max(thisYear + YEAR_SPAN, mustInclude ?? -Infinity);
  return { first, last };
}

/**
 * The page of years holding `year`, clamped into `[first, last]`.
 *
 * The last page is SHORT whenever the span is not a multiple of twelve — 41
 * years page as 12, 12, 12 and 5 — so the caller must not assume a full grid.
 */
export function yearPage(year: number, first: number, last: number): number[] {
  const inside = Math.min(Math.max(year, first), last);
  const start = first + Math.floor((inside - first) / YEARS_PER_PAGE) * YEARS_PER_PAGE;
  const page: number[] = [];
  for (let y = start; y < start + YEARS_PER_PAGE && y <= last; y += 1) page.push(y);
  return page;
}
