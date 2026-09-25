// Fixture-driven: the fund quotes of every committed feed capture, against the data-model spec's
// account of them (*What the feed actually contains*).
import { describe, expect, it } from 'vitest';

import { parseAssetsFeed } from './parse';
import july from './__fixtures__/assets-sample.json';
import september from './__fixtures__/assets-2026-09-24.json';

/** The feed quotes a fund to four decimals. */
const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** The funds that have a `nav` to quote on: a completed fund reads `nav` 0. */
function funds(payload: unknown) {
  return parseAssetsFeed(payload).entries.filter((e) => e.kind === 'fund' && (e.navUAH ?? 0) > 0);
}

type Factors = Record<string, { sell: number; buy: number }>;

// The provider sets a factor per fund and side and changed them between these captures, so a
// fund's `sell` and `buy` are captured, never derived from its `nav`.
const CAPTURES: [string, unknown, Factors][] = [
  [
    '2026-07-28',
    july,
    {
      'inzhur-energy': { sell: 1.009, buy: 1.01 },
      'inzhur-reit': { sell: 1.009, buy: 1.01 },
    },
  ],
  [
    '2026-09-24',
    september,
    {
      'inzhur-energy': { sell: 1, buy: 1.0025 },
      'inzhur-miltech': { sell: 0.995, buy: 1 },
      'inzhur-reit': { sell: 1, buy: 1.0025 },
    },
  ],
];

describe('a fund quotes its nav times factors of its own', () => {
  it.each(CAPTURES)('on %s, sell and buy per fund', (_, payload, factors) => {
    const quoted = funds(payload);
    expect(quoted.map((f) => f.ref).sort()).toEqual(Object.keys(factors).sort());
    for (const fund of quoted) {
      const { sell, buy } = factors[fund.ref];
      expect(fund.sellUAH, `${fund.ref} sell`).toBe(round4(fund.navUAH! * sell));
      expect(fund.buyUAH, `${fund.ref} buy`).toBe(round4(fund.navUAH! * buy));
    }
  });
});
