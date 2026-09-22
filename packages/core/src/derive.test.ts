import { describe, expect, it } from 'vitest';

import {
  annualizedPct,
  basisIsShort,
  capitalGain,
  capitalGainPct,
  cashIsShort,
  cashYieldPct,
  freeCashFromLedger,
  globalRoi,
  headlineKpis,
  headlineTotal,
  headlineTotalAsOf,
  incomeReceived,
  incomeReceivedNet,
  investedOwnByAsset,
  latestCompleteSnapshot,
  latestQuotes,
  netDeposits,
  netResult,
  startDateByAsset,
  payoutsGross,
  payoutsGrossByAsset,
  payoutsNet,
  payoutsNetByAsset,
  portfolioStart,
  portfolioXirr,
  quotesAsOf,
  sharePct,
  shareTotal,
  soldAmount,
  soldAmountByAsset,
  taxesPaid,
  taxesPaidByAsset,
  topUpAmount,
  totalCapital,
  totalNetProfit,
  totalReturnPct,
  transactionsIn,
  trimAmount,
  valueAsOf,
  yieldSinceStart,
} from './derive';
import type { PriceLookup } from './derive';
import { unitDelta } from './types';
import type { Asset, Snapshot, Transaction } from './types';

const complete2507: Snapshot = {
  date: '2026-07-25',
  savedAt: '2026-07-25T21:14:00',
  quotes: { reit: 68629.36, energy: 60086.09, ovdp8976: 15846.3, ovdp6475: 4374.12 },
};
const partial2707: Snapshot = { date: '2026-07-27', quotes: { reit: 68702.1 } };
const snaps = [complete2507, partial2707];
const ASSET_IDS = ['reit', 'energy', 'ovdp8976', 'ovdp6475'];
const invested = { reit: 65800, energy: 59208, ovdp8976: 15390, ovdp6475: 4158 };

// Free cash is no longer read off a snapshot, so every total needs the ledger that
// produces it: the four buys behind `invested`, funded by one deposit that leaves the
// same ₴7,75 residue the seed carries.
const LEDGER: Transaction[] = [
  { id: 'd', date: '2026-02-03', type: 'deposit', assetId: '', amount: 144563.75 },
  ...Object.entries(invested).map(([assetId, amount], i) => ({
    id: `b${i}`,
    date: '2026-02-03',
    type: 'buy' as const,
    assetId,
    amount,
  })),
];

describe('headline derivations (latest quote per asset, partials included)', () => {
  it('merges the partial snapshot over the last complete one', () => {
    expect(latestQuotes(snaps)).toEqual({
      reit: 68702.1,
      energy: 60086.09,
      ovdp8976: 15846.3,
      ovdp6475: 4374.12,
    });
  });

  it('headline total = Σ latest quotes + the ledger’s free cash (sidebar / Overview / donut)', () => {
    expect(headlineTotal(snaps, LEDGER)).toBeCloseTo(149016.36, 2);
    expect(freeCashFromLedger(LEDGER)).toBeCloseTo(7.75, 2);
  });

  it('net result excludes cash: +₴4,452.61 = +3.08% since 03.02', () => {
    const r = netResult(latestQuotes(snaps), invested);
    expect(r.uah).toBeCloseTo(4452.61, 2);
    expect(r.pct).toBeCloseTo(0.0308, 4);
  });

  it('headlineKpis composes total + net for the sidebar capital card', () => {
    const kpis = headlineKpis(snaps, LEDGER);
    expect(kpis.total).toBeCloseTo(149016.36, 2);
    expect(kpis.net.uah).toBeCloseTo(4452.61, 2);
    expect(kpis.net.pct).toBeCloseTo(0.0308, 4);
  });
});

describe('snapshot-level derivations (Balances)', () => {
  it('totalCapital of one complete snapshot matches the 25.07 table row', () => {
    expect(totalCapital(complete2507, LEDGER)).toBeCloseTo(148943.62, 2);
  });

  it('latestCompleteSnapshot skips the partial 27.07 row', () => {
    expect(latestCompleteSnapshot(snaps, ASSET_IDS)?.date).toBe('2026-07-25');
  });
});

describe('yield (reference teaser strip + Yield table)', () => {
  it('yield since start per asset', () => {
    expect(yieldSinceStart(68702.1, 65800)).toBeCloseTo(0.0441, 4); // REIT +4.41%
    expect(yieldSinceStart(60086.09, 59208)).toBeCloseTo(0.0148, 4); // Energy +1.48%
    expect(yieldSinceStart(15846.3, 15390)).toBeCloseTo(0.0296, 4); // …8976 +2.96%
    expect(yieldSinceStart(4374.12, 4158)).toBeCloseTo(0.052, 4); // …6475 +5.20%
  });

  it('annualized uses the GLOBAL portfolio start (03.02 → 27.07 = 174 days) for every asset', () => {
    // That the SEED derives the same start date — the assertion that actually protects
    // the 174 below — lives in `seed.test.ts`: the claim there is about the seed's rows,
    // the claim here is about the arithmetic, and neither should fail for the other's reason.
    expect(annualizedPct(68702.1, 65800, 174)).toBeCloseTo(0.093, 3); // REIT +9.3%
    expect(annualizedPct(60086.09, 59208, 174)).toBeCloseTo(0.031, 3); // Energy +3.1%
    expect(annualizedPct(15846.3, 15390, 174)).toBeCloseTo(0.062, 3); // …8976 +6.2%
    expect(annualizedPct(4374.12, 4158, 174)).toBeCloseTo(0.109, 3); // …6475 +10.9%, NOT per-asset basis
  });
});

