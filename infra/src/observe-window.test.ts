import { describe, expect, it } from 'vitest';

import { addDays } from '../../src/core/dates';
import { OBSERVE_CAP_DAYS, observeProgress, observeWindowEnd } from './observe-window';

// [Cloud target]: any statement over the archive is bounded by a SQL date
// window, and completeness names both bounds, the row limit first. After the
// cap itself, the four cases are the ones the ruling's reasoning names; each
// is a way that deriving completeness from the row count alone went wrong once
// the window was capped.
describe('the observe window', () => {
  // A whole-archive run: `{observe:{}}` spans the NBU archive from its first
  // file, which is many windows.
  const from = '2016-01-04';
  const to = '2026-09-10';

  it('bounds the statement at CAP days past `from`, or at `to` when that is nearer', () => {
    expect(OBSERVE_CAP_DAYS).toBe(1000);
    // The widest window planned as an index scan on `price_capture_as_of`;
    // wider fell to a full scan with `payload_gzip` projected.
    expect(OBSERVE_CAP_DAYS).toBeLessThanOrEqual(1500);
    expect(observeWindowEnd(from, to)).toBe('2018-09-30');
    expect(observeWindowEnd(from, '2016-03-01')).toBe('2016-03-01');
  });

  it('refuses a bound Postgres would parse but the JS window cannot', () => {
    // Before the window, `from` went straight to `BETWEEN $2 AND $3` and the
    // database read every spelling; now the bound is compared as text first.
    expect(() => observeWindowEnd('2016-1-4', to)).toThrow(/YYYY-MM-DD/);
    expect(() => observeWindowEnd(from, '2026/09/10')).toThrow(/YYYY-MM-DD/);
  });

  it('both bounds truncating at once continues from the CURSOR, not the window', () => {
    // The everyday case: a window holds more dates than the limit consumes.
    // Continuing from the window would skip every fetched-but-unconsumed date.
    const windowEnd = observeWindowEnd(from, to);
    const r = observeProgress({ to, windowEnd, fetched: 684, dates: 400, cursor: '2017-07-14' });
    expect(r).toEqual({ complete: false, nextFrom: '2017-07-15' });
  });

  it('a window that truncates reports complete: false', () => {
    // The row count alone read a capped window as the end of the archive.
    const windowEnd = observeWindowEnd(from, to);
    const r = observeProgress({ to, windowEnd, fetched: 12, dates: 12, cursor: '2016-01-20' });
    expect(r).toEqual({ complete: false, nextFrom: addDays(windowEnd, 1) });
  });

  it('an EMPTY window advances nextFrom past the window, not by one day', () => {
    // A gap in the archive must not stall the caller at a day per invocation.
    const windowEnd = observeWindowEnd(from, to);
    const r = observeProgress({ to, windowEnd, fetched: 0, dates: 0, cursor: from });
    expect(r).toEqual({ complete: false, nextFrom: '2018-10-01' });
  });

  it('a run that reaches `to` inside one window reports complete: true', () => {
    const near = '2016-03-01';
    const windowEnd = observeWindowEnd(from, near);
    const r = observeProgress({
      to: near,
      windowEnd,
      fetched: 40,
      dates: 40,
      cursor: '2016-02-29',
    });
    expect(r).toEqual({ complete: true, nextFrom: null });
  });

  it('a last window consumed to exactly the limit is finished, not truncated', () => {
    // The limit bit only when rows were fetched and not consumed; a count that
    // merely equals the limit is not that, and reporting it so cost one more
    // invocation to learn the archive was already derived.
    const near = '2016-03-01';
    const windowEnd = observeWindowEnd(from, near);
    const r = observeProgress({ to: near, windowEnd, fetched: 40, dates: 40, cursor: near });
    expect(r).toEqual({ complete: true, nextFrom: null });
  });

  it('a zero limit consumes nothing, advances a day at a time and still ends', () => {
    // `dates >= limit` held at zero before a single row was consumed and never
    // let the window or `to` answer, so the caller looped forever. Fetched
    // rows now carry it a day; an empty window carries it a window.
    const windowEnd = observeWindowEnd(from, to);
    const r = observeProgress({ to, windowEnd, fetched: 684, dates: 0, cursor: from });
    expect(r).toEqual({ complete: false, nextFrom: addDays(from, 1) });
    const last = observeProgress({ to, windowEnd: to, fetched: 0, dates: 0, cursor: from });
    expect(last).toEqual({ complete: true, nextFrom: null });
  });
});
