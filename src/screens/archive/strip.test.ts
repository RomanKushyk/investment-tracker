// The coverage strip's rules (`design/extensions/archive-admin.dc.html`, T4): one axis per source,
// two eras, a mark per run of empty days, and the cut past the latest 100.
import { describe, expect, it } from 'vitest';

import type { ArchiveGroup } from '../../lib/repository';
import { axisOf, orderGroups, stripOf, ticksOf } from './strip';

const group = (over: Partial<ArchiveGroup> = {}): ArchiveGroup => ({
  instrument_ref: 'UA4000207518',
  basis: 'buy',
  source: 'inzhur',
  dates: '10',
  measured_from: '2026-10-01',
  last_as_of: '2026-10-10',
  publishedDays: '10',
  gaps: 0,
  importedDays: null,
  emptyDays: 0,
  emptyDates: [],
  ...over,
});

describe('the axis', () => {
  it('runs from the earliest imported, measured or listed empty day of the groups to today', () => {
    const axis = axisOf(
      [
        group({ measured_from: '2026-10-05' }),
        group({ measured_from: '2026-10-08', importedDays: '3' }),
        group({ measured_from: '2026-10-09', emptyDates: ['2026-10-04'], emptyDays: 1 }),
      ],
      '2026-10-10',
    );
    expect(axis).toEqual({ from: '2026-10-04', to: '2026-10-10', days: 7 });
    // The imported era ends the day before the captured one, so it starts `importedDays` earlier.
    expect(
      axisOf([group({ measured_from: '2026-10-08', importedDays: '5' })], '2026-10-10')?.from,
    ).toBe('2026-10-03');
  });

  // A clock behind the archive's own days would end the axis before it starts.
  it('is nothing when today comes before its earliest bound', () => {
    expect(axisOf([group({ measured_from: '2026-10-11' })], '2026-10-10')).toBeUndefined();
  });

  it('is nothing when no group was measured', () => {
    const unmeasured = group({
      dates: '0',
      measured_from: null,
      publishedDays: null,
      emptyDays: null,
      emptyDates: null,
    });
    expect(axisOf([unmeasured], '2026-10-10')).toBeUndefined();
  });
});

describe('the ticks', () => {
  const ticks = (from: string, to: string) =>
    ticksOf({ from, to, days: Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1 });

  it('are months under 200 days, the year on the first and on January', () => {
    expect(ticks('2025-11-10', '2026-04-15').map((t) => [t.month, t.year])).toEqual([
      [11, 2025],
      [0, 2026],
      [1, undefined],
      [2, undefined],
      // April falls within 12 % of the end and is dropped.
    ]);
  });

  it('are quarters under two years, as the drawing’s Inzhur axis', () => {
    const at = ticks('2024-11-14', '2026-10-21');
    expect(at.map((t) => [t.month, t.year])).toEqual([
      [0, 2025],
      [3, undefined],
      [6, undefined],
      [9, undefined],
      [0, 2026],
      [3, undefined],
      [6, undefined],
    ]);
    // The drawing places January 2025 at 6,78925 % of a 707-day axis.
    expect(at[0]!.left).toBeCloseTo(6.78925, 4);
  });

  it('are years beyond two years, with no month', () => {
    expect(ticks('2016-01-04', '2026-10-21').map((t) => [t.month, t.year])).toEqual(
      [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025].map((y) => [undefined, y]),
    );
  });
});

describe('a strip', () => {
  const axis = { from: '2026-10-01', to: '2026-10-10', days: 10 };

  it('draws the captured era from measured_from to last_as_of, rounded where it meets the track’s end', () => {
    const strip = stripOf(group({ measured_from: '2026-10-06' }), axis);
    expect(strip.captured).toEqual({
      left: 50,
      width: 50,
      roundLeft: false,
      roundRight: true,
      seam: false,
    });
    expect(strip.imported).toBeUndefined();
  });

  it('draws imported history before the captured era, at the seam', () => {
    const strip = stripOf(group({ measured_from: '2026-10-04', importedDays: '3' }), axis);
    expect(strip.imported).toEqual({ left: 0, width: 30, roundLeft: true });
    expect(strip.captured).toMatchObject({ left: 30, seam: true, roundLeft: false });
  });

  it('places a mark for a missing captured day, one per run of adjacent days', () => {
    const strip = stripOf(
      group({ emptyDays: 3, emptyDates: ['2026-10-03', '2026-10-04', '2026-10-08'] }),
      axis,
    );
    expect(strip.marks).toEqual([
      { left: 20, width: 20 },
      { left: 70, width: 10 },
    ]);
    expect(strip.cut).toBeUndefined();
  });

  it('draws no band for a group with no captured era, and still places its marks', () => {
    const strip = stripOf(
      group({
        dates: '0',
        measured_from: null,
        last_as_of: null,
        importedDays: '4',
        emptyDays: 1,
        emptyDates: ['2026-10-02'],
      }),
      axis,
    );
    expect(strip.captured).toBeUndefined();
    expect(strip.imported).toBeUndefined();
    expect(strip.marks).toEqual([{ left: 10, width: 10 }]);
  });

  it('hatches the span past the latest 100 from the earliest expected day, and counts it', () => {
    const strip = stripOf(
      group({
        measured_from: '2026-10-03',
        importedDays: '2',
        emptyDays: 5,
        emptyDates: ['2026-10-05', '2026-10-06'],
      }),
      axis,
    );
    expect(strip.cut).toEqual({ left: 0, width: 40, count: 3, before: '2026-10-05' });
  });

  it('counts a cut with no hatch where the earliest expected day is not served', () => {
    const strip = stripOf(
      group({
        dates: '0',
        measured_from: null,
        last_as_of: null,
        importedDays: '200',
        emptyDays: 150,
        emptyDates: ['2026-10-05'],
      }),
      axis,
    );
    expect(strip.cut).toEqual({ count: 149, before: '2026-10-05' });
  });
});

describe('the order', () => {
  it('puts the most empty days first, then the served order, a group not measured last', () => {
    const unmeasured = group({ instrument_ref: 'A', emptyDays: null, emptyDates: null });
    const groups = [
      unmeasured,
      group({ instrument_ref: 'B', emptyDays: 0 }),
      group({ instrument_ref: 'C', emptyDays: 2 }),
      group({ instrument_ref: 'D', emptyDays: 0 }),
      group({ instrument_ref: 'E', emptyDays: 5 }),
    ];
    expect(orderGroups(groups).map((g) => g.instrument_ref)).toEqual(['E', 'C', 'B', 'D', 'A']);
  });
});
