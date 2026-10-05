import { describe, expect, it } from 'vitest';

import { dayBefore } from './dates';
import { heldQuotesAsOf } from './derive';
import { PERIOD_OPTIONS } from './period';
import { buildSeedSnapshots, SEED_TRANSACTIONS } from './seed';
import type { Asset, Snapshot, Transaction } from './types';
import { rebuildSnapshots, type PriceRow, type ValuedSnapshot } from './valuation';
import { buildView } from './view/build';
import { asPriceRows, TEST_LEDGERS } from './view/test-ledgers';
import { windowView } from './view/window';

const buy = (id: string, assetId: string, date: string, amount: number, quantity: number) =>
  ({ id, date, type: 'buy', assetId, amount, quantity }) as const satisfies Transaction;
const deposit = (id: string, date: string, amount = 100) =>
  ({ id, date, type: 'deposit', assetId: '', amount }) as const satisfies Transaction;
const row = (assetId: string, asOf: string, price: number): PriceRow => ({ assetId, asOf, price });

const NO_ASSETS: Asset[] = [];
// Uncapped unless a test names the caller's day, so the cap never hides behind a grid rule.
const NO_CAP = '9999-12-31';
const rebuild = (
  txs: Transaction[],
  user: PriceRow[],
  archive: PriceRow[] = [],
  assets: Asset[] = NO_ASSETS,
  today = NO_CAP,
) => rebuildSnapshots(assets, txs, { user, archive }, today);
const at = (series: ValuedSnapshot[], date: string) => series.find((s) => s.date === date);
const dates = (series: ValuedSnapshot[]) => series.map((s) => s.date);

const TXS: Transaction[] = [
  buy('b1', 'a1', '2026-03-01', 1000, 100),
  buy('b2', 'a2', '2026-03-01', 500, 50),
];

