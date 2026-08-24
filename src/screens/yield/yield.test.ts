import { describe, expect, it } from 'vitest';

import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '../../lib/seed';
import type { Asset, Snapshot, Transaction } from '../../core/types';
import {
  cumulativeYieldSeries,
  cumulativeYieldSeriesIn,
  xirrIsExtrapolated,
  yieldTableRows,
  yieldTableRowsIn,
} from './yield';
import { resolveWindow } from '../../core/period';
import type { PeriodOption } from '../../core/period';
import { portfolioStart } from '../../core/derive';
import { latestSnapshotDate } from '../../core/dates';

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

describe('yieldTableRowsIn (A39) — the window, and what reduces', () => {
  const full = resolveWindow('all', '2026-02-03', '2026-07-27')!;
  const byId = (rows: ReturnType<typeof yieldTableRows>) =>
    Object.fromEntries(rows.map((r) => [r.asset.id, r]));

  it('THE FULL HISTORY IS NOT A SPECIAL CASE — it reduces exactly', () => {
    // The property the whole design hangs on, and the reason `yieldTableRows`
    // is allowed to delegate. If this ever fails, two implementations have
    // started to disagree and every D5-pinned figure is in play.
    expect(yieldTableRowsIn(SEED_ASSETS, snaps, SEED_TRANSACTIONS, full)).toEqual(
      yieldTableRows(SEED_ASSETS, snaps, SEED_TRANSACTIONS),
    );
  });

  it('a shorter window keeps Δ almost still while `Річна` triples — F-2, measured', () => {
    // The finding the extension spent a page on: `annualizedPct` is LINEAR, so
    // a 30-day window multiplies by 365/30 = 12,17. …6475 is the row that shows
    // it, because its Δ barely moves between windows.
    const w = (o: 'all' | '3m' | '1m') => resolveWindow(o, '2026-02-03', '2026-07-27')!;
    const at = (o: 'all' | '3m' | '1m') =>
      byId(yieldTableRowsIn(SEED_ASSETS, snaps, SEED_TRANSACTIONS, w(o))).ovdp6475;

    // `all` and `3m` contain the SAME FLOWS for this asset — bought 02.06, after
    // 27.04 — so Δ may not move between them. `Річна` must, and by exactly the
    // ratio of the two spans: 174 / 91 = 1,91. That is the whole of F-2, and a
    // first draft of this test asserted the two were equal, which is the belief
    // the finding exists to correct.
    expect(at('3m').deltaTotal).toBeCloseTo(at('all').deltaTotal!, 10);
    expect(at('3m').annualized! / at('all').annualized!).toBeCloseTo(174 / 91, 2);
    expect(at('3m').annualized! * 100).toBeCloseTo(20.8, 1);

    // 1 місяць opens after the purchase, so the basis becomes the position it
    // inherited and the annualized figure amplifies.
    expect(at('1m').deltaTotal! * 100).toBeCloseTo(2.77, 1);
    expect(at('1m').annualized! * 100).toBeGreaterThan(30);
    expect(at('all').annualized! * 100).toBeCloseTo(10.9, 1);
  });

  it('a SELL inside the window is not a loss — the case the seed cannot show (F-7)', () => {
    // The seed has no disposals, which is exactly why the sheet's formula could
    // omit the term for three review rounds without a single figure moving.
    //
    // A FIRST DRAFT OF THIS TEST COULD NOT FAIL (A39 review): it added proceeds
    // to the numerator and left the quote alone, so `withSell > without` was
    // true by construction and would have passed for `+ 2 * sold` too. A real
    // disposal REDUCES THE POSITION, so the fixture drops the quote by the same
    // 10 000 the sale returned — and the return must then be unchanged, because
    // selling at market moves no value.
    const asset = SEED_ASSETS.find((a) => a.id === 'energy')!;
    const sold: Transaction = {
      id: 'sell-test',
      date: '2026-07-01',
      type: 'sell',
      assetId: 'energy',
      amount: 10_000,
      source: 'own',
    };
    const reduced: Snapshot[] = snaps.map((s) =>
      s.date >= '2026-07-01' && s.quotes.energy !== undefined
        ? { ...s, quotes: { ...s.quotes, energy: s.quotes.energy - 10_000 } }
        : s,
    );
    const w = resolveWindow('1m', '2026-02-03', '2026-07-27')!;
    const withSell = yieldTableRowsIn([asset], reduced, [...SEED_TRANSACTIONS, sold], w)[0];
    const without = yieldTableRowsIn([asset], snaps, SEED_TRANSACTIONS, w)[0];

    // Selling at market is return-neutral. Drop the `+ sold` term and this row
    // reports a double-digit loss on a position that merely returned cash.
    expect(withSell.deltaTotal! * 100).toBeCloseTo(without.deltaTotal! * 100, 1);
    expect(withSell.deltaTotal!).toBeGreaterThan(0);
  });
});

