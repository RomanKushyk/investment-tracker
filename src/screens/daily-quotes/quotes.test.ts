import { describe, expect, it } from 'vitest';

import { SEED_ASSETS } from '../../lib/seed';
import type { Snapshot } from '../../core/types';
import { bondAbbrev, collectQuotes, maxSavedAt, pendingChange, yesterdayQuote } from './quotes';

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
    const earlier: Snapshot = {
      date: '2026-07-20',
      cash: 0,
      quotes: {},
      savedAt: '2026-07-20T10:00:00',
    };
    expect(maxSavedAt([earlier, complete2507])).toBe('2026-07-25T21:14:00');
  });
});

describe('bondAbbrev', () => {
  it('combines the first word of the name with the last-4 suffix ("OVDP …8976")', () => {
    const ovdp8976 = SEED_ASSETS.find((a) => a.id === 'ovdp8976')!;
    expect(bondAbbrev(ovdp8976)).toBe('OVDP …8976');
    const ovdp6475 = SEED_ASSETS.find((a) => a.id === 'ovdp6475')!;
    expect(bondAbbrev(ovdp6475)).toBe('OVDP …6475');
  });
});

describe('pendingChange — what the rail names', () => {
  // 25.07 is the complete snapshot above; 27.07 is the day the seed's own
  // README example works from, and there is no 26.07, so «учора» on the 27th is
  // the 25th. Every case below drafts against that.
  const snapshots = [complete2507];
  const assets = SEED_ASSETS;
  const on = '2026-07-27';

  it('is silent until a draft differs from its baseline', () => {
    expect(pendingChange(assets, {}, snapshots, on)).toEqual({ sum: 0, changed: 0 });
  });

  it('counts a row that is FILLED but unchanged as no change at all', () => {
    // 68 629,36 is exactly what 25.07 holds for REIT — the row is filled, the
    // portfolio moves by nothing, and `filled(n, m)` would still say 1.
    expect(pendingChange(assets, { reit: '68629.36' }, snapshots, on)).toEqual({
      sum: 0,
      changed: 0,
    });
  });

  it('sums the deltas and counts only the rows that moved', () => {
    const got = pendingChange(
      assets,
      { reit: '68702.10', energy: '60086.09', ovdp8976: '15900' },
      snapshots,
      on,
    );
    // REIT +72,74 · Energy unchanged · …8976 +53,70
    expect(got.changed).toBe(2);
    expect(got.sum).toBeCloseTo(126.44, 2);
  });

  it('subtracts a NEGATIVE move too — it is a change, not a total', () => {
    const got = pendingChange(assets, { reit: '68000' }, snapshots, on);
    expect(got.changed).toBe(1);
    expect(got.sum).toBeCloseTo(-629.36, 2);
  });

  it('ignores a draft the schema refuses', () => {
    for (const bad of ['', 'abc', '-5', '0']) {
      expect(pendingChange(assets, { reit: bad }, snapshots, on)).toEqual({ sum: 0, changed: 0 });
    }
  });

  // THE TRAP THE SHEET NAMES. With the picker off today, an unbounded baseline
  // (`latestQuotes`) would measure against a LATER snapshot than the sublines
  // beside it. Drafting for 26.07 must compare against 25.07 and NOT against the
  // 28.07 row that exists in the store.
  it('reads the baseline strictly BEFORE the picked date, never the latest', () => {
    const later: Snapshot = { date: '2026-07-28', cash: 0, quotes: { reit: 70000 } };
    const got = pendingChange(assets, { reit: '68700' }, [complete2507, later], '2026-07-26');
    expect(got.changed).toBe(1);
    expect(got.sum).toBeCloseTo(70.64, 2); // 68 700 − 68 629,36, not 68 700 − 70 000
  });

  it('does not count an asset that has no baseline yet', () => {
    // Its row shows no «учора», so there is nothing to be less than — and a
    // first quote is not a change of anything.
    const fresh: Snapshot = { date: '2026-07-25', cash: 0, quotes: { reit: 68629.36 } };
    const got = pendingChange(assets, { energy: '60000' }, [fresh], on);
    expect(got).toEqual({ sum: 0, changed: 0 });
  });
});

describe('collectQuotes — what Save reads, and what it refuses', () => {
  const assets = SEED_ASSETS;

  it('reads every non-empty draft and reports none unreadable', () => {
    const out = collectQuotes({ reit: '68 702,10', energy: '60086.09' }, assets);
    expect(out).toEqual({ quotes: { reit: 68702.1, energy: 60086.09 }, unreadable: [] });
  });

  it('skips an empty or untouched draft — it is not an error', () => {
    expect(collectQuotes({ reit: '', energy: '   ' }, assets)).toEqual({
      quotes: {},
      unreadable: [],
    });
    expect(collectQuotes({}, assets)).toEqual({ quotes: {}, unreadable: [] });
  });

  it('names the asset it cannot read and still reads the rest', () => {
    const out = collectQuotes({ reit: '12abc', energy: '60086.09' }, assets);
    expect(out.unreadable).toEqual(['reit']);
    expect(out.quotes).toEqual({ energy: 60086.09 });
  });

  // Issue #1's bytes, read through the screen's own path rather than the schema alone.
  it("reads the reported paste through the screen's own path", () => {
    expect(collectQuotes({ energy: '4 214,24 грн. ' }, assets).quotes.energy).toBe(4214.24);
  });

  it('treats zero and a negative as unreadable, like the schema', () => {
    expect(collectQuotes({ reit: '0', energy: '-5' }, assets).unreadable).toEqual([
      'reit',
      'energy',
    ]);
  });
});