describe('rebuildSnapshots — a price carries forward: the latest at or before the day', () => {
  const prices = [
    row('a1', '2026-04-01', 11),
    row('a2', '2026-04-01', 9),
    row('a1', '2026-05-01', 12),
  ];

  it('values each asset at that day’s units × price, a price carried where none was observed', () => {
    expect(rebuild(TXS, prices).map(({ date, quotes }) => ({ date, quotes }))).toEqual([
      { date: '2026-04-01', quotes: { a1: 1100, a2: 450 } },
      { date: '2026-05-01', quotes: { a1: 1200, a2: 450 } },
    ]);
  });

  it('a buy after the last observation is valued on its own day at the carried price', () => {
    const late = [...TXS, buy('b3', 'a1', '2026-04-15', 550, 50)];
    const day = at(rebuild(late, [row('a1', '2026-04-01', 11)]), '2026-04-15')!;
    expect(day.quotes.a1).toBe(1650);
    expect(day.observed.a1).toEqual({ price: 11, observedOn: '2026-04-01', source: 'user' });
  });

  it('a carried value names the day its price was observed; an observed one its own', () => {
    const late = [...TXS, buy('b3', 'a1', '2026-04-15', 550, 50)];
    const series = rebuild(late, [row('a1', '2026-04-01', 11)]);
    expect(at(series, '2026-04-01')!.observed.a1.observedOn).toBe('2026-04-01');
    expect(at(series, '2026-04-15')!.observed.a1.observedOn).toBe('2026-04-01');
  });

  it('a position sold out has no quote, as the quotes form asks for none; the ledger makes it 0', () => {
    const closed = [
      ...TXS,
      { id: 's1', date: '2026-05-01', type: 'sell', assetId: 'a1', amount: 1200, quantity: 100 },
      deposit('d1', '2026-06-01'),
    ] satisfies Transaction[];
    const series = rebuild(closed, [row('a1', '2026-04-01', 11), row('a2', '2026-04-01', 9)]);
    for (const date of ['2026-05-01', '2026-06-01']) {
      expect(Object.hasOwn(at(series, date)!.quotes, 'a1')).toBe(false);
      expect(Object.hasOwn(at(series, date)!.observed, 'a1')).toBe(false);
    }
    expect(heldQuotesAsOf(series, closed, '2026-06-01').a1).toBe(0);
  });

  it('an observation after a sell-out gives the position no quote on any day', () => {
    const closed = [
      ...TXS,
      { id: 's2', date: '2026-04-10', type: 'sell', assetId: 'a2', amount: 480, quantity: 50 },
      deposit('d1', '2026-05-01'),
    ] satisfies Transaction[];
    const series = rebuild(closed, [row('a1', '2026-03-01', 10)], [row('a2', '2026-04-20', 9)]);
    for (const date of ['2026-03-01', '2026-04-10', '2026-05-01']) {
      expect(Object.hasOwn(at(series, date)!.quotes, 'a2')).toBe(false);
    }
  });

  it('a position sold out and bought back is valued from the rebuy at the latest price', () => {
    const txs = [
      buy('b1', 'a1', '2026-03-01', 1000, 100),
      { id: 's1', date: '2026-04-01', type: 'sell', assetId: 'a1', amount: 1100, quantity: 100 },
      buy('b2', 'a1', '2026-05-10', 480, 40),
    ] satisfies Transaction[];
    const series = rebuild(txs, [row('a1', '2026-03-01', 10)], [row('a1', '2026-05-01', 12)]);
    expect(Object.hasOwn(at(series, '2026-04-01')!.quotes, 'a1')).toBe(false);
    expect(at(series, '2026-05-01')).toBeUndefined();
    expect(at(series, '2026-05-10')!.quotes.a1).toBe(480);
    expect(at(series, '2026-05-10')!.observed.a1).toEqual({
      price: 12,
      observedOn: '2026-05-01',
      source: 'archive',
    });
  });

  it('a position never yet held is absent, not 0, whatever the archive priced it at', () => {
    const later = [...TXS, buy('b3', 'a3', '2026-06-01', 700, 70)];
    const series = rebuild(later, [row('a1', '2026-04-01', 11)], [row('a3', '2026-02-15', 10)]);
    expect(at(series, '2026-02-15')).toBeUndefined();
    expect(Object.hasOwn(at(series, '2026-04-01')!.quotes, 'a3')).toBe(false);
    expect(at(series, '2026-06-01')!.quotes.a3).toBe(700);
  });

  it('a date that values nothing has no snapshot: a priced asset the ledger cannot count', () => {
    const uncounted: Transaction[] = [
      { id: 'b1', date: '2026-03-01', type: 'buy', assetId: 'a1', amount: 1000 },
    ];
    expect(rebuild(uncounted, [row('a1', '2026-04-01', 11)])).toEqual([]);
  });

  it('comes out in date order, whatever order the rows and the ledger arrive in', () => {
    const archive = [row('a2', '2026-04-20', 10)];
    const expected = rebuild(TXS, prices, archive);
    expect(dates(expected)).toEqual(['2026-04-01', '2026-04-20', '2026-05-01']);
    expect(rebuild(TXS, [...prices].reverse(), archive)).toEqual(expected);
    expect(rebuild(TXS, prices, [...archive].reverse())).toEqual(expected);
    expect(rebuild([...TXS].reverse(), prices, archive)).toEqual(expected);
  });
});

describe('rebuildSnapshots — between the sources the newer observation wins, the user’s on a tie', () => {
  const withDeposit = [...TXS, deposit('d1', '2026-04-15')];

  it('a newer archive price outranks an older user price, and carries over it', () => {
    const series = rebuild(
      withDeposit,
      [row('a1', '2026-04-01', 11)],
      [row('a1', '2026-04-10', 12)],
    );
    expect(at(series, '2026-04-10')!.quotes.a1).toBe(1200);
    expect(at(series, '2026-04-10')!.observed.a1.source).toBe('archive');
    expect(at(series, '2026-04-15')!.observed.a1).toEqual({
      price: 12,
      observedOn: '2026-04-10',
      source: 'archive',
    });
  });

  it('a newer user price outranks an older archive price the same way', () => {
    const series = rebuild(
      withDeposit,
      [row('a1', '2026-04-10', 11)],
      [row('a1', '2026-04-01', 12)],
    );
    expect(at(series, '2026-04-01')!.observed.a1.source).toBe('archive');
    expect(at(series, '2026-04-15')!.observed.a1).toEqual({
      price: 11,
      observedOn: '2026-04-10',
      source: 'user',
    });
  });

  it('the user’s price wins only on the same date', () => {
    const user = [row('a1', '2026-04-10', 11)];
    const archive = [row('a1', '2026-04-10', 12)];
    const series = rebuild(withDeposit, user, archive);
    expect(at(series, '2026-04-10')!.quotes.a1).toBe(1100);
    expect(at(series, '2026-04-15')!.observed.a1).toEqual({
      price: 11,
      observedOn: '2026-04-10',
      source: 'user',
    });
  });
});

