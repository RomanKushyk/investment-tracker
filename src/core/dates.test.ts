import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addMonths,
  daysBetween,
  kyivDateIso,
  latestSnapshotDate,
  msUntilNextKyivHour,
  todayIso,
} from './dates';
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

const HOUR = 3_600_000;

describe('kyivDateIso', () => {
  it("reads the Inzhur schedule's midnight-Kyiv instants on the payment day", () => {
    // Winter (UTC+2) and summer (UTC+3) instants of the same fixture bonds —
    // both equal the bond's own maturityDate, which a UTC slice would miss.
    expect(kyivDateIso(new Date('2027-03-23T22:00:00.000Z'))).toBe('2027-03-24');
    expect(kyivDateIso(new Date('2028-09-26T21:00:00.000Z'))).toBe('2028-09-27');
  });

  it('keeps the local calendar day across midnight UTC', () => {
    expect(kyivDateIso(new Date('2026-01-15T21:30:00Z'))).toBe('2026-01-15'); // 23:30 Kyiv
    expect(kyivDateIso(new Date('2026-01-15T22:30:00Z'))).toBe('2026-01-16'); // 00:30 Kyiv
  });
});

describe('msUntilNextKyivHour (the Inzhur ~13:00 staleTime)', () => {
  it('counts to today’s 13:00 in winter, UTC+2', () => {
    // 09:00Z = 11:00 Kyiv (EET) -> 2 h left.
    expect(msUntilNextKyivHour(new Date('2026-01-15T09:00:00Z'), 13)).toBe(2 * HOUR);
  });

  it('counts to today’s 13:00 in summer, UTC+3', () => {
    // 09:00Z = 12:00 Kyiv (EEST) -> 1 h left.
    expect(msUntilNextKyivHour(new Date('2026-07-15T09:00:00Z'), 13)).toBe(HOUR);
  });

  it('rolls to tomorrow once the refresh has passed', () => {
    // 11:00Z = 14:00 Kyiv -> next refresh 16.07 13:00 Kyiv = 10:00Z.
    expect(msUntilNextKyivHour(new Date('2026-07-15T11:00:00Z'), 13)).toBe(23 * HOUR);
  });

  it('is exact across the spring-forward switch (clocks +1 h overnight)', () => {
    // 28.03 16:00 Kyiv (EET) -> 29.03 13:00 Kyiv is already EEST = 10:00Z,
    // i.e. 20 h, not the 21 h a hardcoded +2 would give.
    expect(msUntilNextKyivHour(new Date('2026-03-28T14:00:00Z'), 13)).toBe(20 * HOUR);
  });

  it('is exact across the fall-back switch (clocks −1 h overnight)', () => {
    // 24.10 17:00 Kyiv (EEST) -> 25.10 13:00 Kyiv is EET = 11:00Z, i.e. 21 h,
    // not the 20 h a hardcoded +3 would give.
    expect(msUntilNextKyivHour(new Date('2026-10-24T14:00:00Z'), 13)).toBe(21 * HOUR);
  });

  it('never returns 0 or a negative span (the boundary instant rolls forward)', () => {
    const atRefresh = new Date('2026-07-15T10:00:00Z'); // exactly 13:00 Kyiv
    expect(msUntilNextKyivHour(atRefresh, 13)).toBe(24 * HOUR);
  });
});
