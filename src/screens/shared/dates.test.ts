import { describe, expect, it } from 'vitest';

import type { Snapshot } from '../../lib/types';
import { addMonths, daysBetween, fmtPayoutDate, latestSnapshotDate, MONTH_SHORT, ordinal } from './dates';

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
});

describe('fmtPayoutDate', () => {
  it('renders "d MMM" (design: "10 Aug", "25 Aug")', () => {
    expect(fmtPayoutDate('2026-08-10')).toBe('10 Aug');
    expect(fmtPayoutDate('2026-08-25')).toBe('25 Aug');
    expect(fmtPayoutDate('2026-12-03')).toBe('3 Dec');
  });
});

describe('MONTH_SHORT', () => {
  it('is indexable by (month - 1) for chart axis labels (Payouts/Seasonality)', () => {
    expect(MONTH_SHORT[1]).toBe('Feb');
    expect(MONTH_SHORT[6]).toBe('Jul');
  });
});

describe('ordinal', () => {
  it('formats common day-of-month suffixes', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(10)).toBe('10th');
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(25)).toBe('25th');
  });
});