describe('rebuildSnapshots — an asset is absent before its first observation from either source', () => {
  it('has no key until a source has priced it, then takes that source', () => {
    const series = rebuild(TXS, [row('a1', '2026-04-01', 11)], [row('a2', '2026-05-01', 9)]);
    expect(at(series, '2026-03-01')).toBeUndefined();
    expect(Object.hasOwn(at(series, '2026-04-01')!.quotes, 'a2')).toBe(false);
    expect(at(series, '2026-05-01')!.quotes.a2).toBe(450);
    expect(at(series, '2026-05-01')!.observed.a2.source).toBe('archive');
  });
});

describe('rebuildSnapshots — the grid', () => {
  it('holds every day a held asset is observed on', () => {
    const series = rebuild(TXS, [row('a1', '2026-04-01', 11), row('a1', '2026-04-20', 11.5)]);
    expect(dates(series)).toEqual(['2026-04-01', '2026-04-20']);
  });

  it('an observation of an asset the ledger holds none of that day makes no day', () => {
    // a1 is held and priced on 03-20, so the day would value it; only a2 is observed, unheld.
    const txs = [buy('b1', 'a1', '2026-03-01', 1000, 100), buy('b2', 'a2', '2026-05-01', 500, 50)];
    const user = [row('a1', '2026-03-01', 10), row('a1', '2026-04-01', 11)];
    const series = rebuild(txs, user, [row('a2', '2026-03-20', 9)]);
    // 03-31 is the day before the `1m` window opens, not an observation.
    expect(dates(series)).toEqual(['2026-03-01', '2026-03-31', '2026-04-01', '2026-05-01']);
  });

  it('holds every transaction day from the first observation on', () => {
    const txs: Transaction[] = [
      deposit('d0', '2026-02-15'),
      buy('b1', 'a1', '2026-03-01', 1000, 100),
      { id: 'p1', date: '2026-03-15', type: 'interest_payout', assetId: 'a1', amount: 30 },
      deposit('d1', '2026-03-20'),
    ];
    const series = rebuild(txs, [row('a1', '2026-03-01', 10)]);
    expect(dates(series)).toEqual(['2026-03-01', '2026-03-15', '2026-03-20']);
    expect(at(series, '2026-03-20')!.observed.a1.observedOn).toBe('2026-03-01');
  });

  // Monthly observations, so a window's opening day is a day nothing was observed on.
  const monthly = [
    row('a1', '2026-03-01', 10),
    row('a1', '2026-04-01', 11),
    row('a1', '2026-05-01', 12),
    row('a1', '2026-06-01', 13),
  ];
  const held = [buy('b1', 'a1', '2026-03-01', 1000, 100)];

  it('holds the day before each period opens, carried; one before the first observation is dropped', () => {
    const series = rebuild(held, monthly);
    // `1m` opens 2026-05-01, read the day before; `3m` and the clamped options open on the
    // first day, whose eve has no price.
    expect(dates(series)).toEqual([
      '2026-03-01',
      '2026-04-01',
      '2026-04-30',
      '2026-05-01',
      '2026-06-01',
    ]);
    expect(at(series, '2026-04-30')!.observed.a1.observedOn).toBe('2026-04-01');
  });

  it('closes every window on its latest day: a transaction after the last observation, carried', () => {
    const late = [...held, deposit('d1', '2026-07-15')];
    const snapshots = rebuild(late, monthly);
    expect(dates(snapshots).at(-1)).toBe('2026-07-15');
    expect(at(snapshots, '2026-07-15')!.observed.a1.observedOn).toBe('2026-06-01');
    for (const period of PERIOD_OPTIONS) {
      const w = windowView({ assets: NO_ASSETS, snapshots, transactions: late, period })!;
      expect(w.to, period).toBe('2026-07-15');
    }
  });

  it('keeps a transaction day that values nothing once anything has been valued: a full exit', () => {
    const exit = [
      ...held,
      { id: 's1', date: '2026-06-20', type: 'sell', assetId: 'a1', amount: 1300, quantity: 100 },
      { id: 'w1', date: '2026-07-01', type: 'withdrawal', assetId: '', amount: 1300 },
    ] satisfies Transaction[];
    const snapshots = rebuild(exit, monthly);
    expect(at(snapshots, '2026-06-20')!.quotes).toEqual({});
    expect(at(snapshots, '2026-07-01')!.quotes).toEqual({});
    for (const period of PERIOD_OPTIONS) {
      const w = windowView({ assets: NO_ASSETS, snapshots, transactions: exit, period })!;
      expect(w.to, period).toBe('2026-07-01');
    }
  });

  it('is a fixed point of the windows it holds: each closes on a day it has, each opens after one', () => {
    const snapshots = rebuild(held, monthly);
    const observedOrBefore = (day: string) => monthly.some((r) => r.asOf <= day);
    for (const period of PERIOD_OPTIONS) {
      const w = windowView({ assets: NO_ASSETS, snapshots, transactions: held, period })!;
      expect(at(snapshots, w.to), period).toBeDefined();
      const eve = dayBefore(w.from);
      expect(at(snapshots, eve) !== undefined || !observedOrBefore(eve), period).toBe(true);
    }
  });

  // The caller's day itself is kept, a transaction or a price on it making a day; a later one is not.
  const today = '2026-07-28';
  const capped = (txs: Transaction[], user: PriceRow[], archive: PriceRow[] = []) =>
    rebuild(txs, user, archive, NO_ASSETS, today);
  const priced = [row('a1', '2026-03-01', 10), row('a1', '2026-06-01', 13)];
  const upToToday = [...held, deposit('d0', today)];

  it('adds no day after the caller’s: a transaction dated later closes no window', () => {
    const future = [...upToToday, deposit('d1', '2027-01-15')];
    const snapshots = capped(future, priced);
    expect(snapshots).toEqual(capped(upToToday, priced));
    expect(dates(snapshots).at(-1)).toBe(today);
    for (const period of PERIOD_OPTIONS) {
      const w = windowView({ assets: NO_ASSETS, snapshots, transactions: future, period })!;
      expect(w.to, period).toBe(today);
    }
  });

  it.each(['user', 'archive'] as const)(
    'adds no day after the caller’s: the %s’s price observed later makes none',
    (source) => {
      const later = row('a1', '2027-02-01', 14);
      const snapshots =
        source === 'user'
          ? capped(upToToday, [...priced, later])
          : capped(upToToday, priced, [later]);
      expect(snapshots).toEqual(capped(upToToday, priced));
    },
  );

  it('keeps the caller’s own day: a price observed on it makes a day, no transaction needed', () => {
    const snapshots = capped(held, [...priced, row('a1', today, 14)]);
    expect(dates(snapshots).at(-1)).toBe(today);
    expect(at(snapshots, today)!.observed.a1.observedOn).toBe(today);
  });
});

