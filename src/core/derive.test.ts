import { describe, expect, it } from 'vitest';

import {
  annualizedPct,
  capitalGain,
  capitalGainPct,
  cashAsOf,
  cashYieldPct,
  freeCashFromLedger,
  globalRoi,
  headlineKpis,
  headlineTotal,
  headlineTotalAsOf,
  incomeReceived,
  incomeReceivedNet,
  investedOwnByAsset,
  latestCash,
  latestCompleteSnapshot,
  latestQuotes,
  ledgerCashDrift,
  netDeposits,
  netResult,
  payoutsGross,
  payoutsGrossByAsset,
  payoutsNet,
  payoutsNetByAsset,
  portfolioStart,
  portfolioXirr,
  quotesAsOf,
  sharePct,
  soldAmount,
  soldAmountByAsset,
  taxesPaid,
  topUpAmount,
  totalCapital,
  totalNetProfit,
  totalReturnPct,
  transactionsIn,
  trimAmount,
  yieldSinceStart,
} from './derive';
import type { Asset, Snapshot, Transaction } from './types';

const complete2507: Snapshot = {
  date: '2026-07-25',
  cash: 7.75,
  savedAt: '2026-07-25T21:14:00',
  quotes: { reit: 68629.36, energy: 60086.09, ovdp8976: 15846.3, ovdp6475: 4374.12 },
};
const partial2707: Snapshot = { date: '2026-07-27', cash: 7.75, quotes: { reit: 68702.1 } };
const snaps = [complete2507, partial2707];
const ASSET_IDS = ['reit', 'energy', 'ovdp8976', 'ovdp6475'];
const invested = { reit: 65800, energy: 59208, ovdp8976: 15390, ovdp6475: 4158 };

describe('headline derivations (latest quote per asset, partials included)', () => {
  it('merges the partial snapshot over the last complete one', () => {
    expect(latestQuotes(snaps)).toEqual({
      reit: 68702.1,
      energy: 60086.09,
      ovdp8976: 15846.3,
      ovdp6475: 4374.12,
    });
  });

  it('headline total = Σ latest quotes + latest cash (sidebar / Overview / donut)', () => {
    expect(headlineTotal(snaps)).toBeCloseTo(149016.36, 2);
  });

  it('latest cash comes from the most recent snapshot', () => {
    expect(latestCash(snaps)).toBe(7.75);
  });

  it('net result excludes cash: +₴4,452.61 = +3.08% since 03.02', () => {
    const r = netResult(latestQuotes(snaps), invested);
    expect(r.uah).toBeCloseTo(4452.61, 2);
    expect(r.pct).toBeCloseTo(0.0308, 4);
  });

  it('headlineKpis composes total + net for the sidebar capital card', () => {
    const txs: Transaction[] = Object.entries(invested).map(([assetId, amount], i) => ({
      id: `b${i}`,
      date: '2026-02-03',
      type: 'buy',
      assetId,
      amount,
      source: 'own',
    }));
    const kpis = headlineKpis(snaps, txs);
    expect(kpis.total).toBeCloseTo(149016.36, 2);
    expect(kpis.net.uah).toBeCloseTo(4452.61, 2);
    expect(kpis.net.pct).toBeCloseTo(0.0308, 4);
  });
});