describe('allocation & rebalance', () => {
  it('share of headline total', () => {
    expect(sharePct(68702.1, 149016.36)).toBeCloseTo(46.104, 2); // REIT "46.1%"
    expect(sharePct(15846.3, 149016.36)).toBeCloseTo(10.634, 2);
  });

  it('a total that is not a usable denominator yields no share at all', () => {
    expect(sharePct(60000, -10000)).toBeNull();
    expect(sharePct(60000, 0)).toBeNull();
    expect(sharePct(60000, NaN)).toBeNull();
    expect(sharePct(60000, Infinity)).toBeNull();
    // A negative value over a usable total is the Free-cash card's `-0,06 %` on a short ledger.
    expect(sharePct(-92.25, 148916.36)).toBeNull();
  });

  it('cash is short when negative or unreadable, never at zero', () => {
    expect(cashIsShort(-1)).toBe(true);
    expect(cashIsShort(NaN)).toBe(true);
    expect(cashIsShort(0)).toBe(false);
  });

  it('a short ledger leaves no total to take a share of, even a positive one', () => {
    // Seed + Withdrawal 100 000: total 49 016,36 over cash -99 992,25 put REIT at ~140 %.
    expect(sharePct(68702.1, shareTotal(49016.36, -99992.25))).toBeNull();
    expect(sharePct(68702.1, shareTotal(149016.36, NaN))).toBeNull();
    expect(shareTotal(149016.36, 7.75)).toBe(149016.36);
    expect(shareTotal(0, 0)).toBe(0);
  });

  it('trim is linear: REIT overweight → −₴9,095', () => {
    expect(trimAmount(sharePct(68702.1, 149016.36)!, 40, 149016.36)).toBeCloseTo(9095.56, 0);
  });

  it('top-up compounds the total: …8976 → ₴11,429 (reference prints 11,413)', () => {
    expect(topUpAmount(15846.3, 17, 149016.36)).toBeCloseTo(11429.49, 0);
  });
});

describe('income aggregation', () => {
  const txs: Transaction[] = [
    {
      id: 't1',
      date: '2026-02-10',
      type: 'dividend_accrual',
      assetId: 'reit',
      amount: 580.2,
    },
    {
      id: 't2',
      date: '2026-02-25',
      type: 'interest_payout',
      assetId: 'ovdp8976',
      amount: 1183.5,
    },
    {
      id: 't3',
      date: '2026-06-10',
      type: 'reinvest',
      assetId: 'reit',
      amount: 484.36,
    },
    { id: 't4', date: '2026-02-03', type: 'buy', assetId: 'reit', amount: 64628.62 },
    {
      id: 't5',
      date: '2026-02-03',
      type: 'deposit',
      assetId: '',
      amount: 123844.37,
    },
  ];

  it('dividend accruals → dividends, interest payouts → coupons; other types excluded', () => {
    expect(incomeReceived(txs)).toEqual({ dividends: 580.2, coupons: 1183.5, total: 1763.7 });
  });
});

// --- WEALTH-MANAGEMENT-ARCHITECTURE reconciliation (docs/reference/FORMULA-AUDIT.md) ---

const tx = (
  id: string,
  type: Transaction['type'],
  amount: number,
  assetId = 'a1',
  date = '2026-03-01',
): Transaction => ({ id, date, type, assetId, amount });