describe('the two regressions A39 shipped and its review caught', () => {
  it('a buy entered AFTER the last snapshot still counts, on every window', () => {
    // Transactions are entered daily; snapshots are not. Clipping flows at the
    // window's top dropped them, so `/yield` reported 65 800 for an asset
    // `/portfolio` reported 115 800 for — on the DEFAULT screen.
    const later: Transaction = {
      id: 'late-buy',
      date: '2026-08-05',
      type: 'buy',
      assetId: 'reit',
      amount: 50_000,
      source: 'own',
    };
    const rows = yieldTableRows(SEED_ASSETS, snaps, [...SEED_TRANSACTIONS, later]);
    expect(rows.find((r) => r.asset.id === 'reit')!.invested).toBe(115_800);
  });

  it('no snapshots is no VALUATION, not an empty ledger', () => {
    // `invested` renders unconditionally, so this read "Вкладено 0,00" beside
    // "Вартість зараз —" for anyone who had entered buys but saved no snapshot.
    const rows = yieldTableRows(SEED_ASSETS, [], SEED_TRANSACTIONS);
    expect(rows.find((r) => r.asset.id === 'reit')!.invested).toBe(65_800);
    expect(rows.find((r) => r.asset.id === 'reit')!.value).toBeUndefined();
  });

  it('a zero-length window annualizes NOTHING rather than fabricating a 0', () => {
    // `ytd` on 1 January resolves from === to. The old 0-guard was written for
    // an empty dataset where nothing rendered; with data present it produced a
    // "0,0 %" and a full-expected-rate miss that both read as measurements.
    const rows = yieldTableRowsIn(SEED_ASSETS, snaps, SEED_TRANSACTIONS, {
      from: '2026-07-27',
      to: '2026-07-27',
      clamped: false,
    });
    const reit = rows.find((r) => r.asset.id === 'reit')!;
    expect(reit.value).toBeDefined();
    expect(reit.annualized).toBeUndefined();
    expect(reit.vsExpectedPp).toBeUndefined();
  });
});

describe('cumulativeYieldSeriesIn (A39) — the half that had no tests', () => {
  const full = resolveWindow('all', '2026-02-03', '2026-07-27')!;

  it('reduces exactly, the same claim the table makes', () => {
    expect(cumulativeYieldSeriesIn(snaps, SEED_TRANSACTIONS, SEED_ASSETS, full)).toEqual(
      cumulativeYieldSeries(snaps, SEED_TRANSACTIONS, SEED_ASSETS),
    );
  });

  it('clips its domain to the window', () => {
    const m1 = resolveWindow('1m', '2026-02-03', '2026-07-27')!;
    const pts = cumulativeYieldSeriesIn(snaps, SEED_TRANSACTIONS, SEED_ASSETS, m1);
    expect(pts.length).toBeGreaterThan(0);
    expect(pts[0].date >= m1.from).toBe(true);
    expect(pts[pts.length - 1].date).toBe(m1.to);
  });

  it('rebases against the inherited position, so the curve opens near zero', () => {
    // Not merely clipped: a window's first point measures the window, so it
    // starts near 0 rather than at the since-inception figure. Dropping the
    // `dayBefore` basis or the `>= from` clause on the buy filter breaks this
    // and nothing else in the suite notices.
    const m1 = resolveWindow('1m', '2026-02-03', '2026-07-27')!;
    const first = cumulativeYieldSeriesIn(snaps, SEED_TRANSACTIONS, SEED_ASSETS, m1)[0];
    const sinceStart = cumulativeYieldSeries(snaps, SEED_TRANSACTIONS, SEED_ASSETS).find(
      (p) => p.date === first.date,
    )!;
    expect(Math.abs(first.reit as number)).toBeLessThan(1);
    expect(sinceStart.reit as number).toBeGreaterThan(3);
  });
});

