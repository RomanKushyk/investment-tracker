import { afterEach, describe, expect, it, vi } from 'vitest';

import { addMonths, daysBetween, latestSnapshotDate, todayIso } from './dates';
import type { Snapshot } from './types';

describe('todayIso', () => {
  afterEach(() => vi.useRealTimers());

  it('formats the LOCAL date as yyyy-MM-dd', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 12, 0, 0)); // local 28.07.2026
    expect(todayIso()).toBe('2026-07-28');
  });
});

describe('daysBetween', () => {
  it('matches the pinned 174-day global basis (03.02 -> 27.07)', () => {
    expect(daysBetween('2026-02-03', '2026-07-27')).toBe(174);
  });

  it('is 0 for the same date', () => {
    expect(daysBetween('2026-02-03', '2026-02-03')).toBe(0);
  });

  it('rounds firstPurchase-to-now spans used for "in N weeks" copy', () => {
    // 02.06 -> 27.07 = 55 days, matches the design's "…6475 +5.20% in 8 weeks"
    expect(daysBetween('2026-06-02', '2026-07-27')).toBe(55);
  });
});

describe('latestSnapshotDate', () => {
  const snaps: Snapshot[] = [
    { date: '2026-07-25', cash: 7.75, quotes: {} },
    { date: '2026-07-27', cash: 7.75, quotes: { reit: 68702.1 } },
    { date: '2026-02-03', cash: 0, quotes: {} },
  ];

  it('picks the max date regardless of array order', () => {
    expect(latestSnapshotDate(snaps)).toBe('2026-07-27');
  });

  it('returns undefined for an empty list', () => {
    expect(latestSnapshotDate([])).toBeUndefined();
  });
});

describe('addMonths', () => {
  it('advances the month, keeping the day (REIT dividend 10.07 -> next 10.08)', () => {
    expect(addMonths('2026-07-10', 1)).toBe('2026-08-10');
  });

  it('rolls over the year', () => {
    expect(addMonths('2026-12-03', 1)).toBe('2027-01-03');
  });

  it("clamps to the target month's last day instead of overflowing (G1)", () => {
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29'); // leap year keeps the 29th
  });
});