describe('§2.1 metric family: capital gain vs total return', () => {
  // The user's real …6475 position, the plan's illusion-of-loss fixture.
  it('illusion of loss: capitalGain −₴116,88 but totalNetProfit +₴238,52', () => {
    expect(capitalGain(4379.52, 4496.4, 0)).toBeCloseTo(-116.88, 2);
    expect(totalNetProfit(4379.52, 355.4, 0, 4496.4, 0)).toBeCloseTo(238.52, 2);
  });

  it('totalReturnPct ≈ +5.30% on the illusion-of-loss fixture (denominator investedOwn)', () => {
    expect(totalReturnPct(4379.52, 355.4, 0, 4496.4, 0)! * 100).toBeCloseTo(5.3, 2);
    expect(capitalGainPct(4379.52, 4496.4, 0)! * 100).toBeCloseTo(-2.6, 1);
    expect(cashYieldPct(355.4, 4496.4, 0)! * 100).toBeCloseTo(7.9, 1);
  });

  it('payoutsNet subtracts the withholding: 467,46 − 65,44 = 402,02', () => {
    const rows = [{ ...tx('p', 'dividend_accrual', 467.46), taxWithheld: 65.44 }];
    expect(payoutsGross(rows)).toBeCloseTo(467.46, 2);
    expect(taxesPaid(rows)).toBeCloseTo(65.44, 2);
    expect(payoutsNet(rows)).toBeCloseTo(402.02, 2);
    expect(payoutsNetByAsset(rows).a1).toBeCloseTo(402.02, 2);
  });

  it('investedOwnByAsset counts buys ONLY (reinvest is its own type)', () => {
    const rows = [tx('b', 'buy', 1000), tx('r', 'reinvest', 100), tx('s', 'sell', 50)];
    expect(investedOwnByAsset(rows)).toEqual({ a1: 1000 });
  });

  it('soldAmount = Σ sell + redemption, per asset and total', () => {
    const rows = [tx('s1', 'sell', 500), tx('rd', 'redemption', 1000, 'a2'), tx('b', 'buy', 2000)];
    expect(soldAmount(rows)).toBe(1500);
    expect(soldAmountByAsset(rows)).toEqual({ a1: 500, a2: 1000 });
  });

  it('a withholding with no payout under it is unrepresentable', () => {
    // A `tax` row could stand alone and drive an asset's net payouts NEGATIVE — `{ a9:
    // -10 }` with no gross above it. A field cannot exist without the row it sits on,
    // so the shape stops existing rather than being handled.
    const rows = [{ ...tx('p', 'interest_payout', 10, 'a9'), taxWithheld: 4 }];
    expect(payoutsGrossByAsset(rows)).toEqual({ a9: 10 });
    expect(payoutsNetByAsset(rows)).toEqual({ a9: 6 });
  });

  it('incomeReceivedNet nets EVERY figure; the gross variant beside it does not', () => {
    // It used to report the two categories gross with only `total` net, because a `tax`
    // row knew its asset and not its category. Both are net now.
    const rows = [
      { ...tx('d', 'dividend_accrual', 467.46), taxWithheld: 65.44 },
      tx('c', 'interest_payout', 100),
    ];
    expect(incomeReceivedNet(rows)).toEqual({
      dividends: 402.02,
      coupons: 100,
      taxes: 65.44,
      total: 502.02,
    });
    expect(incomeReceived(rows).total).toBeCloseTo(567.46, 2); // untouched
  });

  it('zero-denominator guards return null, never NaN/Infinity', () => {
    expect(capitalGainPct(100, 0, 0)).toBeNull();
    expect(totalReturnPct(100, 10, 0, 0, 50)).toBeNull(); // reinvested alone is no denominator
    expect(cashYieldPct(10, 0, 0)).toBeNull();
    expect(globalRoi(100, 0)).toBeNull();
    expect(globalRoi(100, -5)).toBeNull(); // over-withdrawn: no external base to measure
  });
});

describe('§1 free cash from ledger — the ledger’s signed sum, bounded by date', () => {
  it('deposits − withdrawals − buys + sells + redemptions', () => {
    const rows = [
      tx('d', 'deposit', 1000, ''),
      tx('w', 'withdrawal', 200, ''),
      tx('b', 'buy', 500),
      tx('s', 'sell', 150),
      tx('rd', 'redemption', 100),
    ];
    expect(freeCashFromLedger(rows)).toBe(550);
  });

  it('a payout CREDITS the account and a reinvest DEBITS it', () => {
    const base = [tx('d', 'deposit', 1000, ''), tx('b', 'buy', 900)];
    expect(freeCashFromLedger([...base, tx('p', 'dividend_accrual', 55.5)])).toBeCloseTo(155.5, 10);
    expect(freeCashFromLedger([...base, tx('r', 'reinvest', 55.5)])).toBeCloseTo(44.5, 10);
  });

  it('a paired payout + reinvest of the same amount still nets to zero', () => {
    // The pair nets by ARITHMETIC now rather than by two exclusions, so it holds for a
    // pair that does NOT match too — which the exclusions could never report.
    const base = [tx('d', 'deposit', 1000, ''), tx('b', 'buy', 900)];
    const pair = [...base, tx('p', 'interest_payout', 216), tx('r', 'reinvest', 216)];
    expect(freeCashFromLedger(pair)).toBe(freeCashFromLedger(base));
  });

  it('a payout contributes amount − coalesce(taxWithheld, 0), and the withholding is the gap', () => {
    // The paired comparison: one payout carrying a withholding against the same payout
    // without one. Without the clause free cash overstates by every hryvnia withheld.
    const base = [tx('d', 'deposit', 100, '')];
    const gross = tx('p', 'interest_payout', 50);
    const taxed = { ...gross, taxWithheld: 12 };
    expect(freeCashFromLedger([...base, gross])).toBeCloseTo(150, 10);
    expect(freeCashFromLedger([...base, taxed])).toBeCloseTo(138, 10);
    expect(freeCashFromLedger([...base, gross]) - freeCashFromLedger([...base, taxed])).toBeCloseTo(
      12,
      10,
    );
  });

  it('`asOf` bounds the sum INCLUSIVELY — a later row must not count', () => {
    const rows = [
      tx('d', 'deposit', 1000, '', '2026-03-01'),
      tx('p', 'dividend_accrual', 60, 'a1', '2026-03-10'),
      tx('w', 'withdrawal', 400, '', '2026-03-20'),
    ];
    expect(freeCashFromLedger(rows, '2026-02-28')).toBe(0);
    expect(freeCashFromLedger(rows, '2026-03-01')).toBe(1000); // the bound's own day counts
    expect(freeCashFromLedger(rows, '2026-03-10')).toBe(1060);
    expect(freeCashFromLedger(rows, '2026-03-19')).toBe(1060); // nothing between
    expect(freeCashFromLedger(rows, '2026-03-20')).toBe(660);
    expect(freeCashFromLedger(rows)).toBe(660); // unbounded = the whole ledger
  });

  it('empty ledger → 0, bounded or not', () => {
    expect(freeCashFromLedger([])).toBe(0);
    expect(freeCashFromLedger([], '2026-03-01')).toBe(0);
    expect(netDeposits([])).toBe(0);
  });
});

