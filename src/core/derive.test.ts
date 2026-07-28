import { describe, expect, it } from 'vitest';

import {
  annualizedPct,
  headlineKpis,
  headlineTotal,
  incomeReceived,
  latestCash,
  latestCompleteSnapshot,
  latestQuotes,
  netResult,
  PORTFOLIO_START,
  sharePct,
  topUpAmount,
  totalCapital,
  trimAmount,
  yieldSinceStart,
} from './derive';
import type { Snapshot, Transaction } from './types';

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
    expect(PORTFOLIO_START).toBe('2026-02-03');
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
