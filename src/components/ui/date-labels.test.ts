import { describe, expect, it } from 'vitest';

import { fmtPayoutDate, MONTH_SHORT, ordinal } from './date-labels';

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