describe('value(a, D) = units(a, D) × coalesce(user_price(a, D), archive(a, D))', () => {
  const held = [
    { ...tx('b', 'buy', 1000, 'a1', '2026-03-01'), quantity: 100 },
    { ...tx('r', 'reinvest', 60, 'a1', '2026-04-01'), quantity: 5 },
  ];
  const none: PriceLookup = () => undefined;

  it('prefers the user’s price over the archive', () => {
    const user: PriceLookup = () => 12;
    const archive: PriceLookup = () => 11;
    expect(valueAsOf('a1', '2026-05-01', held, user, archive)).toBeCloseTo(1260, 10);
  });

  it('falls back to the archive when the user has no price that day', () => {
    const archive: PriceLookup = () => 11;
    expect(valueAsOf('a1', '2026-05-01', held, none, archive)).toBeCloseTo(1155, 10);
  });

  it('neither lookup answers → undefined, never a fabricated 0', () => {
    expect(valueAsOf('a1', '2026-05-01', held, none, none)).toBeUndefined();
  });

  it('units are taken AS OF the date, so a later purchase does not inflate an earlier value', () => {
    const user: PriceLookup = () => 12;
    expect(valueAsOf('a1', '2026-03-15', held, user, none)).toBeCloseTo(1200, 10);
    expect(valueAsOf('a1', '2026-04-01', held, user, none)).toBeCloseTo(1260, 10);
  });

  it('an asset the ledger cannot count has no value — absent, not zero', () => {
    // `ledgerUnits` withholds an asset whose position-moving rows lack a quantity; a
    // price cannot rescue a unit count that was never captured.
    const incomplete = [tx('b', 'buy', 1000, 'a2', '2026-03-01')];
    expect(valueAsOf('a2', '2026-05-01', incomplete, () => 12, none)).toBeUndefined();
  });

  it('an asset with no rows at all is absent too', () => {
    expect(valueAsOf('a9', '2026-05-01', held, () => 12, none)).toBeUndefined();
  });

  it('zero units before the first purchase is a DERIVED 0, where an unknown asset is absent', () => {
    // The asymmetry is the formula's, not a special case: `units × price` with a unit
    // count of zero IS zero, and the ledger knows the asset exists to hold none of.
    // Absent is reserved for what the ledger cannot answer at all.
    expect(valueAsOf('a1', '2026-02-01', held, () => 12, none)).toBe(0);
    expect(valueAsOf('a9', '2026-02-01', held, () => 12, none)).toBeUndefined();
  });

  it('a position sold down to nothing is worth nothing, not absent', () => {
    const closed = [...held, { ...tx('s', 'sell', 1400, 'a1', '2026-06-01'), quantity: 105 }];
    expect(valueAsOf('a1', '2026-06-01', closed, () => 12, none)).toBe(0);
  });
});

describe('§5 netDeposits / globalRoi (external capital denominator)', () => {
  it('netDeposits = deposits − withdrawals', () => {
    const rows = [
      tx('d1', 'deposit', 1000, ''),
      tx('d2', 'deposit', 500, ''),
      tx('w', 'withdrawal', 300, ''),
      tx('b', 'buy', 700), // buys never touch the external-capital base
    ];
    expect(netDeposits(rows)).toBe(1200);
  });

  it('globalRoi on the seed figures: (149 016,36 − 143 176,37)/143 176,37 ≈ +4.0789%', () => {
    expect(globalRoi(149016.36, 143176.37)! * 100).toBeCloseTo(4.0789, 4);
  });
});

