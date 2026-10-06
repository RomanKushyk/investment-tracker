import { describe, expect, it } from 'vitest';

import { NBU_RATE_SET_BY, inzhurAsOf, nbuAsOf, rateDatesDue } from './dates';

// THE TWO DATES HAD NO TEST, and they were one function that was wrong for
// eight days of Inzhur rows (*The price archive*). This pins the split itself: the same instant
// must produce DIFFERENT dates for the two sources, and the Kyiv-vs-UTC trap
// must stay closed.
describe('as-of dates', () => {
  // 01:00 Europe/Kyiv on 18 August 2026 is 22:00 UTC on the 17th, so a subtraction done on the
  // UTC date yields D-2 rather than D-1.
  const scheduledRun = new Date('2026-08-17T22:00:00Z');

  it('gives Inzhur the Kyiv date of the run, not the day before', () => {
    expect(inzhurAsOf(scheduledRun)).toBe('2026-08-18');
  });

  it('gives NBU the previous Kyiv date, because that is the newest file that exists', () => {
    expect(nbuAsOf(scheduledRun)).toBe('2026-08-17');
  });

  it('never lets the two agree — a single date is the defect it fixed', () => {
    expect(inzhurAsOf(scheduledRun)).not.toBe(nbuAsOf(scheduledRun));
  });

  it('subtracts on the KYIV date, so the UTC rollover cannot yield D-2', () => {
    // Its own literal, deliberately: this stays pinned even if `scheduledRun` is ever retimed
    // to an instant whose UTC date already matches. `setUTCDate(getUTCDate() - 1)` here gives
    // 08-16, which is what the name rules out.
    expect(nbuAsOf(new Date('2026-08-17T22:00:00Z'))).toBe('2026-08-17');
  });

  it('rolls over months and years without hand-written arithmetic', () => {
    expect(nbuAsOf(new Date('2027-01-01T00:00:00Z'))).toBe('2026-12-31');
    expect(inzhurAsOf(new Date('2027-01-01T00:00:00Z'))).toBe('2027-01-01');
    expect(nbuAsOf(new Date('2026-03-01T12:00:00Z'))).toBe('2026-02-28');
  });
});

// NBU sets a date's official rate by 15:30 Kyiv the day before (Resolution 148), so from then on
// tomorrow's rate is due too. Both offsets, because 15:30 Kyiv is 12:30 UTC in summer and 13:30 in
// winter; and midnight, because the day the run takes as today is Kyiv's, not UTC's.
describe('the official rate dates due', () => {
  it('pins the time Resolution 148 sets', () => {
    expect(NBU_RATE_SET_BY).toBe('15:30');
  });

  it('is today alone until 15:30 Kyiv, and today and tomorrow from then, in summer', () => {
    expect(rateDatesDue(new Date('2026-07-15T12:29:59Z'))).toEqual(['2026-07-15']);
    expect(rateDatesDue(new Date('2026-07-15T12:30:00Z'))).toEqual(['2026-07-15', '2026-07-16']);
  });

  it('is today alone until 15:30 Kyiv, and today and tomorrow from then, in winter', () => {
    expect(rateDatesDue(new Date('2026-12-15T13:29:59Z'))).toEqual(['2026-12-15']);
    expect(rateDatesDue(new Date('2026-12-15T13:30:00Z'))).toEqual(['2026-12-15', '2026-12-16']);
  });

  it('turns over at Kyiv’s midnight', () => {
    expect(rateDatesDue(new Date('2026-12-31T21:59:59Z'))).toEqual(['2026-12-31', '2027-01-01']);
    expect(rateDatesDue(new Date('2026-12-31T22:00:00Z'))).toEqual(['2027-01-01']);
  });
});
