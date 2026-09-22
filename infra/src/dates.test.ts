import { describe, expect, it } from 'vitest';

import { inzhurAsOf, nbuAsOf } from './dates';

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