describe('netResult with closed positions (sold term)', () => {
  const values = { reit: 68702.1, energy: 60086.09, ovdp8976: 15846.3, ovdp6475: 4374.12 };
  const invested = { reit: 65800, energy: 59208, ovdp8976: 15390, ovdp6475: 4158 };
  // …8976 redeemed: its quote disappears, its cost basis does not.
  const withoutRedeemed = (v: Record<string, number>) =>
    Object.fromEntries(Object.entries(v).filter(([id]) => id !== 'ovdp8976'));

  it('is unchanged when nothing was ever sold — the seed-pinned figure', () => {
    expect(netResult(values, invested).uah).toBeCloseTo(4452.61, 2);
    expect(netResult(values, invested, 0).uah).toBeCloseTo(4452.61, 2);
  });

  it('does NOT invert when a position is redeemed', () => {
    const rest = withoutRedeemed(values);
    // Without the sold term this reads as a total loss of the position.
    expect(netResult(rest, invested).uah).toBeCloseTo(-11393.69, 2);
    // With the proceeds counted, only the real capital difference remains.
    expect(netResult(rest, invested, 15390).uah).toBeCloseTo(3996.31, 2);
  });

  it('carries a redemption above or below cost into the result', () => {
    const rest = withoutRedeemed(values);
    const atCost = netResult(rest, invested, 15390).uah;
    expect(netResult(rest, invested, 15500).uah - atCost).toBeCloseTo(110, 6);
    expect(netResult(rest, invested, 15000).uah - atCost).toBeCloseTo(-390, 6);
  });
});

describe('portfolioStart', () => {
  const asset = (id: string, firstPurchase: string): Asset => ({
    id,
    name: id,
    code: 'XX',
    colorKey: 'reit',
    yieldType: 'dividends',
    expectedPct: 14,
    targetPct: 25,
    payoutSchedule: 'monthly',
    firstPurchase,
    createdAt: '2026-02-03T00:00:00',
  });
  const snap = (date: string): Snapshot => ({ date, quotes: {} });
  const tx = (date: string): Transaction => ({
    id: date,
    date,
    type: 'buy',
    assetId: 'reit',
    amount: 1,
  });

  it('takes the EARLIEST of the three signals, not any one of them', () => {
    // Each source is the earliest in turn; the answer follows it every time.
    expect(
      portfolioStart([asset('a', '2026-05-01')], [snap('2026-04-01')], [tx('2026-03-01')]),
    ).toBe('2026-03-01');
    expect(
      portfolioStart([asset('a', '2026-05-01')], [snap('2026-02-01')], [tx('2026-03-01')]),
    ).toBe('2026-02-01');
    expect(
      portfolioStart([asset('a', '2026-01-01')], [snap('2026-02-01')], [tx('2026-03-01')]),
    ).toBe('2026-01-01');
  });

  it('trusts a firstPurchase that predates the whole ledger', () => {
    // The case the min() exists for: an asset added without back-filling. The ledger
    // says six months; the user says six years. Believing the ledger would divide a
    // six-year return by six months and print a fantasy.
    expect(
      portfolioStart([asset('a', '2020-01-01')], [snap('2026-02-03')], [tx('2026-02-03')]),
    ).toBe('2020-01-01');
  });

  it('works from any single source alone', () => {
    expect(portfolioStart([], [], [tx('2026-03-01')])).toBe('2026-03-01');
    expect(portfolioStart([], [snap('2026-03-01')], [])).toBe('2026-03-01');
    expect(portfolioStart([asset('a', '2026-03-01')], [], [])).toBe('2026-03-01');
  });

  it('is undefined on an empty dataset — there is no start to report', () => {
    expect(portfolioStart([], [], [])).toBeUndefined();
  });
});

describe('portfolioXirr', () => {
  let n = 0;
  const tx = (
    date: string,
    type: Transaction['type'],
    amount: number,
    assetId = '',
  ): Transaction => ({ id: `t${(n += 1)}`, date, type, amount, assetId });

  it('solves a plain one-year 10%', () => {
    // 100 in, 110 out, 365 days apart. If this ever stops being 0.1 the day count
    // changed, not the portfolio.
    expect(portfolioXirr([tx('2026-01-01', 'deposit', 100)], 110, '2027-01-01')).toBeCloseTo(
      0.1,
      6,
    );
  });

  it('measures EXTERNAL capital only — internal flows never move it', () => {
    // The assertion that pins the definition. Buys, sells, reinvests and payouts move
    // money inside the portfolio's boundary; only deposits and withdrawals cross it.
    // Whatever the assets did is already in the terminal value, so counting those rows
    // again would double-count them.
    const external = [tx('2026-01-01', 'deposit', 100)];
    const alsoInternal = [
      ...external,
      tx('2026-02-01', 'buy', 60, 'a'),
      tx('2026-03-01', 'sell', 20, 'a'),
      tx('2026-04-01', 'interest_payout', 5, 'a'),
      tx('2026-05-01', 'reinvest', 5, 'a'),
      tx('2026-07-01', 'dividend_accrual', 3, 'a'),
      tx('2026-08-01', 'redemption', 10, 'a'),
    ];
    expect(portfolioXirr(alsoInternal, 110, '2027-01-01')).toBe(
      portfolioXirr(external, 110, '2027-01-01'),
    );
  });

  it('a withdrawal is an inflow to the investor, a deposit an outflow', () => {
    // Take 50 back at six months and still hold 60: the same 100 in, so the early
    // return has to beat the 10% of the first test.
    const rate = portfolioXirr(
      [tx('2026-01-01', 'deposit', 100), tx('2026-07-02', 'withdrawal', 50)],
      60,
      '2027-01-01',
    )!;
    expect(rate).toBeGreaterThan(0.1);
  });

  it('is null when there is nothing to measure', () => {
    expect(portfolioXirr([], 0, undefined)).toBeNull(); // no snapshot, no terminal date
    expect(portfolioXirr([], 100, '2027-01-01')).toBeNull(); // a terminal value nobody paid for
    expect(portfolioXirr([tx('2026-01-01', 'deposit', 100)], 0, '2026-01-01')).toBeNull(); // one date
  });

  it("ignores a deposit's assetId — the form always attaches one", () => {
    // `assetCashFlows` documents the same trap from the other side: the transaction
    // form attaches the selected asset to every row, so a deposit carries an assetId it
    // has no business having.
    expect(
      portfolioXirr([tx('2026-01-01', 'deposit', 100, 'reit')], 110, '2027-01-01'),
    ).toBeCloseTo(0.1, 6);
  });
});