describe('shortBasis — F-3/D80, the rows whose basis their holding cannot support', () => {
  const rowsAt = (period: PeriodOption) => {
    const w = resolveWindow(
      period,
      portfolioStart(SEED_ASSETS, snaps, SEED_TRANSACTIONS),
      latestSnapshotDate(snaps),
    );
    return yieldTableRowsIn(SEED_ASSETS, snaps, SEED_TRANSACTIONS, w);
  };
  const mark = (period: PeriodOption, id: string) =>
    rowsAt(period).find((r) => r.asset.id === id)!.shortBasis;

  it('marks …6475 at Від початку — 55 days against a 174-day basis', () => {
    // The sheet's first pinned case. Bought 02.06.2026 into a basis that opens
    // 03.02.2026, so its +10,9 % is its +5,20 % spread over time it did not exist.
    expect(mark('all', 'ovdp6475')).toBe(true);
  });

  it('does NOT mark …8976 at Від початку, though it was bought after the start', () => {
    // The sheet's second pinned case, and the one that killed the predicate it
    // deleted: …8976 was bought 05.02.2026 against a 03.02.2026 start — two days
    // of a 174-day basis. A "first purchase after `from`" test fires here and
    // would have marked three cells while the drawing shows two.
    expect(mark('all', 'ovdp8976')).toBe(false);
    expect(mark('all', 'reit')).toBe(false);
    expect(mark('all', 'energy')).toBe(false);
  });

  it('never marks a row whose annualized is absent', () => {
    // The mark says "trust this figure less"; there is no figure to distrust.
    // Every seed row HAS an annualized at `all`, so this needs an asset with no
    // quote to reach the branch at all — a loop over the seed asserted nothing
    // and stayed green with the flag inverted (A41 review).
    const unquoted: Asset = { ...SEED_ASSETS[3]!, id: 'unquoted', firstPurchase: '2026-07-20' };
    const w = resolveWindow(
      'all',
      portfolioStart(SEED_ASSETS, snaps, SEED_TRANSACTIONS),
      latestSnapshotDate(snaps),
    );
    const row = yieldTableRowsIn(
      [...SEED_ASSETS, unquoted],
      snaps,
      SEED_TRANSACTIONS,
      w,
    ).find((r) => r.asset.id === 'unquoted')!;
    expect(row.annualized).toBeUndefined();
    expect(row.shortBasis).toBe(false);
  });

  it('marks in EVERY window, which is what D80 claims and only `all` was pinning', () => {
    // …6475 is bought 02.06.2026. Under `3 місяці` (27.04–27.07, 91 d) it holds
    // 55 of 91 — 39,6 % short, still marked. Under `1 місяць` (27.06–27.07) it
    // holds all 30, and the sheet's own errata says NOT to pin it as marked:
    // "it lived through the whole window and the rule says do NOT mark it".
    expect(mark('3m', 'ovdp6475')).toBe(true);
    expect(mark('1m', 'ovdp6475')).toBe(false);
    // …8976, bought 05.02.2026, lives through both windows entirely.
    expect(mark('3m', 'ovdp8976')).toBe(false);
    expect(mark('1m', 'ovdp8976')).toBe(false);
  });

  it('clamps the holding to the window rather than measuring from purchase', () => {
    // The `start > w.from ? start : w.from` clamp. Without it an asset bought
    // before the window opens measures from its purchase, so …8976 under
    // `1 місяць` would read 172 days against a 30-day basis — held > basis,
    // never short, right answer for the wrong reason — and REIT, bought at the
    // portfolio's own start, would too. The clamp is what makes the ratio mean
    // "of THIS window".
    expect(mark('1m', 'reit')).toBe(false);
    expect(mark('ytd', 'ovdp6475')).toBe(true);
  });

  it('leaves every D5-pinned figure byte-identical — it is a colour, not a suppression', () => {
    const r = rowsAt('all').find((x) => x.asset.id === 'ovdp6475')!;
    expect(r.shortBasis).toBe(true);
    expect(r.annualized! * 100).toBeCloseTo(10.9, 1);
  });
});


