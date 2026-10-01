import { afterEach, describe, expect, it, vi } from 'vitest';

import { PERIOD_OPTIONS } from '../period';
import { allocationView } from './allocation';
import { attributesView } from './attributes';
import { balancesView } from './balances';
import { buildView, type View } from './build';
import { capitalView } from './capital';
import { overviewView } from './overview';
import { payoutsView } from './payouts';
import { portfolioView } from './portfolio';
import { seasonalityView } from './seasonality';
import { TEST_LEDGERS } from './test-ledgers';
import { windowView } from './window';
import { yieldView } from './yield';

describe.each(TEST_LEDGERS.map((l) => [l.name, l.input] as const))('buildView — %s', (_, input) => {
  const view = buildView(input);

  it('carries one block per period option, in the shared order', () => {
    expect(Object.keys(view.periods)).toEqual([...PERIOD_OPTIONS]);
  });

  it.each(PERIOD_OPTIONS)('the %s block is every windowed composer run with it', (period) => {
    const at = { ...input, period };
    expect(view.periods[period]).toStrictEqual({
      window: windowView(at),
      overview: overviewView(at),
      yield: yieldView(at),
      seasonality: seasonalityView(at),
    });
  });

  // ONCE, NOT SIX TIMES: these take no period, and the Balances chart is one point
  // per snapshot.
  it('carries every period-invariant screen once, as its composer returns it', () => {
    expect(Object.keys(view).sort()).toEqual(
      ['allocation', 'attributes', 'balances', 'capital', 'payouts', 'periods', 'portfolio'].sort(),
    );
    expect(view.payouts).toStrictEqual(payoutsView(input));
    expect(view.portfolio).toStrictEqual(portfolioView(input));
    expect(view.allocation).toStrictEqual(allocationView(input));
    expect(view.attributes).toStrictEqual(attributesView(input));
    expect(view.balances).toStrictEqual(balancesView(input));
    expect(view.capital).toStrictEqual(capitalView(input));
  });

  it('shows one figure the same wherever two screens show it', () => {
    expect(view.portfolio.totals.value).toBe(view.capital.total);
    expect(view.periods.all.overview.total).toBe(view.capital.total);
    expect(view.portfolio.totals.net).toStrictEqual(view.capital.net);
    for (const p of PERIOD_OPTIONS) {
      expect(view.periods[p].overview.window).toStrictEqual(view.periods[p].window);
      expect(view.periods[p].yield.window).toStrictEqual(view.periods[p].window);
      expect(view.periods[p].overview.nextPayouts).toStrictEqual(view.payouts.nextPayouts);
    }
  });
});

describe('the clock is an input, never read', () => {
  const seed = TEST_LEDGERS.find((l) => l.name === 'seed')!.input;

  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers the same for one `today` under two system clocks', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 1, 12));
    const before = buildView(seed);
    vi.setSystemTime(new Date(2030, 5, 15, 12));
    expect(buildView(seed)).toStrictEqual(before);
  });

  it('moves the next payouts, and nothing else, with `today`', () => {
    const a = buildView({ ...seed, today: '2026-07-28' });
    const b = buildView({ ...seed, today: '2026-09-01' });
    expect(a.payouts.nextPayouts.map((r) => r.date)).toEqual([
      '2026-08-10',
      '2026-08-25',
      '2026-12-03',
    ]);
    expect(b.payouts.nextPayouts.map((r) => r.date)).toEqual([
      '2026-09-10',
      '2026-12-03',
      '2027-02-25',
    ]);
    const withoutNext = (v: View) => ({
      ...v,
      payouts: { ...v.payouts, nextPayouts: [] },
      periods: Object.fromEntries(
        Object.entries(v.periods).map(([p, block]) => [
          p,
          { ...block, overview: { ...block.overview, nextPayouts: [] } },
        ]),
      ),
    });
    expect(withoutNext(b)).toStrictEqual(withoutNext(a));
  });
});
