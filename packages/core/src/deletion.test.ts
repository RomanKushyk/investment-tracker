import { describe, expect, it } from 'vitest';

import { deletionLastDay, deletionWindowOpen } from './deletion';

// Kyiv is UTC+2 from 2026-10-25 to 2027-03-28 and UTC+3 either side of it.
describe('deletionLastDay', () => {
  it('is the 30th day, counting the Kyiv day after the press as the first (#572)', () => {
    expect(deletionLastDay(new Date('2026-10-30T10:00:00Z'))).toBe('2026-11-29');
  });

  it('does not roll a Sunday last day forward', () => {
    expect(new Date('2026-11-29T12:00:00Z').getUTCDay()).toBe(0);
    expect(deletionLastDay(new Date('2026-10-30T10:00:00Z'))).toBe('2026-11-29');
  });

  it('crosses a month’s end', () => {
    expect(deletionLastDay(new Date('2026-01-31T10:00:00Z'))).toBe('2026-03-02');
  });

  it('crosses a year’s end', () => {
    expect(deletionLastDay(new Date('2026-12-05T10:00:00Z'))).toBe('2027-01-04');
  });

  it('counts from the Kyiv day of the press, not the UTC one', () => {
    // 23:59 in Kyiv on 30.10 is still the 30th.
    expect(deletionLastDay(new Date('2026-10-30T21:59:00Z'))).toBe('2026-11-29');
    // 00:00:30 in Kyiv on 31.10 is the 31st, though UTC still reads the 30th.
    expect(deletionLastDay(new Date('2026-10-30T22:00:30Z'))).toBe('2026-11-30');
  });
});

describe('deletionWindowOpen', () => {
  const due = '2026-11-29';

  it('stays open to the last instant of the last day in Kyiv', () => {
    expect(deletionWindowOpen(due, new Date('2026-11-29T21:59:59.999Z'))).toBe(true);
  });

  it('closes as that day ends in Kyiv', () => {
    expect(deletionWindowOpen(due, new Date('2026-11-29T22:00:00Z'))).toBe(false);
  });

  it('is open on the day of the press', () => {
    expect(deletionWindowOpen(due, new Date('2026-10-30T10:00:00Z'))).toBe(true);
  });
});