const stored = (snapshots: Snapshot[]): Snapshot[] =>
  snapshots.map(({ date, quotes }) => ({ date, quotes }));

// The paths where two outputs differ by more than `tolerance`, relative: 0 is exact.
function differences(a: unknown, b: unknown, tolerance: number, path = '$'): string[] {
  if (typeof a === 'number' && typeof b === 'number') {
    const limit = tolerance * Math.max(Math.abs(a), Math.abs(b));
    return Object.is(a, b) || Math.abs(a - b) <= limit ? [] : [path];
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return Object.is(a, b) ? [] : [path];
  }
  const at = (o: object, k: string) => (o as Record<string, unknown>)[k];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => differences(at(a, k), at(b, k), tolerance, `${path}.${k}`));
}

// Float noise: the composers sum ₴ floats in key order, so the same quotes in another order can
// differ in the last place.
const beyondNoise = (a: unknown, b: unknown) => differences(a, b, 1e-12);

describe('every golden ledger a per-unit price can express rebuilds to its own figures', () => {
  const expressible = TEST_LEDGERS.filter(
    (l) => asPriceRows(l.input.snapshots, l.input.transactions) !== undefined,
  );

  // `sold-out` quotes …8976 after the ledger holds none of it: no price per unit values to that.
  it('leaves out only the ledger that quotes a position held none of', () => {
    expect(TEST_LEDGERS.filter((l) => !expressible.includes(l)).map((l) => l.name)).toEqual([
      'sold-out',
    ]);
  });

  // The figures a carried price moves, per ledger: the seed's last day quotes one position, and
  // the other three complete it at their carried price, so Balances gains the day.
  const MOVES: Record<string, string[]> = {
    seed: ['$.balances.chart.173'],
    empty: [],
    'sold-and-unquoted': [],
    'cash-short': ['$.balances.chart.173'],
    linked: [],
  };

  it('names every expressible ledger in the allow-list of moves', () => {
    expect(Object.keys(MOVES).sort()).toEqual(expressible.map((l) => l.name).sort());
  });

  // The seed's case is the criterion: every composer over all six periods, through `buildView`.
  it.each(expressible.map((l) => [l.name, l.input] as const))('%s', (name, input) => {
    const user = asPriceRows(input.snapshots, input.transactions)!;
    const rebuilt = rebuild(input.transactions, user, [], input.assets, input.today);
    expect(dates(rebuilt)).toEqual(stored(input.snapshots).map((s) => s.date));
    for (const s of input.snapshots) expect(at(rebuilt, s.date)!.quotes).toMatchObject(s.quotes);
    // Exact: each snapshot keeps its quotes in the stored order.
    expect(differences(buildView({ ...input, snapshots: rebuilt }), buildView(input), 0)).toEqual(
      MOVES[name],
    );
  });

  it('the seed’s last day completes at three carried prices, each naming the day it was observed', () => {
    const seed = TEST_LEDGERS.find((l) => l.name === 'seed')!.input;
    const user = asPriceRows(seed.snapshots, seed.transactions)!;
    const rebuilt = rebuild(seed.transactions, user, [], NO_ASSETS, seed.today);
    const { observed } = at(rebuilt, '2026-07-27')!;
    expect(
      Object.fromEntries(Object.entries(observed).map(([id, o]) => [id, o.observedOn])),
    ).toEqual({
      reit: '2026-07-27',
      energy: '2026-07-25',
      ovdp8976: '2026-07-25',
      ovdp6475: '2026-07-25',
    });
  });

  it('read in the store’s order, asset then date, the seed differs by float noise at most', () => {
    const seed = TEST_LEDGERS.find((l) => l.name === 'seed')!.input;
    // `user_price`'s primary key is (user_id, asset_id, as_of).
    const user = asPriceRows(seed.snapshots, seed.transactions)!.sort(
      (x, y) => x.assetId.localeCompare(y.assetId) || x.asOf.localeCompare(y.asOf),
    );
    const rebuilt = rebuild(seed.transactions, user, [], seed.assets, seed.today);
    expect(beyondNoise(buildView({ ...seed, snapshots: rebuilt }), buildView(seed))).toEqual(
      MOVES.seed,
    );
  });
});