// The bounded twins of the headline accessors (Phase 8 brief § G-5).
describe('windowed accessors', () => {
  const tx = (date: string, amount: number): Transaction => ({
    id: date,
    date,
    type: 'deposit',
    assetId: '',
    amount,
  });

  it('quotesAsOf merges only the snapshots up to and including the date', () => {
    // The partial 27.07 carries REIT alone. Bounded at 25.07 it must not be seen at all
    // — the merge is what makes this subtle, since a bound that leaked would show the
    // other three assets from 25.07 and look entirely plausible.
    expect(quotesAsOf(snaps, '2026-07-25')).toEqual({
      reit: 68629.36,
      energy: 60086.09,
      ovdp8976: 15846.3,
      ovdp6475: 4374.12,
    });
    expect(quotesAsOf(snaps, '2026-07-27').reit).toBe(68702.1);
    expect(quotesAsOf(snaps, '2026-07-26').reit).toBe(68629.36);
  });

  it('quotes are empty before the first snapshot, and the total is then the cash alone', () => {
    // NOT zero any more: money deposited before the first valuation is capital, and the
    // ledger can say so where a missing snapshot could not.
    expect(quotesAsOf(snaps, '2026-07-24')).toEqual({});
    expect(headlineTotalAsOf(snaps, LEDGER, '2026-07-24')).toBeCloseTo(7.75, 2);
    expect(headlineTotalAsOf(snaps, [], '2026-07-24')).toBe(0);
  });

  it('the unbounded accessors are the same function with no bound', () => {
    // One implementation of the merge, two names. A second copy of this arithmetic
    // would be a second answer.
    expect(quotesAsOf(snaps)).toEqual(latestQuotes(snaps));
    expect(headlineTotalAsOf(snaps, LEDGER)).toBeCloseTo(headlineTotal(snaps, LEDGER), 10);
  });

  it('UNBOUND, a row entered since the last snapshot moves cash with no valuation opposite it', () => {
    // The seam between a ledger that runs to its last row and quotes that stop at the
    // last snapshot. A late DEPOSIT raises the total and is right; a late BUY lowers it
    // by the whole amount, because the units it bought are not valued yet and
    // `quotesAsOf` will not invent a figure for them. Pinned in BOTH directions so the
    // trade-off is a decision and not a surprise — bounding the ledger at the last
    // snapshot instead would hide the deposit again, which is the bug this replaced.
    const base = headlineTotal(snaps, LEDGER);
    const late = (type: Transaction['type'], assetId: string): Transaction[] => [
      ...LEDGER,
      { id: 'late', date: '2026-07-28', type, assetId, amount: 1000 },
    ];
    expect(headlineTotal(snaps, late('deposit', ''))).toBeCloseTo(base + 1000, 2);
    expect(headlineTotal(snaps, late('buy', 'reit'))).toBeCloseTo(base - 1000, 2);
    expect(headlineTotal(snaps, late('withdrawal', ''))).toBeCloseTo(base - 1000, 2);
    // BOUND at the last snapshot, none of the three is visible at all.
    for (const t of ['deposit', 'buy', 'withdrawal'] as const) {
      expect(
        headlineTotalAsOf(snaps, late(t, t === 'buy' ? 'reit' : ''), '2026-07-27'),
      ).toBeCloseTo(headlineTotalAsOf(snaps, LEDGER, '2026-07-27'), 10);
    }
  });

  it('headlineTotalAsOf takes Σ quotes and the free cash at the SAME instant', () => {
    expect(headlineTotalAsOf(snaps, LEDGER, '2026-07-25')).toBeCloseTo(
      68629.36 + 60086.09 + 15846.3 + 4374.12 + 7.75,
      2,
    );
    // A buy after the bound moves neither half.
    const later: Transaction[] = [
      ...LEDGER,
      { id: 'b9', date: '2026-07-26', type: 'buy', assetId: 'reit', amount: 1000 },
    ];
    expect(headlineTotalAsOf(snaps, later, '2026-07-25')).toBeCloseTo(
      headlineTotalAsOf(snaps, LEDGER, '2026-07-25'),
      10,
    );
  });

  it('transactionsIn is INCLUSIVE at both ends, and that is the whole point of it existing', () => {
    // G-5: three screens each writing their own boundary test is three chances to
    // disagree about whether the opening day counts. It does, at both ends.
    const txs = [tx('2026-02-03', 1), tx('2026-04-27', 2), tx('2026-07-27', 3)];
    const w = { from: '2026-02-03', to: '2026-07-27', clamped: false };
    expect(transactionsIn(txs, w).map((t) => t.amount)).toEqual([1, 2, 3]);
    expect(
      transactionsIn(txs, { from: '2026-02-04', to: '2026-07-26', clamped: false }).map(
        (t) => t.amount,
      ),
    ).toEqual([2]);
  });

  it('transactionsIn preserves order and does not mutate its input', () => {
    const txs = [tx('2026-07-27', 3), tx('2026-02-03', 1)];
    const out = transactionsIn(txs, { from: '2026-01-01', to: '2026-12-31', clamped: false });
    expect(out.map((t) => t.amount)).toEqual([3, 1]);
    expect(txs.map((t) => t.amount)).toEqual([3, 1]);
  });
});

