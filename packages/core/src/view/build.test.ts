import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { addDays } from '../dates';
import { PERIOD_OPTIONS } from '../period';
import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '../seed';
import type { Asset, Snapshot, Transaction } from '../types';
import { rebuildSnapshots } from '../valuation';
import { allocationView } from './allocation';
import { attributesView } from './attributes';
import { balancesView } from './balances';
import { buildView, type View } from './build';
import { capitalView } from './capital';
import type { ViewInput } from './input';
import { overviewView } from './overview';
import { payoutsView } from './payouts';
import { portfolioView } from './portfolio';
import { seasonalityView } from './seasonality';
import { asPriceRows, PUBLISHED_INPUT, TEST_LEDGERS } from './test-ledgers';
import { windowView } from './window';
import { cumulativeYieldSeriesIn, yieldView } from './yield';

// The ledger the composers read: nothing dated after the caller's day. Written out here, so the
// oracle does not read the function under test.
const asOf = <T extends ViewInput>(input: T): T => ({
  ...input,
  transactions: input.transactions.filter((t) => t.date <= input.today),
  snapshots: input.snapshots.filter((s) => s.date <= input.today),
});

const ledger = (name: string) => TEST_LEDGERS.find((l) => l.name === name)!.input;
const deposit = (date: string, amount: number): Transaction => ({
  id: `d-${date}`,
  date,
  type: 'deposit',
  assetId: '',
  amount,
});
const buy = (assetId: string, date: string, amount: number, quantity: number): Transaction => ({
  id: `b-${date}`,
  date,
  type: 'buy',
  assetId,
  amount,
  quantity,
});

