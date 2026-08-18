import { describe, expect, it } from 'vitest';

import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '../../lib/seed';
import type { Asset, Snapshot, Transaction } from '../../core/types';
import { cumulativeYieldSeries, xirrIsExtrapolated, yieldTableRows } from './yield';

const snaps = buildSeedSnapshots();

describe('yieldTableRows', () => {
  const rows = yieldTableRows(SEED_ASSETS, snaps, SEED_TRANSACTIONS);

  it('REIT: +4.41% total, +9.3% annualized (global 174-day basis), -4.7pp vs expected', () => {
    const reit = rows.find((r) => r.asset.id === 'reit')!;
    expect(reit.deltaTotal).toBeCloseTo(0.0441, 3);
    expect(reit.annualized).toBeCloseTo(0.0925, 3);
    expect(reit.vsExpectedPp).toBeCloseTo(-4.7, 1);
  });

  it('Energy: +1.48% total, +3.1% annualized, -6.9pp vs expected', () => {
    const energy = rows.find((r) => r.asset.id === 'energy')!;
    expect(energy.deltaTotal).toBeCloseTo(0.0148, 3);
    expect(energy.annualized).toBeCloseTo(0.0311, 3);
    expect(energy.vsExpectedPp).toBeCloseTo(-6.9, 1);
  });

  it('…8976: +2.96% total, +6.2% annualized, -10.2pp vs expected', () => {
    const b = rows.find((r) => r.asset.id === 'ovdp8976')!;
    expect(b.deltaTotal).toBeCloseTo(0.0296, 3);
    expect(b.annualized).toBeCloseTo(0.0622, 3);
    expect(b.vsExpectedPp).toBeCloseTo(-10.2, 1);
  });

  it('…6475 uses the GLOBAL portfolio-start basis: +10.9% (NOT +34.5% per-asset basis, D5#5)', () => {
    const b = rows.find((r) => r.asset.id === 'ovdp6475')!;
    expect(b.deltaTotal).toBeCloseTo(0.052, 3);
    expect(b.annualized).toBeCloseTo(0.109, 2);
    expect(b.vsExpectedPp).toBeCloseTo(-4.3, 1);
  });

  it('an asset with no quote yet reports undefined figures instead of a bogus huge negative % (empty-state guard)', () => {
    // No snapshots at all -> every asset is unquoted, even though invested
    // capital exists — must not compute yieldSinceStart(0, invested) = -100%
    // scaled up by the annualization factor.
    const noQuoteRows = yieldTableRows(SEED_ASSETS, [], SEED_TRANSACTIONS);
    for (const r of noQuoteRows) {
      expect(r.value).toBeUndefined();
      expect(r.deltaTotal).toBeUndefined();
      expect(r.annualized).toBeUndefined();
      expect(r.vsExpectedPp).toBeUndefined();
    }
  });

  it('an asset with invested capital but no quote is undefined even when OTHER assets are quoted', () => {
    const onlyReit: Snapshot[] = [{ date: '2026-07-25', cash: 7.75, quotes: { reit: 68629.36 } }];
    const partialRows = yieldTableRows(SEED_ASSETS, onlyReit, SEED_TRANSACTIONS);
    const reit = partialRows.find((r) => r.asset.id === 'reit')!;
    const energy = partialRows.find((r) => r.asset.id === 'energy')!;
    expect(reit.value).toBe(68629.36);
    expect(reit.deltaTotal).toBeDefined();
    expect(energy.value).toBeUndefined();
    expect(energy.deltaTotal).toBeUndefined();
    expect(energy.totalReturn).toBeUndefined();
    expect(energy.xirr).toBeUndefined();
  });

  // S9b new columns — demo derivations via core/derive + core/xirr (the
  // extension mock cells are illustrative; these figures are the app's).
  it('Total return (net of tax, incl. payouts): REIT +10.12%, Energy +1.48%, …8976 +10.65%, …6475 +10.96%', () => {
    const byId = Object.fromEntries(rows.map((r) => [r.asset.id, r]));
    expect(byId.reit.totalReturn! * 100).toBeCloseTo(10.1248, 3);
    expect(byId.energy.totalReturn! * 100).toBeCloseTo(1.4831, 3);
    expect(byId.ovdp8976.totalReturn! * 100).toBeCloseTo(10.655, 3);
    expect(byId.ovdp6475.totalReturn! * 100).toBeCloseTo(10.9619, 3);
  });

  it('XIRR (money-weighted, ACT/365): REIT +23.0%, Energy +3.1%, …8976 +25.8%, …6475 +99.4%', () => {
    const byId = Object.fromEntries(rows.map((r) => [r.asset.id, r]));
    expect(byId.reit.xirr! * 100).toBeCloseTo(23.05, 1);
    expect(byId.energy.xirr! * 100).toBeCloseTo(3.14, 1);
    expect(byId.ovdp8976.xirr! * 100).toBeCloseTo(25.81, 1);
    expect(byId.ovdp6475.xirr! * 100).toBeCloseTo(99.43, 1);
  });
});