describe('snapshot-level derivations (Balances)', () => {
  it('totalCapital of one complete snapshot matches the 25.07 table row', () => {
    expect(totalCapital(complete2507)).toBeCloseTo(148943.62, 2);
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
    // The `expect(PORTFOLIO_START).toBe('2026-02-03')` that stood here was a
    // literal asserting a literal, and A24 deleted the literal. That the SEED
    // derives that same date — the assertion that actually protects the 174
    // below — lives in `lib/seed.test.ts`, because core may not import the seed
    // (G1) and the claim is about the seed's rows, not about core.
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

  it('trim is linear: REIT overweight → −₴9,095', () => {
    expect(trimAmount(sharePct(68702.1, 149016.36), 40, 149016.36)).toBeCloseTo(9095.56, 0);
  });

  it('top-up compounds the total: …8976 → ₴11,429 (reference prints 11,413 — D5#4)', () => {
    expect(topUpAmount(15846.3, 17, 149016.36)).toBeCloseTo(11429.49, 0);
  });
});

describe('income aggregation', () => {
  const txs: Transaction[] = [
    { id: 't1', date: '2026-02-10', type: 'dividend_accrual', assetId: 'reit', amount: 580.2, source: 'accrual' },
    { id: 't2', date: '2026-02-25', type: 'interest_payout', assetId: 'ovdp8976', amount: 1183.5, source: 'accrual' },
    { id: 't3', date: '2026-06-10', type: 'reinvest', assetId: 'reit', amount: 484.36, source: 'reinvest_reit' },
    { id: 't4', date: '2026-02-03', type: 'buy', assetId: 'reit', amount: 64628.62, source: 'own' },
    { id: 't5', date: '2026-02-03', type: 'deposit', assetId: '', amount: 123844.37, source: 'own' },
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
): Transaction => ({ id, date, type, assetId, amount, source: 'own' });

describe('§2.1 metric family: capital gain vs total return', () => {
  // The user's real …6475 position (plan's illusion-of-loss fixture):
  // invested own 4 496,40, value 4 379,52, coupons received 355,40, taxes 0.
  it('illusion of loss: capitalGain −₴116,88 but totalNetProfit +₴238,52', () => {
    expect(capitalGain(4379.52, 4496.4, 0)).toBeCloseTo(-116.88, 2);
    expect(totalNetProfit(4379.52, 355.4, 0, 4496.4, 0)).toBeCloseTo(238.52, 2);
  });

  it('totalReturnPct ≈ +5.30% on the illusion-of-loss fixture (denominator investedOwn)', () => {
    expect(totalReturnPct(4379.52, 355.4, 0, 4496.4, 0)! * 100).toBeCloseTo(5.3, 2);
    expect(capitalGainPct(4379.52, 4496.4, 0)! * 100).toBeCloseTo(-2.6, 1);
    expect(cashYieldPct(355.4, 4496.4, 0)! * 100).toBeCloseTo(7.9, 1);
  });

  it('payoutsNet subtracts tax rows: 467,46 payout − 65,44 tax = 402,02', () => {
    const rows = [tx('p', 'dividend_accrual', 467.46), tx('t', 'tax', 65.44)];
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
    const rows = [
      tx('s1', 'sell', 500),
      tx('rd', 'redemption', 1000, 'a2'),
      tx('b', 'buy', 2000),
    ];
    expect(soldAmount(rows)).toBe(1500);
    expect(soldAmountByAsset(rows)).toEqual({ a1: 500, a2: 1000 });
  });

  it('a tax row without any payout still nets negative per asset', () => {
    const rows = [tx('t', 'tax', 10, 'a9')];
    expect(payoutsGrossByAsset(rows)).toEqual({});
    expect(payoutsNetByAsset(rows)).toEqual({ a9: -10 });
  });

  it('incomeReceivedNet subtracts tax rows from the total; gross stays gross', () => {
    const rows = [
      tx('d', 'dividend_accrual', 467.46),
      tx('c', 'interest_payout', 100),
      tx('t', 'tax', 65.44),
    ];
    expect(incomeReceivedNet(rows)).toEqual({
      dividends: 467.46,
      coupons: 100,
      taxes: 65.44,
      total: 467.46 + 100 - 65.44,
    });
    expect(incomeReceived(rows).total).toBeCloseTo(567.46, 2); // untouched by taxes
  });

  it('zero-denominator guards return null, never NaN/Infinity', () => {
    expect(capitalGainPct(100, 0, 0)).toBeNull();
    expect(totalReturnPct(100, 10, 0, 0, 50)).toBeNull(); // reinvested alone is no denominator
    expect(cashYieldPct(10, 0, 0)).toBeNull();
    expect(globalRoi(100, 0)).toBeNull();
    expect(globalRoi(100, -5)).toBeNull(); // over-withdrawn: no external base to measure
  });
});

describe('§1 free cash from ledger (pinned v1 formulation)', () => {
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

  it('an unpaired payout is EXTERNAL — it never credits broker cash', () => {
    const base = [tx('d', 'deposit', 1000, ''), tx('b', 'buy', 900)];
    const withPayout = [...base, tx('p', 'dividend_accrual', 55.5)];
    expect(freeCashFromLedger(withPayout)).toBe(freeCashFromLedger(base));
  });

  it('a paired payout + reinvest nets to zero broker-cash effect', () => {
    const base = [tx('d', 'deposit', 1000, ''), tx('b', 'buy', 900)];
    const withPair = [...base, tx('p', 'interest_payout', 216), tx('r', 'reinvest', 216)];
    expect(freeCashFromLedger(withPair)).toBe(freeCashFromLedger(base));
  });

  it('tax rows are excluded (paid from the external payout, not broker cash)', () => {
    const base = [tx('d', 'deposit', 100, '')];
    expect(freeCashFromLedger([...base, tx('t', 'tax', 12)])).toBe(100);
  });

  it('empty ledger → 0, and ledgerCashDrift = stored − derived', () => {
    expect(freeCashFromLedger([])).toBe(0);
    expect(netDeposits([])).toBe(0);
    const rows = [tx('d', 'deposit', 100, ''), tx('b', 'buy', 90)];
    expect(ledgerCashDrift(10, rows)).toBe(0);
    expect(ledgerCashDrift(12.5, rows)).toBeCloseTo(2.5, 10);
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

  it('is unchanged when nothing was ever sold — the D5-pinned figure', () => {
    expect(netResult(values, invested).uah).toBeCloseTo(4452.61, 2);
    expect(netResult(values, invested, 0).uah).toBeCloseTo(4452.61, 2);
  });

  it('does NOT invert when a position is redeemed', () => {
    const rest = withoutRedeemed(values);
    // Without the sold term this reads as a total loss of the position.
    expect(netResult(rest, invested).uah).toBeCloseTo(-11393.69, 2);
    // With the proceeds counted, only the real capital difference remains:
    // 15 390,00 invested returned at 15 390,00 → the other assets' gain stands.
    expect(netResult(rest, invested, 15390).uah).toBeCloseTo(3996.31, 2);
  });

  it('carries a redemption above or below cost into the result', () => {
    const rest = withoutRedeemed(values);
    const atCost = netResult(rest, invested, 15390).uah;
    expect(netResult(rest, invested, 15500).uah - atCost).toBeCloseTo(110, 6);
    expect(netResult(rest, invested, 15000).uah - atCost).toBeCloseTo(-390, 6);
  });
});

// A24 — the portfolio start is derived, not declared. Written before the
// implementation: every case below failed until `portfolioStart` existed.
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
  const snap = (date: string): Snapshot => ({ date, quotes: {}, cash: 0 });
  const tx = (date: string): Transaction => ({
    id: date,
    date,
    type: 'buy',
    assetId: 'reit',
    amount: 1,
    source: 'own',
  });

  it('takes the EARLIEST of the three signals, not any one of them', () => {
    // Each source is the earliest in turn; the answer follows it every time.
    expect(portfolioStart([asset('a', '2026-05-01')], [snap('2026-04-01')], [tx('2026-03-01')])).toBe(
      '2026-03-01',
    );
    expect(portfolioStart([asset('a', '2026-05-01')], [snap('2026-02-01')], [tx('2026-03-01')])).toBe(
      '2026-02-01',
    );
    expect(portfolioStart([asset('a', '2026-01-01')], [snap('2026-02-01')], [tx('2026-03-01')])).toBe(
      '2026-01-01',
    );
  });

  it('trusts a firstPurchase that predates the whole ledger', () => {
    // The case the min() exists for: an asset added without back-filling. The
    // ledger says six months; the user says six years. Believing the ledger
    // would divide a six-year return by six months and print a fantasy.
    expect(portfolioStart([asset('a', '2020-01-01')], [snap('2026-02-03')], [tx('2026-02-03')])).toBe(
      '2020-01-01',
    );
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

// A25 — the portfolio's money-weighted rate. Written before the implementation.
describe('portfolioXirr', () => {
  let n = 0;
  const tx = (
    date: string,
    type: Transaction['type'],
    amount: number,
    assetId = '',
  ): Transaction => ({ id: `t${(n += 1)}`, date, type, amount, assetId, source: 'own' });

  it('solves a plain one-year 10%', () => {
    // 100 in, 110 out, 365 days apart. If this ever stops being 0.1 the day
    // count changed, not the portfolio.
    expect(portfolioXirr([tx('2026-01-01', 'deposit', 100)], 110, '2027-01-01')).toBeCloseTo(
      0.1,
      6,
    );
  });

  it('measures EXTERNAL capital only — internal flows never move it', () => {
    // The assertion that pins the definition. Buys, sells, reinvests, payouts
    // and taxes move money inside the portfolio's boundary; only deposits and
    // withdrawals cross it. Whatever the assets did is already in the terminal
    // value, so counting those rows again would double-count them.
    const external = [tx('2026-01-01', 'deposit', 100)];
    const alsoInternal = [
      ...external,
      tx('2026-02-01', 'buy', 60, 'a'),
      tx('2026-03-01', 'sell', 20, 'a'),
      tx('2026-04-01', 'interest_payout', 5, 'a'),
      tx('2026-05-01', 'reinvest', 5, 'a'),
      tx('2026-06-01', 'tax', 1, 'a'),
      tx('2026-07-01', 'dividend_accrual', 3, 'a'),
      tx('2026-08-01', 'redemption', 10, 'a'),
    ];
    expect(portfolioXirr(alsoInternal, 110, '2027-01-01')).toBe(
      portfolioXirr(external, 110, '2027-01-01'),
    );
  });

  it('a withdrawal is an inflow to the investor, a deposit an outflow', () => {
    // Take 50 back at six months and still hold 60: the same 100 in, so the
    // early return has to beat the 10% of the first test.
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
    // `assetCashFlows` documents the same trap from the other side: the
    // transaction form attaches the selected asset to every row, so a deposit
    // carries an assetId it has no business having.
    expect(portfolioXirr([tx('2026-01-01', 'deposit', 100, 'reit')], 110, '2027-01-01')).toBeCloseTo(
      0.1,
      6,
    );
  });
});

// A27 — the bounded twins of the headline accessors (Phase 8 brief § G-5).
// Written before the implementation.
describe('windowed accessors', () => {
  const tx = (date: string, amount: number): Transaction => ({
    id: date,
    date,
    type: 'deposit',
    assetId: '',
    amount,
    source: 'own',
  });

  it('quotesAsOf merges only the snapshots up to and including the date', () => {
    // The partial 27.07 carries REIT alone. Bounded at 25.07 it must not be
    // seen at all — the merge is what makes this subtle, since a bound that
    // leaked would show 68 702,10 with the other three assets from 25.07 and
    // look entirely plausible.
    expect(quotesAsOf(snaps, '2026-07-25')).toEqual({
      reit: 68629.36,
      energy: 60086.09,
      ovdp8976: 15846.3,
      ovdp6475: 4374.12,
    });
    expect(quotesAsOf(snaps, '2026-07-27').reit).toBe(68702.1);
    expect(quotesAsOf(snaps, '2026-07-26').reit).toBe(68629.36);
  });

  it('is empty before the first snapshot rather than guessing', () => {
    expect(quotesAsOf(snaps, '2026-07-24')).toEqual({});
    expect(headlineTotalAsOf(snaps, '2026-07-24')).toBe(0);
  });

  it('the unbounded accessors are the same function with no bound', () => {
    // One implementation of the merge, two names. A second copy of this
    // arithmetic would be a second answer.
    expect(quotesAsOf(snaps)).toEqual(latestQuotes(snaps));
    expect(cashAsOf(snaps)).toBe(latestCash(snaps));
    expect(headlineTotalAsOf(snaps)).toBeCloseTo(headlineTotal(snaps), 10);
  });

  it('cashAsOf takes the last snapshot at or before the date, not the last of all', () => {
    const withCashMove: Snapshot[] = [
      { date: '2026-07-20', cash: 500, quotes: {} },
      ...snaps,
    ];
    expect(cashAsOf(withCashMove, '2026-07-20')).toBe(500);
    expect(cashAsOf(withCashMove, '2026-07-25')).toBe(7.75);
    expect(cashAsOf(withCashMove, '2026-07-19')).toBe(0);
  });

  it('headlineTotalAsOf is Σ quotes + cash at the same instant', () => {
    expect(headlineTotalAsOf(snaps, '2026-07-25')).toBeCloseTo(68629.36 + 60086.09 + 15846.3 + 4374.12 + 7.75, 2);
  });

  it('transactionsIn is INCLUSIVE at both ends, and that is the whole point of it existing', () => {
    // G-5: three screens each writing their own boundary test is three chances
    // to disagree about whether the opening day counts. It does, at both ends.
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
