import { describe, expect, it } from 'vitest';

import { resolveWindow, type PeriodOption } from './period';

// A27 — the window a period resolves to. Written before the implementation.
//
// Every case fixes `latest` at the seed's own last snapshot date so the
// arithmetic is checkable by hand against a real portfolio rather than a
// round number.
const START = '2026-02-03';
const LATEST = '2026-07-27';

describe('resolveWindow', () => {
  it('needs both ends — there is no window over nothing', () => {
    expect(resolveWindow('all', undefined, LATEST)).toBeUndefined();
    expect(resolveWindow('all', START, undefined)).toBeUndefined();
    expect(resolveWindow('all', undefined, undefined)).toBeUndefined();
  });

  it('"all" is the whole history and is never clamped', () => {
    expect(resolveWindow('all', START, LATEST)).toEqual({
      from: START,
      to: LATEST,
      clamped: false,
    });
  });

  it('counts months back from the LATEST snapshot, not from today', () => {
    // Today is not a portfolio fact. The last snapshot is, and it is what every
    // other figure on these screens is measured to.
    expect(resolveWindow('1m', START, LATEST)?.from).toBe('2026-06-27');
    expect(resolveWindow('3m', START, LATEST)?.from).toBe('2026-04-27');
  });

  it('clamps to the start when the option reaches further back than the data', () => {
    // The seed is under six months old, so 6m and 12m are both "since start"
    // wearing a longer name — the exact thing G-3 forbids showing silently.
    const six = resolveWindow('6m', START, LATEST)!;
    expect(six).toEqual({ from: START, to: LATEST, clamped: true });
    expect(resolveWindow('12m', START, LATEST)?.clamped).toBe(true);

    // And 3m is genuinely inside the data, so it is NOT clamped.
    expect(resolveWindow('3m', START, LATEST)?.clamped).toBe(false);
  });

  it('"all" is not clamped even though it starts at the start', () => {
    // The flag means "you asked for more than exists", not "from == start".
    // Marking `all` would put a warning on the default state.
    expect(resolveWindow('all', START, LATEST)?.clamped).toBe(false);
  });

  it('year-to-date runs from 1 January of the LATEST snapshot year', () => {
    expect(resolveWindow('ytd', '2025-01-01', LATEST)).toEqual({
      from: '2026-01-01',
      to: LATEST,
      clamped: false,
    });
    // On the seed, 1 Jan 2026 predates the portfolio, so YTD clamps too.
    expect(resolveWindow('ytd', START, LATEST)).toEqual({
      from: START,
      to: LATEST,
      clamped: true,
    });
  });

  it('clamps the day of month rather than overflowing it', () => {
    // 31 March minus one month is February, which has no 31st. `addMonths`
    // already clamps to the month's last day; this asserts the window inherits
    // that rather than producing 2026-03-03.
    expect(resolveWindow('1m', '2020-01-01', '2026-03-31')?.from).toBe('2026-02-28');
  });

  it('every option resolves to a window inside the data', () => {
    const options: PeriodOption[] = ['all', '1m', '3m', '6m', '12m', 'ytd'];
    for (const o of options) {
      const w = resolveWindow(o, START, LATEST)!;
      expect(w.from >= START).toBe(true);
      expect(w.to).toBe(LATEST);
      expect(w.from <= w.to).toBe(true);
    }
  });
});
