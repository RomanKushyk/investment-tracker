import { describe, expect, it } from 'vitest';

import type { Snapshot } from '../../lib/types';
import { maxSavedAt, yesterdayQuote } from './quotes';

const complete2507: Snapshot = {
  date: '2026-07-25',
  cash: 7.75,
  savedAt: '2026-07-25T21:14:00',
  quotes: { reit: 68629.36, energy: 60086.09, ovdp8976: 15846.3, ovdp6475: 4374.12 },
};
const partial2707: Snapshot = { date: '2026-07-27', cash: 7.75, quotes: { reit: 68702.1 } };
const snaps = [complete2507, partial2707];

describe('yesterdayQuote', () => {
  it('finds the latest prior snapshot with a quote for the asset, skipping the gap day (no 26.07)', () => {
    expect(yesterdayQuote(snaps, 'reit', '2026-07-27')).toBe(68629.36);
    expect(yesterdayQuote(snaps, 'energy', '2026-07-27')).toBe(60086.09);
  });

  it('returns undefined when the asset has no quote before the selected date', () => {
    expect(yesterdayQuote(snaps, 'reit', '2026-02-03')).toBeUndefined();
    expect(yesterdayQuote([], 'reit', '2026-07-27')).toBeUndefined();
  });

  it('ignores same-date and future snapshots', () => {
    expect(yesterdayQuote(snaps, 'reit', '2026-07-25')).toBeUndefined();
  });
});

describe('maxSavedAt', () => {
  it('picks the most recent savedAt, ignoring snapshots that were never saved', () => {
    expect(maxSavedAt(snaps)).toBe('2026-07-25T21:14:00');
  });

  it('returns undefined when nothing has been saved', () => {
    expect(maxSavedAt([partial2707])).toBeUndefined();
    expect(maxSavedAt([])).toBeUndefined();
  });

  it('takes the max across multiple saved snapshots', () => {
    const earlier: Snapshot = { date: '2026-07-20', cash: 0, quotes: {}, savedAt: '2026-07-20T10:00:00' };
    expect(maxSavedAt([earlier, complete2507])).toBe('2026-07-25T21:14:00');
  });
});