describe('startDateByAsset', () => {
  // Self-contained rather than seeded: this is a core test and the only fields it
  // exercises are `id` and `firstPurchase`.
  const a = (over: Partial<Asset>): Asset =>
    ({
      id: 'x',
      name: 'X',
      code: 'X',
      colorKey: 'reit',
      yieldType: 'market',
      expectedPct: 0,
      targetPct: 0,
      firstPurchase: '2026-02-05',
      createdAt: '2026-02-05T10:00:00',
      ...over,
    }) as Asset;

  it("takes the earliest of the stated firstPurchase and the asset's own rows", () => {
    const asset = a({ id: 'x', firstPurchase: '2026-05-01' });
    const txs = [
      { id: 't1', date: '2026-03-02', type: 'buy', assetId: 'x', amount: 10 },
      { id: 't2', date: '2026-06-02', type: 'buy', assetId: 'x', amount: 10 },
    ] as Transaction[];
    // A row earlier than the attribute wins — the same min direction `portfolioStart`
    // uses, and the reason this is derived rather than read.
    expect(startDateByAsset([asset], txs)['x']).toBe('2026-03-02');
  });

  it('keeps firstPurchase when no row is earlier, and ignores other assets', () => {
    const asset = a({ id: 'x', firstPurchase: '2026-02-05' });
    const txs = [
      { id: 't1', date: '2026-01-01', type: 'buy', assetId: 'other', amount: 10 },
    ] as Transaction[];
    expect(startDateByAsset([asset], txs)['x']).toBe('2026-02-05');
  });

  it('says nothing for an asset with neither', () => {
    const asset = a({ id: 'x', firstPurchase: undefined });
    expect(startDateByAsset([asset], [])['x']).toBeUndefined();
  });

  // Cash rows carry no assetId and belong to no asset's start.
  it('ignores rows with no asset', () => {
    const txs = [
      { id: 'd1', date: '2026-01-01', type: 'deposit', assetId: '', amount: 10 },
    ] as Transaction[];
    expect(startDateByAsset([a({ id: 'x', firstPurchase: '2026-02-05' })], txs)['x']).toBe(
      '2026-02-05',
    );
  });
});

describe('basisIsShort — F-3, and the threshold the sheet delegated', () => {
  it('tolerates a tenth of the basis and no more', () => {
    expect(basisIsShort(90, 100)).toBe(false); // exactly the tolerance
    expect(basisIsShort(89, 100)).toBe(true);
    expect(basisIsShort(100, 100)).toBe(false);
  });

  it("separates the sheet's two pinned cases with room on both sides", () => {
    expect(basisIsShort(172, 174)).toBe(false); // …8976 — 1,15 % short
    expect(basisIsShort(55, 174)).toBe(true); //  …6475 — 68,39 % short
  });

  it('MARKS the maximally short holding rather than exempting it', () => {
    // Bought on the window's last day: one day of return scaled up. A `heldDays <= 0`
    // guard made this the one row that could never be marked — the opposite of the
    // rule. Negative is the same case: `yield.ts` counts a buy dated after the last
    // snapshot.
    expect(basisIsShort(0, 30)).toBe(true);
    expect(basisIsShort(-3, 30)).toBe(true);
  });

  it('says nothing when there is no basis to be short of', () => {
    expect(basisIsShort(0, 0)).toBe(false);
    expect(basisIsShort(10, 0)).toBe(false);
  });
});

describe('unitDelta — the sign rule units depend on', () => {
  const tx = (over: Partial<Transaction>): Transaction => ({
    id: 'x',
    date: '2026-08-12',
    type: 'buy',
    assetId: 'reit',
    amount: 100,
    ...over,
  });

  it('ADDS on buy and reinvest, REMOVES on sell and redemption', () => {
    expect(unitDelta(tx({ type: 'buy', quantity: 10 }))).toBe(10);
    expect(unitDelta(tx({ type: 'reinvest', quantity: 10 }))).toBe(10);
    expect(unitDelta(tx({ type: 'sell', quantity: 10 }))).toBe(-10);
    // `redemption` is the bond's principal coming back at maturity — the position
    // closes, so it removes. Getting this sign wrong would make a matured bond count
    // double.
    expect(unitDelta(tx({ type: 'redemption', quantity: 10 }))).toBe(-10);
  });

  it('is zero without a quantity, and zero on a row that moves nothing', () => {
    expect(unitDelta(tx({ type: 'buy' }))).toBe(0);
    expect(unitDelta(tx({ type: 'interest_payout', quantity: 10 }))).toBe(0);
  });
});