// The audit's illusion-of-loss triple (FORMULA-AUDIT §2, real …6475 shape):
// capital-gain −2.6% coexists with total return +5.30% — the columns MAY
// disagree by design.
describe('yieldTableRows — illusion-of-loss fixture (capital gain vs total return)', () => {
  const bond: Asset = {
    id: 'b6475',
    name: 'OVDP UA4000236475',
    code: 'GB',
    colorKey: 'ovdp6475',
    yieldType: 'fixed_coupon',
    expectedPct: 15.2,
    targetPct: 3,
    payoutSchedule: 'semiannual',
    firstPurchase: '2026-02-03',
    createdAt: '2026-02-03T10:00:00',
  };
  const txs: Transaction[] = [
    { id: 'b', date: '2026-02-03', type: 'buy', assetId: 'b6475', amount: 4496.4, source: 'own' },
    { id: 'c', date: '2026-05-05', type: 'interest_payout', assetId: 'b6475', amount: 355.4, source: 'accrual' },
  ];
  const snapsOne: Snapshot[] = [{ date: '2026-07-27', cash: 0, quotes: { b6475: 4379.52 } }];
  const row = yieldTableRows([bond], snapsOne, txs)[0];

  it('Δ total (capital-gain family) reads −2.6% — the "loss"', () => {
    expect(row.deltaTotal! * 100).toBeCloseTo(-2.6, 1);
  });

  it('Total return reads +5.30% — the honest net figure (audit-pinned)', () => {
    expect(row.totalReturn! * 100).toBeCloseTo(5.3, 2);
  });

  it('XIRR is positive too (payout + terminal value beat the buy)', () => {
    expect(row.xirr).not.toBeNull();
    expect(row.xirr!).toBeGreaterThan(0);
  });
});

describe('yieldTableRows — xirr column wiring (flow signs)', () => {
  const asset: Asset = {
    id: 'a1',
    name: 'Test Asset',
    code: 'TA',
    colorKey: 'reit',
    yieldType: 'capitalization',
    expectedPct: 10,
    targetPct: 100,
    payoutSchedule: 'none',
    firstPurchase: '2026-01-01',
    createdAt: '2026-01-01T10:00:00',
  };
  const buy: Transaction = {
    id: 'b1', date: '2026-01-01', type: 'buy', assetId: 'a1', amount: 1000, source: 'own',
  };
  const oneYearLater: Snapshot[] = [{ date: '2027-01-01', cash: 0, quotes: { a1: 1080 } }];

  it('known-good: −1,000 buy → +1,080 terminal over exactly one year = 8% (audit §6.1 fixture)', () => {
    const row = yieldTableRows([asset], oneYearLater, [buy])[0];
    expect(row.xirr).toBeCloseTo(0.08, 9);
  });

  it('a tax row is a negative flow: xirr drops below the no-tax rate (net-of-tax wiring)', () => {
    const tax: Transaction = {
      id: 't1', date: '2026-07-01', type: 'tax', assetId: 'a1', amount: 30, source: 'own',
    };
    const noTax = yieldTableRows([asset], oneYearLater, [buy])[0].xirr!;
    const withTax = yieldTableRows([asset], oneYearLater, [buy, tax])[0].xirr!;
    expect(withTax).toBeLessThan(noTax);
  });

  it('deposit/withdrawal rows carrying the assetId are NOT asset flows (portfolio-level cash)', () => {
    const deposit: Transaction = {
      id: 'd1', date: '2026-06-01', type: 'deposit', assetId: 'a1', amount: 500, source: 'own',
    };
    const withdrawal: Transaction = {
      id: 'w1', date: '2026-06-02', type: 'withdrawal', assetId: 'a1', amount: 200, source: 'own',
    };
    const base = yieldTableRows([asset], oneYearLater, [buy])[0].xirr!;
    const withCashMoves = yieldTableRows([asset], oneYearLater, [buy, deposit, withdrawal])[0].xirr!;
    expect(withCashMoves).toBeCloseTo(base, 12);
  });
});

describe('xirrIsExtrapolated (the "(ann.)" header token)', () => {
  it('true on the demo seed (03.02 → 27.07 = 174 days < 365)', () => {
    expect(xirrIsExtrapolated(SEED_ASSETS, snaps, SEED_TRANSACTIONS)).toBe(true);
  });

  it('false once the latest snapshot is a full year past the derived start', () => {
    // A24 rewrote this case rather than only its arguments. It used to hand in
    // one 2027 snapshot and lean on the constant for the other end; with a
    // derived start that snapshot would be BOTH ends and the span would be
    // zero. The seed's assets and transactions now supply the 2026-02-03 end,
    // which is the relationship the token actually depends on.
    const yearOn: Snapshot[] = [{ date: '2027-02-03', cash: 0, quotes: { reit: 70000 } }];
    expect(xirrIsExtrapolated(SEED_ASSETS, yearOn, SEED_TRANSACTIONS)).toBe(false);
  });

  it('true with no snapshots at all', () => {
    expect(xirrIsExtrapolated(SEED_ASSETS, [], SEED_TRANSACTIONS)).toBe(true);
  });

  it('true on a wholly empty dataset — no start, nothing to relativize', () => {
    expect(xirrIsExtrapolated([], [], [])).toBe(true);
  });
});

describe('cumulativeYieldSeries', () => {
  const series = cumulativeYieldSeries(snaps, SEED_TRANSACTIONS, SEED_ASSETS);

  it('starts at the first snapshot date', () => {
    expect(series[0].date).toBe('2026-02-03');
  });

  it('…6475 has no entry before its 02.06 first purchase', () => {
    const feb = series.find((p) => p.date === '2026-02-10')!;
    expect(feb.ovdp6475).toBeUndefined();
  });

  it('…6475 appears from 02.06 onward', () => {
    const jun2 = series.find((p) => p.date === '2026-06-02')!;
    expect(jun2.ovdp6475).toBeDefined();
  });

  it("reit's series ends at 07.27 matching the table Δ +4.41% (headline uses the partial-row quote)", () => {
    const last = series[series.length - 1];
    expect(last.date).toBe('2026-07-27');
    expect(last.reit).toBeCloseTo(4.41, 1);
    expect(last.energy).toBeUndefined();
  });

  it("energy's last defined point (07.25) matches its table Δ +1.48% (unaffected by the partial row)", () => {
    const jul25 = series.find((p) => p.date === '2026-07-25')!;
    expect(jul25.energy).toBeCloseTo(1.48, 1);
  });
});
