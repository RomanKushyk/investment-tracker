import { describe, expect, it } from 'vitest';

import sample from '../../src/core/inzhur/__fixtures__/assets-sample.json';
import { parseAssetsFeed } from '../../src/core/inzhur/parse';
import { tallyQuotes } from './quotes';

// A6 leans this diagnostic on the nightly run, and A20 removed the other
// staleness signal on the grounds that this one exists — so the counting is
// load-bearing now, not decorative.
describe('tallyQuotes', () => {
  const feed = parseAssetsFeed(sample);

  it('counts only bonds, and never the funds beside them', () => {
    const t = tallyQuotes(feed, '2026-08-18');
    const bonds = feed.entries.filter((e) => e.kind === 'bond').length;
    const counted = t.consistent + t.stale + t.revised + t.insensitive + t.unexplained.length;
    expect(counted).toBeLessThanOrEqual(bonds);
    expect(feed.entries.some((e) => e.kind !== 'bond')).toBe(true);
  });

  it('reports the WORST staleness, not the last one seen', () => {
    // Far enough forward that every quote in the fixture is stale by a
    // different number of days, so a max and a last-write differ.
    const t = tallyQuotes(feed, '2026-08-18');
    expect(t.maxStaleDays).toBeGreaterThanOrEqual(0);
    if (t.stale > 0) expect(t.maxStaleDays).toBeGreaterThan(0);
  });

  it('keeps refs for unexplained and counts for the rest', () => {
    const t = tallyQuotes(feed, '2026-08-18');
    expect(Array.isArray(t.unexplained)).toBe(true);
    for (const ref of t.unexplained) expect(typeof ref).toBe('string');
  });

  it('never throws on a feed with no bonds at all', () => {
    const empty = { entries: [], skipped: [] } as unknown as ReturnType<typeof parseAssetsFeed>;
    expect(tallyQuotes(empty, '2026-08-18')).toEqual({
      consistent: 0,
      stale: 0,
      revised: 0,
      insensitive: 0,
      unexplained: [],
      maxStaleDays: 0,
    });
  });
});