describe('the withholding is a field on the payout it was taken from', () => {
  // The audit's own fixture, re-shaped: gross and withheld used to be two rows and
  // are now two columns of one. The FIGURES do not move — that is the point of
  // re-using them — only where they are read from.
  const payout = (
    id: string,
    type: 'dividend_accrual' | 'interest_payout',
    amount: number,
    taxWithheld?: number,
    assetId = 'a1',
  ): Transaction => ({
    id,
    date: '2026-03-01',
    type,
    assetId,
    amount,
    ...(taxWithheld === undefined ? {} : { taxWithheld }),
  });

  it('taxesPaid sums the FIELD, and attributes it to the payout’s own asset', () => {
    const rows = [payout('p', 'dividend_accrual', 467.46, 65.44)];
    expect(taxesPaid(rows)).toBeCloseTo(65.44, 2);
    expect(taxesPaidByAsset(rows).a1).toBeCloseTo(65.44, 2);
    expect(payoutsGross(rows)).toBeCloseTo(467.46, 2);
    expect(payoutsNet(rows)).toBeCloseTo(402.02, 2);
    expect(payoutsNetByAsset(rows).a1).toBeCloseTo(402.02, 2);
  });

  it('a payout carrying none contributes nothing and keys no asset', () => {
    const rows = [payout('p', 'interest_payout', 100)];
    expect(taxesPaid(rows)).toBe(0);
    expect(taxesPaidByAsset(rows)).toEqual({});
    expect(payoutsNetByAsset(rows).a1).toBeCloseTo(100, 2);
  });

  it('cross-asset attribution stops existing rather than being handled', () => {
    // A `tax` row could name a DIFFERENT asset than the payout it settled, and
    // `payoutsNetByAsset` then netted the wrong position. A field cannot.
    const rows = [
      payout('p1', 'dividend_accrual', 467.46, 65.44, 'reit'),
      payout('p2', 'interest_payout', 100, 18, 'ovdp8976'),
    ];
    expect(taxesPaidByAsset(rows)).toEqual({ reit: 65.44, ovdp8976: 18 });
    expect(payoutsNetByAsset(rows).reit).toBeCloseTo(402.02, 2);
    expect(payoutsNetByAsset(rows).ovdp8976).toBeCloseTo(82, 2);
  });

  it('incomeReceivedNet splits the withholding by CATEGORY, exactly', () => {
    // A `tax` row carried an asset and not which payout it taxed, so dividends and
    // coupons could only be reported gross with one net total beneath them. The field
    // knows which payout it came from.
    const rows = [
      payout('d', 'dividend_accrual', 467.46, 65.44),
      payout('c', 'interest_payout', 100, 18),
    ];
    expect(incomeReceivedNet(rows)).toEqual({
      dividends: 402.02,
      coupons: 82,
      taxes: 83.44,
      total: 484.02,
    });
    // The GROSS figure is untouched — it backs the pinned KPI.
    expect(incomeReceived(rows).total).toBeCloseTo(567.46, 2);
  });
});

describe('the withholding totals do not trust a CHECK core cannot reach', () => {
  // A DDL CHECK is not reachable from `core/`, which is why `POSITION_MOVING` is
  // mirrored here rather than cited. An ungated sum would let a row the store forbids
  // — hand-edited into a backup, or written by a door that forgets — count in the
  // portfolio total while filing itself under the EMPTY key, read by no per-asset
  // consumer. That is the failure the widened CHECK exists to prevent, arriving
  // through the one place the CHECK cannot see.
  const rogue: Transaction = {
    id: 'r',
    date: '2026-03-01',
    type: 'deposit',
    assetId: '',
    amount: 1000,
    taxWithheld: 10,
  };

  it('ignores a withholding on a row that is not a payout', () => {
    expect(taxesPaid([rogue])).toBe(0);
    expect(taxesPaidByAsset([rogue])).toEqual({});
    expect(payoutsNetByAsset([rogue])).toEqual({});
    // The THIRD gate, on the same fixture: three functions read this field and they
    // have to agree about which rows carry it, or the portfolio total and the
    // per-category split drift apart on a row neither should have counted.
    expect(incomeReceivedNet([rogue])).toEqual({
      dividends: 0,
      coupons: 0,
      taxes: 0,
      total: 0,
    });
  });

  it('still counts the ones that ARE payouts, beside it', () => {
    const real = { ...tx('p', 'interest_payout', 100, 'a1'), taxWithheld: 18 };
    expect(taxesPaid([rogue, real])).toBeCloseTo(18, 2);
    expect(taxesPaidByAsset([rogue, real])).toEqual({ a1: 18 });
  });
});