describe.each(TEST_LEDGERS.map((l) => [l.name, l.input] as const))('buildView — %s', (_, input) => {
  const view = buildView(input);
  const cut = asOf(input);

  it('carries one block per period option, in the shared order', () => {
    expect(Object.keys(view.periods)).toEqual([...PERIOD_OPTIONS]);
  });

  it.each(PERIOD_OPTIONS)('the %s block is every windowed composer run with it', (period) => {
    const at = { ...cut, period };
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
    expect(view.payouts).toStrictEqual(payoutsView(cut));
    expect(view.portfolio).toStrictEqual(portfolioView(cut));
    expect(view.allocation).toStrictEqual(allocationView(cut));
    expect(view.attributes).toStrictEqual(attributesView(cut));
    expect(view.balances).toStrictEqual(balancesView(cut));
    expect(view.capital).toStrictEqual(capitalView(cut));
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

// Every figure stops at today (#358): a row entered ahead — a coupon known to be coming, a planned
// deposit — is absent from every composed figure until its day, as a Ghostfolio draft is.
describe('a transaction or a quote snapshot dated after today counts in no figure', () => {
  describe.each(TEST_LEDGERS.map((l) => [l.name, l.input] as const))('%s', (_, input) => {
    const tomorrow = addDays(input.today, 1);
    const first = input.assets[0]?.id;
    const ahead: ViewInput = {
      ...input,
      transactions: [
        ...input.transactions,
        deposit(tomorrow, 1000),
        ...(first === undefined ? [] : [buy(first, tomorrow, 1000, 10)]),
      ],
      snapshots: [...input.snapshots, { date: tomorrow, quotes: first ? { [first]: 1234 } : {} }],
    };

    it('composes as the ledger alone', () => {
      expect(buildView(ahead)).toStrictEqual(buildView(input));
    });
  });

  it('counts a transaction and a snapshot dated on today itself', () => {
    const seed = ledger('seed');
    const onDay: ViewInput = {
      ...seed,
      transactions: [...seed.transactions, deposit(seed.today, 1000)],
      // Complete, so the Balances chart lists the day.
      snapshots: [
        ...seed.snapshots,
        {
          date: seed.today,
          quotes: { reit: 68_702.1, energy: 60_100, ovdp8976: 15_850, ovdp6475: 4375 },
        },
      ],
    };
    const view = buildView(onDay);
    expect(view.portfolio.cash).toBe(buildView(seed).portfolio.cash + 1000);
    expect(view.periods.all.window?.to).toBe(seed.today);
    expect(view.balances.chart.at(-1)?.date).toBe(seed.today);
  });

  it('linked, whose rows all fall after its today, composes as the same ledger without them', () => {
    const linked = ledger('linked');
    expect(linked.transactions.every((t) => t.date > linked.today)).toBe(true);
    expect(buildView(linked)).toStrictEqual(buildView({ ...linked, transactions: [] }));
  });

  it('an asset whose only buy is ahead composes as an asset with no transaction yet', () => {
    const seed = ledger('seed');
    const tomorrow = addDays(seed.today, 1);
    const fresh: Asset = {
      id: 'fresh',
      name: 'Fresh fund',
      code: 'FR',
      colorKey: 'energy',
      yieldType: 'capitalization',
      expectedPct: 12,
      targetPct: 0,
      payoutSchedule: 'none',
      firstPurchase: tomorrow,
      createdAt: `${seed.today}T10:00:00`,
    };
    const withAsset: ViewInput = { ...seed, assets: [...seed.assets, fresh] };
    const ahead: ViewInput = {
      ...withAsset,
      transactions: [
        ...seed.transactions,
        deposit(tomorrow, 5000),
        buy('fresh', tomorrow, 5000, 500),
      ],
    };
    const view = buildView(ahead);
    expect(view).toStrictEqual(buildView(withAsset));
    // Named, as an asset no row has bought yet: nothing invested, its value and its Δ absent.
    const row = view.periods.all.yield.rows.find((r) => r.asset.id === 'fresh');
    expect(row).toBeDefined();
    expect([row!.invested, row!.value, row!.deltaTotal]).toEqual([0, undefined, undefined]);
  });
});

// `linked` composes as an empty ledger through `buildView` now, so its feed and payment dates reach
// no figure there: these two ledgers, every row on or before their day, carry both through the cut.
describe.each([
  ['linked on its buy day', { ...ledger('linked'), today: '2026-08-12' }],
  ['a bond with published dates', PUBLISHED_INPUT],
] as const)('buildView keeps the feed and the payment dates — %s', (_, input) => {
  const view = buildView(input);

  it('cuts nothing from it', () => {
    expect(asOf(input)).toStrictEqual(input);
  });

  it('carries every composer as it returns it', () => {
    for (const period of PERIOD_OPTIONS) {
      const at = { ...input, period };
      expect(view.periods[period]).toStrictEqual({
        window: windowView(at),
        overview: overviewView(at),
        yield: yieldView(at),
        seasonality: seasonalityView(at),
      });
    }
    expect(view.payouts).toStrictEqual(payoutsView(input));
    expect(view.attributes).toStrictEqual(attributesView(input));
  });
});

it('linked on its buy day solves its YTM at purchase through buildView', () => {
  const cards = buildView({ ...ledger('linked'), today: '2026-08-12' }).attributes.cards;
  expect(cards.some((c) => c.kind === 'bond' && c.ytm !== undefined)).toBe(true);
});

// #358's reproduction: on the series rebuilt from per-unit prices, a sale dated after today reached
// the table and not the curve, so the row's Δ was not the line's last point.
describe('a sale dated after today, on the series rebuilt from per-unit prices', () => {
  const today = '2026-07-28';
  const sale = (amount: number, quantity: number): Transaction => ({
    id: 'late',
    date: '2026-07-30',
    type: 'sell',
    assetId: 'energy',
    amount,
    quantity,
  });
  const cases = [
    { name: 'all 6 000 units', sold: sale(60_500, 6000) },
    { name: '1 000 of 6 000 units', sold: sale(10_000, 1000) },
  ];

  describe.each(cases)('energy sells $name on 30.07', ({ sold }) => {
    const transactions = [...SEED_TRANSACTIONS, sold];
    const energyRow = (view: View, period: (typeof PERIOD_OPTIONS)[number]) =>
      view.periods[period].yield.rows.find((r) => r.asset.id === 'energy')!;
    let snapshots: Snapshot[];
    let withSale: View;
    let without: View;
    beforeAll(() => {
      const user = asPriceRows(buildSeedSnapshots(), transactions);
      expect(user).toBeDefined();
      snapshots = rebuildSnapshots(SEED_ASSETS, transactions, { user: user!, archive: [] }, today);
      withSale = buildView({ assets: SEED_ASSETS, snapshots, transactions, today });
      without = buildView({
        assets: SEED_ASSETS,
        snapshots,
        transactions: SEED_TRANSACTIONS,
        today,
      });
    });

    it.each(PERIOD_OPTIONS)('%s: the row reads as without the sale', (period) => {
      expect(energyRow(withSale, period)).toStrictEqual(energyRow(without, period));
    });

    // Over the same cut ledger, the test's own: the series handler composes the curve outside
    // `buildView` and cuts it there.
    it.each(PERIOD_OPTIONS)('%s: the line ends on the row’s Δ', (period) => {
      const row = energyRow(withSale, period);
      const cut = asOf({ assets: SEED_ASSETS, snapshots, transactions, today });
      expect(cut.transactions).not.toContain(sold);
      const series = cumulativeYieldSeriesIn(
        cut.snapshots,
        cut.transactions,
        SEED_ASSETS,
        withSale.periods[period].yield.window,
      );
      const last = series.filter((p) => p.energy !== undefined).at(-1)!;
      expect(last.energy).toBeCloseTo(row.deltaTotal! * 100, 10);
    });
  });
});

describe('the clock is an input, never read', () => {
  const seed = ledger('seed');

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