describe('every figure that moves against the stored series on a ledger with archive rows is predicted', () => {
  const seed = TEST_LEDGERS.find((l) => l.name === 'seed')!.input;
  // A buy after energy's last observation, on a day nothing is observed.
  const transactions: Transaction[] = [
    ...SEED_TRANSACTIONS,
    deposit('d9', '2026-07-26', 1001),
    buy('b9', 'energy', '2026-07-26', 1001, 100),
  ];
  const user = asPriceRows(buildSeedSnapshots(), transactions)!;
  const lastUser = (assetId: string) => user.filter((r) => r.assetId === assetId).at(-1)!.price;
  const archive = [
    // Newer than the user's last …8976 price: outranks it at the close.
    row('ovdp8976', '2026-07-27', lastUser('ovdp8976') * 1.01),
    // The same day as the user's last reit price: the user's wins, nothing moves.
    row('reit', '2026-07-27', lastUser('reit') * 1.01),
    // Before …6475 was bought: absent, nothing moves.
    row('ovdp6475', '2026-05-20', lastUser('ovdp6475')),
  ];
  const input = { ...seed, transactions, snapshots: buildSeedSnapshots() };
  const rebuilt = rebuild(transactions, user, archive, seed.assets, seed.today);
  const moves = beyondNoise(buildView({ ...input, snapshots: rebuilt }), buildView(input));

  const periods = (path: string) => PERIOD_OPTIONS.map((p) => `$.periods.${p}.${path}`);
  const yieldRow = (i: number) =>
    ['value', 'deltaTotal', 'annualized', 'vsExpectedPp', 'totalReturn', 'xirr'].flatMap((f) =>
      periods(`yield.rows.${i}.${f}`),
    );
  // Carry-forward: energy's 6 100 units are valued at the carried price where the stored series
  // valued 6 000 units' ₴ (the seam `headlineTotalAsOf` describes).
  const CARRY: string[] = [...yieldRow(1)];
  // Precedence: …8976 closes at the archive's newer price over the user's carried one.
  const PRECEDENCE: string[] = [...yieldRow(2)];
  // Both, through every figure read at the close: totals, shares, gains, and the rebalance plan,
  // where a share that crossed its band moves an asset between the two lists.
  const ASSET_FIELDS = [
    'code',
    'colorKey',
    'couponAmount',
    'createdAt',
    'expectedPct',
    'firstPurchase',
    'id',
    'maturity',
    'name',
    'nextCoupon',
    'payoutSchedule',
    'targetPct',
    'yieldType',
  ];
  const TOTALS: string[] = [
    ...[
      'total',
      'cashShare',
      'net.uah',
      'net.pct',
      'portfolioXirr',
      'totalReturn.uah',
      'totalReturn.roi',
      'underweight.deltaPp',
      'underweight.topUp',
    ].flatMap((f) => periods(`overview.${f}`)),
    ...[0, 1, 2, 3].flatMap((i) => periods(`overview.rows.${i}.share`)),
    ...[1, 2].flatMap((i) => [
      ...periods(`overview.rows.${i}.value`),
      ...periods(`overview.rows.${i}.yield`),
    ]),
    '$.capital.total',
    '$.capital.net.uah',
    '$.capital.net.pct',
    '$.portfolio.totals.value',
    '$.portfolio.totals.net.uah',
    '$.portfolio.totals.net.pct',
    '$.portfolio.worst.yield',
    ...[0, 1, 2, 3].map((i) => `$.portfolio.rows.${i}.share`),
    ...[1, 2].flatMap((i) => [
      `$.portfolio.rows.${i}.value`,
      `$.portfolio.rows.${i}.pnl`,
      `$.portfolio.rows.${i}.pnlPct`,
    ]),
    '$.allocation.total',
    '$.allocation.slices.1.value',
    '$.allocation.slices.2.value',
    ...[0, 1, 2, 3].flatMap((i) => [
      `$.allocation.rows.${i}.share`,
      `$.allocation.rows.${i}.deltaPp`,
    ]),
    '$.allocation.rows.1.severity',
    '$.allocation.plan.actions.0.amount',
    '$.allocation.plan.actions.1.amount',
    '$.allocation.plan.actions.2',
    '$.allocation.plan.withinRange.1',
    ...ASSET_FIELDS.map((f) => `$.allocation.plan.withinRange.0.${f}`),
    '$.attributes.cards.1.actualAnnualized',
  ];
  // The grid: the buy's day is a new point, and the last day is complete.
  const GRID: string[] = ['$.balances.chart.173', '$.balances.chart.174'];

  it('lists every moved figure under the rule that predicts it', () => {
    expect([...moves].sort()).toEqual([...CARRY, ...PRECEDENCE, ...TOTALS, ...GRID].sort());
  });

  it('moves no window: the fixture’s last observation, after its last transaction, still closes it', () => {
    expect(moves.filter((p) => p.includes('.window.'))).toEqual([]);
    expect(dates(rebuilt).at(-1)).toBe('2026-07-27');
  });
});
